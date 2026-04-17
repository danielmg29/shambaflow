"""
ShambaFlow — Dynamic Field Definition Service  (v2)
====================================================
This is the gatekeeper for every cooperative-defined field.

Architecture
────────────
CRM models are now skeletons.  Every cooperative owns its schema.
A cooperative in Kakamega may register:
    MEMBER: first_name, last_name, phone_number, national_id, region, gender

A cooperative in Nakuru may register:
    MEMBER: full_name, member_id_number, mobile, county, age_group

Both are stored in Member.extra_data.  DynamicFieldDefinition is the
registry that documents every key, its type, label, and validation rules
per (cooperative, target_model) pair.

Duplicate Prevention
────────────────────
When a cooperative tries to register a new field, this service checks
ALL existing active definitions for the SAME (cooperative, target_model)
pair and refuses if the new label:

  Rule 1 — Exact / near-exact match
      "First Name" blocks "firstname", "first  name", "FIRST NAME"
      Uses normalisation + Levenshtein + Jaccard similarity.

  Rule 2 — Semantic equivalence
      "First Name" + "Last Name" already registered  →
      "Member Name", "Full Name", "Jina Kamili" are refused.
      Uses the Swahili synonym table and semantic cluster detection.

  Rule 3 — Cross-model isolation
      MEMBER fields do NOT conflict with PRODUCTION fields.
      "First Name" on MEMBER does not block "First Name" on PRODUCTION.
      Each (cooperative, target_model) pair is a fully independent namespace.

Immutability after first use
────────────────────────────
Once a FormSubmission writes to a field_key, that definition is locked.
Locked definitions cannot have their field_key renamed (data would become
orphaned in extra_data).  Label, help text, and options remain editable.

Public API
──────────
  register_field(cooperative_id, target_model, label, ...) -> DFD | DuplicateFieldError
  update_field(dfd_id, ...)                                 -> DFD | DuplicateFieldError
  deactivate_field(dfd_id)                                  -> DFD
  lock_field(dfd_id)                                        -> DFD
  lock_fields_for_template(template_id)                     -> int
  get_field_schema(cooperative_id, target_model)            -> list[dict]
  check_label_conflict(cooperative_id, target_model, label, exclude_id=None) -> ConflictResult
  validate_custom_payload(cooperative_id, target_model, payload) -> (bool, list)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction

from core.services.semantic_text import (
    KNOWN_ABBREVIATIONS,
    STOP_WORDS,
    SWAHILI_SYNONYMS,
    anchor_tokens,
    canonical_tokens,
    near_exact_labels,
    normalize_text,
    semantic_duplicate_labels,
    slugify_to_field_key,
    tokenize_text,
)


# ── Lazy imports so this service is importable before Django setup ─────────────
def _dfd():
    from core.models import DynamicFieldDefinition
    return DynamicFieldDefinition

# ══════════════════════════════════════════════════════════════════
#  RESULT TYPES
# ══════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class ConflictResult:
    """
    Returned by check_label_conflict().
    is_conflict=True means the new label should be refused.
    """
    is_conflict: bool
    conflict_type: str  # "exact", "near_exact", "semantic_overlap", "covers_compound"
    conflicting_labels: list[str] = field(default_factory=list)
    message: str = ""

    @classmethod
    def clean(cls) -> "ConflictResult":
        return cls(is_conflict=False, conflict_type="none")


class DuplicateFieldError(Exception):
    """Raised by register_field / update_field when a conflict is detected."""
    def __init__(self, result: ConflictResult):
        self.result = result
        super().__init__(result.message)

    @property
    def conflict_type(self) -> str:
        return self.result.conflict_type

    @property
    def conflicting_labels(self) -> list[str]:
        return self.result.conflicting_labels


class FieldLockedError(Exception):
    """Raised when attempting to rename field_key on a locked definition."""


# Compound-to-atomic semantic clusters
_COMPOUND_CLUSTERS: list[frozenset[str]] = [
    frozenset({"first", "last"}),
    frozenset({"gps", "lat", "lng"}),
    frozenset({"latitude", "longitude"}),
    frozenset({"day", "month", "year"}),
]

_FULL_NAME_SET = frozenset({"full_name", "fullname", "jina_kamili", "name", "member_name"})
_FIRST_LAST_SET = frozenset({"first_name", "last_name", "firstname", "lastname",
                              "jina_la_kwanza", "jina_la_mwisho", "given_name", "surname", "family_name"})

_UNIT_KEYWORDS = frozenset({
    "kg", "kgs", "gram", "grams", "g", "ton", "tonne", "tonnes",
    "ksh", "kes", "usd", "eur",
    "km", "m", "meter", "meters", "metre", "metres", "cm",
    "ha", "hectare", "hectares", "acre", "acres",
    "l", "litre", "litres", "liter", "liters", "ml",
    "percent", "percentage",
    "day", "days", "week", "weeks", "month", "months", "year", "years",
    "count", "number", "pieces", "units", "score",
})


# ══════════════════════════════════════════════════════════════════
#  DUPLICATE CHECK — CORE LOGIC
# ══════════════════════════════════════════════════════════════════

def check_label_conflict(
    cooperative_id: Any,
    target_model: str,
    new_label: str,
    exclude_id: Any | None = None,
) -> ConflictResult:
    """
    Check whether `new_label` conflicts with any existing active field
    definition for the given (cooperative, target_model) pair.

    Returns ConflictResult. If is_conflict=True, the caller should refuse
    the registration and surface result.message to the user.

    Rules applied (in order — first match wins):
      1. Exact / near-exact label match against each existing label
      2. Semantic overlap: expanded token intersection is large
      3. Compound cluster: new label represents a concept already covered
         by existing atomic fields (or vice-versa)
      4. Full-name cluster: "Full Name" refused if "First Name" + "Last Name"
         exist; "First Name" or "Last Name" refused if "Full Name" exists

    Scope isolation: this function is called with a specific target_model.
    MEMBER fields never conflict with PRODUCTION fields.
    """
    DFD = _dfd()
    existing_qs = (
        DFD.objects
        .filter(
            cooperative_id=cooperative_id,
            target_model=target_model,
            is_active=True,
        )
    )
    if exclude_id is not None:
        existing_qs = existing_qs.exclude(pk=exclude_id)

    existing = list(existing_qs.values("id", "label", "field_key"))
    if not existing:
        return ConflictResult.clean()

    new_canonical = canonical_tokens(new_label)
    new_anchor = anchor_tokens(new_label)
    new_key = slugify_to_field_key(new_label)

    # ── Rule 1: Exact / near-exact ───────────────────────────────
    for ex in existing:
        if near_exact_labels(new_label, ex["label"]):
            return ConflictResult(
                is_conflict=True,
                conflict_type="near_exact",
                conflicting_labels=[ex["label"]],
                message=(
                    f'"{new_label}" is too similar to existing field '
                    f'"{ex["label"]}".  '
                    f'Please choose a more distinct label.'
                ),
            )
        if new_key == ex["field_key"]:
            return ConflictResult(
                is_conflict=True,
                conflict_type="near_exact",
                conflicting_labels=[ex["label"]],
                message=(
                    f'"{new_label}" produces the same internal key '
                    f'("{new_key}") as existing field "{ex["label"]}". '
                    f'Please choose a more distinct label.'
                ),
            )

    # ── Rule 2: Semantic overlap ─────────────────────────────────
    for ex in existing:
        ex_canonical = canonical_tokens(ex["label"])
        ex_anchor = anchor_tokens(ex["label"])
        if not new_canonical or not ex_canonical:
            continue
        if semantic_duplicate_labels(new_label, ex["label"]):
            shared_anchors = sorted(new_anchor & ex_anchor)
            meaning_hint = (
                f" Shared concept: {', '.join(shared_anchors)}."
                if shared_anchors else ""
            )
            return ConflictResult(
                is_conflict=True,
                conflict_type="semantic_overlap",
                conflicting_labels=[ex["label"]],
                message=(
                    f'"{new_label}" appears to mean the same thing as '
                    f'existing field "{ex["label"]}". '
                    f'For example, "Jina" and "Name" are treated as equivalent.'
                    f"{meaning_hint} Please choose a label for a genuinely different concept."
                ),
            )

    # ── Rule 3: Compound / atomic cluster ────────────────────────
    existing_tok_sets = [canonical_tokens(ex["label"]) for ex in existing]

    for cluster in _COMPOUND_CLUSTERS:
        if cluster.issubset(new_canonical):
            covered = sum(
                1 for atom in cluster
                if any(atom in exs for exs in existing_tok_sets)
            )
            if covered == len(cluster):
                covering = [
                    ex["label"] for ex, exs in zip(existing, existing_tok_sets)
                    if any(atom in exs for atom in cluster)
                ]
                return ConflictResult(
                    is_conflict=True,
                    conflict_type="covers_compound",
                    conflicting_labels=covering,
                    message=(
                        f'"{new_label}" combines concepts already captured by '
                        + ", ".join('"' + l + '"' for l in covering) + ". "
                        f'You already collect these individually. '
                        f'Adding a combined field would create redundancy.'
                    ),
                )

    for cluster in _COMPOUND_CLUSTERS:
        for exs, ex in zip(existing_tok_sets, existing):
            if cluster.issubset(exs):
                if any(atom in new_canonical for atom in cluster):
                    return ConflictResult(
                        is_conflict=True,
                        conflict_type="covers_compound",
                        conflicting_labels=[ex["label"]],
                        message=(
                            f'"{new_label}" is already covered by the more '
                            f'complete field "{ex["label"]}". '
                            f'Adding a partial field alongside it would '
                            f'create ambiguity.'
                        ),
                    )

    # ── Rule 4: Full-name / component cluster ────────────────────
    new_key_norm = new_key.replace("_", "")

    new_is_fullname = (
        new_key_norm in {k.replace("_", "") for k in _FULL_NAME_SET}
        or normalize_text(new_label).replace(" ", "") in {
            normalize_text(label).replace(" ", "") for label in _FULL_NAME_SET
        }
        or ("full" in new_canonical and "name" in new_canonical)
    )
    new_is_component = (
        new_key_norm in {k.replace("_", "") for k in _FIRST_LAST_SET}
        or ("first" in new_canonical and "name" in new_canonical)
        or ("last" in new_canonical and "name" in new_canonical)
    )

    if new_is_fullname:
        has_component = any(
            ("first" in exs or "last" in exs)
            for exs in existing_tok_sets
        )
        if has_component:
            covering = [
                ex["label"] for ex, exs in zip(existing, existing_tok_sets)
                if ("first" in exs or "last" in exs)
            ]
            return ConflictResult(
                is_conflict=True,
                conflict_type="covers_compound",
                conflicting_labels=covering,
                message=(
                    f'"{new_label}" represents a combined name field, but you '
                    f'already collect name components individually: '
                    + ", ".join('"' + l + '"' for l in covering) + ". "
                    f'Choose one approach — combined or separate.'
                ),
            )

    if new_is_component:
        has_full = any(
            "full_name" in exs or ("full" in exs and "name" in exs)
            for exs in existing_tok_sets
        )
        if has_full:
            covering = [
                ex["label"] for ex, exs in zip(existing, existing_tok_sets)
                if "full_name" in exs or ("full" in exs and "name" in exs)
            ]
            return ConflictResult(
                is_conflict=True,
                conflict_type="covers_compound",
                conflicting_labels=covering,
                message=(
                    f'"{new_label}" is a component of the combined name field '
                    f'you already defined: '
                    + ", ".join('"' + l + '"' for l in covering) + ". "
                    f'Choose one approach — combined or separate.'
                ),
            )

    return ConflictResult.clean()


# ══════════════════════════════════════════════════════════════════
#  FIELD KEY CONFLICT CHECK
# ══════════════════════════════════════════════════════════════════

def check_key_conflict(
    cooperative_id: Any,
    target_model: str,
    field_key: str,
    exclude_id: Any | None = None,
) -> bool:
    """
    Returns True if the given field_key already exists (active or inactive)
    for this (cooperative, target_model) pair.

    A deactivated field keeps its key permanently to prevent orphaning
    historical extra_data values.
    """
    DFD = _dfd()
    qs = DFD.objects.filter(
        cooperative_id=cooperative_id,
        target_model=target_model,
        field_key=field_key,
    )
    if exclude_id is not None:
        qs = qs.exclude(pk=exclude_id)
    return qs.exists()


def _is_acronym_of(short: str, long: str) -> bool:
    ns = normalize_text(short).replace(" ", "")
    if not (2 <= len(ns) <= 6):
        return False
    words = [w for w in normalize_text(long).split() if w not in STOP_WORDS and w]
    return bool(words) and ns == "".join(w[0] for w in words)


def _has_numeric_unit(label: str) -> bool:
    return bool(tokenize_text(label) & _UNIT_KEYWORDS)


def _semantic_issue(
    *,
    issue_type: str,
    severity: str,
    description: str,
    suggestion: str = "",
    conflicting_labels: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "issue_type": issue_type,
        "severity": severity,
        "description": description,
        "suggestion": suggestion,
        "conflicting_labels": conflicting_labels or [],
    }


def preview_field_semantics(
    cooperative_id: Any,
    target_model: str,
    label: str,
    display_type: str = "text",
    exclude_id: Any | None = None,
) -> list[dict[str, Any]]:
    """
    Lightweight semantic validation for the Field Registry editor.

    This is intentionally less strict than the template validator:
    - hard duplicate/conflict checks still return ERRORs
    - advisory issues surface as WARNINGs that users may ignore
    """
    DFD = _dfd()
    label = (label or "").strip()
    if not label:
        return []

    existing = list(
        DFD.objects.filter(
            cooperative_id=cooperative_id,
            target_model=target_model,
            is_active=True,
        )
        .exclude(pk=exclude_id) if exclude_id is not None else
        DFD.objects.filter(
            cooperative_id=cooperative_id,
            target_model=target_model,
            is_active=True,
        )
    )

    issues: list[dict[str, Any]] = []
    conflict = check_label_conflict(
        cooperative_id=cooperative_id,
        target_model=target_model,
        new_label=label,
        exclude_id=exclude_id,
    )
    if conflict.is_conflict:
        issues.append(
            _semantic_issue(
                issue_type="LABEL_DUPLICATE",
                severity="ERROR",
                description=conflict.message,
                suggestion="Choose a more distinct label for a genuinely different concept.",
                conflicting_labels=conflict.conflicting_labels,
            )
        )

    label_tokens = tokenize_text(label)
    normalized_label = normalize_text(label)
    seen: set[tuple[str, tuple[str, ...]]] = set()

    for ex in existing:
        ex_label = ex.label
        ex_tokens = tokenize_text(ex_label)

        if normalized_label in KNOWN_ABBREVIATIONS and KNOWN_ABBREVIATIONS[normalized_label] in normalize_text(ex_label):
            key = ("ABBREVIATION_CLASH", (ex_label,))
            if key not in seen:
                seen.add(key)
                issues.append(
                    _semantic_issue(
                        issue_type="ABBREVIATION_CLASH",
                        severity="WARNING",
                        description=(
                            f'"{label}" looks like an abbreviation of existing field "{ex_label}". '
                            "That may be fine, but data entry staff usually work faster with one naming style."
                        ),
                        suggestion="Prefer the full phrase if both fields are meant to describe different concepts.",
                        conflicting_labels=[ex_label],
                    )
                )
        elif _is_acronym_of(label, ex_label):
            key = ("ABBREVIATION_CLASH", (ex_label,))
            if key not in seen:
                seen.add(key)
                issues.append(
                    _semantic_issue(
                        issue_type="ABBREVIATION_CLASH",
                        severity="WARNING",
                        description=(
                            f'"{label}" appears to be an acronym of existing field "{ex_label}".'
                        ),
                        suggestion="Use the long form unless the abbreviation is what staff already recognize.",
                        conflicting_labels=[ex_label],
                    )
                )

        swahili_match = None
        for sw_word, en_equivalents in SWAHILI_SYNONYMS:
            if sw_word in label_tokens and any(eng in ex_tokens for eng in en_equivalents):
                swahili_match = sw_word
                break
            if sw_word in ex_tokens and any(eng in label_tokens for eng in en_equivalents):
                swahili_match = sw_word
                break
        if swahili_match:
            key = ("SWAHILI_SYNONYM", (ex_label,))
            if key not in seen:
                seen.add(key)
                issues.append(
                    _semantic_issue(
                        issue_type="SWAHILI_SYNONYM",
                        severity="WARNING",
                        description=(
                            f'"{label}" overlaps bilingually with existing field "{ex_label}". '
                            f'The term "{swahili_match}" is treated as the same concept.'
                        ),
                        suggestion="Keep it if bilingual wording is intentional; otherwise standardize the naming.",
                        conflicting_labels=[ex_label],
                    )
                )

    if display_type in {"number", "decimal"} and not _has_numeric_unit(label):
        issues.append(
            _semantic_issue(
                issue_type="NUMERIC_UNIT_AMBIGUITY",
                severity="WARNING",
                description=(
                    f'"{label}" is numeric but does not mention a unit. '
                    "Staff may not know whether to enter kg, KSh, acres, or another measure."
                ),
                suggestion='Consider adding a unit such as "(kg)", "(KSh)", or "(acres)".',
            )
        )

    return issues


def sync_definition_to_templates(dfd: Any) -> dict[str, Any]:
    """
    Push registry-owned properties into draft templates that reference this DFD
    and refresh their semantic issue state.
    """
    from core.models import FormField, FormTemplate
    from core.services.form_semantic import refresh_template_semantic_state

    templates = list(
        FormTemplate.objects.filter(
            cooperative_id=dfd.cooperative_id,
            target_model=dfd.target_model,
            status__in=[
                FormTemplate.Status.DRAFT,
                FormTemplate.Status.VALIDATING,
                FormTemplate.Status.HAS_ISSUES,
            ],
            fields__is_custom_field=True,
            fields__maps_to_model_field=dfd.field_key,
        ).distinct()
    )

    if not templates:
        return {"affected_count": 0, "template_ids": []}

    if dfd.is_active:
        FormField.objects.filter(
            template__in=templates,
            is_custom_field=True,
            maps_to_model_field=dfd.field_key,
        ).update(
            label=dfd.label,
            display_type=dfd.display_type,
            tag=dfd.tag,
        )

    for template in templates:
        refresh_template_semantic_state(template)

    return {
        "affected_count": len(templates),
        "template_ids": [str(template.id) for template in templates],
    }


# ══════════════════════════════════════════════════════════════════
#  PUBLIC API
# ══════════════════════════════════════════════════════════════════

@transaction.atomic
def register_field(
    *,
    cooperative_id: Any,
    target_model: str,
    label: str,
    display_type: str = "text",
    tag: str = "INFORMATIONAL",
    is_required: bool = False,
    help_text_display: str = "",
    placeholder: str = "",
    options: list | None = None,
    validation_rules: dict | None = None,
    created_by_id: Any | None = None,
    field_key: str | None = None,
) -> Any:
    """
    Register a new cooperative-defined field.

    Raises DuplicateFieldError if the label conflicts with any existing
    active field for this (cooperative, target_model) pair.

    Raises ValidationError if field_key is invalid or already taken.

    Returns the created DynamicFieldDefinition instance.
    """
    DFD = _dfd()

    resolved_key = field_key or slugify_to_field_key(label)
    _validate_field_key(resolved_key)

    conflict = check_label_conflict(cooperative_id, target_model, label)
    if conflict.is_conflict:
        raise DuplicateFieldError(conflict)

    if check_key_conflict(cooperative_id, target_model, resolved_key):
        raise ValidationError(
            f'Field key "{resolved_key}" already exists for this cooperative '
            f'and model (including deactivated fields). '
            f'Please use a different label or specify a custom key.'
        )

    dfd = DFD.objects.create(
        cooperative_id=cooperative_id,
        target_model=target_model,
        field_key=resolved_key,
        label=label.strip(),
        display_type=display_type,
        tag=tag,
        is_required=is_required,
        help_text_display=help_text_display.strip(),
        placeholder=placeholder.strip(),
        options=options or [],
        validation_rules=validation_rules or {},
        created_by_id=created_by_id,
    )
    return dfd


@transaction.atomic
def update_field(
    *,
    dfd_id: Any,
    label: str | None = None,
    display_type: str | None = None,
    tag: str | None = None,
    is_required: bool | None = None,
    help_text_display: str | None = None,
    placeholder: str | None = None,
    options: list | None = None,
    validation_rules: dict | None = None,
) -> Any:
    """
    Update a DynamicFieldDefinition.

    Rules:
    - field_key is immutable once locked (FieldLockedError raised).
    - label changes are subject to the same duplicate check as registration.
    - display_type, tag, validation_rules, options are always editable.
    """
    DFD = _dfd()
    dfd = DFD.objects.select_for_update().get(pk=dfd_id)
    sync_needed = False

    if label is not None and label.strip() != dfd.label:
        conflict = check_label_conflict(
            dfd.cooperative_id,
            dfd.target_model,
            label,
            exclude_id=dfd_id,
        )
        if conflict.is_conflict:
            raise DuplicateFieldError(conflict)
        dfd.label = label.strip()
        sync_needed = True

    if display_type is not None:
        sync_needed = sync_needed or display_type != dfd.display_type
        dfd.display_type = display_type
    if tag is not None:
        sync_needed = sync_needed or tag != dfd.tag
        dfd.tag = tag
    if is_required is not None:
        dfd.is_required = is_required
    if help_text_display is not None:
        dfd.help_text_display = help_text_display.strip()
    if placeholder is not None:
        dfd.placeholder = placeholder.strip()
    if options is not None:
        dfd.options = options
    if validation_rules is not None:
        dfd.validation_rules = validation_rules

    dfd.save()
    dfd.template_sync = sync_definition_to_templates(dfd) if sync_needed else {
        "affected_count": 0,
        "template_ids": [],
    }
    return dfd


def deactivate_field(dfd_id: Any) -> Any:
    """
    Soft-delete a DynamicFieldDefinition.

    The field_key is preserved permanently (historical extra_data values
    are never orphaned).  The field is hidden from new form templates.
    Already-submitted values remain intact and queryable.
    """
    DFD = _dfd()
    dfd = DFD.objects.get(pk=dfd_id)
    dfd.is_active = False
    dfd.save(update_fields=["is_active", "updated_at"])
    dfd.template_sync = sync_definition_to_templates(dfd)
    return dfd


def lock_field(dfd_id: Any) -> Any:
    """
    Lock a field after its first FormSubmission.
    Prevents field_key from being renamed (which would orphan JSONB data).
    Called automatically by the form submission service.
    """
    DFD = _dfd()
    DFD.objects.filter(pk=dfd_id).update(is_locked=True)
    return DFD.objects.get(pk=dfd_id)


def lock_fields_for_template(template_id: Any) -> int:
    """
    Lock all custom DynamicFieldDefinitions referenced by a FormTemplate's
    active FormFields.  Called after every successful FormSubmission.

    Returns the count of newly-locked definitions.
    """
    DFD = _dfd()
    try:
        from core.models import FormField
    except ImportError:
        return 0

    custom_keys = list(
        FormField.objects
        .filter(template_id=template_id, is_custom_field=True)
        .values_list("maps_to_model_field", flat=True)
    )
    if not custom_keys:
        return 0

    try:
        from core.models import FormTemplate
        tmpl = FormTemplate.objects.values("cooperative_id", "target_model").get(pk=template_id)
    except Exception:
        return 0

    result = DFD.objects.filter(
        cooperative_id=tmpl["cooperative_id"],
        target_model=tmpl["target_model"],
        field_key__in=custom_keys,
        is_locked=False,
    ).update(is_locked=True)
    return result


# ══════════════════════════════════════════════════════════════════
#  SCHEMA QUERY — used by Form Builder editor and API views
# ══════════════════════════════════════════════════════════════════

def get_field_schema(
    cooperative_id: Any,
    target_model: str,
    include_inactive: bool = False,
) -> list[dict]:
    """
    Return the full list of field definitions for a (cooperative, target_model)
    pair, formatted for the Form Builder editor and API responses.

    Structure of each dict:
    {
        "id":               str (UUID),
        "field_key":        str,
        "label":            str,
        "display_type":     str,
        "tag":              str,
        "is_required":      bool,
        "is_locked":        bool,
        "is_active":        bool,
        "help_text":        str,
        "placeholder":      str,
        "options":          list,
        "validation_rules": dict,
        "created_at":       str (ISO-8601),
    }
    """
    DFD = _dfd()
    qs = DFD.objects.filter(
        cooperative_id=cooperative_id,
        target_model=target_model,
    )
    if not include_inactive:
        qs = qs.filter(is_active=True)

    return [
        {
            "id":               str(d.id),
            "field_key":        d.field_key,
            "label":            d.label,
            "display_type":     d.display_type,
            "tag":              d.tag,
            "is_required":      d.is_required,
            "is_locked":        d.is_locked,
            "is_active":        d.is_active,
            "help_text":        d.help_text_display,
            "placeholder":      d.placeholder,
            "options":          d.options,
            "validation_rules": d.validation_rules,
            "created_at":       d.created_at.isoformat(),
        }
        for d in qs.order_by("label")
    ]


def validate_custom_payload(
    cooperative_id: Any,
    target_model: str,
    payload: dict,
) -> tuple[bool, list[dict]]:
    """
    Validate a dict of {field_key: value} pairs against the cooperative's
    registered DynamicFieldDefinitions for the given target_model.

    Returns (is_valid, errors).
    errors is a list of {"field_key": str, "message": str} dicts.

    Checks:
    - Unknown keys (keys with no active DynamicFieldDefinition) are rejected.
    - Required fields must be present and non-empty.
    - Type coercion errors are reported.
    """
    DFD = _dfd()
    definitions = {
        d.field_key: d
        for d in DFD.objects.filter(
            cooperative_id=cooperative_id,
            target_model=target_model,
            is_active=True,
        )
    }

    errors: list[dict] = []

    for key, value in payload.items():
        if key not in definitions:
            errors.append({
                "field_key": key,
                "message": (
                    f'"{key}" is not a registered field for this cooperative. '
                    f'Register it first in the Field Registry.'
                ),
            })
            continue

        defn = definitions[key]

        if defn.is_required and (value is None or value == "" or value == []):
            errors.append({
                "field_key": key,
                "message": f'"{defn.label}" is required.',
            })
            continue

        if value is None or value == "":
            continue

        type_error = _validate_value_type(key, value, defn.display_type, defn.validation_rules)
        if type_error:
            errors.append({"field_key": key, "message": type_error})

    for key, defn in definitions.items():
        if defn.is_required and key not in payload:
            errors.append({
                "field_key": key,
                "message": f'"{defn.label}" is required but was not provided.',
            })

    return len(errors) == 0, errors


def _validate_value_type(key: str, value: Any, display_type: str, rules: dict) -> str | None:
    """Returns an error message string or None if value is acceptable."""
    try:
        if display_type == "number":
            v = int(value)
            if "min" in rules and v < rules["min"]:
                return f'Value must be at least {rules["min"]}.'
            if "max" in rules and v > rules["max"]:
                return f'Value must be at most {rules["max"]}.'

        elif display_type == "decimal":
            v = float(value)
            if "min" in rules and v < rules["min"]:
                return f'Value must be at least {rules["min"]}.'
            if "max" in rules and v > rules["max"]:
                return f'Value must be at most {rules["max"]}.'

        elif display_type == "date":
            import datetime
            if isinstance(value, str):
                datetime.date.fromisoformat(value)

        elif display_type in ("text", "textarea", "rich_text"):
            if "max_length" in rules and len(str(value)) > rules["max_length"]:
                return f'Must be {rules["max_length"]} characters or fewer.'

        elif display_type == "boolean":
            if not isinstance(value, bool) and str(value).lower() not in ("true", "false", "1", "0"):
                return "Must be a true/false value."

        elif display_type == "dropdown":
            choices = rules.get("choices", [])
            if choices and str(value) not in [str(c) for c in choices]:
                return f'Must be one of: {", ".join(str(c) for c in choices)}.'

    except (ValueError, TypeError) as e:
        return f'Invalid value for type "{display_type}": {e}'

    return None


def _validate_field_key(key: str) -> None:
    """Raise ValidationError if key format is invalid."""
    if not key:
        raise ValidationError("Field key cannot be empty.")
    if not re.match(r"^[a-z][a-z0-9_]{0,63}$", key):
        raise ValidationError(
            f'"{key}" is not a valid field key. '
            f'Use lowercase snake_case starting with a letter '
            f'(e.g. "first_name", "harvest_weight_kg", "irrigation_method").'
        )
    _RESERVED_KEYS = frozenset({
        "id", "cooperative", "cooperative_id", "created_at", "updated_at",
        "extra_data", "member_number", "event_type", "record_type",
        "category", "record_date",
    })
    if key in _RESERVED_KEYS:
        raise ValidationError(
            f'"{key}" is a reserved system field name and cannot be used '
            f'as a custom field key.'
        )
