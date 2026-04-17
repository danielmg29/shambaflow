"""
ShambaFlow – Core URL Configuration
=====================================
Uses re_path with optional trailing slash (/?) on every route.

WHY: Django's path() requires an exact match. If APPEND_SLASH=False and the
client sends a request without a trailing slash (which Next.js fetch, proxies,
or URL normalisation can silently cause), path() returns 404 because the
registered pattern ends in '/' and the request path does not.

re_path with /? accepts BOTH forms:
  /api/form-builder/.../templates    →  match
  /api/form-builder/.../templates/   →  match

Route ordering is preserved — more specific patterns before generic ones:
  1. Static segments first           (model-fields, dynamic-fields/check, schema)
  2. Action suffixes before bare id  (validate/, activate/, duplicate/)
  3. Field reorder before field id   (reorder/ before <field_id>)
  4. Acknowledge before bare issues  (issues/<id>/acknowledge/ before issues/)
  5. Broad list/detail routes last

Import sources:
  core/views/form_builder.py   — templates, fields, issues, submissions,
                                  model-field introspection
  core/views/field_registry.py — cooperative-owned dynamic field definitions
                                  (DFD registry, check, schema)
"""

from django.urls import re_path

from core.views.form_builder import (
    # ── Template & field management ───────────────────────────────
    template_list_view, template_detail_view, template_validate_view,
    template_activate_view, template_duplicate_view,
    field_list_view, field_detail_view, field_reorder_view,
    # ── Semantic validation ───────────────────────────────────────
    issues_list_view, issue_acknowledge_view,
    # ── Form submission ───────────────────────────────────────────
    form_submit_view, form_submit_with_member_context_view, submission_history_view,
    # ── Model field introspection ───────────────────────────────
    model_fields_view,
)
from core.views.field_registry import (
    # ── Dynamic Field Definition (cooperative-owned schema) ─────
    dynamic_fields_list_view,
    dynamic_field_detail_view,
    dynamic_field_check_view,
    dynamic_field_schema_view,
)

# ── Reusable segment patterns ──────────────────────────────────────────────────
_CID = r"(?P<cooperative_id>[^/]+)"
_TID = r"(?P<template_id>[^/]+)"
_FID = r"(?P<field_id>[^/]+)"
_IID = r"(?P<issue_id>[^/]+)"
_TGT = r"(?P<target_model>[^/]+)"
_DID = r"(?P<dfd_id>[0-9a-f\-]{36})"
_MID = r"(?P<member_id>[^/]+)"
_SL  = r"/?"    # optional trailing slash

urlpatterns = [

    # ── Model field introspection ─────────────────────────────────────────────
    # Static literal "model-fields" must be declared before any cooperative-
    # scoped patterns so it is not swallowed by the <cooperative_id> segment.
    re_path(
        rf"^form-builder/model-fields/{_TGT}{_SL}$",
        model_fields_view,
        name="fb-model-fields",
    ),

    # ── Field registry — static routes MUST precede variable-segment routes ───
    # "check" and "schema/<model>" are literals; they must not be captured
    # by the DFD UUID pattern below.
    re_path(
        rf"^form-builder/dynamic-fields/check{_SL}$",
        dynamic_field_check_view,
        name="dfd-check",
    ),
    re_path(
        rf"^form-builder/dynamic-fields/schema/(?P<target_model>[A-Z_]{{3,15}}){_SL}$",
        dynamic_field_schema_view,
        name="dfd-schema",
    ),
    re_path(
        rf"^form-builder/dynamic-fields/{_DID}{_SL}$",
        dynamic_field_detail_view,
        name="dfd-detail",
    ),
    re_path(
        rf"^form-builder/dynamic-fields{_SL}$",
        dynamic_fields_list_view,
        name="dfd-list",
    ),

    # ── Template list + create ────────────────────────────────────────────────
    re_path(
        rf"^form-builder/{_CID}/templates{_SL}$",
        template_list_view,
        name="fb-template-list",
    ),

    # ── Template actions (before bare template-detail) ────────────────────────
    # Declared BEFORE the bare template-detail route so the literal suffixes
    # (validate, activate, duplicate) are not captured by <template_id>.
    re_path(
        rf"^form-builder/{_CID}/templates/{_TID}/validate{_SL}$",
        template_validate_view,
        name="fb-template-validate",
    ),
    re_path(
        rf"^form-builder/{_CID}/templates/{_TID}/activate{_SL}$",
        template_activate_view,
        name="fb-template-activate",
    ),
    re_path(
        rf"^form-builder/{_CID}/templates/{_TID}/duplicate{_SL}$",
        template_duplicate_view,
        name="fb-template-duplicate",
    ),

    # ── Template CRUD (GET / PUT / DELETE) ───────────────────────────────────
    re_path(
        rf"^form-builder/{_CID}/templates/{_TID}{_SL}$",
        template_detail_view,
        name="fb-template-detail",
    ),

    # ── Form field routes ─────────────────────────────────────────────────────
    # reorder MUST precede <field_id> — otherwise the literal string "reorder"
    # would match the <field_id> capture group and route to field_detail_view.
    re_path(
        rf"^form-builder/{_CID}/templates/{_TID}/fields/reorder{_SL}$",
        field_reorder_view,
        name="fb-field-reorder",
    ),
    re_path(
        rf"^form-builder/{_CID}/templates/{_TID}/fields/{_FID}{_SL}$",
        field_detail_view,
        name="fb-field-detail",
    ),
    re_path(
        rf"^form-builder/{_CID}/templates/{_TID}/fields{_SL}$",
        field_list_view,
        name="fb-field-list",
    ),

    # ── Semantic issues ───────────────────────────────────────────────────────
    # acknowledge MUST precede the bare issues list for the same reason.
    re_path(
        rf"^form-builder/{_CID}/templates/{_TID}/issues/{_IID}/acknowledge{_SL}$",
        issue_acknowledge_view,
        name="fb-issue-acknowledge",
    ),
    re_path(
        rf"^form-builder/{_CID}/templates/{_TID}/issues{_SL}$",
        issues_list_view,
        name="fb-issue-list",
    ),

    # ── Form submission ───────────────────────────────────────────────────────
    re_path(
        rf"^form-builder/{_CID}/submit/{_TID}{_SL}$",
        form_submit_view,
        name="fb-submit",
    ),
    re_path(
        rf"^form-builder/{_CID}/submit/{_TID}/member/{_MID}{_SL}$",
        form_submit_with_member_context_view,
        name="fb-submit-member-context",
    ),
    re_path(
        rf"^form-builder/{_CID}/templates/{_TID}/submissions{_SL}$",
        submission_history_view,
        name="fb-submission-history",
    ),
]