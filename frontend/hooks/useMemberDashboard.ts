"use client";

/**
 * useMemberDashboard — Member Dashboard API hooks
 * ==============================================
 * Hooks for fetching member-specific analytics, records, and form templates.
 * Provides member context for form builder operations.
 */

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import type { CRMAnalyticsResult, ModelSlug } from "@/hooks/useCRMData";

/* ══════════════════════════════════════════════════════════════════
   DOMAIN TYPES
══════════════════════════════════════════════════════════════════ */

export interface Member {
  id: string;
  member_number: string;
  display_name: string;
  status: string;
  created_at: string;
  extra_data: Record<string, any>;
}

export interface MemberAnalytics {
  production: {
    total_records: number;
    latest_date: string | null;
    seasons: string[];
  };
  livestock: {
    total_events: number;
    vaccinations: number;
    treatments: number;
    latest_event: string | null;
  };
  governance: {
    total_records: number;
    meetings: number;
    certificates: number;
    latest_record: string | null;
  };
  financial: {
    total_records: number;
    contributions: number;
    loans: number;
    latest_transaction: string | null;
  };
  assets: {
    land_records: number;
    herd_records: number;
  };
  overall: {
    total_activities: number;
    member_since: string;
    status: string;
  };
}

export interface RecentActivity {
  type: "production" | "livestock" | "governance" | "financial" | "land" | "herds";
  title: string;
  date: string;
  data: any;
}

export interface MemberRecord {
  id: string;
  // Production record fields
  record_date?: string;
  // Livestock record fields
  event_type?: string;
  event_type_display?: string;
  // Governance record fields
  record_type?: string;
  record_type_display?: string;
  // Financial record fields
  category?: string;
  category_display?: string;
  member_id?: string;
  member_number?: string;
  member_name?: string;
  // Common fields
  extra_data: Record<string, any>;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface MemberTemplate {
  id: string;
  name: string;
  description: string;
  target_model: string;
  target_model_display: string;
  is_default?: boolean;
  has_member_field: boolean;
  member_fields: Array<{
    field_key: string;
    label: string;
    display_type: string;
    is_required: boolean;
  }>;
  field_count: number;
  can_create?: boolean;
  permissions?: {
    can_view: boolean;
    can_create: boolean;
    can_edit: boolean;
    can_delete: boolean;
  };
  fields?: Array<{
    id: string;
    label: string;
    display_type: string;
    tag: string;
    field_order: number;
    placeholder: string;
    help_text: string;
    is_required: boolean;
    is_model_required: boolean;
    default_value: string;
    maps_to_model_field: string;
    is_custom_field: boolean;
    options: string[];
    validation_rules: Record<string, any>;
    conditional_rule: Record<string, any> | null;
    is_system?: boolean;
  }>;
  member_context: {
    member_id: string;
    member_number: string;
    member_name: string;
    defaults: Record<string, any>;
  };
  created_at: string;
  updated_at: string;
}

export interface MemberModuleField {
  key: string;
  label: string;
  display_type: string;
  options: string[];
}

export interface MemberModuleMetadata {
  source: "template" | "schema";
  source_template_id: string | null;
  date_field: string | null;
  title_field: string | null;
  table_columns: MemberModuleField[];
  filter_fields: MemberModuleField[];
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  total_pages: number;
  total_count: number;
  has_next: boolean;
  has_previous: boolean;
}

export interface MemberDashboardResponse {
  member: Member;
  member_status_options?: Array<{
    value: string;
    label: string;
  }>;
  analytics: MemberAnalytics;
  module_analytics?: Partial<Record<ModelSlug, CRMAnalyticsResult>>;
  module_metadata?: Partial<Record<ModelSlug, MemberModuleMetadata>>;
  recent_activity: RecentActivity[];
  permissions?: Record<string, {
    can_view: boolean;
    can_create: boolean;
    can_edit: boolean;
    can_delete: boolean;
  }>;
}

/* ══════════════════════════════════════════════════════════════════
   HOOKS
══════════════════════════════════════════════════════════════════ */

export function useMemberDashboard(coopId: string, memberId: string) {
  const [data, setData] = useState<MemberDashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    if (!coopId || !memberId) { setData(null); return; }
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<MemberDashboardResponse>(
        `/api/crm/${coopId}/members/${memberId}/dashboard/`
      );
      setData(response);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load member dashboard");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [coopId, memberId]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { data, loading, error, refresh: fetch_ };
}

export function useMemberRecords(
  coopId: string,
  memberId: string,
  recordType: "production" | "livestock" | "governance" | "financial" | "land" | "herds",
  options: {
    page?: number;
    pageSize?: number;
    search?: string;
    filters?: Record<string, string>;
    enabled?: boolean;
  } = {}
) {
  const { page = 1, pageSize = 20, search = "", filters, enabled = true } = options;
  const [data, setData] = useState<PaginatedResponse<MemberRecord> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filtersSignature = JSON.stringify(filters ?? {});
  const normalizedFilterEntries = useCallback(() => {
    return Object.entries(filters ?? {})
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .sort(([left], [right]) => left.localeCompare(right));
  }, [filtersSignature]);

  const fetch_ = useCallback(async () => {
    if (!enabled || !coopId || !memberId || !recordType) { setData(null); return; }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (search.trim()) params.set("search", search.trim());
      normalizedFilterEntries().forEach(([key, value]) => {
        params.set(key, value);
      });
      const response = await apiFetch<PaginatedResponse<MemberRecord>>(
        `/api/crm/${coopId}/members/${memberId}/records/${recordType}/?${params.toString()}`
      );
      setData(response);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load member records");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, coopId, memberId, normalizedFilterEntries, page, pageSize, recordType, search]);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    fetch_();
  }, [enabled, fetch_]);

  return { data, loading, error, refresh: fetch_ };
}

export function useMemberFormTemplates(coopId: string, memberId: string) {
  const [data, setData] = useState<{
    member: Member;
    templates: MemberTemplate[];
    total: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    if (!coopId || !memberId) { setData(null); return; }
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<{
        member: Member;
        templates: MemberTemplate[];
        total: number;
      }>(
        `/api/crm/${coopId}/members/${memberId}/form-templates/`
      );
      setData(response);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load member form templates");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [coopId, memberId]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { data, loading, error, refresh: fetch_ };
}

/* ══════════════════════════════════════════════════════════════════
   FORM SUBMISSION WITH MEMBER CONTEXT
══════════════════════════════════════════════════════════════════ */

export interface MemberContextSubmission {
  template_id: string;
  member_id: string;
  payload: Record<string, any>;
}

export interface MemberContextSubmissionResult {
  message: string;
  submission_id: string;
  created_model: string;
  created_record_id: string;
  member_context: {
    member_id: string;
    member_number: string;
    member_name: string;
  };
}

export function useMemberContextSubmission(coopId: string) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<MemberContextSubmissionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (submission: MemberContextSubmission) => {
      setSubmitting(true);
      setError(null);
      setResult(null);
      
      try {
        const response = await apiFetch<MemberContextSubmissionResult>(
          `/api/form-builder/${coopId}/submit/${submission.template_id}/member/${submission.member_id}/`,
          { method: "POST", body: submission.payload }
        );
        setResult(response);
        return response;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Submission failed";
        setError(msg);
        throw e;
      } finally {
        setSubmitting(false);
      }
    },
    [coopId]
  );

  return {
    submit,
    submitting,
    result,
    error,
    reset: () => { setResult(null); setError(null); },
  };
}

/* ══════════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
══════════════════════════════════════════════════════════════════ */

export function getMemberDisplayName(member: Member): string {
  const extra = member.extra_data || {};
  const fullName = [extra.first_name, extra.last_name]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join(" ");

  const candidates = [
    member.display_name,
    extra.display_name,
    extra.member_name,
    extra.full_name,
    extra.jina_kamili,
    extra.fullname,
    extra.name,
    fullName,
  ];

  const label = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return label ? String(label).trim() : `Member ${member.member_number}`;
}

export function getAnalyticsSummary(analytics: MemberAnalytics): {
  totalActivities: number;
  latestActivity: string | null;
  hasData: boolean;
} {
  const totalActivities = analytics.overall.total_activities;
  const latestActivities = [
    analytics.production.latest_date,
    analytics.livestock.latest_event,
    analytics.governance.latest_record,
    analytics.financial.latest_transaction,
  ].filter(Boolean);
  
  const latestActivity = latestActivities.length > 0 
    ? latestActivities.sort().reverse()[0] || null
    : null;
    
  return {
    totalActivities,
    latestActivity,
    hasData: totalActivities > 0,
  };
}

export function getTemplateByTargetModel(
  templates: MemberTemplate[],
  targetModel: string
): MemberTemplate[] {
  return templates.filter(template => template.target_model === targetModel);
}
