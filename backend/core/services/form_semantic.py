"""
ShambaFlow — Form Builder Semantic Validation Engine
core/services/form_semantic.py

Runs before a FormTemplate is activated. Analyses all FormField labels
and their model mappings to catch problems that would either:
  ERROR   → cause data integrity failures (blocks activation)
  WARNING → confuse data-entry staff or create ambiguous data (can be acknowledged)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SEMANTIC CHECKS (in order of severity)

  1. MODEL_FIELD_CLASH     ERROR   Two fields map to the same DB column.
  2. TYPE_MISMATCH         ERROR   Widget type incompatible with DB column type.
  3. MISSING_REQUIRED      ERROR   Non-nullable DB column with no default not covered.
  4. LABEL_DUPLICATE       ERROR   Two labels have the same meaning after normalisation.
  5. ABBREVIATION_CLASH    WARNING One label is a recognised abbreviation of another.
  6. SWAHILI_SYNONYM       WARNING One label is the Swahili translation of another.
  7. LABEL_CORE_CONFLICT   WARNING Label too similar to a core system field name.
  8. REDUNDANT_CORE        WARNING Field maps to a column that is auto-populated.
  9. NUMERIC_UNIT_AMBIGUITY WARNING Numeric field label omits the measurement unit.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SIMILARITY ALGORITHM (no external NLP dependencies)

Labels are compared after:
  • lowercase + strip punctuation
  • tokenisation (split on whitespace and hyphens)
  • stop-word removal (a, of, the, in, for, at, by, with, and, or)

Duplicate detection uses THREE tests (any hit = flagged):
  A. Token overlap: if the significant-token sets of both labels share ≥ 1
     non-trivial token (len > 2), they are semantically related.
     "Farmer Name" → {"farmer","name"}
     "Member Name" → {"member","name"}
     Overlap = {"name"} → LABEL_DUPLICATE
  B. Substring containment: if one normalised label contains the other
     as a complete substring, flag them.
     "Name" ⊂ "Full Name of Member" → LABEL_DUPLICATE
  C. Character edit distance: for labels with ≤ 12 characters each,
     if SequenceMatcher ratio ≥ 0.82 → LABEL_DUPLICATE.
     "Qty" vs "Qnty" → ratio ≈ 0.86 → LABEL_DUPLICATE
"""

import re
import logging
from difflib import SequenceMatcher
from typing import List, Dict, Any, Tuple, Optional, Set
from django.utils import timezone

logger = logging.getLogger("shambaflow")

# ── Stop words removed before token comparison ────────────────────
_STOP_WORDS: Set[str] = {
    "a", "an", "the", "of", "in", "for", "at", "by", "with", "and",
    "or", "to", "from", "on", "is", "are", "was", "be", "has", "have",
    "this", "that", "it", "its", "per", "all", "each", "any",
}

# ── Known abbreviation expansions ─────────────────────────────────
# key = abbreviated form (lowercase)  →  value = expanded tokens
_ABBREVIATIONS: Dict[str, Set[str]] = {
    "dob":   {"date", "birth"},
    "id":    {"identification", "identifier", "number"},
    "no":    {"number"},
    "num":   {"number"},
    "qty":   {"quantity"},
    "qnty":  {"quantity"},
    "wt":    {"weight"},
    "wgt":   {"weight"},
    "kg":    {"kilogram", "kilograms", "weight"},
    "lt":    {"litre", "litres", "volume"},
    "ltr":   {"litre", "litres"},
    "amt":   {"amount"},
    "pmt":   {"payment"},
    "ref":   {"reference"},
    "reg":   {"registration", "registered"},
    "nat":   {"national"},
    "addr":  {"address"},
    "ph":    {"phone"},
    "tel":   {"telephone", "phone"},
    "mob":   {"mobile", "phone"},
    "gps":   {"location", "coordinate", "coordinates"},
    "loc":   {"location"},
    "yr":    {"year"},
    "mo":    {"month"},
    "dt":    {"date"},
    "ts":    {"timestamp", "date", "time"},
    "desc":  {"description"},
    "prod":  {"production", "product"},
    "mem":   {"member"},
    "coop":  {"cooperative"},
    "govt":  {"government"},
    "agri":  {"agriculture", "agricultural"},
}

# ── Swahili ↔ English synonym dictionary ─────────────────────────
# Keys are Swahili tokens; values are sets of English equivalents.
_SWAHILI_EN: Dict[str, Set[str]] = {
    "shamba":       {"farm", "land", "plot", "field"},
    "mkulima":      {"farmer", "member", "grower"},
    "mazao":        {"produce", "production", "harvest", "crop", "crops"},
    "zao":          {"crop", "produce", "product"},
    "uzalishaji":   {"production", "output", "yield"},
    "mavuno":       {"harvest"},
    "nguruwe":      {"pig", "swine"},
    "ng'ombe":      {"cattle", "cow", "bovine"},
    "mifugo":       {"livestock", "animals", "herd"},
    "kondoo":       {"sheep"},
    "mbuzi":        {"goat"},
    "kuku":         {"poultry", "chicken"},
    "samaki":       {"fish"},
    "nyumba":       {"house", "building"},
    "ardhi":        {"land", "plot", "parcel"},
    "eka":          {"acre", "acreage"},
    "eneo":         {"area", "region", "zone"},
    "mkoa":         {"region", "province", "county"},
    "wilaya":       {"district", "county"},
    "kata":         {"ward"},
    "kijiji":       {"village"},
    "jina":         {"name"},
    "nambari":      {"number", "id", "identifier"},
    "tarehe":       {"date"},
    "uzito":        {"weight"},
    "bei":          {"price", "cost", "rate"},
    "kiasi":        {"quantity", "amount", "volume"},
    "ubora":        {"quality", "grade"},
    "akaunti":      {"account"},
    "mwanachama":   {"member"},
    "chama":        {"cooperative", "association"},
    "mkutano":      {"meeting"},
    "uamuzi":       {"resolution", "decision"},
    "fedha":        {"finance", "financial", "money", "funds"},
    "mchango":      {"contribution"},
    "akiba":        {"savings"},
    "mapato":       {"revenue", "income"},
    "matumizi":     {"expenditure", "expenses"},
    "rekodi":       {"record"},
    "taarifa":      {"report"},
    "chanjo":       {"vaccination"},
    "matibabu":     {"treatment", "medicine"},
    "dawa":         {"medicine", "drug"},
    "zahanati":     {"clinic", "health"},
    "afya":         {"health"},
    "umwagiliaji":  {"irrigation"},
    "msimu":        {"season"},
    "mkurugenzi":   {"director", "manager"},
    "mweka_hazina": {"treasurer"},
    "katibu":       {"clerk", "secretary"},
    "msimamizi":    {"supervisor", "officer"},
    "msaidizi":     {"assistant", "helper"},
}

# Pre-build a reverse map: English token → Swahili tokens that translate to it
_EN_SWAHILI: Dict[str, Set[str]] = {}
for sw, en_set in _SWAHILI_EN.items():
    for en in en_set:
        _EN_SWAHILI.setdefault(en, set()).add(sw)

# ── Django field type → compatible display_type sets ──────────────
# display_types NOT in the compatible set will be flagged TYPE_MISMATCH
# (True = ERROR, False = WARNING for possibly-intentional mismatches)
_TYPE_COMPATIBILITY: Dict[str, Tuple[Set[str], bool]] = {
    # Django type: (compatible display_types, is_clear_error_if_not_in_set)
    "CharField":            ({"text", "textarea", "dropdown", "multi_select"}, False),
    "TextField":            ({"text", "textarea", "rich_text"}, False),
    "CKEditor5Field":       ({"rich_text"}, False),
    "IntegerField":         ({"number"}, True),
    "BigIntegerField":      ({"number"}, True),
    "PositiveIntegerField": ({"number"}, True),
    "PositiveSmallIntegerField": ({"number"}, True),
    "SmallIntegerField":    ({"number"}, True),
    "DecimalField":         ({"decimal", "number"}, True),
    "FloatField":           ({"decimal", "number"}, True),
    "BooleanField":         ({"boolean"}, True),
    "NullBooleanField":     ({"boolean"}, True),
    "DateField":            ({"date"}, True),
    "DateTimeField":        ({"datetime", "date"}, False),
    "TimeField":            ({"text"}, False),
    "EmailField":           ({"text"}, False),
    "URLField":             ({"text"}, False),
    "UUIDField":            ({"text"}, True),
    "FileField":            ({"file_upload"}, True),
    "ImageField":           ({"image_upload", "file_upload"}, True),
    "JSONField":            ({"text", "textarea"}, False),
    "SlugField":            ({"text"}, False),
    "ForeignKey":           ({"dropdown", "number", "text"}, False),
}

# ── Model fields that are ALWAYS auto-populated by the system ─────
# Forms should not ask the user to fill these in.
_AUTO_POPULATED_FIELDS: Dict[str, Set[str]] = {
    "Member":              {"id", "cooperative_id", "created_at", "updated_at", "added_by_id"},
    "ProductionRecord":    {"id", "cooperative_id", "created_at", "updated_at", "recorded_by_id"},
    "LivestockHealthLog":  {"id", "cooperative_id", "created_at", "updated_at", "recorded_by_id"},
    "GovernanceRecord":    {"id", "cooperative_id", "created_at", "updated_at", "recorded_by_id"},
    "FinancialRecord":     {"id", "cooperative_id", "created_at", "updated_at", "recorded_by_id"},
    "MemberLandRecord":    {"id", "created_at", "updated_at"},
    "MemberHerdRecord":    {"id", "created_at", "updated_at"},
}

# ── Labels that are "core system concepts" — mapping these in a form
#    is redundant because the system always provides them ──────────
_CORE_CONCEPT_TOKENS: Set[str] = {
    "cooperative", "coop", "recorded", "added", "created", "submitted",
    "timestamp", "uuid", "system",
}


# ══════════════════════════════════════════════════════════════════
#  TEXT NORMALISATION UTILITIES
# ══════════════════════════════════════════════════════════════════

def _normalise(label: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    label = label.lower()
    label = re.sub(r"[^\w\s]", " ", label)   # punctuation → space
    label = re.sub(r"\s+", " ", label).strip()
    return label


def _tokenise(label: str) -> List[str]:
    """Normalise and split into tokens, removing stop words."""
    tokens = _normalise(label).split()
    return [t for t in tokens if t not in _STOP_WORDS and len(t) > 1]


def _significant_tokens(label: str) -> Set[str]:
    """Return the set of significant (non-trivial) tokens."""
    return set(_tokenise(label))


def _similarity_ratio(a: str, b: str) -> float:
    """SequenceMatcher ratio on normalised strings."""
    return SequenceMatcher(None, _normalise(a), _normalise(b)).ratio()


# ══════════════════════════════════════════════════════════════════
#  INDIVIDUAL CHECKS
# ══════════════════════════════════════════════════════════════════

def _is_duplicate_pair(label_a: str, label_b: str) -> bool:
    """
    Return True if label_a and label_b are semantically equivalent.

    Tests:
      A. Significant-token overlap ≥ 1 token (both tokens len > 2)
      B. Substring containment (normalised)
      C. Edit-distance ratio ≥ 0.82 for short labels
    """
    tokens_a = _significant_tokens(label_a)
    tokens_b = _significant_tokens(label_b)

    # Filter tokens longer than 2 characters to avoid noise
    sig_a = {t for t in tokens_a if len(t) > 2}
    sig_b = {t for t in tokens_b if len(t) > 2}

    # A. Token overlap
    if sig_a & sig_b:
        return True

    # B. Substring containment
    norm_a = _normalise(label_a)
    norm_b = _normalise(label_b)
    if norm_a in norm_b or norm_b in norm_a:
        return True

    # C. Edit distance (only for short labels ≤ 15 chars each)
    if len(norm_a) <= 15 and len(norm_b) <= 15:
        if _similarity_ratio(label_a, label_b) >= 0.82:
            return True

    return False


def _is_abbreviation_pair(label_a: str, label_b: str) -> bool:
    """
    Return True if one label is a recognised abbreviation of the other.
    Checks the _ABBREVIATIONS table.
    """
    tokens_a = set(_tokenise(label_a))
    tokens_b = set(_tokenise(label_b))

    for abbr, expansions in _ABBREVIATIONS.items():
        if abbr in tokens_a and expansions & tokens_b:
            return True
        if abbr in tokens_b and expansions & tokens_a:
            return True

    return False


def _is_swahili_synonym_pair(label_a: str, label_b: str) -> bool:
    """
    Return True if one label contains a Swahili word that translates
    to a token in the other label (or vice versa).
    """
    tokens_a = set(_tokenise(label_a))
    tokens_b = set(_tokenise(label_b))

    # Check: Swahili token in A, English expansion in B
    for sw_token in tokens_a:
        if sw_token in _SWAHILI_EN:
            en_equivalents = _SWAHILI_EN[sw_token]
            if en_equivalents & tokens_b:
                return True

    # Check: English token in A, Swahili token in B
    for en_token in tokens_a:
        if en_token in _EN_SWAHILI:
            sw_equivalents = _EN_SWAHILI[en_token]
            if sw_equivalents & tokens_b:
                return True

    # Swap: A and B
    for sw_token in tokens_b:
        if sw_token in _SWAHILI_EN:
            if _SWAHILI_EN[sw_token] & tokens_a:
                return True

    return False


def _is_core_conflict(label: str, target_model_name: str) -> bool:
    """
    Return True if the label conflicts with a core auto-populated concept.
    """
    tokens = _significant_tokens(label)
    return bool(tokens & _CORE_CONCEPT_TOKENS)


def _is_type_mismatch(display_type: str, django_field_type: str) -> Tuple[bool, bool]:
    """
    Return (is_mismatch: bool, is_error: bool).
    is_error = True means it's a definite error (not just a warning).
    """
    if django_field_type not in _TYPE_COMPATIBILITY:
        return False, False   # Unknown type — skip

    compatible_types, is_error_if_mismatch = _TYPE_COMPATIBILITY[django_field_type]

    if display_type not in compatible_types:
        return True, is_error_if_mismatch

    return False, False


def _has_numeric_unit(label: str) -> bool:
    """
    Return True if a numeric field label includes a measurement unit.
    Checks for common unit tokens in the label.
    """
    unit_tokens = {
        "kg", "g", "grams", "kilogram", "kilograms",
        "lt", "litre", "litres", "liter", "liters", "ml",
        "km", "m", "meters", "metres", "feet", "ft",
        "ksh", "kes", "usd", "eur", "shilling", "shillings",
        "acres", "hectares", "ha", "sqm",
        "head", "units", "pieces", "bags", "tonnes", "tons",
        "hours", "days", "weeks", "months", "years",
        "%", "percent", "percentage",
    }
    tokens = set(_tokenise(label))
    return bool(tokens & unit_tokens)


# ══════════════════════════════════════════════════════════════════
#  FIELD INTROSPECTION UTILITIES
# ══════════════════════════════════════════════════════════════════

def get_model_field_info(model_class) -> Dict[str, Dict[str, Any]]:
    """
    Return a dict of {field_name: field_info} for all concrete fields
    on a Django model. Used during validation to inspect field types
    and nullability.
    """
    info = {}
    for field in model_class._meta.get_fields():
        if not hasattr(field, "column"):
            continue   # Skip reverse relations
        info[field.name] = {
            "django_type": type(field).__name__,
            "null":        getattr(field, "null", True),
            "blank":       getattr(field, "blank", True),
            "has_default": (
                hasattr(field, "default")
                and field.default is not field.__class__.default
            ),
            "primary_key": getattr(field, "primary_key", False),
            "editable":    getattr(field, "editable", True),
        }
    return info


def get_required_model_fields(model_class, auto_populated: Set[str]) -> Set[str]:
    """
    Return the set of field names that MUST be provided by the form
    (non-nullable, no default, not auto-populated, not the PK).
    """
    required = set()
    for field in model_class._meta.get_fields():
        if not hasattr(field, "column"):
            continue
        if field.primary_key:
            continue
        if field.name in auto_populated:
            continue
        if not getattr(field, "editable", True):
            continue
        null        = getattr(field, "null", True)
        blank       = getattr(field, "blank", True)
        has_default = (
            hasattr(field, "default")
            and field.default is not field.__class__.default
        )
        if not null and not has_default:
            required.add(field.name)
    return required


# ══════════════════════════════════════════════════════════════════
#  MASTER VALIDATION ORCHESTRATOR
# ══════════════════════════════════════════════════════════════════

def run_semantic_validation(template) -> List[Dict[str, Any]]:
    """
    Run all semantic checks on a FormTemplate and its fields.

    Creates / updates FormFieldSemanticIssue records.
    Returns a list of issue dicts for the caller to display.

    Steps:
      1. Clear previous issues for this template.
      2. Introspect the target model.
      3. Run pairwise checks (label duplicates, abbreviations, Swahili).
      4. Run per-field checks (type mismatch, redundant core, unit ambiguity).
      5. Run coverage checks (missing required fields, field clashes).
      6. Update template.has_blocking_errors and template.status.
    """
    from core.models import FormField, FormFieldSemanticIssue, FormTemplate

    issues_created = []

    # ── Step 1: Clear previous run ────────────────────────────────
    FormFieldSemanticIssue.objects.filter(template=template).delete()

    # ── Step 2: Introspect target model ───────────────────────────
    model_class = template.target_model_class
    if model_class is None:
        logger.error("Cannot validate: target model class not found for %s", template)
        return []

    model_name        = model_class.__name__
    model_fields_info = get_model_field_info(model_class)
    auto_populated    = _AUTO_POPULATED_FIELDS.get(model_name, set())
    required_fields   = get_required_model_fields(model_class, auto_populated)

    # Build sets from the template's field defaults
    default_covered = set(template.field_defaults.keys())

    # Fetch all form fields
    fields = list(FormField.objects.filter(template=template).select_related("template"))

    if not fields:
        return []

    # ── Helper to persist an issue ─────────────────────────────────
    def _create_issue(
        affected_field: FormField,
        issue_type: str,
        severity: str,
        description: str,
        suggestion: str = "",
        conflicting_field: Optional[FormField] = None,
    ):
        issue = FormFieldSemanticIssue.objects.create(
            template=template,
            affected_field=affected_field,
            conflicting_field=conflicting_field,
            issue_type=issue_type,
            severity=severity,
            description=description,
            suggestion=suggestion,
        )
        issues_created.append({
            "field":       affected_field.label,
            "issue_type":  issue_type,
            "severity":    severity,
            "description": description,
        })
        return issue

    # ── Step 3: MODEL_FIELD_CLASH (ERROR) ─────────────────────────
    # Two form fields mapping to the same model column
    seen_mappings: Dict[str, FormField] = {}
    for field in fields:
        mapped = field.maps_to_model_field
        if mapped in seen_mappings:
            other = seen_mappings[mapped]
            _create_issue(
                affected_field=field,
                issue_type="MODEL_FIELD_CLASH",
                severity="ERROR",
                description=(
                    f'"{field.label}" and "{other.label}" both map to the '
                    f'model field "{mapped}". A form cannot write to the same '
                    f"database column twice."
                ),
                suggestion=(
                    f"Remove one of the two fields, or change one to map to a "
                    f"different model column."
                ),
                conflicting_field=other,
            )
        else:
            seen_mappings[mapped] = field

    # ── Step 4: TYPE_MISMATCH (ERROR / WARNING) ────────────────────
    for field in fields:
        mapped = field.maps_to_model_field
        if mapped not in model_fields_info:
            continue   # MISSING_REQUIRED check will catch unknown fields
        django_type  = model_fields_info[mapped]["django_type"]
        is_mismatch, is_error = _is_type_mismatch(field.display_type, django_type)
        if is_mismatch:
            severity = "ERROR" if is_error else "WARNING"
            _create_issue(
                affected_field=field,
                issue_type="TYPE_MISMATCH",
                severity=severity,
                description=(
                    f'"{field.label}" uses widget type "{field.display_type}" but '
                    f'the database column "{mapped}" is a {django_type}. '
                    f"Data entered may fail to save."
                ),
                suggestion=(
                    f"Change the widget type to one compatible with {django_type}. "
                    f"Compatible types: "
                    f"{', '.join(_TYPE_COMPATIBILITY.get(django_type, (set(), False))[0])}."
                ),
            )

    # ── Step 5: MISSING_REQUIRED (ERROR) ──────────────────────────
    covered_by_form    = set(seen_mappings.keys())
    covered_completely = covered_by_form | default_covered
    missing = required_fields - covered_completely

    if missing:
        # Create one issue per missing field; attach to the first form field
        anchor_field = fields[0]
        for missing_col in missing:
            _create_issue(
                affected_field=anchor_field,
                issue_type="MISSING_REQUIRED",
                severity="ERROR",
                description=(
                    f'The database column "{missing_col}" on {model_name} is required '
                    f"(non-nullable, no default) but is not covered by any form field "
                    f"or field default. Submitting this form will raise a database error."
                ),
                suggestion=(
                    f'Add a form field that maps to "{missing_col}", or add '
                    f'"{missing_col}" to the template\'s field_defaults with an '
                    f"auto-populated value."
                ),
            )

    # ── Step 6: LABEL_DUPLICATE (ERROR) ───────────────────────────
    labelled: List[FormField] = [f for f in fields]
    flagged_duplicate_pairs: Set[Tuple[int, int]] = set()   # track (a.pk, b.pk) pairs

    for i, field_a in enumerate(labelled):
        for field_b in labelled[i + 1:]:
            pair_key = (min(str(field_a.id), str(field_b.id)),
                        max(str(field_a.id), str(field_b.id)))
            if pair_key in flagged_duplicate_pairs:
                continue
            if _is_duplicate_pair(field_a.label, field_b.label):
                flagged_duplicate_pairs.add(pair_key)
                _create_issue(
                    affected_field=field_a,
                    issue_type="LABEL_DUPLICATE",
                    severity="ERROR",
                    description=(
                        f'"{field_a.label}" and "{field_b.label}" appear to mean the '
                        f"same thing. Two fields with the same meaning confuse data-entry "
                        f"staff and create duplicate data."
                    ),
                    suggestion=(
                        f"Rename or remove one of the two labels. If they capture different "
                        f"information, make the distinction explicit in the label "
                        f"(e.g., include units, time period, or qualifier)."
                    ),
                    conflicting_field=field_b,
                )

    # ── Step 7: ABBREVIATION_CLASH (WARNING) ──────────────────────
    for i, field_a in enumerate(labelled):
        for field_b in labelled[i + 1:]:
            if _is_abbreviation_pair(field_a.label, field_b.label):
                _create_issue(
                    affected_field=field_a,
                    issue_type="ABBREVIATION_CLASH",
                    severity="WARNING",
                    description=(
                        f'"{field_a.label}" appears to be an abbreviation of '
                        f'"{field_b.label}" (or vice versa). If they represent the same '
                        f"attribute, data-entry staff may fill in both."
                    ),
                    suggestion=(
                        "Use the full, unabbreviated label consistently. "
                        "If they are genuinely distinct, add a qualifier to each label."
                    ),
                    conflicting_field=field_b,
                )

    # ── Step 8: SWAHILI_SYNONYM (WARNING) ─────────────────────────
    for i, field_a in enumerate(labelled):
        for field_b in labelled[i + 1:]:
            if _is_swahili_synonym_pair(field_a.label, field_b.label):
                _create_issue(
                    affected_field=field_a,
                    issue_type="SWAHILI_SYNONYM",
                    severity="WARNING",
                    description=(
                        f'"{field_a.label}" appears to be a Swahili translation of '
                        f'"{field_b.label}" (or vice versa). If they represent the same '
                        f"attribute, data-entry staff may fill in both."
                    ),
                    suggestion=(
                        "Choose one language for labels consistently, or add qualifiers "
                        "to make clear that these fields collect different information."
                    ),
                    conflicting_field=field_b,
                )

    # ── Step 9: LABEL_CORE_CONFLICT (WARNING) ─────────────────────
    for field in fields:
        if _is_core_conflict(field.label, model_name):
            _create_issue(
                affected_field=field,
                issue_type="LABEL_CORE_CONFLICT",
                severity="WARNING",
                description=(
                    f'"{field.label}" contains a word typically associated with '
                    f"system-managed core fields (e.g. cooperative, recorded by). "
                    f"This may confuse data-entry staff."
                ),
                suggestion=(
                    "Use a more specific, cooperative-facing label. "
                    "Core system fields are already populated automatically."
                ),
            )

    # ── Step 10: REDUNDANT_CORE (WARNING) ─────────────────────────
    for field in fields:
        if field.maps_to_model_field in auto_populated:
            _create_issue(
                affected_field=field,
                issue_type="REDUNDANT_CORE",
                severity="WARNING",
                description=(
                    f'"{field.label}" maps to the field "{field.maps_to_model_field}" '
                    f"which is automatically populated by the system. "
                    f"Adding it to the form asks users to enter data the system already knows."
                ),
                suggestion=(
                    f'Remove this field from the form, or move "{field.maps_to_model_field}" '
                    f"to the template's field_defaults instead."
                ),
            )

    # ── Step 11: NUMERIC_UNIT_AMBIGUITY (WARNING) ──────────────────
    numeric_display_types = {"number", "decimal"}
    numeric_django_types  = {
        "IntegerField", "BigIntegerField", "PositiveIntegerField",
        "PositiveSmallIntegerField", "SmallIntegerField",
        "DecimalField", "FloatField",
    }
    numeric_form_fields = [
        f for f in fields
        if f.display_type in numeric_display_types
        or model_fields_info.get(f.maps_to_model_field, {}).get("django_type") in numeric_django_types
    ]
    if len(numeric_form_fields) >= 2:
        for field in numeric_form_fields:
            if not _has_numeric_unit(field.label):
                _create_issue(
                    affected_field=field,
                    issue_type="NUMERIC_UNIT_AMBIGUITY",
                    severity="WARNING",
                    description=(
                        f'The numeric field "{field.label}" does not include a measurement '
                        f"unit in its label. When there are multiple numeric fields, "
                        f"staff may enter values in the wrong unit."
                    ),
                    suggestion=(
                        f'Include the unit in the label, e.g. '
                        f'"{field.label} (kg)" or "{field.label} (KES)".'
                    ),
                )

    # ── Step 12: Update template state ───────────────────────────
    has_blocking = FormFieldSemanticIssue.objects.filter(
        template=template,
        severity="ERROR",
        is_acknowledged=False,
    ).exists()

    template.has_blocking_errors = has_blocking
    template.status = (
        "HAS_ISSUES" if has_blocking else
        ("DRAFT" if issues_created else "DRAFT")
    )
    template.save(update_fields=["has_blocking_errors", "status"])

    logger.info(
        "Semantic validation complete | template=%s | issues=%d | blocking=%s",
        template.name,
        len(issues_created),
        has_blocking,
    )
    return issues_created


def can_activate_template(template) -> Tuple[bool, List[str]]:
    """
    Check whether a template can be activated.
    Returns (can_activate: bool, blocking_reasons: List[str]).
    """
    from core.models import FormFieldSemanticIssue

    blocking_issues = FormFieldSemanticIssue.objects.filter(
        template=template,
        severity="ERROR",
        is_acknowledged=False,
    )

    reasons = [issue.description for issue in blocking_issues]
    return (len(reasons) == 0), reasons


def activate_template(template, activated_by) -> bool:
    """
    Activate a FormTemplate after checking for blocking issues.
    Deactivates any previous active template for the same
    (cooperative, target_model) pair if this is set as default.
    Returns True on success, raises ValueError on blocking errors.
    """
    from core.models import FormTemplate

    can_activate, reasons = can_activate_template(template)
    if not can_activate:
        raise ValueError(
            f"Template cannot be activated. Resolve {len(reasons)} blocking error(s) first: "
            + "; ".join(reasons[:3])
            + ("..." if len(reasons) > 3 else "")
        )

    # Deactivate previous default for this (cooperative, target_model)
    if template.is_default:
        FormTemplate.objects.filter(
            cooperative=template.cooperative,
            target_model=template.target_model,
            is_default=True,
            status="ACTIVE",
        ).exclude(pk=template.pk).update(
            status="INACTIVE",
            is_default=False,
        )

    template.status = "ACTIVE"
    template.save(update_fields=["status"])
    logger.info("Template activated | %s by %s", template.name, activated_by.email)
    return True