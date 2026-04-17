"use client";

/**
 * useCRMData — Hooks for all seven CRM models
 * =============================================
 * Adaptive Convergence: one hook set, every model.
 *
 * URL CONTRACT (must match core/urls.py):
 *   /api/crm/<cooperative_id>/<model_slug>/
 *   /api/crm/<cooperative_id>/<model_slug>/<pk>/
 *   /api/crm/<cooperative_id>/<model_slug>/schema/
 *   /api/crm/<cooperative_id>/<model_slug>/import/
 *   /api/crm/<cooperative_id>/<model_slug>/import/template/
 *   /api/crm/<cooperative_id>/<model_slug>/export/
 *
 * cooperative_id is ALWAYS in the URL path, never in query params.
 */

import { useState, useEffect, useCallback } from "react";
import { apiFetch, downloadBlob, postForm, type ModulePermissionFlags } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ModelSlug =
  | "members"
  | "land"
  | "herds"
  | "production"
  | "livestock"
  | "governance"
  | "finance";

export interface SchemaField {
  field_key:         string;
  label:             string;
  display_type:      string;
  is_system:         boolean;
  is_required:       boolean;
  is_locked:         boolean;
  editable:          boolean;
  tag:               string;
  options:           string[];
  help_text:         string;
  help_text_display?: string;
  placeholder?:      string;
  validation_rules?: Record<string, unknown>;
}

export interface DFDField {
  dfd_id:            string;
  field_key:         string;
  label:             string;
  display_type:      string;
  tag:               string;
  is_required:       boolean;
  is_locked:         boolean;
  is_active:         boolean;
  options:           string[];
  help_text_display: string;
  placeholder:       string;
  validation_rules:  Record<string, unknown>;
}

interface RawSchema {
  model_slug:         string;
  target_model:       string;
  cooperative_id:     string;
  skeleton_fields:    SchemaField[];
  cooperative_fields: SchemaField[];
  all_fields:         SchemaField[];
  meta_fields:        SchemaField[];
  display_columns:    string[];
  field_count:        number;
  permissions?:       ModulePermissionFlags;
}

/**
 * CRMSchema — frontend representation.
 * Adds `discriminator` as skeleton_fields[0] so page components can use
 * schema.discriminator.field_key / .label / .options directly.
 */
export interface CRMSchema extends RawSchema {
  discriminator: SchemaField;
}

export interface CRMRecord {
  id:             string;
  cooperative_id: string;
  extra_data:     Record<string, unknown>;
  created_at:     string;
  updated_at:     string;
  [key: string]:  unknown;
}

export interface PaginatedRecords {
  data:         CRMRecord[];
  page:         number;
  total_pages:  number;
  total_count:  number;
  has_next:     boolean;
  has_previous: boolean;
  model_slug:   string;
  permissions?: ModulePermissionFlags;
}

export interface CRMAnalyticsCard {
  id:          string;
  label:       string;
  value:       string;
  helper_text: string;
  tone:        "default" | "primary" | "accent";
}

export interface CRMAnalyticsDatum {
  label: string;
  value: number;
}

export interface CRMAnalyticsChart {
  id:          string;
  type:        "timeline" | "bar" | "line";
  title:       string;
  description: string;
  data:        CRMAnalyticsDatum[];
}

export interface CRMAnalyticsHighlight {
  label: string;
  value: string;
}

export interface CRMAnalyticsResult {
  model_slug:   string;
  generated_at: string;
  total_records: number;
  cards:        CRMAnalyticsCard[];
  charts:       CRMAnalyticsChart[];
  highlights:   CRMAnalyticsHighlight[];
  permissions?: ModulePermissionFlags;
}

export interface ImportResult {
  success:        boolean;
  parse_error:    string | null;
  dry_run:        boolean;
  total_rows:     number;
  success_count:  number;
  error_count:    number;
  imported_count: number;
  created_ids:    string[];
  header_validation: {
    valid:            boolean;
    errors:           string[];
    headers_found:    string[];
    skeleton_present: boolean;
    unknown_headers:  string[];
    missing_required: string[];
  } | null;
  row_validation: {
    total:       number;
    valid_count: number;
    error_count: number;
  } | null;
  error_rows: Array<{
    row_number: number | string;
    errors:     string[];
    raw_row:    Record<string, string>;
  }>;
  skipped_unknown: string[];
}

// ── Schema transform ───────────────────────────────────────────────────────────

const FALLBACK_FIELD: SchemaField = {
  field_key:    "id",
  label:        "ID",
  display_type: "text",
  is_system:    true,
  is_required:  true,
  is_locked:    true,
  editable:     false,
  tag:          "INFORMATIONAL",
  options:      [],
  help_text:    "",
};

function toSchema(raw: RawSchema): CRMSchema {
  return { ...raw, discriminator: raw.skeleton_fields[0] ?? FALLBACK_FIELD };
}

// ══════════════════════════════════════════════════════════════════
//  SCHEMA HOOK
// ══════════════════════════════════════════════════════════════════

export function useCRMSchema(cooperativeId: string, modelSlug: ModelSlug) {
  const [schema,  setSchema]  = useState<CRMSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!cooperativeId || !modelSlug) return;
    setLoading(true);
    setError(null);

    apiFetch<RawSchema>(`/api/crm/${cooperativeId}/${modelSlug}/schema/`)
      .then((raw) => {
        setSchema(toSchema(raw));
      })
      .catch((e: { error?: string }) => {
        setError(e.error ?? "Failed to load schema");
      })
      .finally(() => setLoading(false));
  }, [cooperativeId, modelSlug]);

  return { schema, loading, error };
}

// ══════════════════════════════════════════════════════════════════
//  RECORDS LIST HOOK
// ══════════════════════════════════════════════════════════════════

export interface UseRecordsOptions {
  page?:     number;
  pageSize?: number;
  search?:   string;
  filters?:  Record<string, string>;
  enabled?:  boolean;
}

export function useCRMRecords(
  cooperativeId: string,
  modelSlug:     ModelSlug,
  options:       UseRecordsOptions = {}
) {
  const { page = 1, pageSize = 50, search = "", filters, enabled = true } = options;

  const [result,  setResult]  = useState<PaginatedRecords | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error,   setError]   = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    if (!cooperativeId || !modelSlug) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page:      String(page),
        page_size: String(pageSize),
      });
      if (search) params.set("search", search);
      if (filters) {
        Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      }
      const data = await apiFetch<PaginatedRecords>(
        `/api/crm/${cooperativeId}/${modelSlug}/?${params}`
      );
      setResult(data);
    } catch (e: unknown) {
      setError((e as { error?: string }).error ?? "Failed to load records");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooperativeId, enabled, modelSlug, page, pageSize, search, JSON.stringify(filters)]);

  useEffect(() => {
    if (!enabled) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    fetchData();
  }, [enabled, fetchData]);

  return { result, loading, error, refetch: fetchData };
}

// ══════════════════════════════════════════════════════════════════
//  ANALYTICS HOOK
// ══════════════════════════════════════════════════════════════════

export function useCRMAnalytics(
  cooperativeId: string,
  modelSlug:     ModelSlug,
  options:       Pick<UseRecordsOptions, "search" | "filters" | "enabled"> = {}
) {
  const { search = "", filters, enabled = true } = options;

  const [result,  setResult]  = useState<CRMAnalyticsResult | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error,   setError]   = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    if (!cooperativeId || !modelSlug) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          if (value) params.set(key, value);
        });
      }
      const query = params.toString();
      const data = await apiFetch<CRMAnalyticsResult>(
        `/api/crm/${cooperativeId}/${modelSlug}/analytics/${query ? `?${query}` : ""}`
      );
      setResult(data);
    } catch (e: unknown) {
      setError((e as { error?: string }).error ?? "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooperativeId, enabled, modelSlug, search, JSON.stringify(filters)]);

  useEffect(() => {
    if (!enabled) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    fetchData();
  }, [enabled, fetchData]);

  return { result, loading, error, refetch: fetchData };
}

// ══════════════════════════════════════════════════════════════════
//  SINGLE RECORD HOOK
// ══════════════════════════════════════════════════════════════════

export function useCRMRecord(
  cooperativeId: string,
  modelSlug:     ModelSlug,
  recordId:      string | null
) {
  const [record,  setRecord]  = useState<CRMRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!recordId) { setRecord(null); return; }
    setLoading(true);

    apiFetch<CRMRecord>(`/api/crm/${cooperativeId}/${modelSlug}/${recordId}/`)
      .then(setRecord)
      .catch((e: { error?: string }) =>
        setError(e.error ?? "Failed to load record")
      )
      .finally(() => setLoading(false));
  }, [cooperativeId, modelSlug, recordId]);

  return { record, loading, error };
}

// ══════════════════════════════════════════════════════════════════
//  MUTATIONS HOOK
// ══════════════════════════════════════════════════════════════════

export function useCRMMutations(cooperativeId: string, modelSlug: ModelSlug) {
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  /**
   * POST /api/crm/<coop>/<model>/
   * Send a flat payload dict — backend splits skeleton vs extra_data.
   */
  const createRecord = useCallback(
    async (payload: Record<string, unknown>): Promise<CRMRecord | null> => {
      setSaving(true);
      setError(null);
      try {
        return await apiFetch<CRMRecord>(
          `/api/crm/${cooperativeId}/${modelSlug}/`,
          { method: "POST", body: payload }
        );
      } catch (e: unknown) {
        setError((e as { error?: string }).error ?? "Failed to create record");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [cooperativeId, modelSlug]
  );

  /** PATCH /api/crm/<coop>/<model>/<pk>/ */
  const updateRecord = useCallback(
    async (recordId: string, payload: Record<string, unknown>): Promise<CRMRecord | null> => {
      setSaving(true);
      setError(null);
      try {
        return await apiFetch<CRMRecord>(
          `/api/crm/${cooperativeId}/${modelSlug}/${recordId}/`,
          { method: "PATCH", body: payload }
        );
      } catch (e: unknown) {
        setError((e as { error?: string }).error ?? "Failed to update record");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [cooperativeId, modelSlug]
  );

  /** DELETE /api/crm/<coop>/<model>/<pk>/ */
  const deleteRecord = useCallback(
    async (recordId: string): Promise<boolean> => {
      setDeleting(true);
      setError(null);
      try {
        await apiFetch(
          `/api/crm/${cooperativeId}/${modelSlug}/${recordId}/`,
          { method: "DELETE" }
        );
        return true;
      } catch (e: unknown) {
        setError((e as { error?: string }).error ?? "Failed to delete record");
        return false;
      } finally {
        setDeleting(false);
      }
    },
    [cooperativeId, modelSlug]
  );

  return { createRecord, updateRecord, deleteRecord, saving, deleting, error };
}

// ══════════════════════════════════════════════════════════════════
//  IMPORT / EXPORT HOOK
// ══════════════════════════════════════════════════════════════════

export interface CRMImportScope {
  memberId?: string;
  memberNumber?: string;
  search?: string;
  filters?: Record<string, string>;
}

function buildScopedQuery(scope: CRMImportScope = {}): string {
  const params = new URLSearchParams();
  if (scope.memberId) params.set("member_id", scope.memberId);
  if (scope.memberNumber) params.set("member_number", scope.memberNumber);
  if (scope.search) params.set("search", scope.search);
  if (scope.filters) {
    Object.entries(scope.filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function useCRMImport(
  cooperativeId: string,
  modelSlug: ModelSlug,
  scope: CRMImportScope = {}
) {
  const [importing, setImporting] = useState(false);
  const [result,    setResult]    = useState<ImportResult | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  /** POST /api/crm/<coop>/<model>/import/[?dry_run=true] */
  const importFile = useCallback(
    async (file: File, dryRun = false): Promise<ImportResult | null> => {
      setImporting(true);
      setError(null);
      setResult(null);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const params = new URLSearchParams();
        if (dryRun) params.set("dry_run", "true");
        if (scope.memberId) params.set("member_id", scope.memberId);
        if (scope.memberNumber) params.set("member_number", scope.memberNumber);
        const qs = params.toString() ? `?${params.toString()}` : "";
        const res = await postForm<ImportResult>(
          `/api/crm/${cooperativeId}/${modelSlug}/import/${qs}`,
          fd
        );
        setResult(res);
        return res;
      } catch (e: unknown) {
        const msg = (e as { error?: string }).error ?? "Import failed";
        setError(msg);
        return null;
      } finally {
        setImporting(false);
      }
    },
    [cooperativeId, modelSlug, scope.memberId, scope.memberNumber]
  );

  /** GET /api/crm/<coop>/<model>/import/template/ → blank CSV download */
  const downloadTemplate = useCallback(() => {
    const qs = buildScopedQuery(scope);
    downloadBlob(`/api/crm/${cooperativeId}/${modelSlug}/import/template/${qs}`)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a   = document.createElement("a");
        a.href     = url;
        a.download = `${modelSlug}_import_template.csv`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => {/* swallow - user sees nothing happened */});
  }, [cooperativeId, modelSlug, scope]);

  /** GET /api/crm/<coop>/<model>/export/?format=csv|xlsx */
  const downloadExport = useCallback(
    (fmt: "csv" | "xlsx" = "csv") => {
      const params = new URLSearchParams();
      params.set("format", fmt);
      if (scope.memberId) params.set("member_id", scope.memberId);
      if (scope.memberNumber) params.set("member_number", scope.memberNumber);
      if (scope.search) params.set("search", scope.search);
      if (scope.filters) {
        Object.entries(scope.filters).forEach(([key, value]) => {
          if (value) params.set(key, value);
        });
      }
      downloadBlob(`/api/crm/${cooperativeId}/${modelSlug}/export/?${params.toString()}`)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          const a   = document.createElement("a");
          a.href     = url;
          a.download = `${modelSlug}_export.${fmt}`;
          a.click();
          URL.revokeObjectURL(url);
        })
        .catch(() => {});
    },
    [cooperativeId, modelSlug, scope]
  );

  return {
    importFile,
    downloadTemplate,
    downloadExport,
    importing,
    result,
    error,
    clearResult: () => setResult(null),
  };
}
