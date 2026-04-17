from __future__ import annotations

import re
import string
import unicodedata


STOP_WORDS = frozenset({
    "a", "an", "the", "of", "in", "on", "at", "to", "for", "and", "or",
    "by", "is", "be", "as", "its", "it", "this", "that", "with", "from",
    "their", "s", "per", "each", "total",
    # Common Swahili connectors that should not affect semantic matching.
    "ya", "la", "wa", "za", "na", "ni", "kwa", "cha", "vya", "mwa",
})

KNOWN_ABBREVIATIONS: dict[str, str] = {
    "dob":  "date of birth",
    "id":   "identifier",
    "no":   "number",
    "qty":  "quantity",
    "amt":  "amount",
    "ksh":  "kenyan shillings",
    "kes":  "kenyan shillings",
    "kg":   "kilogram",
    "ha":   "hectare",
    "yr":   "year",
    "gps":  "global positioning system",
    "ref":  "reference",
    "desc": "description",
    "mob":  "mobile",
    "tel":  "telephone",
    "nat":  "national",
    "agm":  "annual general meeting",
    "coop": "cooperative",
    "ph":   "phone",
    "reg":  "registration",
    "cert": "certificate",
    "doc":  "document",
    "info": "information",
    "addr": "address",
    "fn":   "first name",
    "ln":   "last name",
    "fname": "first name",
    "lname": "last name",
}

# Keep this list conservative. Broad or ambiguous mappings cause false positives.
SWAHILI_SYNONYMS: list[tuple[str, tuple[str, ...]]] = [
    ("jina", ("name",)),
    ("kwanza", ("first", "given")),
    ("mwisho", ("last", "surname", "family")),
    ("kamili", ("full", "complete")),
    ("simu", ("phone", "mobile", "telephone")),
    ("anwani", ("address",)),
    ("tarehe", ("date",)),
    ("nambari", ("number", "identifier", "id", "code")),
    ("maelezo", ("description", "details", "remarks", "notes")),
    ("aina", ("type", "category", "kind", "class", "classification")),
    ("jinsia", ("gender", "sex")),
    ("umri", ("age",)),
    ("uzito", ("weight", "mass")),
    ("afya", ("health", "wellbeing")),
    ("dawa", ("treatment", "medicine", "drug", "therapy")),
    ("chanjo", ("vaccination", "vaccine", "immunisation", "immunization")),
    ("ardhi", ("land", "plot", "farm")),
    ("udongo", ("soil",)),
    ("eneo", ("location", "area", "zone")),
    ("umiliki", ("ownership", "owner", "tenure")),
    ("kuzaliwa", ("birth",)),
]

_CANONICAL_GROUPS: dict[str, set[str]] = {
    "name": {"name", "jina", "majina"},
    "first": {"first", "given", "kwanza"},
    "last": {"last", "surname", "family", "mwisho"},
    "full": {"full", "complete", "kamili"},
    "phone": {"phone", "mobile", "telephone", "simu"},
    "address": {"address", "anwani"},
    "date": {"date", "tarehe"},
    "birth": {"birth", "born", "kuzaliwa"},
    "number": {"number", "nambari", "no", "num"},
    "id": {"id", "identifier", "identification"},
    "type": {"type", "category", "kind", "class", "classification", "aina"},
    "description": {"description", "details", "remarks", "notes", "comment", "comments", "maelezo"},
    "gender": {"gender", "sex", "jinsia"},
    "age": {"age", "umri"},
    "weight": {"weight", "mass", "uzito"},
    "health": {"health", "wellbeing", "afya"},
    "vaccination": {"vaccination", "vaccine", "immunisation", "immunization", "chanjo"},
    "treatment": {"treatment", "medicine", "drug", "therapy", "dawa"},
    "land": {"land", "farm", "plot", "shamba", "ardhi"},
    "soil": {"soil", "udongo"},
    "location": {"location", "area", "zone", "eneo"},
    "ownership": {"ownership", "owner", "owned", "tenure", "umiliki"},
    "method": {"method", "mode"},
    "status": {"status", "condition", "state", "hali"},
}

_PHRASE_CANONICALS: dict[str, set[str]] = {
    "date of birth": {"birth", "date"},
    "birth date": {"birth", "date"},
    "phone number": {"phone", "number"},
    "mobile number": {"phone", "number"},
    "telephone number": {"phone", "number"},
    "nambari ya simu": {"phone", "number"},
    "full name": {"full", "name"},
    "member name": {"full", "name"},
    "jina kamili": {"full", "name"},
    "first name": {"first", "name"},
    "given name": {"first", "name"},
    "jina la kwanza": {"first", "name"},
    "last name": {"last", "name"},
    "family name": {"last", "name"},
    "jina la mwisho": {"last", "name"},
    "vaccination date": {"vaccination", "date"},
    "immunization date": {"vaccination", "date"},
    "immunisation date": {"vaccination", "date"},
    "sex at birth": {"gender", "birth"},
    "land ownership type": {"land", "ownership", "type"},
    "ownership type": {"ownership", "type"},
}

DESCRIPTOR_TOKENS = frozenset({
    "type",
    "category",
    "kind",
    "class",
    "classification",
    "number",
    "code",
    "description",
    "details",
    "remarks",
    "notes",
    "comment",
    "comments",
    "method",
    "mode",
    "status",
    "record",
    "entry",
    "field",
    "information",
    "info",
    "value",
    "level",
})

_TOKEN_CANONICAL_LOOKUP: dict[str, str] = {}
for _canonical, _variants in _CANONICAL_GROUPS.items():
    for _variant in _variants | {_canonical}:
        _TOKEN_CANONICAL_LOOKUP[_variant] = _canonical


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.lower().replace("_", " ")
    text = text.translate(str.maketrans("", "", string.punctuation))
    return re.sub(r"\s+", " ", text).strip()


def tokenize_text(text: str) -> set[str]:
    return {
        token
        for token in normalize_text(text).split()
        if token not in STOP_WORDS and len(token) > 1
    }


def slugify_to_field_key(label: str) -> str:
    value = normalize_text(label)
    value = re.sub(r"[^a-z0-9]+", "_", value)
    value = value.strip("_")
    if value and value[0].isdigit():
        value = f"f_{value}"
    value = re.sub(r"_+", "_", value)
    return value[:64] or "custom_field"


def canonical_tokens(text: str) -> set[str]:
    normalized = normalize_text(text)
    expanded = set(tokenize_text(text))

    for token in list(expanded):
        if token in KNOWN_ABBREVIATIONS:
            expanded.update(tokenize_text(KNOWN_ABBREVIATIONS[token]))
        singular = token[:-1] if len(token) > 4 and token.endswith("s") else token
        if singular in _TOKEN_CANONICAL_LOOKUP:
            expanded.add(singular)

    canonical = {
        _TOKEN_CANONICAL_LOOKUP.get(token, token)
        for token in expanded
    }

    padded = f" {normalized} "
    for phrase, phrase_tokens in _PHRASE_CANONICALS.items():
        if f" {phrase} " in padded:
            canonical.update(phrase_tokens)

    if {"first", "name"} <= canonical:
        canonical.add("first_name")
    if {"last", "name"} <= canonical:
        canonical.add("last_name")
    if {"full", "name"} <= canonical:
        canonical.add("full_name")
    if {"birth", "date"} <= canonical:
        canonical.add("birth_date")
    if {"phone", "number"} <= canonical:
        canonical.add("phone_number")

    return canonical


def anchor_tokens(text: str) -> set[str]:
    return {
        token for token in canonical_tokens(text)
        if token not in DESCRIPTOR_TOKENS and "_" not in token
    }


def _jaccard_tokens(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _levenshtein(a: str, b: str) -> int:
    if len(a) > len(b):
        a, b = b, a
    row = list(range(len(a) + 1))
    for i, char_b in enumerate(b, 1):
        new_row = [i]
        for j, char_a in enumerate(a, 1):
            new_row.append(
                min(
                    row[j] + 1,
                    new_row[j - 1] + 1,
                    row[j - 1] + (0 if char_a == char_b else 1),
                )
            )
        row = new_row
    return row[-1]


def near_exact_labels(a: str, b: str) -> bool:
    normalized_a = normalize_text(a)
    normalized_b = normalize_text(b)
    if normalized_a == normalized_b:
        return True
    if _jaccard_tokens(tokenize_text(a), tokenize_text(b)) >= 0.70:
        return True
    if len(normalized_a) <= 12 and len(normalized_b) <= 12 and _levenshtein(normalized_a, normalized_b) <= 2:
        return True
    if " ".join(sorted(tokenize_text(a))) == " ".join(sorted(tokenize_text(b))):
        return True
    return False


def semantic_duplicate_labels(a: str, b: str) -> bool:
    canonical_a = canonical_tokens(a)
    canonical_b = canonical_tokens(b)
    if not canonical_a or not canonical_b:
        return False
    if canonical_a == canonical_b:
        return True

    anchors_a = {token for token in canonical_a if token not in DESCRIPTOR_TOKENS and "_" not in token}
    anchors_b = {token for token in canonical_b if token not in DESCRIPTOR_TOKENS and "_" not in token}
    return bool(anchors_a) and anchors_a == anchors_b
