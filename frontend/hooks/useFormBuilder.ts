"use client";

/**
 * useFormBuilder — Form Builder API hooks  (v2 — cooperative-owned schemas)
 * =========================================================================
 * What changed from v1:
 *  - Removed useModelFields() and ModelField — static Django columns are gone
 *  - Removed available_model_fields from Template interface
 *  - Added DynamicFieldDefinition type (the field registry)
 *  - Added ConflictResult type (pre-flight duplicate check result)
 *  - Added useFieldRegistry()         — fetch DFDs for a (coop, model) pair
 *  - Added useFieldRegistryMutations() — register / update / deactivate DFDs
 *  - Added usePreflightCheck()        — debounced label conflict check
 *  - Added useSkeletonSchema()        — fetch skeleton + cooperative fields combined
 *
 * Everything else (useTemplates, useTemplate, useTemplateMutations,
 * useFieldMutations, useIssueMutations, useFormSubmit, useActiveTemplate)
 * is unchanged — the template/field/issue system still works the same way.
 * The only difference is that FormField.maps_to_model_field now always holds
 * a DynamicFieldDefinition.field_key (or the skeleton discriminator key),
 * never a raw Django column name.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";


/* ══════════════════════════════════════════════════════════════════
   DOMAIN TYPES
══════════════════════════════════════════════════════════════════ */

export type TemplateStatus =
  | "DRAFT"
  | "VALIDATING"
  | "HAS_ISSUES"
  | "ACTIVE"
  | "INACTIVE";

export type TargetModel =
  | "MEMBER"
  | "PRODUCTION"
  | "LIVESTOCK"
  | "GOVERNANCE"
  | "FINANCE"
  | "LAND"
  | "HERD";

export type FieldTag =
  | "CAPACITY"
  | "GOVERNANCE"
  | "FINANCIAL"
  | "INFORMATIONAL";

export type DisplayType =
  | "text"
  | "textarea"
  | "number"
  | "decimal"
  | "date"
  | "datetime"
  | "boolean"
  | "dropdown"
  | "multi_select"
  | "gps"
  | "file_upload"
  | "relation";

export type IssueSeverity = "ERROR" | "WARNING";

export type IssueType =
  | "LABEL_DUPLICATE"
  | "ABBREVIATION_CLASH"
  | "SWAHILI_SYNONYM"
  | "LABEL_CORE_CONFLICT"
  | "MODEL_FIELD_CLASH"
  | "TYPE_MISMATCH"
  | "REDUNDANT_CORE"
  | "MISSING_REQUIRED"
  | "NUMERIC_UNIT_AMBIGUITY"
  | "CUSTOM_KEY_MISSING_DEF";

/* ── Dynamic Field Definition ────────────────────────────────────────
   A field that a cooperative has registered for a target model.
   These live in the Field Registry and are referenced by form templates.
─────────────────────────────────────────────────────────────────── */

export interface DynamicFieldDefinition {
  id:               string;
  cooperative_id?:  string;
  target_model?:    TargetModel;
  field_key:        string;   // stable snake_case key used in extra_data JSONB
  label:            string;   // human-readable display label
  display_type:     DisplayType;
  tag:              FieldTag;
  is_required:      boolean;
  is_locked:        boolean;  // true after first submission — field_key immutable
  is_active:        boolean;
  help_text:        string;
  placeholder:      string;
  options:          string[];
  validation_rules: ValidationRules;
  created_at:       string;
  updated_at?:      string;
  template_sync?: {
    affected_count: number;
    template_ids: string[];
  };
}

/* ── Skeleton field ───────────────────────────────────────────────────
   System-defined discriminator field on each model.
   Shown in the Field Registry and Form Builder but cannot be edited
   or removed by cooperatives.
─────────────────────────────────────────────────────────────────── */

export interface SkeletonField {
  field_key:    string;
  label:        string;
  display_type: DisplayType;
  is_system:    true;
  is_required:  true;
  help_text:    string;
  options?:     string[];
  editable:     false;
}

export interface SkeletonSchema {
  target_model:       TargetModel;
  cooperative_id:     string;
  skeleton_field:     SkeletonField | null;
  cooperative_fields: DynamicFieldDefinition[];
  total_fields:       number;
}

/* ── Conflict result (pre-flight label check) ─────────────────────── */

export type ConflictType =
  | "none"
  | "near_exact"
  | "semantic_overlap"
  | "covers_compound";

export interface ConflictResult {
  is_conflict:        boolean;
  conflict_type:      ConflictType;
  conflicting_labels: string[];
  message:            string;
  suggested_key:      string;   // snake_case key the label would produce
  semantic_issues:    RegistrySemanticIssue[];
  error_count:        number;
  warning_count:      number;
  can_save:           boolean;
}

export interface RegistrySemanticIssue {
  issue_type: IssueType;
  severity: IssueSeverity;
  description: string;
  suggestion: string;
  conflicting_labels: string[];
}

/* ── Form Template ───────────────────────────────────────────────── */

export interface Template {
  id:                  string;
  name:                string;
  description:         string;
  target_model:        TargetModel;
  status:              TemplateStatus;
  version:             number;
  parent_version:      number | null;
  has_blocking_errors: boolean;
  is_default:          boolean;
  field_defaults:      Record<string, unknown>;
  change_note:         string;
  created_by:          string | null;
  created_at:          string;
  updated_at:          string;
  /* Populated when fetching a single template */
  fields?:  TemplateField[];
  issues?:  Issue[];
  available_model_fields?: ModelField[];  // Enhanced with system field classification
  submission_count?: number;
}

/* ── Model Field (for mapping existing model columns) ───────────────── */

export type SystemFieldType = "auto_filled" | "user_selectable" | "regular";

export interface ModelField {
    field_name:    string;
    verbose_name:  string;
    django_type:   string;
    is_required:   boolean;
    has_choices:   boolean;
    choices:       Array<{value: string; label: string}>;
    max_length:    number | null;
    help_text:     string;
    is_relation:   boolean;
    related_model: string | null;
    is_custom:     false;
    // New fields for smart system field handling
    is_system_field:      boolean;
    system_field_type:    SystemFieldType;
    user_guidance:        string;
    is_already_mapped?:   boolean;  // Added by template detail view
}

export interface TemplateField {
  id:                  string;
  label:               string;
  display_type:        DisplayType;
  tag:                 FieldTag;
  /** DFD field_key (or skeleton discriminator key) — what writes to extra_data */
  maps_to_model_field: string;
  /** True = stored in extra_data (DFD-backed). False = real model column. */
  is_custom_field:     boolean;
  is_required:         boolean;
  /** True if required by the DFD definition itself (cannot be made optional) */
  is_model_required:   boolean;
  placeholder:         string;
  help_text:           string;
  options:             string[];
  validation_rules:    ValidationRules;
  conditional_rule:    ConditionalRule | null;
  field_order:         number;
}

export interface ValidationRules {
  min_value?:     number;
  max_value?:     number;
  min_length?:    number;
  max_length?:    number;
  regex_pattern?: string;
  regex_message?: string;
}

export interface ConditionalRule {
  /** maps_to_model_field of the controlling field */
  show_when_field: string;
  show_when_value: string;
}

/* ── Issue ───────────────────────────────────────────────────────── */

export interface Issue {
  id:                      string;
  issue_type:              IssueType;
  severity:                IssueSeverity;
  description:             string;
  suggestion:              string;
  is_acknowledged:         boolean;
  acknowledged_at:         string | null;
  acknowledged_by:         string | null;
  can_be_acknowledged?:    boolean;
  is_blocking?:            boolean;
  affected_field:          string | null;
  affected_field_label:    string | null;
  conflicting_field:       string | null;
  conflicting_field_label: string | null;
}


/* ══════════════════════════════════════════════════════════════════
   FIELD REGISTRY HOOKS  (new in v2)
══════════════════════════════════════════════════════════════════ */

/* ── useModelFields — enhanced model field introspection ───────────────── */

export interface ModelFieldsFilters {
  template_id?: string;  // If provided, marks already-mapped fields
}

export function useModelFields(
  targetModel: TargetModel | "",
  filters: ModelFieldsFilters = {}
) {
  const [fields, setFields]   = useState<ModelField[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    if (!targetModel) { setFields([]); return; }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ target_model: targetModel });
      if (filters.template_id) qs.set("template_id", filters.template_id);
      const data = await apiFetch<{ fields: ModelField[] }>(
        `/api/form-builder/model-fields/${targetModel}/?${qs}`
      );
      setFields(data.fields ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load model fields");
      setFields([]);
    } finally {
      setLoading(false);
    }
  }, [targetModel, filters.template_id]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { 
    fields, 
    loading, 
    error, 
    refresh: fetch_, 
    // Helper getters for UI components
    autoFilledFields: fields.filter(f => f.system_field_type === "auto_filled"),
    userSelectableFields: fields.filter(f => f.system_field_type === "user_selectable"),
    regularFields: fields.filter(f => f.system_field_type === "regular"),
  };
}

/* ── useFieldRegistry — list DFDs for a (cooperative, model) ───── */

export interface FieldRegistryFilters {
  include_inactive?: boolean;
}

export function useFieldRegistry(
  coopId: string,
  targetModel: TargetModel | "",
  filters: FieldRegistryFilters = {},
) {
  const [fields, setFields]   = useState<DynamicFieldDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    if (!coopId || !targetModel) { setFields([]); return; }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ cooperative_id: coopId, target_model: targetModel });
      if (filters.include_inactive) qs.set("include_inactive", "true");
      const data = await apiFetch<{ fields: DynamicFieldDefinition[] }>(
        `/api/form-builder/dynamic-fields/?${qs}`
      );
      setFields(data.fields ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load field registry");
      setFields([]);
    } finally {
      setLoading(false);
    }
  }, [coopId, targetModel, filters.include_inactive]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { fields, loading, error, refresh: fetch_, setFields };
}

/* ── 2. useSkeletonSchema — skeleton + cooperative fields combined ─── */

export function useSkeletonSchema(coopId: string, targetModel: TargetModel | "") {
  const [schema, setSchema]   = useState<SkeletonSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    if (!coopId || !targetModel) { setSchema(null); return; }
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<SkeletonSchema>(
        `/api/form-builder/dynamic-fields/schema/${targetModel}/?cooperative_id=${coopId}`
      );
      setSchema(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load schema");
    } finally {
      setLoading(false);
    }
  }, [coopId, targetModel]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { schema, loading, error, refresh: fetch_ };
}

/* ── 3. usePreflightCheck — debounced label conflict detection ─────── */

export function usePreflightCheck(
  coopId: string,
  targetModel: TargetModel | "",
  label: string,
  displayType?: DisplayType,
  excludeId?: string,
  debounceMs = 400,
) {
  const [result, setResult]   = useState<ConflictResult | null>(null);
  const [checking, setChecking] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!coopId || !targetModel || label.trim().length < 2) {
      setResult(null);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setChecking(true);
      try {
        const qs = new URLSearchParams({
          cooperative_id: coopId,
          target_model:   targetModel,
          label:          label.trim(),
        });
        if (displayType) qs.set("display_type", displayType);
        if (excludeId) qs.set("exclude_id", excludeId);
        const data = await apiFetch<ConflictResult>(
          `/api/form-builder/dynamic-fields/check/?${qs}`
        );
        setResult(data);
      } catch {
        setResult(null);
      } finally {
        setChecking(false);
      }
    }, debounceMs);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [coopId, targetModel, label, displayType, excludeId, debounceMs]);

  return { result, checking };
}

/* ── 4. useFieldRegistryMutations ────────────────────────────────── */

export interface RegisterFieldPayload {
  cooperative_id:   string;
  target_model:     TargetModel;
  label:            string;
  display_type?:    DisplayType;
  tag?:             FieldTag;
  is_required?:     boolean;
  help_text?:       string;
  placeholder?:     string;
  options?:         string[];
  validation_rules?: ValidationRules;
  field_key?:       string;  // optional override; auto-derived if omitted
}

export interface RegistryConflictError {
  type: "duplicate_field";
  conflict_type:      ConflictType;
  conflicting_labels: string[];
  message:            string;
}

export function useFieldRegistryMutations() {
  const [saving,      setSaving]      = useState(false);
  const [deactivating, setDeactivating] = useState<string | null>(null);

  /** Register a new field. Throws RegistryConflictError on 409. */
  const registerField = useCallback(
    async (payload: RegisterFieldPayload): Promise<DynamicFieldDefinition> => {
      setSaving(true);
      try {
        return await apiFetch<DynamicFieldDefinition>(
          `/api/form-builder/dynamic-fields/`,
          { method: "POST", body: payload }
        );
      } finally {
        setSaving(false);
      }
    },
    []
  );

  /** Update mutable properties of a DFD. Throws RegistryConflictError on 409. */
  const updateField = useCallback(
    async (
      dfdId: string,
      patch: Partial<Pick<
        DynamicFieldDefinition,
        "label" | "display_type" | "tag" | "is_required"
        | "help_text" | "placeholder" | "options" | "validation_rules"
      >>
    ): Promise<DynamicFieldDefinition> => {
      setSaving(true);
      try {
        return await apiFetch<DynamicFieldDefinition>(
          `/api/form-builder/dynamic-fields/${dfdId}/`,
          { method: "PATCH", body: patch }
        );
      } finally {
        setSaving(false);
      }
    },
    []
  );

  /** Soft-delete a DFD. field_key is preserved permanently. */
  const deactivateField = useCallback(
    async (dfdId: string): Promise<{ message: string }> => {
      setDeactivating(dfdId);
      try {
        return await apiFetch<{ message: string }>(
          `/api/form-builder/dynamic-fields/${dfdId}/`,
          { method: "DELETE" }
        );
      } finally {
        setDeactivating(null);
      }
    },
    []
  );

  return { registerField, updateField, deactivateField, saving, deactivating };
}


/* ══════════════════════════════════════════════════════════════════
   TEMPLATE HOOKS  (unchanged from v1)
══════════════════════════════════════════════════════════════════ */

export interface TemplateFilters {
  target_model?: TargetModel | "";
  status?:       TemplateStatus | "";
}

/* ── useTemplates ────────────────────────────────────────────────── */

export function useTemplates(coopId: string, filters: TemplateFilters = {}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    if (!coopId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (filters.target_model) qs.set("target_model", filters.target_model);
      if (filters.status)       qs.set("status",       filters.status);
      const q = qs.toString();
      const data = await apiFetch<{ data: Template[] }>(
        `/api/form-builder/${coopId}/templates/${q ? `?${q}` : ""}`
      );
      setTemplates(data.data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, [coopId, filters.target_model, filters.status]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { templates, loading, error, refresh: fetch_, setTemplates };
}

/* ── useTemplate ─────────────────────────────────────────────────── */

export function useTemplate(coopId: string, templateId: string) {
  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    if (!coopId || !templateId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<Template>(
        `/api/form-builder/${coopId}/templates/${templateId}/`
      );
      setTemplate(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load template");
    } finally {
      setLoading(false);
    }
  }, [coopId, templateId]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { template, loading, error, refresh: fetch_, setTemplate };
}

/* ── useTemplateMutations ─────────────────────────────────────────── */

export function useTemplateMutations(coopId: string) {
  const [saving,     setSaving]     = useState(false);
  const [validating, setValidating] = useState(false);
  const [activating, setActivating] = useState(false);

  const createTemplate = useCallback(
    async (payload: { name: string; target_model: TargetModel; description?: string }) =>
      apiFetch<Template>(
        `/api/form-builder/${coopId}/templates/`,
        { method: "POST", body: payload }
      ),
    [coopId]
  );

  const updateTemplate = useCallback(
    async (
      templateId: string,
      payload: Partial<Pick<Template, "name" | "description" | "change_note" | "is_default" | "field_defaults">>
    ) => {
      setSaving(true);
      try {
        return await apiFetch<Template>(
          `/api/form-builder/${coopId}/templates/${templateId}/`,
          { method: "PUT", body: payload }
        );
      } finally { setSaving(false); }
    },
    [coopId]
  );

  const deleteTemplate = useCallback(
    async (templateId: string) =>
      apiFetch<void>(
        `/api/form-builder/${coopId}/templates/${templateId}/`,
        { method: "DELETE" }
      ),
    [coopId]
  );

  const validateTemplate = useCallback(
    async (templateId: string) => {
      setValidating(true);
      try {
        return await apiFetch<{
          issues:              Issue[];
          has_blocking_errors: boolean;
          status:              TemplateStatus;
          error_count:         number;
          warning_count:       number;
        }>(
          `/api/form-builder/${coopId}/templates/${templateId}/validate/`,
          { method: "POST" }
        );
      } finally { setValidating(false); }
    },
    [coopId]
  );

  const activateTemplate = useCallback(
    async (templateId: string) => {
      setActivating(true);
      try {
        return await apiFetch<Template>(
          `/api/form-builder/${coopId}/templates/${templateId}/activate/`,
          { method: "POST" }
        );
      } finally { setActivating(false); }
    },
    [coopId]
  );

  const duplicateTemplate = useCallback(
    async (templateId: string) =>
      apiFetch<Template>(
        `/api/form-builder/${coopId}/templates/${templateId}/duplicate/`,
        { method: "POST" }
      ),
    [coopId]
  );

  return {
    createTemplate, updateTemplate, deleteTemplate,
    validateTemplate, activateTemplate, duplicateTemplate,
    saving, validating, activating,
  };
}

/* ── useFieldMutations ───────────────────────────────────────────── */

export function useFieldMutations(coopId: string, templateId: string) {
  const [saving, setSaving] = useState(false);

  const addField = useCallback(
    async (payload: Omit<Partial<TemplateField>, "id" | "is_model_required" | "field_order">) => {
      setSaving(true);
      try {
        return await apiFetch<TemplateField>(
          `/api/form-builder/${coopId}/templates/${templateId}/fields/`,
          { method: "POST", body: payload }
        );
      } finally { setSaving(false); }
    },
    [coopId, templateId]
  );

  const updateField = useCallback(
    async (fieldId: string, payload: Partial<TemplateField>) => {
      setSaving(true);
      try {
        return await apiFetch<TemplateField>(
          `/api/form-builder/${coopId}/templates/${templateId}/fields/${fieldId}/`,
          { method: "PUT", body: payload }
        );
      } finally { setSaving(false); }
    },
    [coopId, templateId]
  );

  const deleteField = useCallback(
    async (fieldId: string) =>
      apiFetch<void>(
        `/api/form-builder/${coopId}/templates/${templateId}/fields/${fieldId}/`,
        { method: "DELETE" }
      ),
    [coopId, templateId]
  );

  const reorderFields = useCallback(
    async (order: { id: string; field_order: number }[]) =>
      apiFetch<{ success: boolean }>(
        `/api/form-builder/${coopId}/templates/${templateId}/fields/reorder/`,
        { method: "POST", body: order }
      ),
    [coopId, templateId]
  );

  return { addField, updateField, deleteField, reorderFields, saving };
}

/* ── useIssueMutations ───────────────────────────────────────────── */

export function useIssueMutations(coopId: string, templateId: string) {
  const [acknowledging, setAcknowledging] = useState<string | null>(null);

  const acknowledgeIssue = useCallback(
    async (issueId: string) => {
      setAcknowledging(issueId);
      try {
        return await apiFetch<{ message: string; issue: Issue }>(
          `/api/form-builder/${coopId}/templates/${templateId}/issues/${issueId}/acknowledge/`,
          { method: "POST" }
        );
      } finally { setAcknowledging(null); }
    },
    [coopId, templateId]
  );

  return { acknowledgeIssue, acknowledging };
}

/* ── useFormSubmit ───────────────────────────────────────────────── */

export interface SubmitResult {
  submission_id:     string;
  created_model:     string;
  created_record_id: string;
  status:            "COMPLETED";
}

export function useFormSubmit(coopId: string, templateId: string) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult]         = useState<SubmitResult | null>(null);
  const [error, setError]           = useState<string | null>(null);

  const submit = useCallback(
    async (payload: Record<string, unknown>) => {
      setSubmitting(true);
      setError(null);
      try {
        const data = await apiFetch<SubmitResult>(
          `/api/form-builder/${coopId}/submit/${templateId}/`,
          { method: "POST", body: payload }
        );
        setResult(data);
        return data;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Submission failed";
        setError(msg);
        throw e;
      } finally {
        setSubmitting(false);
      }
    },
    [coopId, templateId]
  );

  return {
    submit, submitting, result, error,
    reset: () => { setResult(null); setError(null); },
  };
}

/* ── useActiveTemplate ───────────────────────────────────────────── */

export function useActiveTemplate(coopId: string, targetModel: TargetModel) {
  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    if (!coopId || !targetModel) {
      setTemplate(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    setLoading(true);
    setError(null);
    setTemplate(null);
    apiFetch<{ data: Template[] }>(
      `/api/form-builder/${coopId}/templates/?target_model=${targetModel}&status=ACTIVE`
    )
      .then(async (d) => {
        if (cancelled) return;
        const t = d.data?.[0] ?? null;
        if (!t) {
          setTemplate(null);
          return;
        }
        try {
          const full = await apiFetch<Template>(
            `/api/form-builder/${coopId}/templates/${t.id}/`
          );
          if (cancelled) return;
          setTemplate(full);
        } catch {
          // Fallback to summary if detail fetch fails.
          if (cancelled) return;
          setTemplate(t);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Error");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [coopId, targetModel]);

  return { template, loading, error };
}
