"use client";

/**
 * ShambaFlow CRM — Model Workspace + Analytics
 * ===========================================
 * Route: /crm/[cooperative_id]/[model]
 *
 * Each model page now owns both its records experience and its analytics
 * surface so users can drill into one module without hopping to a separate
 * analytics route.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import {
  useCRMAnalytics,
  useCRMSchema,
  useCRMRecords,
  useCRMMutations,
  useCRMImport,
  type CRMRecord,
  type SchemaField,
  type ModelSlug,
} from "@/hooks/useCRMData";
import CRMImportModal from "@/components/shambaflow/CRMImportModal";
import ModelAnalyticsPanel from "@/components/crm/model-analytics-panel";
import { ShambaTable, type ColumnDef, type RowAction } from "@/components/shambaflow/ShambaTable";
import { getUser, hasPermission, type ModulePermissionFlags, type UserSnapshot } from "@/lib/api";

const MODEL_META: Record<
  ModelSlug,
  { label: string; description: string; icon: string }
> = {
  members:    { label: "Members",          description: "Member registry and profile coverage",       icon: "👥" },
  land:       { label: "Land Records",     description: "Land parcel visibility across members",      icon: "🌾" },
  herds:      { label: "Herd Records",     description: "Livestock asset coverage across members",    icon: "🐄" },
  production: { label: "Production",       description: "Production performance and capture trends",  icon: "📦" },
  livestock:  { label: "Livestock Health", description: "Health event mix and operational activity",  icon: "💉" },
  governance: { label: "Governance",       description: "Institutional records and governance health",icon: "📋" },
  finance:    { label: "Finance",          description: "Financial logs and value movement signals",  icon: "💰" },
};

const MODEL_TO_PERMISSION: Record<ModelSlug, string> = {
  members: "MEMBERS",
  land: "MEMBERS",
  herds: "MEMBERS",
  production: "PRODUCTION",
  livestock: "LIVESTOCK",
  governance: "GOVERNANCE",
  finance: "FINANCE",
};

const FIXED_TEMPLATE_FIELD_KEYS = new Set([
  "status",
  "display_name",
  "member_number",
  "member_name",
  "collection_scope",
]);

const SCOPE_FILTER_MODELS = new Set<ModelSlug>([
  "production",
  "livestock",
  "governance",
  "finance",
]);

type FlatRecord = Record<string, unknown> & {
  id: string;
  created_at?: string;
};

const MEMBER_NAME_FIELD_KEYS = new Set(["display_name", "member_name"]);

function formatCell(value: unknown, displayType: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (displayType === "date" && typeof value === "string") {
    try {
      return new Date(value).toLocaleDateString("en-KE", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return String(value);
    }
  }
  if (displayType === "datetime" && typeof value === "string") {
    try {
      return new Date(value).toLocaleString("en-KE", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return String(value);
    }
  }
  if (displayType === "gps" && typeof value === "string" && value.includes(",")) {
    const [lat, lng] = value.split(",");
    return `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}`;
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function memberFieldPriority(field: SchemaField): number {
  if (field.field_key === "display_name") return -2;
  if (field.field_key === "member_name") return -1;
  if (field.field_key === "collection_scope") return 0;
  return 1;
}

function getVisibleCooperativeFields(fields: SchemaField[]): SchemaField[] {
  const hasMemberNameField = fields.some((field) => MEMBER_NAME_FIELD_KEYS.has(field.field_key));

  return fields
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => !(hasMemberNameField && field.field_key === "member_number"))
    .sort((left, right) => {
      const priorityDelta = memberFieldPriority(left.field) - memberFieldPriority(right.field);
      return priorityDelta !== 0 ? priorityDelta : left.index - right.index;
    })
    .map(({ field }) => field);
}

function getMemberDisplayName(member: CRMRecord): string {
  const extraData = (member.extra_data as Record<string, unknown> | undefined) ?? {};
  const fullName = [extraData.first_name, extraData.last_name]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join(" ");
  const candidates = [
    member.display_name,
    member.member_name,
    extraData.full_name,
    extraData.jina_kamili,
    extraData.name,
    fullName,
    member.member_number,
  ];

  const label = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return label ? String(label).trim() : "Unnamed member";
}

function buildColumns(schema: ReturnType<typeof useCRMSchema>["schema"]): ColumnDef<FlatRecord>[] {
  if (!schema) return [];

  const columns: ColumnDef<FlatRecord>[] = [];
  const discriminator = schema.discriminator;
  const cooperativeFields = getVisibleCooperativeFields(schema.cooperative_fields);
  const primaryMemberField =
    discriminator.field_key === "member_number"
      ? cooperativeFields.find((field) => MEMBER_NAME_FIELD_KEYS.has(field.field_key))
      : null;
  const primaryField = primaryMemberField ?? discriminator;
  const secondaryFields = cooperativeFields
    .filter((field) => field.field_key !== primaryMemberField?.field_key)
    .slice(0, 4);

  columns.push({
    key: primaryField.field_key,
    label: primaryField.label,
    sortable: true,
    render: (value) => (
      <span className="font-semibold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
        {primaryField.options?.length
          ? String(value ?? "—").replace(/_/g, " ")
          : String(value ?? "—")}
      </span>
    ),
  });

  secondaryFields.forEach((field: SchemaField, index) => {
    columns.push({
      key: field.field_key,
      label: field.label,
      sortable: field.display_type === "number" || field.display_type === "decimal",
      mobileHide: index > 0,
      render: (value) => (
        <span className="text-foreground/80">
          {formatCell(value, field.display_type)}
        </span>
      ),
    });
  });

  columns.push({
    key: "created_at",
    label: "Created",
    sortable: true,
    mobileHide: true,
    render: (value) => (
      <span className="text-xs text-muted-foreground">
        {formatCell(value, "date")}
      </span>
    ),
  });

  return columns;
}

function flattenRecord(
  record: CRMRecord,
  schema: NonNullable<ReturnType<typeof useCRMSchema>["schema"]>
): FlatRecord {
  const flat: FlatRecord = { id: record.id, created_at: record.created_at };

  schema.skeleton_fields.forEach((field) => {
    flat[field.field_key] = record[field.field_key];
  });

  schema.cooperative_fields.forEach((field) => {
    flat[field.field_key] = (record.extra_data as Record<string, unknown>)?.[field.field_key] ?? record[field.field_key];
  });

  return flat;
}

export default function CRMDataPage() {
  const params = useParams();
  const router = useRouter();
  const cooperativeId = params.cooperative_id as string;
  const modelSlug = params.model as ModelSlug;
  const meta = MODEL_META[modelSlug];

  const [page, setPage] = useState(1);
  const [showImport, setShowImport] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [serverSearch, setServerSearch] = useState("");
  const [memberFilter, setMemberFilter] = useState("");
  const [memberFilterLabel, setMemberFilterLabel] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberFilterOpen, setMemberFilterOpen] = useState(false);
  const [scopeFilter, setScopeFilter] = useState("");
  const [extraFieldKey, setExtraFieldKey] = useState("");
  const [extraFieldValue, setExtraFieldValue] = useState("");
  const memberFilterRef = useRef<HTMLDivElement | null>(null);

  const currentUser = getUser() as UserSnapshot | null;
  const permissionModule = MODEL_TO_PERMISSION[modelSlug];
  const showMemberFilter = modelSlug !== "members";
  const showScopeFilter = showMemberFilter && SCOPE_FILTER_MODELS.has(modelSlug);
  const fallbackPermissions: ModulePermissionFlags = {
    can_view: currentUser?.user_type === "CHAIR" ? true : hasPermission(permissionModule, "can_view", currentUser),
    can_create: currentUser?.user_type === "CHAIR" ? true : hasPermission(permissionModule, "can_create", currentUser),
    can_edit: currentUser?.user_type === "CHAIR" ? true : hasPermission(permissionModule, "can_edit", currentUser),
    can_delete: currentUser?.user_type === "CHAIR" ? true : hasPermission(permissionModule, "can_delete", currentUser),
  };
  const canViewFormBuilder = currentUser?.user_type === "CHAIR"
    ? true
    : hasPermission("FORM_BUILDER", "can_view", currentUser);

  const serverFilters = useMemo(() => {
    const filters: Record<string, string> = {};
    if (showMemberFilter && memberFilter) filters.member_id = memberFilter;
    if (showScopeFilter && scopeFilter) filters.collection_scope = scopeFilter;
    if (extraFieldKey && extraFieldValue) filters[`extra__${extraFieldKey}`] = extraFieldValue;
    return filters;
  }, [extraFieldKey, extraFieldValue, memberFilter, scopeFilter, showMemberFilter, showScopeFilter]);

  const { schema, loading: schemaLoading, error: schemaError } = useCRMSchema(cooperativeId, modelSlug);
  const { result, loading, error, refetch } = useCRMRecords(cooperativeId, modelSlug, {
    page,
    pageSize: 25,
    search: serverSearch,
    filters: serverFilters,
  });
  const {
    result: analyticsResult,
    loading: analyticsLoading,
    error: analyticsError,
    refetch: refetchAnalytics,
  } = useCRMAnalytics(cooperativeId, modelSlug, {
    search: serverSearch,
    filters: serverFilters,
  });
  const { result: membersResult, loading: membersLoading } = useCRMRecords(cooperativeId, "members", {
    page: 1,
    pageSize: 75,
    search: memberFilterOpen ? memberSearch : "",
    enabled: showMemberFilter,
  });
  const { deleteRecord, deleting } = useCRMMutations(cooperativeId, modelSlug);
  const importHook = useCRMImport(cooperativeId, modelSlug, {
    search: serverSearch,
    filters: serverFilters,
  });

  const permissionSnapshot =
    result?.permissions ??
    analyticsResult?.permissions ??
    schema?.permissions ??
    fallbackPermissions;
  const canView = permissionSnapshot.can_view;
  const canCreate = permissionSnapshot.can_create;
  const canDelete = permissionSnapshot.can_delete;

  const customFieldCount = useMemo(
    () =>
      (schema?.cooperative_fields ?? []).filter(
        (field) => !field.is_system && !FIXED_TEMPLATE_FIELD_KEYS.has(field.field_key)
      ).length,
    [schema]
  );

  const extraFilterFields = useMemo(
    () => (schema?.cooperative_fields ?? []).filter((field) => !field.is_system),
    [schema]
  );
  const tableColumns = useMemo(() => buildColumns(schema), [schema]);
  const tableData = useMemo<FlatRecord[]>(() => {
    if (!schema || !result?.data) return [];
    return result.data.map((record) => flattenRecord(record, schema));
  }, [result?.data, schema]);
  const rowActions = useMemo<RowAction<FlatRecord>[]>(() => {
    if (!canDelete) return [];
    return [
      {
        label: "Delete",
        variant: "destructive",
        onClick: (row) => setConfirmDelete(row.id as string),
      },
    ];
  }, [canDelete]);

  const noCustomFields = Boolean(schema) && customFieldCount === 0;
  const totalCount = result?.total_count ?? analyticsResult?.total_records ?? 0;
  const memberOptions = membersResult?.data ?? [];
  const selectedMember = memberOptions.find((member) => member.id === memberFilter) ?? null;

  useEffect(() => {
    if (!showMemberFilter || !memberFilterOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!memberFilterRef.current?.contains(event.target as Node)) {
        setMemberFilterOpen(false);
        setMemberSearch("");
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [memberFilterOpen, showMemberFilter]);

  useEffect(() => {
    if (!memberFilter) {
      setMemberFilterLabel("");
      return;
    }
    if (selectedMember) {
      setMemberFilterLabel(getMemberDisplayName(selectedMember));
    }
  }, [memberFilter, selectedMember]);

  const chooseMember = useCallback((member: CRMRecord | null) => {
    setPage(1);
    setMemberFilter(member?.id ?? "");
    setMemberFilterLabel(member ? getMemberDisplayName(member) : "");
    setMemberSearch("");
    setMemberFilterOpen(false);
  }, []);

  const handleRefresh = useCallback(async () => {
    await Promise.all([refetch(), refetchAnalytics()]);
  }, [refetch, refetchAnalytics]);

  const handleDelete = useCallback(async (id: string) => {
    const ok = await deleteRecord(id);
    if (ok) {
      toast.success("Record deleted");
      await Promise.all([refetch(), refetchAnalytics()]);
    }
    setConfirmDelete(null);
  }, [deleteRecord, refetch, refetchAnalytics]);

  if (!meta) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-lg font-semibold text-foreground">Unknown model: {modelSlug}</p>
          <button onClick={() => router.back()} className="mt-4 text-sm text-primary">← Go back</button>
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        You do not have permission to view the {meta.label.toLowerCase()} module.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-20 border-b border-border bg-card px-6 py-4">
        <div className="mx-auto flex max-w-screen-xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="select-none text-2xl">{meta.icon}</span>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
                {meta.label}
              </h1>
              <p className="text-xs text-muted-foreground">
                {meta.description} {loading || analyticsLoading ? "· Loading…" : `· ${totalCount.toLocaleString()} records`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canViewFormBuilder && (
              <button
                onClick={() => router.push(`/crm/${cooperativeId}/form-builder`)}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Form Builder
              </button>
            )}

            <button
              onClick={handleRefresh}
              className="rounded-lg border border-border bg-muted p-2 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${(loading || analyticsLoading) ? "animate-spin" : ""}`} />
            </button>

            {canCreate && (
              <button
                onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                <Upload className="h-3.5 w-3.5" />
                Import
              </button>
            )}

            <button
              onClick={() => importHook.downloadExport("csv")}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Export CSV
            </button>

            <button
              onClick={() => importHook.downloadExport("xlsx")}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Export Excel
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-screen-xl space-y-5 px-6 py-5">
        {noCustomFields && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between gap-4 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-xl">{meta.icon}</span>
              <div>
                <p className="text-sm font-semibold text-foreground">No custom fields defined yet</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Use the Form Builder to enrich {meta.label.toLowerCase()} with custom fields for deeper analytics and reporting.
                </p>
              </div>
            </div>
            {canViewFormBuilder && (
              <button
                onClick={() => router.push(`/crm/${cooperativeId}/form-builder`)}
                className="shrink-0 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Open Form Builder
                <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </motion.div>
        )}

        {schemaError && (
          <div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{schemaError}</p>
          </div>
        )}

        <ModelAnalyticsPanel
          modelSlug={modelSlug}
          analytics={analyticsResult}
          loading={analyticsLoading}
          error={analyticsError}
          onRetry={refetchAnalytics}
        />

        {error && (
          <div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
            <button onClick={refetch} className="ml-auto text-xs font-semibold text-destructive underline">
              Retry
            </button>
          </div>
        )}

        <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Search
            </label>
            <input
              value={serverSearch}
              onChange={(event) => {
                setPage(1);
                setServerSearch(event.target.value);
              }}
              placeholder={`Search ${meta.label.toLowerCase()}…`}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          {showMemberFilter && (
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Member
              </label>
              <div ref={memberFilterRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setMemberFilterOpen((open) => {
                      const nextOpen = !open;
                      if (!nextOpen) setMemberSearch("");
                      return nextOpen;
                    });
                  }}
                  className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-left text-sm"
                >
                  <span className={memberFilterLabel ? "text-foreground" : "text-muted-foreground"}>
                    {memberFilterLabel || "All members"}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${memberFilterOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {memberFilterOpen && (
                  <div className="absolute z-30 mt-2 w-full rounded-xl border border-border bg-popover p-2 shadow-xl">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={memberSearch}
                        onChange={(event) => setMemberSearch(event.target.value)}
                        placeholder="Search member name…"
                        autoFocus
                        className="w-full rounded-lg border border-border bg-background py-2 pr-3 pl-9 text-sm"
                      />
                    </div>

                    <div className="mt-2 max-h-60 space-y-1 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => chooseMember(null)}
                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                          memberFilter ? "text-foreground" : "bg-accent text-accent-foreground"
                        }`}
                      >
                        <Check className={`h-4 w-4 ${memberFilter ? "opacity-0" : "opacity-100"}`} />
                        <span>All members</span>
                      </button>

                      {membersLoading ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          Searching members…
                        </div>
                      ) : memberOptions.length > 0 ? (
                        memberOptions.map((member) => {
                          const memberName = getMemberDisplayName(member);
                          const memberNumber = typeof member.member_number === "string" ? member.member_number : "";
                          const isSelected = member.id === memberFilter;

                          return (
                            <button
                              key={member.id}
                              type="button"
                              onClick={() => chooseMember(member)}
                              className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent ${
                                isSelected ? "bg-accent text-accent-foreground" : "text-foreground"
                              }`}
                            >
                              <Check className={`mt-0.5 h-4 w-4 shrink-0 ${isSelected ? "opacity-100" : "opacity-0"}`} />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium">{memberName}</span>
                                {memberNumber && (
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {memberNumber}
                                  </span>
                                )}
                              </span>
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          No members match that name yet.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {showScopeFilter && (
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Scope
              </label>
              <select
                value={scopeFilter}
                onChange={(event) => {
                  setPage(1);
                  setScopeFilter(event.target.value);
                }}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">All scopes</option>
                <option value="MEMBER">Member</option>
                <option value="COOPERATIVE">Cooperative</option>
              </select>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Extra Data Filter
            </label>
            <div className="flex gap-2">
              <select
                value={extraFieldKey}
                onChange={(event) => {
                  setPage(1);
                  setExtraFieldKey(event.target.value);
                }}
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">Field</option>
                {extraFilterFields.map((field) => (
                  <option key={field.field_key} value={field.field_key}>
                    {field.label}
                  </option>
                ))}
              </select>
              <input
                value={extraFieldValue}
                onChange={(event) => {
                  setPage(1);
                  setExtraFieldValue(event.target.value);
                }}
                placeholder="Value"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        {schema ? (
          <ShambaTable<FlatRecord>
            variant="default"
            columns={tableColumns}
            data={tableData}
            keyField="id"
            loading={schemaLoading || loading}
            searchable={false}
            searchPlaceholder={`Search ${meta.label.toLowerCase()}…`}
            totalCount={totalCount}
            page={page}
            pageSize={25}
            onPageChange={setPage}
            rowActions={rowActions}
            emptyMessage={`No ${meta.label.toLowerCase()} records found.`}
            exportFileName={`${modelSlug}-${cooperativeId}`}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <div className="mx-auto max-w-md space-y-2">
              <p className="text-sm font-semibold text-foreground">Unable to build the table right now</p>
              <p className="text-sm text-muted-foreground">
                Refresh the page or reopen the module after the schema finishes loading.
              </p>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {confirmDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmDelete(null)}
            />
            <motion.div
              className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <h3 className="mb-2 font-semibold text-foreground">Delete record?</h3>
              <p className="mb-5 text-sm text-muted-foreground">
                This action cannot be undone. The record will be permanently deleted.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="flex-1 rounded-xl bg-muted py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/80"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(confirmDelete)}
                  disabled={deleting}
                  className="flex-1 rounded-xl bg-destructive py-2 text-sm font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showImport && (
          <CRMImportModal
            modelSlug={modelSlug}
            modelLabel={meta.label}
            onImport={async (file, dryRun) => {
              const response = await importHook.importFile(file, dryRun);
              if (response?.success_count && response.success_count > 0 && !dryRun) {
                await Promise.all([refetch(), refetchAnalytics()]);
              }
              return response;
            }}
            onDownloadTemplate={importHook.downloadTemplate}
            importing={importHook.importing}
            onClose={() => setShowImport(false)}
            onSuccess={() => {
              void Promise.all([refetch(), refetchAnalytics()]);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
