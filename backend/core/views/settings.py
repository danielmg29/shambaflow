"""
ShambaFlow – Settings Views  (fixed)
=====================================
Bugs fixed in this version:
  BUG-2  coop.type / get_type_display()
         → coop.cooperative_type / get_cooperative_type_display()

  BUG-3  user.role used everywhere — field does not exist on User model.
         User has user_type (CHAIR/HELPER/BUYER) and helper_role (MANAGER/…).
         _require_chair now checks user.user_type == "CHAIR"
         exclude(role=…)  →  exclude(user_type="CHAIR")
         _serialize_user_role uses helper_role / user_type
         role_detail save uses update_fields=["helper_role"]

  BUG-4  create_user(role=role, must_reset_password=True)
         → User.objects.create_helper() which sets user_type="HELPER",
           helper_role=role, must_change_password=True automatically.

  BUG-5  coop.chair accessed without null guard
         → _serialize_chair() handles None safely.

  BUG-6  VerificationDocument.objects.create(uploaded_at=timezone.now())
         → removed; field is auto_now_add, Django sets it automatically.
"""

import os
import uuid
import secrets
from datetime import timedelta

from django.utils import timezone
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import (
    Cooperative,
    User,
    RolePermission,
    NotificationPreference,
    VerificationDocument,
    Invitation,
)
from core.services.brevo_email import send_invitation_email
from core.services.infobip_sms import send_invitation_sms


# ── Constants ──────────────────────────────────────────────────────────────────

HELPER_ROLES = [
    "MANAGER",
    "TREASURER",
    "CLERK",
    "DATA_OFFICER",
    "EXTENSION_OFFICER",
]

MODULES = [
    "MEMBERS",
    "PRODUCTION",
    "LIVESTOCK",
    "GOVERNANCE",
    "FINANCE",
    "FORM_BUILDER",
]

ALLOWED_DOCUMENT_TYPES = [
    "REGISTRATION_CERTIFICATE",
    "TAX_COMPLIANCE",
    "AUDITED_ACCOUNTS",
    "CONSTITUTION",
    "MINUTES_AGM",
    "OTHER",
]

ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx"}
MAX_FILE_SIZE_MB = 10


# ── Private helpers ────────────────────────────────────────────────────────────

def _get_cooperative_or_404(cooperative_id: str):
    """Return (cooperative, None) or (None, Response 404)."""
    try:
        coop = Cooperative.objects.get(pk=cooperative_id)
        return coop, None
    except (Cooperative.DoesNotExist, ValueError):
        return None, Response({"error": "Cooperative not found."}, status=404)


def _require_chair(user, cooperative):
    """
    Return None if the user is the Chair of this cooperative.
    Return a 403 Response otherwise.

    FIX BUG-3: User model has no `role` field.
    Chairs have user_type == "CHAIR".
    """
    if user.user_type != "CHAIR" or str(user.cooperative_id) != str(cooperative.id):
        return Response(
            {"error": "Only the Cooperative Chair can perform this action."},
            status=403,
        )
    return None


def _is_member_of(user, cooperative) -> bool:
    """True if this user belongs to the cooperative (any user_type)."""
    return str(user.cooperative_id) == str(cooperative.id)


def _serialize_chair(chair) -> dict | None:
    """Null-safe serialisation of the cooperative's Chair. FIX BUG-5."""
    if chair is None:
        return None
    return {
        "id": str(chair.id),
        "name": f"{chair.first_name} {chair.last_name}".strip() or chair.email,
        "email": chair.email,
    }


def _serialize_user_role(user: User, cooperative_id) -> dict:
    """
    Serialise a helper with their module permissions.

    FIX BUG-3: expose helper_role (MANAGER/CLERK/…) as 'role' for the
    frontend, since the frontend UI still calls it 'role'. user_type is
    returned separately for type discrimination.
    """
    perms = RolePermission.objects.filter(
        user=user, cooperative_id=cooperative_id
    ).values(
        "module", "can_view", "can_create",
        "can_edit", "can_delete", "can_edit_templates",
    )
    return {
        "id": str(user.id),
        "first_name": user.first_name,
        "last_name": user.last_name,
        "email": user.email,
        "phone_number": user.phone_number,
        "role": user.helper_role,       # FIX BUG-3
        "user_type": user.user_type,    # FIX BUG-3
        "is_active": user.is_active,
        "date_joined": user.date_joined.isoformat(),
        "last_login": user.last_login.isoformat() if user.last_login else None,
        "permissions": list(perms),
    }


def _serialize_notification_pref(pref) -> dict:
    """Serialise notification prefs, falling back to all-True defaults."""
    keys = [
        "email_invitations", "email_tender_updates",
        "email_verification_alerts", "email_system_announcements",
        "sms_invitations", "sms_otp",
        "sms_tender_updates", "sms_critical_alerts",
    ]
    if pref is None:
        return {k: True for k in keys}
    return {k: getattr(pref, k) for k in keys}


def _serialize_verification_doc(doc: VerificationDocument) -> dict:
    return {
        "id": str(doc.id),
        "document_type": doc.document_type,
        "document_type_display": doc.get_document_type_display(),
        "file_url": doc.file.url if doc.file else None,
        "file_name": doc.file_name,
        "uploaded_at": doc.uploaded_at.isoformat(),
        "status": doc.status,
        "status_display": doc.get_status_display(),
        "notes": doc.notes,
    }


# ── 1. Cooperative Profile ─────────────────────────────────────────────────────

@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def cooperative_profile_settings(request, cooperative_id: str):
    """GET cooperative profile (any member) / PUT update it (Chair only)."""
    coop, err = _get_cooperative_or_404(cooperative_id)
    if err:
        return err

    if not _is_member_of(request.user, coop):
        return Response({"error": "Access denied."}, status=403)

    if request.method == "GET":
        return Response({
            "id": str(coop.id),
            "name": coop.name,
            "registration_number": coop.registration_number,
            # FIX BUG-2: cooperative_type, not type
            "type": coop.cooperative_type,
            "type_display": coop.get_cooperative_type_display(),
            "region": coop.region,
            "county": coop.county or "",
            "description": coop.description or "",
            "website": coop.website or "",
            "physical_address": coop.physical_address or "",
            "verification_status": coop.verification_status,
            "verification_status_display": coop.get_verification_status_display(),
            "created_at": coop.created_at.isoformat(),
            "updated_at": coop.updated_at.isoformat(),
            # FIX BUG-5: null-safe
            "chair": _serialize_chair(coop.chair),
            "total_members": coop.members.count(),
        })

    # PUT – Chair only
    err = _require_chair(request.user, coop)
    if err:
        return err

    for field in ["name", "region", "county", "description", "website", "physical_address"]:
        if field in request.data:
            setattr(coop, field, request.data[field])

    coop.save()
    return Response({
        "message": "Cooperative profile updated.",
        "updated_at": coop.updated_at.isoformat(),
    })


# ── 2. Notification Preferences ───────────────────────────────────────────────

@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def notification_preferences(request, cooperative_id: str):
    """GET/PUT the current user's notification preferences."""
    coop, err = _get_cooperative_or_404(cooperative_id)
    if err:
        return err

    if not _is_member_of(request.user, coop):
        return Response({"error": "Access denied."}, status=403)

    pref, _ = NotificationPreference.objects.get_or_create(
        user=request.user,
        cooperative=coop,
        defaults={k: True for k in _serialize_notification_pref(None)},
    )

    if request.method == "GET":
        return Response(_serialize_notification_pref(pref))

    # PUT
    for field in _serialize_notification_pref(None):
        if field in request.data:
            setattr(pref, field, bool(request.data[field]))
    pref.save()

    return Response({
        "message": "Notification preferences updated.",
        **_serialize_notification_pref(pref),
    })


# ── 3. Role Management ────────────────────────────────────────────────────────

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def role_management(request, cooperative_id: str):
    """GET helper accounts / POST invite a new helper (Chair only)."""
    coop, err = _get_cooperative_or_404(cooperative_id)
    if err:
        return err

    if not _is_member_of(request.user, coop):
        return Response({"error": "Access denied."}, status=403)

    if request.method == "GET":
        # FIX BUG-3: filter by user_type, not the non-existent role field
        helpers = (
            User.objects
            .filter(cooperative=coop)
            .exclude(user_type="CHAIR")
            .select_related("cooperative")
        )
        data = [_serialize_user_role(u, coop.id) for u in helpers]
        return Response({"helpers": data, "total": len(data)})

    # POST – Chair only
    err = _require_chair(request.user, coop)
    if err:
        return err

    required = ["first_name", "last_name", "email", "role"]
    missing = [f for f in required if not request.data.get(f)]
    if missing:
        return Response(
            {"error": f"Missing required fields: {', '.join(missing)}"},
            status=400,
        )

    role = request.data["role"].upper()
    if role not in HELPER_ROLES:
        return Response(
            {"error": f"Invalid role. Must be one of: {', '.join(HELPER_ROLES)}"},
            status=400,
        )

    email = request.data["email"].lower().strip()
    if User.objects.filter(email=email).exists():
        return Response({"error": "A user with this email already exists."}, status=409)

    invite_token = secrets.token_urlsafe(32)
    temp_password = secrets.token_urlsafe(12)

    # FIX BUG-4: use the dedicated create_helper() manager method.
    # It sets user_type="HELPER", helper_role=role, must_change_password=True.
    new_user = User.objects.create_helper(
        email=email,
        temporary_password=temp_password,
        first_name=request.data["first_name"],
        last_name=request.data["last_name"],
        role=role,
        cooperative=coop,
        phone_number=request.data.get("phone_number", ""),
    )

    # Default module permissions
    default_perms = request.data.get("permissions", {})
    for module in MODULES:
        mp = default_perms.get(module, {})
        RolePermission.objects.create(
            user=new_user,
            cooperative=coop,
            module=module,
            can_view=mp.get("can_view", True),
            can_create=mp.get("can_create", False),
            can_edit=mp.get("can_edit", False),
            can_delete=mp.get("can_delete", False),
            can_edit_templates=mp.get("can_edit_templates", False),
        )

    invitation = Invitation.objects.create(
        cooperative=coop,
        email=email,
        role=role,
        token=invite_token,
        invited_by=request.user,
        expires_at=timezone.now() + timedelta(days=7),
    )

    # Notifications (non-fatal)
    try:
        send_invitation_email(
            to_email=email,
            to_name=f"{new_user.first_name} {new_user.last_name}",
            cooperative_name=coop.name,
            invite_token=invite_token,
            temp_password=temp_password,
            role=role,
        )
    except Exception:
        pass

    phone = request.data.get("phone_number", "")
    if phone:
        try:
            send_invitation_sms(
                to_phone=phone,
                cooperative_name=coop.name,
                invite_token=invite_token,
                temp_password=temp_password,
            )
        except Exception:
            pass

    return Response(
        {
            "message": f"Invitation sent to {email}.",
            "user_id": str(new_user.id),
            "invitation_id": str(invitation.id),
        },
        status=201,
    )


@api_view(["GET", "PUT", "DELETE"])
@permission_classes([IsAuthenticated])
def role_detail(request, cooperative_id: str, user_id: str):
    """GET/PUT/DELETE a specific helper account."""
    coop, err = _get_cooperative_or_404(cooperative_id)
    if err:
        return err

    if not _is_member_of(request.user, coop):
        return Response({"error": "Access denied."}, status=403)

    try:
        target_user = User.objects.get(pk=user_id, cooperative=coop)
    except (User.DoesNotExist, ValueError):
        return Response({"error": "User not found in this cooperative."}, status=404)

    # FIX BUG-3: check user_type not the non-existent role field
    if target_user.user_type == "CHAIR":
        return Response(
            {"error": "Cannot modify the Cooperative Chair account."},
            status=403,
        )

    if request.method == "GET":
        return Response(_serialize_user_role(target_user, coop.id))

    # Mutations – Chair only
    err = _require_chair(request.user, coop)
    if err:
        return err

    if request.method == "DELETE":
        target_user.cooperative = None
        target_user.is_active = False
        target_user.save()
        RolePermission.objects.filter(user=target_user, cooperative=coop).delete()
        return Response({"message": "Helper account removed from cooperative."})

    # PUT
    if "role" in request.data:
        new_role = request.data["role"].upper()
        if new_role not in HELPER_ROLES:
            return Response(
                {"error": f"Invalid role. Must be one of: {', '.join(HELPER_ROLES)}"},
                status=400,
            )
        # FIX BUG-3: update helper_role, not the non-existent role field
        target_user.helper_role = new_role
        target_user.save(update_fields=["helper_role"])

    permissions_data = request.data.get("permissions", {})
    for module, perms in permissions_data.items():
        if module not in MODULES:
            continue
        perm_obj, _ = RolePermission.objects.get_or_create(
            user=target_user, cooperative=coop, module=module,
        )
        for perm_field in [
            "can_view", "can_create", "can_edit",
            "can_delete", "can_edit_templates",
        ]:
            if perm_field in perms:
                setattr(perm_obj, perm_field, bool(perms[perm_field]))
        perm_obj.save()

    return Response({
        "message": "Permissions updated.",
        **_serialize_user_role(target_user, coop.id),
    })


# ── 4. Template Editing Permissions ───────────────────────────────────────────

@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def template_permissions(request, cooperative_id: str):
    """GET/PUT which helpers can edit form templates."""
    coop, err = _get_cooperative_or_404(cooperative_id)
    if err:
        return err

    if not _is_member_of(request.user, coop):
        return Response({"error": "Access denied."}, status=403)

    if request.method == "GET":
        # FIX BUG-3: exclude by user_type not role
        helpers = (
            User.objects
            .filter(cooperative=coop)
            .exclude(user_type="CHAIR")
        )
        all_helpers = [
            {
                "user_id": str(u.id),
                "name": f"{u.first_name} {u.last_name}".strip() or u.email,
                "email": u.email,
                "role": u.helper_role,   # FIX BUG-3
                "can_edit_templates": RolePermission.objects.filter(
                    user=u, cooperative=coop, can_edit_templates=True
                ).exists(),
            }
            for u in helpers
        ]
        return Response({"all_helpers": all_helpers})

    # PUT – Chair only
    err = _require_chair(request.user, coop)
    if err:
        return err

    user_permissions = request.data.get("user_permissions", [])
    if not isinstance(user_permissions, list):
        return Response({"error": "user_permissions must be a list."}, status=400)

    updated = []
    for item in user_permissions:
        uid = item.get("user_id")
        can_edit = item.get("can_edit_templates")
        if uid is None or can_edit is None:
            continue
        try:
            target = User.objects.get(pk=uid, cooperative=coop)
        except (User.DoesNotExist, ValueError):
            continue
        RolePermission.objects.filter(user=target, cooperative=coop).update(
            can_edit_templates=bool(can_edit)
        )
        updated.append({"user_id": uid, "can_edit_templates": bool(can_edit)})

    return Response({"message": "Template permissions updated.", "updated": updated})


# ── 5. Verification Documents ─────────────────────────────────────────────────

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def verification_documents(request, cooperative_id: str):
    """GET document list / POST upload new document."""
    coop, err = _get_cooperative_or_404(cooperative_id)
    if err:
        return err

    if not _is_member_of(request.user, coop):
        return Response({"error": "Access denied."}, status=403)

    if request.method == "GET":
        docs = VerificationDocument.objects.filter(
            cooperative=coop
        ).order_by("-uploaded_at")
        return Response({
            "documents": [_serialize_verification_doc(d) for d in docs],
            "total": docs.count(),
            "verification_status": coop.verification_status,
        })

    # POST – Chair only
    err = _require_chair(request.user, coop)
    if err:
        return err

    uploaded_file = request.FILES.get("file")
    doc_type = request.data.get("document_type", "").upper()

    if not uploaded_file:
        return Response({"error": "No file uploaded."}, status=400)
    if doc_type not in ALLOWED_DOCUMENT_TYPES:
        return Response(
            {"error": f"Invalid document type. Allowed: {', '.join(ALLOWED_DOCUMENT_TYPES)}"},
            status=400,
        )

    ext = os.path.splitext(uploaded_file.name)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return Response(
            {"error": f"File type not allowed. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"},
            status=400,
        )
    if uploaded_file.size > MAX_FILE_SIZE_MB * 1024 * 1024:
        return Response(
            {"error": f"File too large. Maximum {MAX_FILE_SIZE_MB}MB."},
            status=400,
        )

    file_path = f"verification/{coop.id}/{uuid.uuid4()}{ext}"
    saved_path = default_storage.save(file_path, ContentFile(uploaded_file.read()))

    # FIX BUG-6: do NOT pass uploaded_at — auto_now_add handles it
    doc = VerificationDocument.objects.create(
        cooperative=coop,
        document_type=doc_type,
        file=saved_path,
        file_name=uploaded_file.name,
        status="PENDING",
        notes=request.data.get("notes", ""),
    )

    return Response(
        {"message": "Document uploaded successfully.", **_serialize_verification_doc(doc)},
        status=201,
    )


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def verification_document_detail(request, cooperative_id: str, doc_id: str):
    """DELETE a verification document (Chair only)."""
    coop, err = _get_cooperative_or_404(cooperative_id)
    if err:
        return err

    err = _require_chair(request.user, coop)
    if err:
        return err

    try:
        doc = VerificationDocument.objects.get(pk=doc_id, cooperative=coop)
    except (VerificationDocument.DoesNotExist, ValueError):
        return Response({"error": "Document not found."}, status=404)

    if doc.file:
        default_storage.delete(doc.file.name)

    doc.delete()
    return Response({"message": "Document deleted."})