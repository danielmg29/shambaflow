"""
ShambaFlow – Form Builder Semantic Validation Engine  (v2 — custom-field aware)
================================================================================
Pure-function validation. No OOP. No external ML libraries.

Nine semantic checks:
  1. LABEL_DUPLICATE         (ERROR)
  2. ABBREVIATION_CLASH      (WARNING)
  3. SWAHILI_SYNONYM         (WARNING)
  4. LABEL_CORE_CONFLICT     (WARNING)  — skipped for custom fields
  5. MODEL_FIELD_CLASH       (ERROR)    — applies to custom key clashes too
  6. TYPE_MISMATCH           (ERROR/W)  — skipped for custom fields
  7. REDUNDANT_CORE          (WARNING)  — skipped for custom fields
  8. MISSING_REQUIRED        (ERROR)    — custom fields don't count as coverage
  9. NUMERIC_UNIT_AMBIGUITY  (WARNING)

Custom fields (is_custom_field=True) store values in the target model's
`extra_data` JSONB column, keyed by maps_to_model_field (a snake_case
identifier). They are exempt from checks 4, 6, 7, and 8 because they do
not reference an existing model column.

Returns a list of issue dicts — the caller persists them as
FormFieldSemanticIssue rows. This module makes NO database writes.
"""

import re

from django.apps import apps

from core.services.semantic_text import (
    KNOWN_ABBREVIATIONS as _KNOWN_ABBREVIATIONS,
    STOP_WORDS as _STOP_WORDS,
    SWAHILI_SYNONYMS as _SWAHILI_SYNONYMS,
    near_exact_labels as _near_exact_labels,
    normalize_text as _normalize,
    semantic_duplicate_labels as _semantic_duplicate_labels,
    slugify_to_field_key as _shared_slugify_to_field_key,
    tokenize_text as _tokens,
)


# ── Target model registry ─────────────────────────────────────────────────────
# Keep in sync with FORM_BUILDER_TARGET_MODELS in core/models.py.
FORM_BUILDER_TARGET_MODELS: dict[str, str] = {
    "MEMBER":      "Member",
    "PRODUCTION":  "ProductionRecord",
    "LIVESTOCK":   "LivestockHealthLog",
    "GOVERNANCE":  "GovernanceRecord",
    "FINANCE":     "FinancialRecord",
    "LAND":        "MemberLandRecord",
    "HERD":        "MemberHerdRecord",
}


def _get_model(model_name: str):
    """
    Resolve a model class from the 'core' app.
    Falls back to a cross-app scan if the core lookup fails.
    Never raises — returns None on failure.
    """
    try:
        return apps.get_model("core", model_name)
    except LookupError:
        pass
    # fallback: search all apps by __name__
    for m in apps.get_models():
        if m.__name__ == model_name:
            return m
    return None


# ══════════════════════════════════════════════════════════════════
#  CUSTOM KEY HELPERS  (used by views and frontend)
# ══════════════════════════════════════════════════════════════════

def slugify_to_field_key(label: str) -> str:
    return _shared_slugify_to_field_key(label)


def validate_custom_key(key: str) -> str | None:
    """
    Validate a custom field key provided by the frontend.
    Returns None if valid, or a human-readable error string if invalid.
    """
    if not key:
        return "Custom field key cannot be empty."
    if not re.match(r"^[a-z][a-z0-9_]{0,63}$", key):
        return (
            f'"{key}" is not a valid custom field key. '
            "Use lowercase snake_case starting with a letter "
            "(e.g. soil_type, harvest_weight_kg, irrigation_method)."
        )
    return None


_UNIT_KEYWORDS = frozenset({
    "kg", "kgs", "grams", "g", "tonnes", "ton",
    "ksh", "kes", "usd", "eur",
    "km", "m", "meters", "metres", "cm",
    "ha", "hectare", "hectares", "acres", "acre",
    "l", "litres", "liters", "ml",
    "percent", "%",
    "days", "weeks", "months", "years",
    "count", "number", "pieces", "units", "score",
})

_COMPATIBLE_TYPES: dict[str, set[str]] = {
    "text":         {"CharField", "TextField", "EmailField", "URLField", "SlugField"},
    "textarea":     {"TextField", "CharField"},
    "number":       {"IntegerField", "PositiveIntegerField", "PositiveSmallIntegerField",
                     "SmallIntegerField", "BigIntegerField", "AutoField"},
    "decimal":      {"DecimalField", "FloatField"},
    "date":         {"DateField"},
    "datetime":     {"DateTimeField"},
    "dropdown":     {"CharField", "TextField"},
    "multi_select": {"JSONField", "TextField", "CharField"},
    "boolean":      {"BooleanField", "NullBooleanField"},
    "file_upload":  {"FileField"},
    "image_upload": {"ImageField"},
    "gps":          {"DecimalField", "FloatField", "CharField"},
    "rich_text":    {"TextField", "CharField"},
}

_INCOMPATIBLE_ERRORS: dict[str, set[str]] = {
    "number":       {"FileField", "ImageField", "BooleanField", "DateField", "DateTimeField", "JSONField"},
    "decimal":      {"FileField", "ImageField", "BooleanField", "DateField", "DateTimeField", "JSONField"},
    "date":         {"IntegerField", "DecimalField", "FileField", "ImageField", "BooleanField", "JSONField"},
    "datetime":     {"IntegerField", "DecimalField", "FileField", "ImageField", "BooleanField", "JSONField"},
    "boolean":      {"DecimalField", "DateField", "DateTimeField", "FileField", "ImageField", "JSONField"},
    "file_upload":  {"IntegerField", "DecimalField", "DateField", "DateTimeField", "BooleanField", "JSONField"},
    "image_upload": {"IntegerField", "DecimalField", "DateField", "DateTimeField", "BooleanField", "JSONField"},
}

_SYSTEM_POPULATED_FIELDS = frozenset({
    "cooperative", "cooperative_id",
    "recorded_by", "recorded_by_id", 
    "added_by", "added_by_id",
    "submitted_by", "submitted_by_id",
    "created_at", "updated_at",
    "id",
})

_AUTO_FILLED_FIELDS = frozenset({
    "id", "created_at", "updated_at", "submitted_by", "submitted_by_id"
})

_USER_SELECTABLE_SYSTEM_FIELDS = frozenset({
    "cooperative", "cooperative_id", 
    "recorded_by", "recorded_by_id",
    "added_by", "added_by_id"
})

_ALWAYS_EXCLUDED = {"id", "created_at", "updated_at", "submitted_by", "submitted_by_id"}


def _are_similar_labels(a: str, b: str) -> bool:
    return _near_exact_labels(a, b) or _semantic_duplicate_labels(a, b)


def _is_acronym_of(short: str, long: str) -> bool:
    ns = _normalize(short).replace(" ", "")
    if not (2 <= len(ns) <= 6):
        return False
    words = [w for w in _normalize(long).split() if w not in _STOP_WORDS and w]
    return bool(words) and ns == "".join(w[0] for w in words)

#  MODEL FIELD INTROSPECTION
# ══════════════════════════════════════════════════════════════════

def get_model_fields_info(target_model_key: str) -> list[dict]:
    """
    Return metadata for all fields on the target model, including system fields
    with smart classification for UI display.
    
    Each field includes:
    - system_field_type: "auto_filled" | "user_selectable" | "regular"
    - is_system_field: true for system fields
    - user_guidance: helpful text for form builder UI
    
    The extra_data column itself is excluded — it is the storage bucket for
    custom fields and is not a mappable target on its own.
    """
    model_name = FORM_BUILDER_TARGET_MODELS.get(target_model_key)
    if not model_name:
        return []
    model_class = _get_model(model_name)
    if model_class is None:
        return []

    result = []
    for field in model_class._meta.get_fields():
        if not hasattr(field, "column"):
            continue
        # Exclude extra_data — it's not a mappable target, it's the bucket
        if field.name == "extra_data":
            continue
        if getattr(field, "primary_key", False):
            continue

        null = getattr(field, "null", True)
        blank = getattr(field, "blank", True)
        dv = getattr(field, "default", None)
        has_default = (
            dv is not None
            and not (hasattr(dv, "__name__") and dv.__name__ == "NOT_PROVIDED")
            and str(type(dv)) != "<class 'django.db.models.fields.NOT_PROVIDED'>"
        )
        is_required = not null and not blank and not has_default

        choices = (
            [{"value": str(c[0]), "label": str(c[1])} for c in field.choices]
            if getattr(field, "choices", None) else []
        )
        is_relation = hasattr(field, "related_model") and field.related_model is not None
        field_type = (
            field.get_internal_type()
            if hasattr(field, "get_internal_type")
            else type(field).__name__
        )

        # Classify system field type
        is_system_field = field.name in _SYSTEM_POPULATED_FIELDS
        if field.name in _AUTO_FILLED_FIELDS:
            system_field_type = "auto_filled"
            user_guidance = "This field is automatically filled by the system - you should not add it to forms."
        elif field.name in _USER_SELECTABLE_SYSTEM_FIELDS:
            system_field_type = "user_selectable"
            user_guidance = "This is a system field that you can select values for, but it's managed by the system."
        else:
            system_field_type = "regular"
            user_guidance = ""

        result.append({
            "field_name":    field.name,
            "verbose_name":  str(getattr(field, "verbose_name", field.name)).capitalize(),
            "django_type":   field_type,
            "is_required":   bool(is_required),
            "has_choices":   bool(choices),
            "choices":       choices,
            "max_length":    getattr(field, "max_length", None),
            "help_text":     str(getattr(field, "help_text", "")),
            "is_relation":   bool(is_relation),
            "related_model": (
                field.related_model.__name__
                if is_relation and field.related_model else None
            ),
            # Always False here — this entry represents an existing model column.
            # The frontend uses this flag to differentiate from custom fields.
            "is_custom":     False,
            # New fields for smart system field handling
            "is_system_field":      is_system_field,
            "system_field_type":    system_field_type,
            "user_guidance":        user_guidance,
        })
    return result


def _get_required_model_fields(target_model_key: str) -> set[str]:
    """Non-nullable, no-default model fields that must be covered by real form fields."""
    model_name = FORM_BUILDER_TARGET_MODELS.get(target_model_key)
    if not model_name:
        return set()
    model_class = _get_model(model_name)
    if model_class is None:
        return set()

    required = set()
    for field in model_class._meta.get_fields():
        if not hasattr(field, "column"):
            continue
        if field.name in _ALWAYS_EXCLUDED:
            continue
        if field.name == "extra_data":
            continue
        if getattr(field, "primary_key", False):
            continue
        null = getattr(field, "null", True)
        blank = getattr(field, "blank", True)
        dv = getattr(field, "default", None)
        has_default = (
            dv is not None
            and str(type(dv)) != "<class 'django.db.models.fields.NOT_PROVIDED'>"
        )
        if not null and not blank and not has_default:
            required.add(field.name)
    return required


def _get_field_internal_type(target_model_key: str, field_name: str) -> str | None:
    model_name = FORM_BUILDER_TARGET_MODELS.get(target_model_key)
    if not model_name:
        return None
    try:
        model_class = _get_model(model_name)
        if model_class is None:
            return None
        f = model_class._meta.get_field(field_name)
        return (
            f.get_internal_type() if hasattr(f, "get_internal_type") else type(f).__name__
        )
    except Exception:
        return None


def _get_core_field_labels(target_model_key: str) -> list[str]:
    model_name = FORM_BUILDER_TARGET_MODELS.get(target_model_key)
    if not model_name:
        return []
    model_class = _get_model(model_name)
    if model_class is None:
        return []
    labels = []
    for field in model_class._meta.get_fields():
        if hasattr(field, "verbose_name"):
            labels.append(str(field.verbose_name))
        labels.append(field.name.replace("_", " "))
    return labels


# ══════════════════════════════════════════════════════════════════
#  THE NINE CHECKS
#
#  Custom fields (is_custom_field=True) are EXEMPT from:
#    4. LABEL_CORE_CONFLICT  — adding new data, not renaming existing columns
#    6. TYPE_MISMATCH        — no Django field to compare the widget against
#    7. REDUNDANT_CORE       — by definition they are new keys, not system fields
#    8. MISSING_REQUIRED     — custom keys go into extra_data, not real columns
#
#  Custom fields ARE subject to:
#    1. LABEL_DUPLICATE          — duplicate labels confuse users regardless of storage
#    2. ABBREVIATION_CLASH       — same ambiguity risk
#    3. SWAHILI_SYNONYM          — same bilingual duplication risk
#    5. MODEL_FIELD_CLASH        — two custom fields with the same key collide in extra_data
#    9. NUMERIC_UNIT_AMBIGUITY   — same UX clarity risk
# ══════════════════════════════════════════════════════════════════

def _check_label_duplicates(fields: list) -> list[dict]:
    """Check 1: LABEL_DUPLICATE — ERROR. Applies to all fields."""
    issues = []
    n = len(fields)
    for i in range(n):
        for j in range(i + 1, n):
            fa, fb = fields[i], fields[j]
            if _are_similar_labels(fa["label"], fb["label"]):
                issues.append({
                    "issue_type":           "LABEL_DUPLICATE",
                    "severity":             "ERROR",
                    "affected_field_id":    str(fa["id"]),
                    "conflicting_field_id": str(fb["id"]),
                    "description": (
                        f'The labels "{fa["label"]}" and "{fb["label"]}" have the same meaning. '
                        "Data entry staff will not know which field to fill."
                    ),
                    "suggestion": "Rename one field to make its purpose unambiguous.",
                })
    return issues


def _check_abbreviation_clashes(fields: list) -> list[dict]:
    """Check 2: ABBREVIATION_CLASH — WARNING. Applies to all fields."""
    issues = []
    n = len(fields)
    for i in range(n):
        norm_i = _normalize(fields[i]["label"])
        if norm_i in _KNOWN_ABBREVIATIONS:
            full_form = _KNOWN_ABBREVIATIONS[norm_i]
            for j in range(n):
                if i == j:
                    continue
                if full_form in _normalize(fields[j]["label"]):
                    issues.append({
                        "issue_type":           "ABBREVIATION_CLASH",
                        "severity":             "WARNING",
                        "affected_field_id":    str(fields[i]["id"]),
                        "conflicting_field_id": str(fields[j]["id"]),
                        "description": (
                            f'"{fields[i]["label"]}" appears to be an abbreviation of '
                            f'"{fields[j]["label"]}" ({_KNOWN_ABBREVIATIONS[norm_i]}).'
                        ),
                        "suggestion": "Use the full label consistently, or remove the abbreviated field.",
                    })
        for j in range(n):
            if i == j:
                continue
            if _is_acronym_of(fields[i]["label"], fields[j]["label"]):
                key = (str(fields[i]["id"]), str(fields[j]["id"]))
                if not any(
                    x["issue_type"] == "ABBREVIATION_CLASH"
                    and x["affected_field_id"] == key[0]
                    and x["conflicting_field_id"] == key[1]
                    for x in issues
                ):
                    issues.append({
                        "issue_type":           "ABBREVIATION_CLASH",
                        "severity":             "WARNING",
                        "affected_field_id":    key[0],
                        "conflicting_field_id": key[1],
                        "description": (
                            f'"{fields[i]["label"]}" appears to be an acronym of '
                            f'"{fields[j]["label"]}".'
                        ),
                        "suggestion": f'Remove "{fields[i]["label"]}" or expand it to its full form.',
                    })
    return issues


def _check_swahili_synonyms(fields: list) -> list[dict]:
    """Check 3: SWAHILI_SYNONYM — WARNING. Applies to all fields."""
    issues = []
    token_sets = [(_tokens(f["label"]), f) for f in fields]
    for i, (tok_i, fi) in enumerate(token_sets):
        for sw_word, en_equivalents in _SWAHILI_SYNONYMS:
            if sw_word not in tok_i:
                continue
            for j, (tok_j, fj) in enumerate(token_sets):
                if i == j:
                    continue
                if any(eng in tok_j for eng in en_equivalents):
                    issues.append({
                        "issue_type":           "SWAHILI_SYNONYM",
                        "severity":             "WARNING",
                        "affected_field_id":    str(fi["id"]),
                        "conflicting_field_id": str(fj["id"]),
                        "description": (
                            f'"{fi["label"]}" uses Swahili "{sw_word}", '
                            f'which means the same as "{fj["label"]}".'
                        ),
                        "suggestion": (
                            "If bilingual labels are intentional this is fine. "
                            "Otherwise standardise to one language."
                        ),
                    })
                    break
    return issues


def _check_label_core_conflicts(fields: list, target_model_key: str) -> list[dict]:
    """
    Check 4: LABEL_CORE_CONFLICT — WARNING.
    SKIPPED for custom fields — they add new keys, not rename existing columns.
    """
    issues = []
    # Only check non-custom fields
    real_fields = [f for f in fields if not f.get("is_custom_field", False)]
    core_labels = _get_core_field_labels(target_model_key)
    for field in real_fields:
        for core_label in core_labels:
            if _are_similar_labels(field["label"], core_label):
                issues.append({
                    "issue_type":           "LABEL_CORE_CONFLICT",
                    "severity":             "WARNING",
                    "affected_field_id":    str(field["id"]),
                    "conflicting_field_id": None,
                    "description": (
                        f'Your label "{field["label"]}" is very similar to the system field '
                        f'"{core_label}". This may confuse data entry staff.'
                    ),
                    "suggestion": f'Use a more specific label that clearly differs from "{core_label}".',
                })
                break
    return issues


def _check_model_field_clashes(fields: list) -> list[dict]:
    """
    Check 5: MODEL_FIELD_CLASH — ERROR.
    Applies to all fields — two custom fields with the same key would collide
    in extra_data exactly as two real fields would collide in a table column.
    """
    issues = []
    seen: dict[str, str] = {}
    for field in fields:
        mf = field["maps_to_model_field"]
        is_custom = field.get("is_custom_field", False)
        if mf in seen:
            location = "in the extra_data JSON" if is_custom else "in the model table"
            issues.append({
                "issue_type":           "MODEL_FIELD_CLASH",
                "severity":             "ERROR",
                "affected_field_id":    str(field["id"]),
                "conflicting_field_id": seen[mf],
                "description": (
                    f'Two form fields both write to "{mf}" {location}. '
                    "The second write will silently overwrite the first."
                ),
                "suggestion": "Remove the duplicate or choose a different key for one of them.",
            })
        else:
            seen[mf] = str(field["id"])
    return issues


def _check_type_mismatches(fields: list, target_model_key: str) -> list[dict]:
    """
    Check 6: TYPE_MISMATCH — ERROR or WARNING.
    SKIPPED for custom fields — they write to extra_data (JSONB), which accepts
    any serialisable type regardless of the display widget chosen.
    """
    issues = []
    real_fields = [f for f in fields if not f.get("is_custom_field", False)]
    for field in real_fields:
        internal_type = _get_field_internal_type(
            target_model_key, field["maps_to_model_field"]
        )
        if internal_type is None:
            continue
        display = field["display_type"]
        compatible = _COMPATIBLE_TYPES.get(display, set())
        error_set  = _INCOMPATIBLE_ERRORS.get(display, set())
        if internal_type in compatible:
            continue
        severity = "ERROR" if internal_type in error_set else "WARNING"
        issues.append({
            "issue_type":           "TYPE_MISMATCH",
            "severity":             severity,
            "affected_field_id":    str(field["id"]),
            "conflicting_field_id": None,
            "description": (
                f'The widget "{display}" is '
                f'{"incompatible" if severity == "ERROR" else "unusual"} '
                f'for a "{internal_type}" column ("{field["maps_to_model_field"]}").'
            ),
            "suggestion": (
                f'Change the widget to one compatible with "{internal_type}": '
                f'{", ".join(sorted(compatible))}.'
                if severity == "ERROR"
                else "Verify the widget type is correct for this field."
            ),
        })
    return issues


def _check_redundant_core(fields: list) -> list[dict]:
    """
    Check 7: REDUNDANT_CORE — WARNING.
    Only triggers for auto-filled system fields that users should never add.
    User-selectable system fields are allowed since users may need to set them.
    SKIPPED for custom fields — they are new keys by definition, never system fields.
    """
    issues = []
    real_fields = [f for f in fields if not f.get("is_custom_field", False)]
    for field in real_fields:
        if field["maps_to_model_field"] in _AUTO_FILLED_FIELDS:
            issues.append({
                "issue_type":           "REDUNDANT_CORE",
                "severity":             "WARNING",
                "affected_field_id":    str(field["id"]),
                "conflicting_field_id": None,
                "description": (
                    f'"{field["label"]}" maps to "{field["maps_to_model_field"]}", '
                    "which the system sets automatically. "
                    "Adding it creates two sources of truth."
                ),
                "suggestion": (
                    f'Remove this field — "{field["maps_to_model_field"]}" '
                    "is auto-populated on submission."
                ),
            })
    return issues


def _check_missing_required(
    fields: list,
    target_model_key: str,
    field_defaults: dict,
) -> list[dict]:
    """
    Check 8: MISSING_REQUIRED — ERROR.
    Custom fields do NOT count as coverage for required model columns —
    they go into extra_data, not into the column itself.
    Only real (non-custom) field mappings and field_defaults count.
    """
    issues = []
    required = _get_required_model_fields(target_model_key)
    # Only real field mappings satisfy model-level required constraints
    real_mappings = {
        f["maps_to_model_field"]
        for f in fields
        if not f.get("is_custom_field", False)
    }
    covered = real_mappings | set(field_defaults.keys())
    for req in required:
        if req not in covered:
            issues.append({
                "issue_type":           "MISSING_REQUIRED",
                "severity":             "ERROR",
                "affected_field_id":    None,
                "conflicting_field_id": None,
                "description": (
                    f'The model field "{req}" is required (non-nullable, no default) '
                    "but is not covered by any form field. Submitting will fail."
                ),
                "suggestion": (
                    f'Add a form field mapping to "{req}", or add it to the '
                    "template's field_defaults."
                ),
            })
    return issues


def _check_numeric_unit_ambiguity(fields: list) -> list[dict]:
    """Check 9: NUMERIC_UNIT_AMBIGUITY — WARNING. Applies to all fields."""
    issues = []
    numeric_fields = [f for f in fields if f["display_type"] in {"number", "decimal"}]
    if len(numeric_fields) < 2:
        return issues
    for field in numeric_fields:
        if not (_tokens(field["label"]) & _UNIT_KEYWORDS):
            issues.append({
                "issue_type":           "NUMERIC_UNIT_AMBIGUITY",
                "severity":             "WARNING",
                "affected_field_id":    str(field["id"]),
                "conflicting_field_id": None,
                "description": (
                    f'"{field["label"]}" has no unit. '
                    "With multiple numeric fields, missing units confuse data entry."
                ),
                "suggestion": (
                    f'Add a unit, e.g. "{field["label"]} (kg)" or "{field["label"]} (KSh)".'
                ),
            })
    return issues


# ══════════════════════════════════════════════════════════════════
#  PUBLIC API
# ══════════════════════════════════════════════════════════════════

# ══════════════════════════════════════════════════════════════════
#  CHECK 10 — CUSTOM_KEY_MISSING_DEF  (ERROR)
# ══════════════════════════════════════════════════════════════════

def _check_custom_key_missing_def(fields: list, template) -> list[dict]:
    """
    CUSTOM_KEY_MISSING_DEF — ERROR
    Every FormField with is_custom_field=True must have a corresponding
    DynamicFieldDefinition (cooperative, target_model, field_key) that is
    active.  Without it, the submission service has no schema to validate
    against, and the extra_data key is effectively undocumented.

    Skipped gracefully if apps.form_builder is not installed (e.g. during
    initial migrations).
    """
    custom_fields = [f for f in fields if f.get("is_custom_field", False)]
    if not custom_fields:
        return []

    try:
        from core.models import DynamicFieldDefinition
    except ImportError:
        return []

    existing_keys: set[str] = set(
        DynamicFieldDefinition.objects.filter(
            cooperative=template.cooperative,
            target_model=template.target_model,
            is_active=True,
        ).values_list("field_key", flat=True)
    )

    issues = []
    for field in custom_fields:
        key = field["maps_to_model_field"]
        if key not in existing_keys:
            issues.append({
                "issue_type":           "CUSTOM_KEY_MISSING_DEF",
                "severity":             "ERROR",
                "affected_field_id":    str(field["id"]),
                "conflicting_field_id": None,
                "description": (
                    f'"{field["label"]}" is a custom field (stored in extra_data) '
                    f'with key "{key}", but no active DynamicFieldDefinition exists '
                    f"for this key on the '{template.target_model}' model. "
                    f"Without a definition, the submission service cannot validate or "
                    f"document this field."
                ),
                "suggestion": (
                    f'Create a DynamicFieldDefinition with field_key="{key}" '
                    f"for this cooperative and target model, then re-validate. "
                    f"Use POST /api/form-builder/dynamic-fields/ to register it."
                ),
            })
    return issues


# ══════════════════════════════════════════════════════════════════
#  PUBLIC API
# ══════════════════════════════════════════════════════════════════

def run_semantic_validation(template) -> list[dict]:
    """
    Run all TEN semantic checks against every field in the template.
    Returns a flat list of issue dicts.

    is_custom_field is fetched from the database so custom-field-aware
    checks (4, 6, 7, 8, 10) work correctly.

    Makes NO database writes — pure computation.

    Check catalogue:
      1.  LABEL_DUPLICATE        ERROR   — two labels share the same meaning
      2.  ABBREVIATION_CLASH     WARNING — one label is a short form of another
      3.  SWAHILI_SYNONYM        WARNING — one label is the Swahili translation
      4.  LABEL_CORE_CONFLICT    WARNING — label clashes with a core field name
                                           (skipped for custom fields)
      5.  MODEL_FIELD_CLASH      ERROR   — two fields map to the same column
                                           (custom: same extra_data key)
      6.  TYPE_MISMATCH          ERROR/W — widget type incompatible with column
                                           (skipped for custom fields)
      7.  REDUNDANT_CORE         WARNING — maps to system-auto-populated field
                                           (skipped for custom fields)
      8.  MISSING_REQUIRED       ERROR   — required model field not covered
                                           (custom fields don't count as coverage)
      9.  NUMERIC_UNIT_AMBIGUITY WARNING — numeric label missing unit
      10. CUSTOM_KEY_MISSING_DEF ERROR   — custom field has no DFD registry entry
    """
    raw_fields = list(
        template.fields.values(
            "id", "label", "display_type", "maps_to_model_field", "tag",
            "is_custom_field",   # required for checks 4, 6, 7, 8, 10
        )
    )
    field_defaults = template.field_defaults or {}

    all_issues: list[dict] = []
    all_issues += _check_label_duplicates(raw_fields)
    all_issues += _check_abbreviation_clashes(raw_fields)
    all_issues += _check_swahili_synonyms(raw_fields)
    all_issues += _check_label_core_conflicts(raw_fields, template.target_model)
    all_issues += _check_model_field_clashes(raw_fields)
    all_issues += _check_type_mismatches(raw_fields, template.target_model)
    all_issues += _check_redundant_core(raw_fields)
    all_issues += _check_missing_required(raw_fields, template.target_model, field_defaults)
    all_issues += _check_numeric_unit_ambiguity(raw_fields)
    all_issues += _check_custom_key_missing_def(raw_fields, template)    # ← check 10
    return all_issues


def has_blocking_errors(issues: list[dict]) -> bool:
    """True if any issue is an ERROR — always blocks template activation."""
    return any(i["severity"] == "ERROR" for i in issues)


def _issue_signature(issue: dict) -> tuple[str, str | None, str | None]:
    return (
        issue["issue_type"],
        issue.get("affected_field_id"),
        issue.get("conflicting_field_id"),
    )


def persist_semantic_issues(template, new_issues: list[dict]) -> None:
    """
    Merge freshly computed issues into persistent FormFieldSemanticIssue rows.

    Behaviour:
    - Remove stale unacknowledged issues
    - Preserve acknowledged WARNINGs whose signature still exists
    - Create rows for any new signatures
    - Refresh template.has_blocking_errors + template.status
    """
    from core.models import FormField, FormFieldSemanticIssue, FormTemplate

    new_sigs = {_issue_signature(issue) for issue in new_issues}

    existing = list(template.semantic_issues.all())
    keep_ids: set[str] = set()
    for ex in existing:
        ex_sig = (
            ex.issue_type,
            str(ex.affected_field_id) if ex.affected_field_id else None,
            str(ex.conflicting_field_id) if ex.conflicting_field_id else None,
        )
        if ex.is_acknowledged and ex.severity == "WARNING" and ex_sig in new_sigs:
            keep_ids.add(str(ex.id))

    template.semantic_issues.exclude(id__in=keep_ids).delete()

    already = {
        (
            ex.issue_type,
            str(ex.affected_field_id) if ex.affected_field_id else None,
            str(ex.conflicting_field_id) if ex.conflicting_field_id else None,
        )
        for ex in existing
        if str(ex.id) in keep_ids
    }

    for issue in new_issues:
        if _issue_signature(issue) in already:
            continue

        affected = None
        if issue.get("affected_field_id"):
            try:
                affected = FormField.objects.get(pk=issue["affected_field_id"])
            except FormField.DoesNotExist:
                continue

        if affected is None and issue["issue_type"] != "MISSING_REQUIRED":
            continue

        conflicting = None
        if issue.get("conflicting_field_id"):
            try:
                conflicting = FormField.objects.get(pk=issue["conflicting_field_id"])
            except FormField.DoesNotExist:
                pass

        FormFieldSemanticIssue.objects.create(
            template=template,
            affected_field=affected,
            conflicting_field=conflicting,
            issue_type=issue["issue_type"],
            severity=issue["severity"],
            description=issue["description"],
            suggestion=issue.get("suggestion", ""),
        )

    any_errors = template.semantic_issues.filter(severity="ERROR").exists()
    template.has_blocking_errors = any_errors
    if any_errors:
        template.status = FormTemplate.Status.HAS_ISSUES
    elif template.status in (
        FormTemplate.Status.VALIDATING,
        FormTemplate.Status.HAS_ISSUES,
    ):
        template.status = FormTemplate.Status.DRAFT

    template.save(update_fields=["has_blocking_errors", "status"])


def refresh_template_semantic_state(template):
    """
    Recompute and persist the semantic state for one template.

    Returns the freshly calculated issue dicts for callers that want to use
    them immediately without re-running validation.
    """
    raw_issues = run_semantic_validation(template)
    persist_semantic_issues(template, raw_issues)
    return raw_issues
