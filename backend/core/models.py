"""
ShambaFlow — Unified Data Model  (v2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Five platform layers, one coherent schema:

  Layer 1 │ Identity & Authority
  │         ShambaFlowUserManager, User,
  │         CooperativeChairProfile, BuyerProfile,
  │         Cooperative, CooperativeDocument,
  │         RolePermission, HelperPermissionOverride,
  │         CooperativeInvitation
  │
  Layer 2 │ Cooperative CRM
  │         Member, MemberLandRecord, MemberHerdRecord,
  │         FormTemplate, FormField, FormFieldSemanticIssue,
  │         FormSubmission,
  │         ProductionRecord, LivestockHealthLog,
  │         GovernanceRecord, FinancialRecord
  │
  Layer 3 │ Certification & Analytics
  │         CapacityMetric, CapacitySnapshot
  │
  Layer 4 │ Marketplace
  │         Buyer, Tender, TenderDocument,
  │         Bid, BidDocument, TenderMessage
  │
  Layer 5 │ Reputation Ledger
  │         ReputationLedger, CooperativeReputationScore

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Key design decisions (v2 changes):

  USER MANAGEMENT
  • ShambaFlowUserManager (BaseUserManager) provides dedicated
    creation paths: create_chair(), create_helper(), create_buyer(),
    create_superuser(). Auto-generates usernames from email.
  • Linked to User via objects = ShambaFlowUserManager()

  PROFILES
  • CooperativeChairProfile — one profile per Chair user.
  • BuyerProfile — one profile per Buyer user.
  • Helper accounts intentionally have NO profile model. Their
    full identity is user_type + helper_role + cooperative FK.

  PERMISSION SYSTEM
  • RolePermission — Chair defines module × action grants/denies
    for each helper ROLE within the cooperative (role-wide).
  • HelperPermissionOverride — Chair sets per-user exceptions that
    take precedence over RolePermission (individual-level).
  • User.has_cooperative_permission() resolves the full chain.

  FORM BUILDER (completely redesigned)
  • Chair picks an ACTUAL target model (Member, ProductionRecord,
    etc.) and designs a form for it.
  • Each FormField maps to a REAL model field (maps_to_model_field).
  • Submitting the form creates a REAL DB entry in the target model.
  • FormSubmission is an AUDIT TRAIL — not the data store.
  • FormFieldSemanticIssue catches label duplicates, type mismatches,
    abbreviation clashes, Swahili synonyms, missing required fields,
    and redundant core field mappings before activation.
  • FormFieldValue is REMOVED — data lives in the actual model tables.

  INVARIANTS
  • No payment logic inside this system.
  • All PKs are UUIDs — safe to expose in URLs.
  • Every model records created_at / updated_at for auditing.
  • Core model fields are immutable — they power marketplace logic
    and analytics and cannot be removed by cooperatives.
"""

import uuid
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models
from django.core.validators import MinValueValidator, MaxValueValidator, RegexValidator
from django_ckeditor_5.fields import CKEditor5Field


# ══════════════════════════════════════════════════════════════════
#  SHARED ABSTRACT BASES
# ══════════════════════════════════════════════════════════════════

class TimeStampedModel(models.Model):
    """Adds created_at / updated_at audit timestamps to any model."""
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class UUIDModel(models.Model):
    """Replaces the default integer PK with a UUID."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class BaseModel(UUIDModel, TimeStampedModel):
    """UUID PK + timestamps — base for almost all ShambaFlow models."""
    class Meta:
        abstract = True


# ══════════════════════════════════════════════════════════════════
#  LAYER 1 — IDENTITY & AUTHORITY
# ══════════════════════════════════════════════════════════════════

# ── USER MANAGER ──────────────────────────────────────────────────

class ShambaFlowUserManager(BaseUserManager):
    """
    Custom manager for the ShambaFlow User model.

    WHY a custom manager?
    ─────────────────────
    ShambaFlow is a multi-persona platform. The default Django
    UserManager uses username as the primary identifier and provides
    only create_user() / create_superuser(). That is insufficient for:
      • Chair accounts (created during cooperative onboarding, must be
        linked to a cooperative immediately)
      • Helper accounts (invited by Chair, no self-registration, must
        receive a temporary password and a must_change_password flag)
      • Buyer accounts (self-registered on the marketplace, no
        cooperative link)
      • Superuser / platform staff (Django admin access)

    By providing distinct creation methods we make the calling code
    at each registration/invitation path explicit and impossible to
    confuse, and we centralise all user-creation side-effects here.

    EMAIL is the login field. Username is auto-generated from the
    email prefix and is invisible in the UI.
    """

    use_in_migrations = True

    # ── Private scaffold ──────────────────────────────────────
    def _create_user(self, email: str, password: str | None, **extra_fields):
        """
        Internal base: normalise email, auto-generate username,
        hash password, validate, and save.
        All public methods delegate here after setting their own fields.
        """
        if not email:
            raise ValueError("A valid email address is required to create a user.")

        email = self.normalize_email(email)

        # Auto-generate a unique username from the email local-part.
        # Username is required by AbstractUser but is never shown to users.
        if not extra_fields.get("username"):
            base = email.split("@")[0].lower()
            username = base
            n = 1
            while self.model.objects.filter(username=username).exists():
                username = f"{base}{n}"
                n += 1
            extra_fields["username"] = username

        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.full_clean()
        user.save(using=self._db)
        return user

    # ── Public creation paths ─────────────────────────────────

    def create_user(self, email: str, password: str | None = None, **extra_fields):
        """
        Generic user creation. Prefer the typed methods below when
        the user_type is known at call site.
        Defaults: not staff, not superuser, type=HELPER.
        """
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        extra_fields.setdefault("user_type", "HELPER")
        return self._create_user(email, password, **extra_fields)

    def create_chair(
        self,
        email: str,
        password: str,
        first_name: str,
        last_name: str,
        phone_number: str,
        cooperative=None,
    ):
        """
        Create a Cooperative Chair account.

        Called by the cooperative onboarding wizard AFTER the
        Cooperative entity has been created. The Chair is the root
        administrator of their cooperative — their permissions bypass
        all RolePermission / HelperPermissionOverride checks.

        cooperative: Cooperative instance or None (can be set later
                     during the same transaction).
        """
        return self._create_user(
            email,
            password,
            first_name=first_name,
            last_name=last_name,
            phone_number=phone_number,
            user_type="CHAIR",
            helper_role="",
            cooperative=cooperative,
            is_staff=False,
            is_superuser=False,
            must_change_password=False,
        )

    def create_helper(
        self,
        email: str,
        temporary_password: str,
        first_name: str,
        last_name: str,
        role: str,
        cooperative,
        phone_number: str = "",
    ):
        """
        Create a Helper account on behalf of a Cooperative Chair.

        Helpers CANNOT self-register — they are always created
        through the Chair's invitation flow.

        The helper receives a temporary password and is forced to
        change it on first login (must_change_password=True).

        Their permissions are governed exclusively by:
          1. RolePermission (role-wide, set by Chair per role)
          2. HelperPermissionOverride (per-user exceptions, set by Chair)
        They have NO profile model — their identity is their role.
        """
        valid_roles = [choice[0] for choice in User.HelperRole.choices]
        if role not in valid_roles:
            raise ValueError(
                f"Invalid helper role '{role}'. "
                f"Valid roles are: {', '.join(valid_roles)}"
            )
        if cooperative is None:
            raise ValueError("A cooperative must be specified when creating a helper account.")

        return self._create_user(
            email,
            temporary_password,
            first_name=first_name,
            last_name=last_name,
            phone_number=phone_number,
            user_type="HELPER",
            helper_role=role,
            cooperative=cooperative,
            is_staff=False,
            is_superuser=False,
            must_change_password=True,   # Forced password change on first login
        )

    def create_buyer(
        self,
        email: str,
        password: str,
        first_name: str,
        last_name: str,
        phone_number: str = "",
    ):
        """
        Create a Buyer account (self-registered on the marketplace).
        Buyers have no cooperative affiliation.
        A BuyerProfile is created separately after this returns.
        """
        return self._create_user(
            email,
            password,
            first_name=first_name,
            last_name=last_name,
            phone_number=phone_number,
            user_type="BUYER",
            helper_role="",
            cooperative=None,
            is_staff=False,
            is_superuser=False,
            must_change_password=False,
        )

    def create_superuser(self, email: str, password: str, **extra_fields):
        """
        Create a ShambaFlow platform staff account with full Django
        admin access. Used ONLY for internal operations.

        Superusers are assigned user_type=PLATFORM. They have no
        cooperative affiliation and no buyer profile.
        """
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("user_type", "PLATFORM")
        extra_fields.setdefault("is_email_verified", True)

        if not extra_fields["is_staff"]:
            raise ValueError("Superuser must have is_staff=True.")
        if not extra_fields["is_superuser"]:
            raise ValueError("Superuser must have is_superuser=True.")

        return self._create_user(email, password, **extra_fields)


# ── USER MODEL ─────────────────────────────────────────────────────

class User(AbstractUser, UUIDModel):
    """
    Central authentication model for the entire ShambaFlow platform.

    Four distinct user personas share this single table:

      CHAIR    — Cooperative root admin. Created during cooperative
                 onboarding via ShambaFlowUserManager.create_chair().
                 Has a CooperativeChairProfile for personal details.
                 Authority over their cooperative is absolute — their
                 has_cooperative_permission() always returns True.
                 They define and assign all permissions to helpers.

      HELPER   — Invited by a Chair via CooperativeInvitation flow.
                 Cannot self-register.
                 Receives a temporary password; must_change_password=True.
                 Permissions come from RolePermission (role-wide) and
                 HelperPermissionOverride (per-user exceptions).
                 Intentionally has NO profile model.

      BUYER    — Self-registered on the marketplace platform.
                 Has a BuyerProfile for company details.
                 No cooperative affiliation.

      PLATFORM — Internal ShambaFlow staff. is_staff=True.
                 No cooperative. No profile.

    Email is the login identifier. Username is auto-generated and
    hidden from the UI (kept for Django/AbstractUser compatibility).
    """

    class UserType(models.TextChoices):
        CHAIR    = "CHAIR",    "Cooperative Chair"
        HELPER   = "HELPER",   "Cooperative Helper"
        BUYER    = "BUYER",    "Buyer"
        PLATFORM = "PLATFORM", "Platform Staff"

    class HelperRole(models.TextChoices):
        MANAGER           = "MANAGER",           "Manager"
        TREASURER         = "TREASURER",          "Treasurer"
        CLERK             = "CLERK",              "Clerk"
        DATA_OFFICER      = "DATA_OFFICER",       "Data Officer"
        EXTENSION_OFFICER = "EXTENSION_OFFICER",  "Extension Officer"

    # ── Attach the custom manager ──────────────────────────────
    objects = ShambaFlowUserManager()

    # ── Login identifier ──────────────────────────────────────
    email    = models.EmailField(unique=True, db_index=True)
    username = models.CharField(
        max_length=150, unique=True,
        help_text="Auto-generated from email. Not shown in the UI.",
    )

    # ── Persona ───────────────────────────────────────────────
    user_type = models.CharField(
        max_length=20,
        choices=UserType.choices,
        default=UserType.HELPER,
        db_index=True,
        help_text="Determines which platform and permissions this user has.",
    )
    helper_role = models.CharField(
        max_length=25,
        choices=HelperRole.choices,
        blank=True,
        help_text=(
            "Populated only for HELPER users. "
            "Drives the RolePermission lookup for this user's cooperative."
        ),
    )

    # ── Contact ───────────────────────────────────────────────
    phone_number = models.CharField(
        max_length=20,
        blank=True,
        validators=[
            RegexValidator(
                r"^\+?1?\d{9,15}$",
                "Enter a phone number in E.164 format, e.g. +254712345678",
            )
        ],
        help_text="Required for OTP delivery via Infobip.",
    )

    # ── Verification ──────────────────────────────────────────
    is_email_verified = models.BooleanField(default=False)
    is_phone_verified = models.BooleanField(default=False)

    # ── Secure token storage (SHA-256 hashed — never plain) ───
    email_verification_token     = models.CharField(max_length=128, blank=True)
    reset_password_token         = models.CharField(max_length=128, blank=True)
    reset_password_token_expires = models.DateTimeField(null=True, blank=True)

    # ── First-login gate for helpers ──────────────────────────
    must_change_password = models.BooleanField(
        default=False,
        help_text=(
            "Set True for newly-created helpers. "
            "They are redirected to the password-change screen and "
            "blocked from any other action until they comply."
        ),
    )

    # ── Cooperative FK (null for BUYER / PLATFORM) ────────────
    cooperative = models.ForeignKey(
        "Cooperative",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="staff",
        help_text="Cooperative this user belongs to. Null for buyers and platform staff.",
    )

    USERNAME_FIELD  = "email"
    REQUIRED_FIELDS = ["username"]

    class Meta:
        db_table            = "sf_users"
        verbose_name        = "User"
        verbose_name_plural = "Users"
        indexes = [
            models.Index(fields=["user_type", "cooperative"]),
            models.Index(fields=["helper_role", "cooperative"]),
            models.Index(fields=["email_verification_token"]),
            models.Index(fields=["reset_password_token"]),
        ]

    def __str__(self):
        return f"{self.email} [{self.get_user_type_display()}]"

    # ── Convenience type checks ───────────────────────────────
    @property
    def is_chair(self) -> bool:
        return self.user_type == self.UserType.CHAIR

    @property
    def is_helper(self) -> bool:
        return self.user_type == self.UserType.HELPER

    @property
    def is_buyer(self) -> bool:
        return self.user_type == self.UserType.BUYER

    @property
    def is_platform_staff(self) -> bool:
        return self.user_type == self.UserType.PLATFORM

    @property
    def full_name(self) -> str:
        name = f"{self.first_name} {self.last_name}".strip()
        return name if name else self.email

    # ── Permission resolution ─────────────────────────────────
    def has_cooperative_permission(self, module: str, action: str) -> bool:
        """
        Check whether this user may perform `action` on `module`
        within their cooperative.

        Resolution chain (highest priority first):
          1. CHAIR → always True (root authority, no table lookup needed).
          2. HELPER:
               a. Check HelperPermissionOverride for this specific user.
                  If a record exists → use its is_granted value (True or False).
               b. Fall back to RolePermission for this user's role within
                  this cooperative. If a record exists → use its is_granted.
               c. If no record found anywhere → default False (deny).
          3. BUYER / PLATFORM → always False for cooperative modules.
        """
        if self.is_chair:
            return True

        if not self.is_helper or not self.cooperative_id:
            return False

        # Per-user override (highest specificity)
        try:
            override = HelperPermissionOverride.objects.get(
                user=self,
                module=module,
                action=action,
            )
            return override.is_granted
        except HelperPermissionOverride.DoesNotExist:
            pass

        # Role-wide permission (fallback)
        try:
            role_perm = RolePermission.objects.get(
                cooperative_id=self.cooperative_id,
                role=self.helper_role,
                module=module,
                action=action,
            )
            return role_perm.is_granted
        except RolePermission.DoesNotExist:
            return False  # Deny by default


# ── PROFILE MODELS ────────────────────────────────────────────────
#
#  Only CHAIR and BUYER have profile extension models.
#  HELPER accounts intentionally have NO profile.
#  Their complete identity is: user_type + helper_role + cooperative.
#  Adding a profile would imply a degree of self-management that
#  helpers do not have — they are managed by the Chair.

class CooperativeChairProfile(BaseModel):
    """
    Personal profile for a Cooperative Chair.

    Stores individual administrative details for the Chair as a person,
    separate from the Cooperative entity itself (which holds organisational
    details). Created automatically during cooperative onboarding.

    Helpers do NOT have this.
    Buyers do NOT have this.
    """
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="chair_profile",
        limit_choices_to={"user_type": "CHAIR"},
    )

    # ── Personal identity ──────────────────────────────────────
    national_id   = models.CharField(
        max_length=50, blank=True,
        help_text="Government-issued ID number, e.g. Kenya National ID.",
    )
    date_of_birth = models.DateField(null=True, blank=True)
    gender        = models.CharField(
        max_length=15,
        blank=True,
        choices=[
            ("MALE",   "Male"),
            ("FEMALE", "Female"),
            ("OTHER",  "Other"),
        ],
    )
    profile_photo = models.ImageField(
        upload_to="chair_photos/%Y/", blank=True, null=True
    )

    # ── Contact extras ─────────────────────────────────────────
    alt_phone        = models.CharField(max_length=20, blank=True)
    physical_address = models.CharField(max_length=300, blank=True)
    region           = models.CharField(max_length=150, blank=True)

    # ── Role within the cooperative ────────────────────────────
    title         = models.CharField(
        max_length=100, blank=True,
        help_text="Official title, e.g. Chairperson, Chairman.",
    )
    years_in_role = models.PositiveSmallIntegerField(null=True, blank=True)
    bio           = models.TextField(blank=True)

    # ── Notification preferences ───────────────────────────────
    preferred_language  = models.CharField(max_length=10, default="en")
    email_notifications = models.BooleanField(default=True)
    sms_notifications   = models.BooleanField(default=True)
    tender_alerts       = models.BooleanField(
        default=True,
        help_text="Receive SMS/email when new tenders matching their cooperative are posted.",
    )

    class Meta:
        db_table     = "sf_chair_profiles"
        verbose_name = "Chair Profile"

    def __str__(self):
        return f"Chair Profile — {self.user.full_name}"


class BuyerProfile(BaseModel):
    """
    Company profile for a Buyer user.

    Stores business identity and sourcing preferences. Created
    immediately after the buyer's User account is created.

    Chair accounts do NOT have this.
    Helper accounts do NOT have this.
    """
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="buyer_profile",
        limit_choices_to={"user_type": "BUYER"},
    )

    class BuyerType(models.TextChoices):
        PROCESSOR  = "PROCESSOR",  "Processor / Manufacturer"
        RETAILER   = "RETAILER",   "Retailer / Supermarket"
        EXPORTER   = "EXPORTER",   "Exporter"
        NGO        = "NGO",        "NGO / Development Organisation"
        GOVERNMENT = "GOVERNMENT", "Government Agency"
        TRADER     = "TRADER",     "Commodity Trader"
        OTHER      = "OTHER",      "Other"

    # ── Company identity ──────────────────────────────────────
    company_name        = models.CharField(max_length=255, db_index=True)
    buyer_type          = models.CharField(max_length=15, choices=BuyerType.choices)
    registration_number = models.CharField(max_length=100, blank=True)
    tax_pin             = models.CharField(
        max_length=50, blank=True, help_text="KRA PIN or equivalent tax identifier."
    )
    company_logo        = models.ImageField(
        upload_to="buyer_logos/%Y/", blank=True, null=True
    )

    # ── Location ──────────────────────────────────────────────
    country          = models.CharField(max_length=100, default="Kenya")
    region           = models.CharField(max_length=150, blank=True)
    physical_address = models.CharField(max_length=300, blank=True)
    website          = models.URLField(blank=True)

    # ── Public description ─────────────────────────────────────
    description = CKEditor5Field(config_name="default", blank=True)

    # ── Verification ──────────────────────────────────────────
    is_verified = models.BooleanField(default=False)
    verified_at = models.DateTimeField(null=True, blank=True)

    # ── Sourcing preferences (drive tender matching) ───────────
    interested_categories = models.JSONField(
        default=list,
        blank=True,
        help_text='List of product category codes, e.g. ["CEREALS", "DAIRY"].',
    )
    preferred_regions = models.JSONField(
        default=list,
        blank=True,
        help_text="List of regions/counties the buyer prefers to source from.",
    )

    # ── Aggregate performance (denormalised) ───────────────────
    average_rating = models.DecimalField(
        max_digits=3,
        decimal_places=1,
        default=0,
        validators=[MinValueValidator(0), MaxValueValidator(5)],
        help_text="Average rating given by cooperatives post-trade.",
    )
    total_tenders = models.PositiveIntegerField(default=0)

    # ── Notification preferences ───────────────────────────────
    email_notifications = models.BooleanField(default=True)
    sms_notifications   = models.BooleanField(default=True)

    class Meta:
        db_table     = "sf_buyer_profiles"
        verbose_name = "Buyer Profile"
        ordering     = ["company_name"]

    def __str__(self):
        return f"{self.company_name} ({self.get_buyer_type_display()})"


# ── COOPERATIVE ────────────────────────────────────────────────────

class Cooperative(BaseModel):
    """
    The primary entity of the ShambaFlow CRM platform.

    A Cooperative has exactly one Chair and up to N helpers.
    Its CRM data, capacity index, and reputation accumulate here,
    creating structural dependency — the indispensability engine.
    """

    class CoopType(models.TextChoices):
        CROP      = "CROP",      "Crop Cooperative"
        LIVESTOCK = "LIVESTOCK", "Livestock Cooperative"
        MIXED     = "MIXED",     "Mixed Cooperative"

    class VerificationStatus(models.TextChoices):
        PENDING   = "PENDING",   "Pending Review"
        VERIFIED  = "VERIFIED",  "Verified"
        REJECTED  = "REJECTED",  "Rejected"
        SUSPENDED = "SUSPENDED", "Suspended"

    class SubscriptionTier(models.TextChoices):
        FREE    = "FREE",    "Free"
        BASIC   = "BASIC",   "Basic"
        PREMIUM = "PREMIUM", "Premium"

    # ── Core identity ─────────────────────────────────────────
    name                = models.CharField(max_length=255, db_index=True)
    slug                = models.SlugField(max_length=255, unique=True)
    registration_number = models.CharField(max_length=100, unique=True)
    cooperative_type    = models.CharField(max_length=15, choices=CoopType.choices)
    description         = CKEditor5Field(
        config_name="default",
        blank=True,
        help_text="Public-facing cooperative profile description.",
    )

    # ── Geography ─────────────────────────────────────────────
    country  = models.CharField(max_length=100, default="Kenya")
    region   = models.CharField(
        max_length=150, help_text="County / State / Province"
    )
    district = models.CharField(max_length=150, blank=True)
    ward     = models.CharField(max_length=150, blank=True)
    gps_lat  = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )
    gps_lng  = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )

    # ── Chair reference ───────────────────────────────────────
    chair = models.OneToOneField(
        "User",
        on_delete=models.PROTECT,
        related_name="chaired_cooperative",
        null=True,
        blank=True,
        help_text=(
            "Root admin of this cooperative. Set during onboarding. "
            "PROTECT prevents accidental deletion."
        ),
    )

    # ── Verification ──────────────────────────────────────────
    verification_status = models.CharField(
        max_length=15,
        choices=VerificationStatus.choices,
        default=VerificationStatus.PENDING,
    )
    verified_at      = models.DateTimeField(null=True, blank=True)
    verified_by      = models.ForeignKey(
        "User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cooperatives_verified",
    )
    rejection_reason = models.TextField(blank=True)

    # ── Contact ───────────────────────────────────────────────
    email        = models.EmailField(blank=True)
    phone_number = models.CharField(max_length=20, blank=True)
    website      = models.URLField(blank=True)

    # ── Subscription ──────────────────────────────────────────
    subscription_tier       = models.CharField(
        max_length=10,
        choices=SubscriptionTier.choices,
        default=SubscriptionTier.FREE,
    )
    subscription_expires_at = models.DateTimeField(null=True, blank=True)

    # ── Denormalised counts ────────────────────────────────────
    founded_year  = models.PositiveIntegerField(null=True, blank=True)
    total_members = models.PositiveIntegerField(default=0)
    is_active     = models.BooleanField(default=True)

    class Meta:
        db_table            = "sf_cooperatives"
        verbose_name        = "Cooperative"
        verbose_name_plural = "Cooperatives"
        ordering            = ["name"]
        indexes = [
            models.Index(fields=["verification_status"]),
            models.Index(fields=["cooperative_type"]),
            models.Index(fields=["subscription_tier"]),
            models.Index(fields=["region"]),
        ]

    def __str__(self):
        return f"{self.name} ({self.get_cooperative_type_display()})"

    @property
    def is_verified(self) -> bool:
        return self.verification_status == self.VerificationStatus.VERIFIED

    @property
    def is_premium(self) -> bool:
        return self.subscription_tier == self.SubscriptionTier.PREMIUM


class CooperativeDocument(BaseModel):
    """Verification and compliance documents uploaded by the cooperative."""

    class DocumentType(models.TextChoices):
        REGISTRATION   = "REGISTRATION",   "Registration Certificate"
        CONSTITUTION   = "CONSTITUTION",   "Cooperative Constitution"
        TAX_COMPLIANCE = "TAX_COMPLIANCE", "Tax Compliance Certificate"
        AUDIT_REPORT   = "AUDIT_REPORT",   "Audit Report"
        OTHER          = "OTHER",          "Other"

    cooperative   = models.ForeignKey(
        Cooperative, on_delete=models.CASCADE, related_name="documents"
    )
    document_type = models.CharField(max_length=20, choices=DocumentType.choices)
    title         = models.CharField(max_length=255)
    file          = models.FileField(upload_to="cooperative_docs/%Y/%m/")
    uploaded_by   = models.ForeignKey("User", on_delete=models.SET_NULL, null=True)
    notes         = models.TextField(blank=True)

    class Meta:
        db_table     = "sf_cooperative_documents"
        verbose_name = "Cooperative Document"

    def __str__(self):
        return f"{self.cooperative.name} — {self.get_document_type_display()}"


# ── PERMISSION SYSTEM ─────────────────────────────────────────────

class RolePermission(BaseModel):
    """
    Role-wide permission matrix set by the Cooperative Chair.

    Grants or denies a (module, action) pair for an ENTIRE helper role
    within one cooperative. For example:
      CLERK → MEMBERS:VIEW   = True
      CLERK → MEMBERS:DELETE = False

    The Chair's own access bypasses this table (always permitted).
    Individual exceptions are handled by HelperPermissionOverride.
    """

    class Module(models.TextChoices):
        MEMBERS      = "MEMBERS",      "Member Management"
        PRODUCTION   = "PRODUCTION",   "Production Records"
        LIVESTOCK    = "LIVESTOCK",    "Livestock Records"
        GOVERNANCE   = "GOVERNANCE",   "Governance"
        FINANCE      = "FINANCE",      "Financial Records"
        FORM_BUILDER = "FORM_BUILDER", "Form Builder"
        MARKETPLACE  = "MARKETPLACE",  "Marketplace / Tenders"
        ANALYTICS    = "ANALYTICS",    "Analytics & Reports"

    class Action(models.TextChoices):
        VIEW   = "VIEW",   "View"
        CREATE = "CREATE", "Create"
        EDIT   = "EDIT",   "Edit"
        DELETE = "DELETE", "Delete"
        EXPORT = "EXPORT", "Export"

    cooperative = models.ForeignKey(
        Cooperative, on_delete=models.CASCADE, related_name="role_permissions"
    )
    role        = models.CharField(max_length=25, choices=User.HelperRole.choices)
    module      = models.CharField(max_length=20, choices=Module.choices)
    action      = models.CharField(max_length=10, choices=Action.choices)
    is_granted  = models.BooleanField(default=False)

    class Meta:
        db_table            = "sf_role_permissions"
        unique_together     = ("cooperative", "role", "module", "action")
        verbose_name        = "Role Permission"
        verbose_name_plural = "Role Permissions"

    def __str__(self):
        status = "GRANT" if self.is_granted else "DENY"
        return (
            f"[{status}] {self.cooperative.name} / "
            f"{self.role} → {self.module}:{self.action}"
        )


class HelperPermissionOverride(BaseModel):
    """
    Per-user permission exception set by the Chair for a specific helper.

    Overrides RolePermission for that individual (see User.has_cooperative_permission).
    Use cases:
      • Give a specific Clerk EXPORT access even though the CLERK role does not.
      • Block a specific Manager from DELETING governance records.

    Only applicable to HELPER users.
    The Chair cannot be overridden (they always have full access).
    """
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="permission_overrides",
        limit_choices_to={"user_type": "HELPER"},
    )
    module     = models.CharField(max_length=20, choices=RolePermission.Module.choices)
    action     = models.CharField(max_length=10, choices=RolePermission.Action.choices)
    is_granted = models.BooleanField(
        help_text="True = explicitly grant. False = explicitly deny, even if the role allows."
    )
    set_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name="overrides_set",
        limit_choices_to={"user_type": "CHAIR"},
        help_text="Must be the Chair of the same cooperative.",
    )
    reason = models.CharField(
        max_length=300, blank=True,
        help_text="Optional note from the Chair explaining the override."
    )

    class Meta:
        db_table        = "sf_helper_permission_overrides"
        unique_together = ("user", "module", "action")
        verbose_name    = "Helper Permission Override"

    def __str__(self):
        status = "GRANT" if self.is_granted else "DENY"
        return (
            f"[{status}] {self.user.email} → {self.module}:{self.action} (override)"
        )


class CooperativeInvitation(BaseModel):
    """
    A pending invitation from a Chair to create a helper account.

    Flow:
      1. Chair fills in the helper's name, email, phone, and role.
      2. System generates a secure token and temporary password.
      3. Token is delivered via Brevo (email) + Infobip (SMS).
      4. Helper clicks the link, accepts, and sets a new password.
      5. ShambaFlowUserManager.create_helper() is called.
      6. accepted_user is set; is_accepted=True.

    Expires after settings.SHAMBAFLOW['INVITATION_EXPIRY_HOURS'] (72h default).
    """
    cooperative = models.ForeignKey(
        Cooperative, on_delete=models.CASCADE, related_name="invitations"
    )
    invited_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="sent_invitations",
        limit_choices_to={"user_type": "CHAIR"},
    )
    email      = models.EmailField()
    phone_number = models.CharField(max_length=20, blank=True)
    first_name = models.CharField(max_length=100)
    last_name  = models.CharField(max_length=100)
    role       = models.CharField(max_length=25, choices=User.HelperRole.choices)

    # Token sent via email/SMS — stored as SHA-256 hash
    token = models.CharField(max_length=128, unique=True, db_index=True)

    # Temporary password: bcrypt hash stored here; plain-text sent to email once
    temporary_password_hash = models.CharField(max_length=128)

    is_accepted   = models.BooleanField(default=False)
    accepted_at   = models.DateTimeField(null=True, blank=True)
    expires_at    = models.DateTimeField()
    accepted_user = models.OneToOneField(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="from_invitation",
    )

    class Meta:
        db_table     = "sf_invitations"
        verbose_name = "Cooperative Invitation"
        ordering     = ["-created_at"]
        indexes      = [
            models.Index(fields=["token"]),
            models.Index(fields=["email", "cooperative"]),
        ]

    def __str__(self):
        return f"Invite → {self.email} ({self.role}) @ {self.cooperative.name}"

    @property
    def is_expired(self) -> bool:
        from django.utils import timezone
        return timezone.now() > self.expires_at

    @property
    def is_usable(self) -> bool:
        return not self.is_accepted and not self.is_expired


# ══════════════════════════════════════════════════════════════════
#  LAYER 2 — COOPERATIVE CRM
# ══════════════════════════════════════════════════════════════════

class Member(BaseModel):
    """
    A registered member of a cooperative.
    Core fields are immutable system fields that power marketplace and analytics.
    Additional cooperative-specific data is collected through FormTemplate submissions
    which create actual entries in this model (or related models).
    """

    class MemberStatus(models.TextChoices):
        ACTIVE    = "ACTIVE",    "Active"
        INACTIVE  = "INACTIVE",  "Inactive"
        SUSPENDED = "SUSPENDED", "Suspended"
        DECEASED  = "DECEASED",  "Deceased"

    class Gender(models.TextChoices):
        MALE        = "MALE",        "Male"
        FEMALE      = "FEMALE",      "Female"
        OTHER       = "OTHER",       "Other"
        UNSPECIFIED = "UNSPECIFIED", "Prefer not to say"

    # ── Core system fields (immutable) ─────────────────────────
    cooperative   = models.ForeignKey(
        Cooperative, on_delete=models.CASCADE, related_name="members"
    )
    member_number = models.CharField(
        max_length=50, help_text="Cooperative-assigned member ID."
    )
    first_name    = models.CharField(max_length=100)
    last_name     = models.CharField(max_length=100)
    date_of_birth = models.DateField(null=True, blank=True)
    gender        = models.CharField(
        max_length=15, choices=Gender.choices, default=Gender.UNSPECIFIED
    )
    national_id   = models.CharField(max_length=50, blank=True)
    phone_number  = models.CharField(max_length=20, blank=True)
    email         = models.EmailField(blank=True)
    status        = models.CharField(
        max_length=15, choices=MemberStatus.choices, default=MemberStatus.ACTIVE
    )
    joined_date   = models.DateField()

    # ── Location (core) ───────────────────────────────────────
    region   = models.CharField(max_length=150)
    district = models.CharField(max_length=150, blank=True)
    ward     = models.CharField(max_length=150, blank=True)
    gps_lat  = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )
    gps_lng  = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )

    # ── Production identity (core — drives marketplace matching) ──
    primary_production_type = models.CharField(
        max_length=150,
        blank=True,
        help_text="e.g. Maize, Dairy Cattle, Coffee Beans.",
    )

    photo    = models.ImageField(
        upload_to="member_photos/%Y/", blank=True, null=True
    )
    notes    = models.TextField(blank=True)
    added_by = models.ForeignKey(
        "User", on_delete=models.SET_NULL, null=True, related_name="members_added"
    )

    class Meta:
        db_table            = "sf_members"
        verbose_name        = "Member"
        verbose_name_plural = "Members"
        unique_together     = ("cooperative", "member_number")
        ordering            = ["last_name", "first_name"]
        indexes = [
            models.Index(fields=["cooperative", "status"]),
            models.Index(fields=["national_id"]),
            models.Index(fields=["phone_number"]),
        ]

    def __str__(self):
        return f"{self.full_name} [{self.member_number}] @ {self.cooperative.name}"

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"


class MemberLandRecord(BaseModel):
    """Land parcels owned or farmed by a member — core for crop capacity scoring."""
    member       = models.ForeignKey(
        Member, on_delete=models.CASCADE, related_name="land_records"
    )
    parcel_name  = models.CharField(max_length=200, blank=True)
    acreage      = models.DecimalField(
        max_digits=8,
        decimal_places=3,
        validators=[MinValueValidator(0.001)],
        help_text="Total area in acres.",
    )
    land_tenure  = models.CharField(
        max_length=50, blank=True, help_text="e.g. Freehold, Leasehold, Communal."
    )
    crop_types   = models.CharField(
        max_length=255, blank=True, help_text="Comma-separated crop names."
    )
    is_irrigated = models.BooleanField(default=False)
    gps_lat      = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )
    gps_lng      = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )
    notes        = models.TextField(blank=True)

    class Meta:
        db_table     = "sf_member_land"
        verbose_name = "Land Record"


class MemberHerdRecord(BaseModel):
    """Livestock herds owned by a member — core for livestock capacity scoring."""
    member         = models.ForeignKey(
        Member, on_delete=models.CASCADE, related_name="herd_records"
    )
    animal_type    = models.CharField(
        max_length=100, help_text="e.g. Dairy Cattle, Goats, Sheep."
    )
    breed          = models.CharField(max_length=100, blank=True)
    total_count    = models.PositiveIntegerField(default=0)
    mature_count   = models.PositiveIntegerField(default=0)
    juvenile_count = models.PositiveIntegerField(default=0)
    notes          = models.TextField(blank=True)
    recorded_on    = models.DateField()

    class Meta:
        db_table     = "sf_member_herds"
        verbose_name = "Herd Record"

    def __str__(self):
        return f"{self.member.full_name} — {self.animal_type} ({self.total_count})"


# ══════════════════════════════════════════════════════════════════
#  FORM BUILDER ENGINE  (revised)
#
#  ┌──────────────────────────────────────────────────────────────┐
#  │  WHAT IT IS                                                  │
#  │  The Form Builder lets a Cooperative Chair design a custom   │
#  │  data entry form that targets a real database table.         │
#  │  Submitting the form creates an actual row in that table.    │
#  │                                                              │
#  │  WHAT IT IS NOT                                              │
#  │  It is NOT a generic key-value store. FormFieldValue from    │
#  │  v1 is removed. Data lives in the real model tables.         │
#  │                                                              │
#  │  HOW IT WORKS                                                │
#  │  1. Chair picks a target model (e.g. ProductionRecord).      │
#  │  2. Chair sees all writable fields on that model.            │
#  │  3. Chair picks which fields to include and renames them     │
#  │     with cooperative-specific labels.                        │
#  │  4. Semantic validation runs (see FormFieldSemanticIssue).   │
#  │  5. Once ACTIVE, helpers use the form to add records.        │
#  │  6. Submission → real DB entry in the target model.          │
#  │  7. FormSubmission is an audit trail only.                   │
#  │                                                              │
#  │  SEMANTIC VALIDATION                                         │
#  │  Before a template becomes ACTIVE the system detects:        │
#  │  • Duplicate meanings  ("Farmer Name" ≈ "Member Name")       │
#  │  • Abbreviation clashes ("DOB" ↔ "Date of Birth")           │
#  │  • Swahili synonyms    ("Shamba" ↔ "Farm")                  │
#  │  • Type mismatches     (text widget → DecimalField)          │
#  │  • Two fields mapping the same model column                  │
#  │  • Required model field not covered by any form field        │
#  │  • Redundant re-mapping of a core field that already exists  │
#  │  ERRORs block activation. WARNINGs can be acknowledged.      │
#  └──────────────────────────────────────────────────────────────┘
# ══════════════════════════════════════════════════════════════════

# Allowed target models and their Django model names within the core app.
FORM_BUILDER_TARGET_MODELS: dict[str, str] = {
    "MEMBER":      "Member",
    "PRODUCTION":  "ProductionRecord",
    "LIVESTOCK":   "LivestockHealthLog",
    "GOVERNANCE":  "GovernanceRecord",
    "FINANCE":     "FinancialRecord",
    "LAND":        "MemberLandRecord",
    "HERD":        "MemberHerdRecord",
}


class FormTemplate(BaseModel):
    """
    A cooperative-specific form that creates entries in a chosen target model.

    Each cooperative may build multiple templates for the same target model
    (e.g. a 'Quick Harvest Log' and a 'Full Harvest Report' both targeting
    ProductionRecord). The default template is used when no specific one is
    selected by the user.

    Version history is preserved: editing creates a new version and
    deactivates the previous one. Old submissions reference the version
    that was active when they were made.
    """

    class TargetModel(models.TextChoices):
        MEMBER     = "MEMBER",      "Member"
        PRODUCTION = "PRODUCTION",  "Production Record"
        LIVESTOCK  = "LIVESTOCK",   "Livestock Health Log"
        GOVERNANCE = "GOVERNANCE",  "Governance Record"
        FINANCE    = "FINANCE",     "Financial Record"
        LAND       = "LAND",        "Land Record"
        HERD       = "HERD",        "Herd Record"

    class Status(models.TextChoices):
        DRAFT      = "DRAFT",      "Draft — being designed"
        VALIDATING = "VALIDATING", "Semantic Validation Running"
        HAS_ISSUES = "HAS_ISSUES", "Has Unresolved Errors — cannot activate"
        ACTIVE     = "ACTIVE",     "Active — in use"
        INACTIVE   = "INACTIVE",   "Inactive — superseded by new version"

    cooperative  = models.ForeignKey(
        Cooperative, on_delete=models.CASCADE, related_name="form_templates"
    )
    name         = models.CharField(
        max_length=255,
        help_text="Cooperative-defined display name for this form, e.g. 'Daily Harvest Log'.",
    )
    target_model = models.CharField(
        max_length=15,
        choices=TargetModel.choices,
        help_text="Which database table this form creates entries in.",
    )
    description  = models.TextField(blank=True)
    status       = models.CharField(
        max_length=15, choices=Status.choices, default=Status.DRAFT
    )
    is_default   = models.BooleanField(
        default=False,
        help_text=(
            "If True, this is the default form used for this target model "
            "within this cooperative. Only one per (cooperative, target_model)."
        ),
    )
    version       = models.PositiveIntegerField(default=1)
    parent_version = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="child_versions",
    )
    created_by  = models.ForeignKey("User", on_delete=models.SET_NULL, null=True)
    change_note = models.CharField(max_length=500, blank=True)

    # Fields NOT in the form but required by the target model.
    # The service layer auto-injects these on submission.
    # JSON: {"cooperative_id": "<uuid>", "recorded_by_id": "<user_uuid>"}
    field_defaults = models.JSONField(
        default=dict,
        blank=True,
        help_text=(
            "Auto-populated values for model fields not covered by form fields. "
            "Set by the system when the template is activated."
        ),
    )

    # True if any unresolved ERROR-severity semantic issues exist.
    has_blocking_errors = models.BooleanField(
        default=False,
        help_text="True if semantic validation found ERRORs. Blocks activation.",
    )

    class Meta:
        db_table     = "sf_form_templates"
        verbose_name = "Form Template"
        ordering     = ["cooperative", "target_model", "-version"]
        indexes      = [
            models.Index(fields=["cooperative", "target_model", "status"]),
        ]
        constraints  = [
            # Enforce only one default form per (cooperative, target_model)
            models.UniqueConstraint(
                fields=["cooperative", "target_model"],
                condition=models.Q(is_default=True, status="ACTIVE"),
                name="unique_default_active_template_per_coop_model",
            )
        ]

    def __str__(self):
        return (
            f"{self.cooperative.name} | {self.target_model} | "
            f"{self.name} v{self.version}"
        )

    @property
    def is_active(self) -> bool:
        return self.status == self.Status.ACTIVE

    @property
    def target_model_class(self):
        """Return the actual Django model class for this template's target."""
        from django.apps import apps
        model_name = FORM_BUILDER_TARGET_MODELS.get(self.target_model)
        return apps.get_model("core", model_name) if model_name else None


class FormField(BaseModel):
    """
    A single field on a FormTemplate.

    Each field:
      • Has a cooperative-defined LABEL (e.g. "Harvest Weight in KGs")
      • Maps to a REAL MODEL FIELD on the target table (e.g. "quantity_kg")
      • Carries a DISPLAY TYPE for the UI widget
      • May have validation rules and conditional visibility logic

    Uniqueness:
      • Within one template, no two fields can map to the same model field.
        (enforced by unique_together)
      • Labels are semantically validated (see FormFieldSemanticIssue).

    is_model_required:
      Auto-set by the service layer when the template is saved.
      True when the underlying model field is non-nullable with no default.
      The form field must be present, OR the model field must appear in
      FormTemplate.field_defaults — otherwise activation is blocked.
    """

    class DisplayType(models.TextChoices):
        """UI widget type. May differ from the underlying DB column type."""
        TEXT         = "text",         "Single-line Text"
        TEXTAREA     = "textarea",     "Multi-line Text"
        NUMBER       = "number",       "Whole Number"
        DECIMAL      = "decimal",      "Decimal Number"
        DATE         = "date",         "Date Picker"
        DATETIME     = "datetime",     "Date & Time Picker"
        DROPDOWN     = "dropdown",     "Dropdown (single choice)"
        MULTI_SELECT = "multi_select", "Multi-Select Checkboxes"
        BOOLEAN      = "boolean",      "Yes / No Toggle"
        FILE_UPLOAD  = "file_upload",  "File Upload"
        IMAGE_UPLOAD = "image_upload", "Image Upload"
        GPS          = "gps",          "GPS Coordinate Picker"
        RICH_TEXT    = "rich_text",    "Rich Text (formatted)"

    class FieldTag(models.TextChoices):
        """
        Semantic classification that drives the Capacity Index engine.
        CAPACITY-tagged fields with data → raises the cooperative's score.
        """
        CAPACITY      = "CAPACITY",      "Capacity / Production"
        GOVERNANCE    = "GOVERNANCE",    "Governance"
        FINANCIAL     = "FINANCIAL",     "Financial"
        INFORMATIONAL = "INFORMATIONAL", "Informational Only"

    template     = models.ForeignKey(
        FormTemplate, on_delete=models.CASCADE, related_name="fields"
    )

    # ── What the user sees ─────────────────────────────────────
    label        = models.CharField(
        max_length=255,
        help_text=(
            "Cooperative-defined label. E.g. 'Harvest Weight' instead of 'quantity_kg'. "
            "Semantic duplication with other labels is detected before activation."
        ),
    )
    display_type = models.CharField(
        max_length=15, choices=DisplayType.choices, default=DisplayType.TEXT
    )
    tag          = models.CharField(
        max_length=15, choices=FieldTag.choices, default=FieldTag.INFORMATIONAL
    )
    field_order  = models.PositiveSmallIntegerField(default=0)
    placeholder  = models.CharField(max_length=255, blank=True)
    help_text    = models.CharField(max_length=500, blank=True)
    is_required  = models.BooleanField(default=False)
    default_value = models.CharField(max_length=500, blank=True)

    # ── What it maps to in the database ───────────────────────
    maps_to_model_field = models.CharField(
        max_length=100,
        help_text=(
            "The exact Django model field name this form field writes to. "
            "e.g. 'quantity_kg', 'first_name', 'harvest_date'. "
            "Validated against the target model's actual fields on save. "
            "Two form fields cannot map to the same model field."
        ),
    )

    # Auto-set by the service layer (not editable by the Chair)
    is_model_required = models.BooleanField(
        default=False,
        editable=False,
        help_text=(
            "True if the underlying model field is non-nullable with no default. "
            "Set automatically — cannot be overridden."
        ),
    )

    # ── Choices for dropdown / multi_select ───────────────────
    options = models.JSONField(
        default=list,
        blank=True,
        help_text='["Option A", "Option B"] for dropdown / multi_select fields.',
    )

    # ── Validation constraints ────────────────────────────────
    validation_rules = models.JSONField(
        default=dict,
        blank=True,
        help_text='{"min": 0, "max": 10000, "pattern": "regex_here"}',
    )

    # ── Conditional visibility ────────────────────────────────
    conditional_rule = models.JSONField(
        default=dict,
        blank=True,
        help_text=(
            'Show/hide this field based on another field\'s value. '
            'Format: {"show_if": {"field_id": "<uuid>", "equals": "Maize"}}'
        ),
    )

    class Meta:
        db_table            = "sf_form_fields"
        verbose_name        = "Form Field"
        # One form field per model field per template
        unique_together     = ("template", "maps_to_model_field")
        ordering            = ["template", "field_order"]

    def __str__(self):
        return (
            f'"{self.label}" → {self.maps_to_model_field} [{self.display_type}] '
            f'on {self.template.name}'
        )


class FormFieldSemanticIssue(BaseModel):
    """
    A semantic problem detected on a FormField during template validation.

    The semantic validation engine (core/services/form_semantic.py) runs
    when a FormTemplate is saved or when activation is requested. It checks
    all fields against each other and against the target model's field names.

    Issues block or warn:
      ERROR   → blocks template activation. Must be resolved (rename field
                or remove it) before the template can go ACTIVE.
      WARNING → informational. The Chair may acknowledge and proceed.

    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Issue type catalogue:

    LABEL_DUPLICATE
      Two labels have the same meaning after normalisation.
      Detection: cosine similarity on TF-IDF tokens ≥ 0.85, OR
                 edit distance ≤ 2 for short labels, OR
                 one is a substring of the other after stop-word removal.
      Example: "Farmer Name" and "Member Name" → both mean the same thing.
      Severity: ERROR (data entry staff will fill both, causing confusion).

    ABBREVIATION_CLASH
      One label appears to be a short form of another.
      Detection: known abbreviation table + first-letters pattern match.
      Example: "DOB" and "Date of Birth", "Qty" and "Quantity".
      Severity: WARNING.

    SWAHILI_SYNONYM
      One label is the Swahili translation of another label.
      Detection: built-in Swahili ↔ English synonym dictionary.
      Example: "Shamba" ↔ "Farm", "Mkulima" ↔ "Farmer",
               "Uzalishaji" ↔ "Production".
      Severity: WARNING (cooperative may intentionally bilingual-label fields).

    LABEL_CORE_CONFLICT
      A cooperative-defined label is too similar to a core system field
      name on the target model, which would confuse data entry staff.
      Example: Adding a field called "Member ID" when member_number already
               exists as a core field.
      Severity: WARNING.

    MODEL_FIELD_CLASH
      Two form fields attempt to map to the same model column.
      Detection: enforced at DB level by unique_together on FormField, but
                 also reported here with a human-readable message.
      Severity: ERROR (Django will raise an IntegrityError at submission).

    TYPE_MISMATCH
      The chosen display_type is semantically incompatible with the
      underlying Django model field type.
      Examples:
        text widget      → DecimalField  (user can't enter "abc" into a decimal)
        boolean widget   → CharField     (checkbox into a text column is valid
                                          but almost certainly wrong)
        file_upload      → IntegerField  (clearly wrong)
      Severity: ERROR for clearly incompatible pairs, WARNING for possibly-
                intentional ones.

    REDUNDANT_CORE
      The form field duplicates data already captured in a required core
      model field that is always populated. Adding it creates two sources
      of truth for the same attribute.
      Example: Adding a label "First Name" that maps_to_model_field=first_name
               when first_name is already a required core field that the
               system fills from the user's registration data.
      Severity: WARNING.

    MISSING_REQUIRED
      A non-nullable model field with no default is not covered by any
      form field AND is not in FormTemplate.field_defaults. If a submission
      is made, Django will raise an IntegrityError.
      Severity: ERROR.

    NUMERIC_UNIT_AMBIGUITY
      Two numeric fields target related model columns but neither label
      includes a unit (e.g. two fields mapping to quantity_kg and
      unit_price_ksh where neither label mentions kg or KES).
      Severity: WARNING.
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    """

    class IssueType(models.TextChoices):
        LABEL_DUPLICATE        = "LABEL_DUPLICATE",       "Duplicate Label Meaning"
        ABBREVIATION_CLASH     = "ABBREVIATION_CLASH",    "Label Is Abbreviation of Another"
        SWAHILI_SYNONYM        = "SWAHILI_SYNONYM",       "Swahili Synonym of Another Label"
        LABEL_CORE_CONFLICT    = "LABEL_CORE_CONFLICT",   "Label Conflicts with Core Field Name"
        MODEL_FIELD_CLASH      = "MODEL_FIELD_CLASH",     "Two Fields Map to Same Model Field"
        TYPE_MISMATCH          = "TYPE_MISMATCH",         "Display Type / Model Field Type Mismatch"
        REDUNDANT_CORE         = "REDUNDANT_CORE",        "Redundant with Existing Core Field"
        MISSING_REQUIRED       = "MISSING_REQUIRED",      "Required Model Field Not Covered"
        NUMERIC_UNIT_AMBIGUITY = "NUMERIC_UNIT_AMBIGUITY","Numeric Field Missing Unit in Label"

    class Severity(models.TextChoices):
        ERROR   = "ERROR",   "Error — blocks activation"
        WARNING = "WARNING", "Warning — may acknowledge and proceed"

    template          = models.ForeignKey(
        FormTemplate, on_delete=models.CASCADE, related_name="semantic_issues"
    )
    affected_field    = models.ForeignKey(
        FormField,
        on_delete=models.CASCADE,
        related_name="semantic_issues",
        help_text="The form field that has the issue.",
    )
    conflicting_field = models.ForeignKey(
        FormField,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="conflicts_with",
        help_text="The other field involved (for pairwise issues like LABEL_DUPLICATE).",
    )
    issue_type     = models.CharField(max_length=25, choices=IssueType.choices)
    severity       = models.CharField(
        max_length=10, choices=Severity.choices, default=Severity.WARNING
    )
    description    = models.TextField(
        help_text="Human-readable explanation shown to the Chair."
    )
    suggestion     = models.TextField(
        blank=True,
        help_text="Recommended resolution shown to the Chair.",
    )

    # Resolution state
    is_acknowledged  = models.BooleanField(
        default=False,
        help_text=(
            "Chair has reviewed and accepted this WARNING. "
            "ERRORs cannot be acknowledged — they must be fixed."
        ),
    )
    acknowledged_by = models.ForeignKey(
        "User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="acknowledged_issues",
    )
    acknowledged_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table     = "sf_form_semantic_issues"
        verbose_name = "Form Field Semantic Issue"
        ordering     = ["severity", "issue_type"]

    def __str__(self):
        return (
            f"[{self.severity}] {self.get_issue_type_display()} "
            f'on "{self.affected_field.label}"'
        )

    @property
    def is_blocking(self) -> bool:
        """True if this issue prevents template activation."""
        return self.severity == self.Severity.ERROR and not self.is_acknowledged

    @property
    def can_be_acknowledged(self) -> bool:
        return self.severity == self.Severity.WARNING


class FormSubmission(BaseModel):
    """
    Audit trail for a form-driven database entry.

    When a helper submits a FormTemplate:
      1. The service layer reads the template's target_model.
      2. Maps each FormField.maps_to_model_field → submitted value.
      3. Injects FormTemplate.field_defaults (cooperative, recorded_by, etc.).
      4. Creates and saves the target model instance.
      5. Creates this FormSubmission record as an immutable audit entry.

    THE DATA LIVES IN THE TARGET MODEL TABLE.
    This record is the paper trail, not the data store.
    Deleting this record does NOT delete the created model entry.
    """

    class SubmissionStatus(models.TextChoices):
        SUCCESS = "SUCCESS", "Record Created Successfully"
        FAILED  = "FAILED",  "Record Creation Failed"
        PARTIAL = "PARTIAL", "Partial — some optional fields skipped"

    template    = models.ForeignKey(
        FormTemplate, on_delete=models.PROTECT, related_name="submissions"
    )
    cooperative = models.ForeignKey(
        Cooperative, on_delete=models.CASCADE, related_name="form_submissions"
    )

    # The actual record that was created
    created_model     = models.CharField(
        max_length=100,
        help_text="Django model class name of the created record, e.g. 'ProductionRecord'.",
    )
    created_record_id = models.UUIDField(
        help_text="Primary key of the created record in the target model table.",
    )

    submitted_by = models.ForeignKey("User", on_delete=models.SET_NULL, null=True)
    submitted_at = models.DateTimeField(auto_now_add=True)

    # Raw snapshot for audit / debugging (JSON: {model_field: submitted_value})
    raw_payload = models.JSONField(
        default=dict,
        help_text="Exact field values submitted, captured at submission time.",
    )

    status       = models.CharField(
        max_length=10, choices=SubmissionStatus.choices, default=SubmissionStatus.SUCCESS
    )
    error_detail = models.TextField(
        blank=True,
        help_text="Populated when status=FAILED. Contains the exception message.",
    )

    class Meta:
        db_table     = "sf_form_submissions"
        verbose_name = "Form Submission"
        ordering     = ["-submitted_at"]
        indexes      = [
            models.Index(fields=["created_model", "created_record_id"]),
            models.Index(fields=["cooperative", "template"]),
            models.Index(fields=["submitted_at"]),
        ]

    def __str__(self):
        return (
            f"[{self.status}] {self.template.name} → "
            f"{self.created_model}:{self.created_record_id}"
        )


# ── OPERATIONAL CRM MODULES ────────────────────────────────────────

class ProductionRecord(BaseModel):
    """
    A single harvest or production event.
    Core fields drive capacity analytics; saving triggers recalculation.
    """

    class QualityGrade(models.TextChoices):
        GRADE_A  = "A",   "Grade A (Premium)"
        GRADE_B  = "B",   "Grade B (Standard)"
        GRADE_C  = "C",   "Grade C (Low)"
        UNGRADED = "UNG", "Ungraded"

    cooperative    = models.ForeignKey(
        Cooperative, on_delete=models.CASCADE, related_name="production_records"
    )
    member         = models.ForeignKey(
        Member,
        on_delete=models.CASCADE,
        related_name="production_records",
        null=True,
        blank=True,
    )
    product_name   = models.CharField(
        max_length=200, help_text="e.g. Maize, Milk, Coffee Beans."
    )
    harvest_date   = models.DateField()
    quantity_kg    = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        validators=[MinValueValidator(0.001)],
        help_text="Weight in kilograms.",
    )
    quality_grade  = models.CharField(
        max_length=5, choices=QualityGrade.choices, default=QualityGrade.UNGRADED
    )
    unit_price_ksh = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Indicative farm-gate price in KES. No transaction is processed here.",
    )
    season      = models.CharField(
        max_length=50, blank=True, help_text="e.g. Long Rains 2024."
    )
    notes       = models.TextField(blank=True)
    recorded_by = models.ForeignKey("User", on_delete=models.SET_NULL, null=True)

    class Meta:
        db_table     = "sf_production_records"
        verbose_name = "Production Record"
        ordering     = ["-harvest_date"]
        indexes      = [
            models.Index(fields=["cooperative", "harvest_date"]),
            models.Index(fields=["cooperative", "product_name"]),
            models.Index(fields=["member", "harvest_date"]),
        ]

    def __str__(self):
        return (
            f"{self.cooperative.name} | {self.product_name} | "
            f"{self.quantity_kg}kg | {self.harvest_date}"
        )


class LivestockHealthLog(BaseModel):
    """Veterinary events: vaccinations, treatments, births, deaths."""

    class EventType(models.TextChoices):
        VACCINATION   = "VACCINATION",   "Vaccination"
        TREATMENT     = "TREATMENT",     "Medical Treatment"
        DISEASE       = "DISEASE",       "Disease Event"
        ROUTINE_CHECK = "ROUTINE_CHECK", "Routine Check"
        BIRTH         = "BIRTH",         "Birth / Calving"
        DEATH         = "DEATH",         "Death"
        SALE          = "SALE",          "Sale"
        PURCHASE      = "PURCHASE",      "Purchase"

    cooperative      = models.ForeignKey(
        Cooperative, on_delete=models.CASCADE, related_name="livestock_logs"
    )
    member           = models.ForeignKey(
        Member,
        on_delete=models.CASCADE,
        related_name="livestock_logs",
        null=True,
        blank=True,
    )
    herd_record      = models.ForeignKey(
        MemberHerdRecord, on_delete=models.SET_NULL, null=True, blank=True
    )
    event_type       = models.CharField(max_length=20, choices=EventType.choices)
    animal_type      = models.CharField(max_length=100)
    event_date       = models.DateField()
    animals_affected = models.PositiveIntegerField(default=1)
    treatment_name   = models.CharField(max_length=255, blank=True)
    dosage           = models.CharField(max_length=100, blank=True)
    veterinarian     = models.CharField(max_length=255, blank=True)
    cost_ksh         = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    next_due_date    = models.DateField(null=True, blank=True)
    notes            = models.TextField(blank=True)
    document         = models.FileField(
        upload_to="livestock_docs/%Y/", blank=True, null=True
    )
    recorded_by      = models.ForeignKey("User", on_delete=models.SET_NULL, null=True)

    class Meta:
        db_table     = "sf_livestock_health"
        verbose_name = "Livestock Health Log"
        ordering     = ["-event_date"]
        indexes      = [
            models.Index(fields=["cooperative", "event_date"]),
            models.Index(fields=["member", "event_type"]),
        ]

    def __str__(self):
        return (
            f"{self.member} | {self.get_event_type_display()} | {self.event_date}"
        )


class GovernanceRecord(BaseModel):
    """AGM minutes, resolutions, audit reports, compliance certificates."""

    class RecordType(models.TextChoices):
        MEETING     = "MEETING",     "Meeting Minutes"
        RESOLUTION  = "RESOLUTION",  "Resolution"
        AUDIT       = "AUDIT",       "Audit Report"
        CERTIFICATE = "CERTIFICATE", "Certificate / Compliance"
        OTHER       = "OTHER",       "Other"

    cooperative     = models.ForeignKey(
        Cooperative, on_delete=models.CASCADE, related_name="governance_records"
    )
    record_type     = models.CharField(max_length=15, choices=RecordType.choices)
    title           = models.CharField(max_length=300)
    event_date      = models.DateField()
    location        = models.CharField(max_length=255, blank=True)
    attendees_count = models.PositiveIntegerField(null=True, blank=True)
    quorum_met      = models.BooleanField(null=True, blank=True)
    content         = CKEditor5Field(config_name="extended", blank=True)
    document        = models.FileField(
        upload_to="governance/%Y/", blank=True, null=True
    )
    recorded_by     = models.ForeignKey("User", on_delete=models.SET_NULL, null=True)
    is_ratified     = models.BooleanField(default=False)

    class Meta:
        db_table     = "sf_governance"
        verbose_name = "Governance Record"
        ordering     = ["-event_date"]
        indexes      = [
            models.Index(fields=["cooperative", "record_type"]),
            models.Index(fields=["event_date"]),
        ]

    def __str__(self):
        return (
            f"{self.cooperative.name} | "
            f"{self.get_record_type_display()} | {self.event_date}"
        )


class FinancialRecord(BaseModel):
    """
    Non-transactional financial log.
    Records contributions, savings, revenue. No payments processed here.
    """

    class RecordCategory(models.TextChoices):
        CONTRIBUTION = "CONTRIBUTION", "Member Contribution"
        LOAN_REPAY   = "LOAN_REPAY",   "Loan Repayment"
        SAVINGS      = "SAVINGS",      "Savings Deposit"
        REVENUE      = "REVENUE",      "Revenue / Proceeds"
        EXPENDITURE  = "EXPENDITURE",  "Expenditure"
        DIVIDEND     = "DIVIDEND",     "Dividend Payout"
        OTHER        = "OTHER",        "Other"

    cooperative      = models.ForeignKey(
        Cooperative, on_delete=models.CASCADE, related_name="financial_records"
    )
    member           = models.ForeignKey(
        Member,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="financial_records",
    )
    category         = models.CharField(max_length=15, choices=RecordCategory.choices)
    amount_ksh       = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        validators=[MinValueValidator(0)],
        help_text="Amount in Kenyan Shillings.",
    )
    transaction_date  = models.DateField()
    reference_number  = models.CharField(max_length=100, blank=True)
    description       = models.TextField(blank=True)
    recorded_by       = models.ForeignKey("User", on_delete=models.SET_NULL, null=True)

    class Meta:
        db_table     = "sf_financial_records"
        verbose_name = "Financial Record"
        ordering     = ["-transaction_date"]
        indexes      = [
            models.Index(fields=["cooperative", "category"]),
            models.Index(fields=["cooperative", "transaction_date"]),
            models.Index(fields=["member"]),
        ]

    def __str__(self):
        return (
            f"{self.cooperative.name} | "
            f"{self.get_category_display()} | KES {self.amount_ksh}"
        )


# ══════════════════════════════════════════════════════════════════
#  LAYER 3 — CERTIFICATION & ANALYTICS
# ══════════════════════════════════════════════════════════════════

class CapacityMetric(BaseModel):
    """
    Computed capacity index for a cooperative.
    Recalculated automatically on CRM data changes via Django signals.
    """
    cooperative = models.OneToOneField(
        Cooperative, on_delete=models.CASCADE, related_name="capacity_metric"
    )

    data_completeness_score        = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    production_consistency_score   = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    governance_participation_score = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    verification_score             = models.DecimalField(max_digits=5, decimal_places=2, default=0)

    overall_index = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=0,
        db_index=True,
        help_text="Weighted composite 0–100. Threshold ≥ 60 for premium tender access.",
    )

    total_members_scored       = models.PositiveIntegerField(default=0)
    total_production_records   = models.PositiveIntegerField(default=0)
    estimated_annual_volume_kg = models.DecimalField(
        max_digits=14, decimal_places=3, default=0
    )
    is_premium_eligible    = models.BooleanField(default=False)
    last_calculated_at     = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table     = "sf_capacity_metrics"
        verbose_name = "Capacity Metric"

    def __str__(self):
        return f"{self.cooperative.name} | Index: {self.overall_index}/100"


class CapacitySnapshot(BaseModel):
    """
    Historical capacity index value written each time CapacityMetric is recalculated.
    Enables the trend graph on the Certification & Analytics page.
    """
    cooperative   = models.ForeignKey(
        Cooperative, on_delete=models.CASCADE, related_name="capacity_snapshots"
    )
    overall_index = models.DecimalField(max_digits=5, decimal_places=2)
    snapshot_date = models.DateField(db_index=True)
    trigger       = models.CharField(
        max_length=50,
        default="SCHEDULED",
        help_text="What triggered this snapshot: SCHEDULED, PRODUCTION_SAVE, MEMBER_ADD, etc.",
    )

    class Meta:
        db_table     = "sf_capacity_snapshots"
        verbose_name = "Capacity Snapshot"
        ordering     = ["-snapshot_date"]

    def __str__(self):
        return f"{self.cooperative.name} | {self.overall_index} | {self.snapshot_date}"


# ══════════════════════════════════════════════════════════════════
#  LAYER 4 — MARKETPLACE (Tender System)
# ══════════════════════════════════════════════════════════════════

class Buyer(BaseModel):
    """
    Marketplace entity representing a sourcing company.
    Linked to a User (user_type=BUYER) with a BuyerProfile.
    Kept as a separate model for marketplace relations (Tender, Bid, etc.).
    """
    user    = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="buyer",
        limit_choices_to={"user_type": "BUYER"},
    )
    profile = models.OneToOneField(
        BuyerProfile,
        on_delete=models.CASCADE,
        related_name="buyer",
        null=True,
        blank=True,
    )

    class Meta:
        db_table     = "sf_buyers"
        verbose_name = "Buyer"

    def __str__(self):
        return self.profile.company_name if self.profile else self.user.email


class Tender(BaseModel):
    """A structured sourcing request posted by a Buyer."""

    class TenderStatus(models.TextChoices):
        DRAFT        = "DRAFT",        "Draft"
        PUBLISHED    = "PUBLISHED",    "Published"
        UNDER_REVIEW = "UNDER_REVIEW", "Under Review"
        AWARDED      = "AWARDED",      "Awarded"
        CANCELLED    = "CANCELLED",    "Cancelled"
        CLOSED       = "CLOSED",       "Closed"

    class EligibilityTier(models.TextChoices):
        OPEN    = "OPEN",    "Open — All Registered Cooperatives"
        PREMIUM = "PREMIUM", "Premium — Verified & CRM-Active Only"

    class ProductCategory(models.TextChoices):
        CEREALS      = "CEREALS",      "Cereals & Grains"
        VEGETABLES   = "VEGETABLES",   "Vegetables"
        FRUITS       = "FRUITS",       "Fruits"
        DAIRY        = "DAIRY",        "Dairy Products"
        MEAT         = "MEAT",         "Meat & Poultry"
        PULSES       = "PULSES",       "Pulses & Legumes"
        CASH_CROPS   = "CASH_CROPS",   "Cash Crops (Tea, Coffee, etc.)"
        HORTICULTURE = "HORTICULTURE", "Horticulture"
        OTHER        = "OTHER",        "Other"

    buyer             = models.ForeignKey(Buyer, on_delete=models.CASCADE, related_name="tenders")
    title             = models.CharField(max_length=300)
    product_category  = models.CharField(max_length=15, choices=ProductCategory.choices)
    product_name      = models.CharField(max_length=200)
    status            = models.CharField(
        max_length=15, choices=TenderStatus.choices, default=TenderStatus.DRAFT
    )
    eligibility_tier  = models.CharField(
        max_length=10, choices=EligibilityTier.choices, default=EligibilityTier.OPEN
    )
    quantity_kg_min   = models.DecimalField(max_digits=12, decimal_places=3)
    quantity_kg_max   = models.DecimalField(max_digits=12, decimal_places=3)
    quality_specs     = CKEditor5Field(config_name="default", blank=True)
    delivery_location = models.CharField(max_length=300)
    delivery_start    = models.DateField()
    delivery_end      = models.DateField()
    bid_deadline      = models.DateTimeField(db_index=True)
    indicative_price_min_ksh = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    indicative_price_max_ksh = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    is_boosted         = models.BooleanField(
        default=False,
        help_text="Paid urgency boost. Payment handled externally.",
    )
    boost_expires_at   = models.DateTimeField(null=True, blank=True)
    boost_confirmed_by = models.ForeignKey(
        "User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="boosted_tenders",
    )
    published_at      = models.DateTimeField(null=True, blank=True)
    closed_at         = models.DateTimeField(null=True, blank=True)
    min_capacity_index = models.PositiveSmallIntegerField(
        default=60, validators=[MaxValueValidator(100)]
    )
    total_bids         = models.PositiveIntegerField(default=0)

    class Meta:
        db_table     = "sf_tenders"
        verbose_name = "Tender"
        ordering     = ["-published_at", "-created_at"]
        indexes      = [
            models.Index(fields=["status", "eligibility_tier"]),
            models.Index(fields=["bid_deadline"]),
            models.Index(fields=["product_category"]),
            models.Index(fields=["is_boosted"]),
        ]

    def __str__(self):
        return f"[{self.status}] {self.title}"


class TenderDocument(BaseModel):
    """Files attached to a tender — specifications, certifications."""
    tender      = models.ForeignKey(Tender, on_delete=models.CASCADE, related_name="documents")
    title       = models.CharField(max_length=255)
    file        = models.FileField(upload_to="tender_docs/%Y/")
    uploaded_by = models.ForeignKey("User", on_delete=models.SET_NULL, null=True)

    class Meta:
        db_table     = "sf_tender_documents"
        verbose_name = "Tender Document"

    def __str__(self):
        return f"{self.tender.title} — {self.title}"


class Bid(BaseModel):
    """A cooperative's formal response to a Tender."""

    class BidStatus(models.TextChoices):
        DRAFT       = "DRAFT",       "Draft"
        SUBMITTED   = "SUBMITTED",   "Submitted"
        SHORTLISTED = "SHORTLISTED", "Shortlisted"
        ACCEPTED    = "ACCEPTED",    "Accepted"
        REJECTED    = "REJECTED",    "Rejected"
        WITHDRAWN   = "WITHDRAWN",   "Withdrawn"

    tender               = models.ForeignKey(Tender, on_delete=models.CASCADE, related_name="bids")
    cooperative          = models.ForeignKey(Cooperative, on_delete=models.CASCADE, related_name="bids")
    submitted_by         = models.ForeignKey("User", on_delete=models.SET_NULL, null=True)
    status               = models.CharField(
        max_length=15, choices=BidStatus.choices, default=BidStatus.DRAFT
    )
    offered_quantity_kg  = models.DecimalField(
        max_digits=12, decimal_places=3, validators=[MinValueValidator(0.001)]
    )
    offered_price_ksh    = models.DecimalField(
        max_digits=10, decimal_places=2, validators=[MinValueValidator(0)]
    )
    proposed_delivery_date = models.DateField()
    narrative              = CKEditor5Field(config_name="default", blank=True)
    terms_notes            = models.TextField(blank=True)
    revision_number        = models.PositiveSmallIntegerField(default=1)
    previous_bid           = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="revisions",
    )
    submitted_at           = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table     = "sf_bids"
        verbose_name = "Bid"
        ordering     = ["-submitted_at"]
        indexes      = [
            models.Index(fields=["tender", "status"]),
            models.Index(fields=["cooperative", "status"]),
        ]
        constraints  = [
            models.UniqueConstraint(
                fields=["tender", "cooperative"],
                condition=models.Q(
                    status__in=["DRAFT", "SUBMITTED", "SHORTLISTED", "ACCEPTED"]
                ),
                name="unique_active_bid_per_coop_per_tender",
            )
        ]

    def __str__(self):
        return f"{self.cooperative.name} → {self.tender.title} [{self.status}]"


class BidDocument(BaseModel):
    """Supporting documents attached to a bid."""
    bid         = models.ForeignKey(Bid, on_delete=models.CASCADE, related_name="documents")
    title       = models.CharField(max_length=255)
    file        = models.FileField(upload_to="bid_docs/%Y/")
    uploaded_by = models.ForeignKey("User", on_delete=models.SET_NULL, null=True)

    class Meta:
        db_table     = "sf_bid_documents"
        verbose_name = "Bid Document"

    def __str__(self):
        return f"{self.bid.cooperative.name} bid doc — {self.title}"


class TenderMessage(BaseModel):
    """In-platform messaging between Buyer and Cooperative, scoped to a Tender."""
    tender                = models.ForeignKey(
        Tender, on_delete=models.CASCADE, related_name="messages"
    )
    sender                = models.ForeignKey(
        "User", on_delete=models.CASCADE, related_name="sent_messages"
    )
    recipient_cooperative = models.ForeignKey(
        Cooperative,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="received_messages",
        help_text="Null when the sender is the cooperative (message is directed to the buyer).",
    )
    body       = models.TextField()
    is_read    = models.BooleanField(default=False)
    read_at    = models.DateTimeField(null=True, blank=True)
    attachment = models.FileField(
        upload_to="chat_attachments/%Y/", blank=True, null=True
    )

    class Meta:
        db_table     = "sf_tender_messages"
        verbose_name = "Tender Message"
        ordering     = ["created_at"]
        indexes      = [
            models.Index(fields=["tender", "sender"]),
            models.Index(fields=["is_read"]),
        ]

    def __str__(self):
        return f"[{self.tender.title}] {self.sender.full_name}: {self.body[:60]}"


# ══════════════════════════════════════════════════════════════════
#  LAYER 5 — REPUTATION & PERFORMANCE LEDGER
# ══════════════════════════════════════════════════════════════════

class ReputationLedger(BaseModel):
    """
    Immutable outcome record written by a Buyer after tender closure.
    Disputes are noted here but resolved entirely offline.
    Each entry drives the CooperativeReputationScore recalculation.
    """

    class FulfillmentStatus(models.TextChoices):
        FULL     = "FULL",     "Fully Delivered"
        PARTIAL  = "PARTIAL",  "Partially Delivered"
        NONE     = "NONE",     "Not Delivered"
        DISPUTED = "DISPUTED", "Disputed"

    tender               = models.ForeignKey(
        Tender, on_delete=models.CASCADE, related_name="reputation_entries"
    )
    cooperative          = models.ForeignKey(
        Cooperative, on_delete=models.CASCADE, related_name="reputation_entries"
    )
    buyer                = models.ForeignKey(
        Buyer, on_delete=models.CASCADE, related_name="reputation_given"
    )
    recorded_by          = models.ForeignKey("User", on_delete=models.SET_NULL, null=True)

    fulfillment_status   = models.CharField(max_length=10, choices=FulfillmentStatus.choices)
    committed_volume_kg  = models.DecimalField(max_digits=12, decimal_places=3)
    delivered_volume_kg  = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    delivery_on_time     = models.BooleanField(null=True, blank=True)
    quality_met          = models.BooleanField(null=True, blank=True)

    reliability_rating   = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)],
        help_text="1 = Very Poor, 5 = Excellent",
    )
    quality_rating       = models.PositiveSmallIntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(5)],
    )
    communication_rating = models.PositiveSmallIntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(5)],
    )

    has_dispute    = models.BooleanField(default=False)
    dispute_notes  = models.TextField(
        blank=True, help_text="Record-only. Resolution happens offline."
    )
    public_comment = models.TextField(
        blank=True, help_text="Visible on the cooperative's public profile page."
    )
    recorded_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table            = "sf_reputation_ledger"
        verbose_name        = "Reputation Ledger Entry"
        ordering            = ["-recorded_at"]
        unique_together     = ("tender", "cooperative")
        indexes             = [
            models.Index(fields=["cooperative", "fulfillment_status"]),
            models.Index(fields=["buyer"]),
        ]

    def __str__(self):
        return (
            f"{self.cooperative.name} | {self.tender.title} | "
            f"{self.get_fulfillment_status_display()}"
        )

    @property
    def delivery_rate(self) -> float:
        if not self.committed_volume_kg:
            return 0.0
        return round(
            float(self.delivered_volume_kg) / float(self.committed_volume_kg) * 100, 1
        )


class CooperativeReputationScore(BaseModel):
    """
    Aggregated credibility score for a cooperative.
    Recalculated whenever a new ReputationLedger entry is saved.
    Displayed on the Cooperative Public Profile and used by Buyers
    when evaluating bids.
    """
    cooperative = models.OneToOneField(
        Cooperative, on_delete=models.CASCADE, related_name="reputation_score"
    )

    total_tenders_participated   = models.PositiveIntegerField(default=0)
    total_tenders_completed      = models.PositiveIntegerField(default=0)
    total_tenders_disputed       = models.PositiveIntegerField(default=0)
    total_committed_kg           = models.DecimalField(max_digits=16, decimal_places=3, default=0)
    total_delivered_kg           = models.DecimalField(max_digits=16, decimal_places=3, default=0)
    average_delivery_rate        = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    average_reliability_rating   = models.DecimalField(max_digits=3, decimal_places=2, default=0)
    average_quality_rating       = models.DecimalField(max_digits=3, decimal_places=2, default=0)
    average_communication_rating = models.DecimalField(max_digits=3, decimal_places=2, default=0)

    credibility_score = models.DecimalField(
        max_digits=5, decimal_places=2, default=0, db_index=True,
        help_text="Platform-computed credibility 0–100. Higher = more trade credibility.",
    )
    completion_rate = models.DecimalField(
        max_digits=5, decimal_places=2, default=0,
        help_text="Percentage of tenders fully delivered.",
    )

    last_calculated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table     = "sf_reputation_scores"
        verbose_name = "Cooperative Reputation Score"

    def __str__(self):
        return f"{self.cooperative.name} | Credibility: {self.credibility_score}/100"