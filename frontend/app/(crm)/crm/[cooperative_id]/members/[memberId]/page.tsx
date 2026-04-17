"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileUp,
  Loader2,
  Plus,
  Upload,
} from "lucide-react";

import ModelAnalyticsPanel from "@/components/crm/model-analytics-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CRMImportModal from "@/components/shambaflow/CRMImportModal";
import {
  useMemberContextSubmission,
  useMemberDashboard,
  useMemberFormTemplates,
  useMemberRecords,
  type MemberModuleMetadata,
  type MemberRecord,
  type MemberTemplate,
  getAnalyticsSummary,
  getMemberDisplayName,
} from "@/hooks/useMemberDashboard";
import { useCRMImport, type CRMAnalyticsChart, type CRMAnalyticsResult, type ModelSlug } from "@/hooks/useCRMData";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";


type ModuleKey = "production" | "livestock" | "governance" | "financial" | "land" | "herds";

type MemberTableColumn = {
  key: string;
  label: string;
  displayType?: string;
  options?: string[];
};

type ModuleFilterState = {
  search: string;
  fieldKey: string;
  fieldValue: string;
};

type ModuleConfig = {
  key: ModuleKey;
  label: string;
  description: string;
  targetModel: string;
  modelSlug: ModelSlug;
  dateKey?: string;
  columns: MemberTableColumn[];
};

const MODULES: ModuleConfig[] = [
  {
    key: "production",
    label: "Production",
    description: "Harvest and production records for this member.",
    targetModel: "PRODUCTION",
    modelSlug: "production",
    dateKey: "record_date",
    columns: [
      { key: "product_name", label: "Product" },
      { key: "season", label: "Season" },
      { key: "quantity_kg", label: "Quantity" },
      { key: "quality_grade", label: "Grade" },
    ],
  },
  {
    key: "livestock",
    label: "Livestock",
    description: "Health and herd activity linked to this member.",
    targetModel: "LIVESTOCK",
    modelSlug: "livestock",
    dateKey: "event_date",
    columns: [
      { key: "animal_type", label: "Animal" },
      { key: "treatment_name", label: "Treatment" },
      { key: "dosage", label: "Dosage" },
      { key: "event_date", label: "Event Date" },
    ],
  },
  {
    key: "governance",
    label: "Governance",
    description: "Participation, certifications, and governance records.",
    targetModel: "GOVERNANCE",
    modelSlug: "governance",
    dateKey: "event_date",
    columns: [
      { key: "title", label: "Title" },
      { key: "location", label: "Location" },
      { key: "attendees_count", label: "Attendees" },
      { key: "event_date", label: "Event Date" },
    ],
  },
  {
    key: "financial",
    label: "Financial",
    description: "Member contributions, savings, and financial activity.",
    targetModel: "FINANCE",
    modelSlug: "finance",
    dateKey: "transaction_date",
    columns: [
      { key: "amount_ksh", label: "Amount" },
      { key: "transaction_date", label: "Transaction Date" },
      { key: "reference_number", label: "Reference" },
      { key: "description", label: "Description" },
    ],
  },
  {
    key: "land",
    label: "Land",
    description: "Parcels and land-use records belonging to this member.",
    targetModel: "LAND",
    modelSlug: "land",
    columns: [
      { key: "parcel_name", label: "Parcel" },
      { key: "acreage", label: "Acreage" },
      { key: "location", label: "Location" },
      { key: "crop_type", label: "Crop Type" },
    ],
  },
  {
    key: "herds",
    label: "Herds",
    description: "Member herd records and livestock assets.",
    targetModel: "HERD",
    modelSlug: "herds",
    columns: [
      { key: "animal_type", label: "Animal" },
      { key: "breed", label: "Breed" },
      { key: "count", label: "Count" },
      { key: "production_purpose", label: "Purpose" },
    ],
  },
];

const MEMBER_DASHBOARD_IMPORT_MODULES = new Set<ModuleKey>([
  "production",
  "livestock",
  "financial",
  "land",
  "herds",
]);

const HIDDEN_MEMBER_FIELD_KEYS = new Set([
  "member",
  "member_id",
  "member_number",
  "member_name",
  "display_name",
  "collection_scope",
]);

const PREFERRED_DATE_FIELD_KEYS = [
  "record_date",
  "event_date",
  "transaction_date",
  "service_date",
  "meeting_date",
  "activity_date",
];

const EMPTY_MODULE_FILTER_STATE: ModuleFilterState = {
  search: "",
  fieldKey: "",
  fieldValue: "",
};

const LOW_SIGNAL_MEMBER_CHART_IDS = new Set(["member_breakdown", "scope_breakdown"]);
const MEMBER_OVERVIEW_CHART_LIMIT = 6;

// Keep the overview aligned with the product spec's member story:
// operational overview first, then production, governance, and finance insights.
const MODULE_CHART_PRIORITIES: Array<{
  slug: ModelSlug;
  label: string;
  prefer: "trend" | "breakdown";
}> = [
  { slug: "production", label: "Production", prefer: "trend" },
  { slug: "governance", label: "Governance", prefer: "breakdown" },
  { slug: "finance", label: "Financial", prefer: "breakdown" },
  { slug: "livestock", label: "Livestock", prefer: "breakdown" },
  { slug: "land", label: "Land", prefer: "breakdown" },
  { slug: "herds", label: "Herds", prefer: "breakdown" },
];


function formatValue(value: unknown, displayType: string = "text"): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (displayType === "date" && typeof value === "string") return formatDate(value);
  if (displayType === "datetime" && typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-KE");
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}


function formatDate(value: string | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-KE");
}


function formatStatusLabel(status: string | undefined) {
  if (!status) return "Unknown";
  return status.replace(/_/g, " ");
}


function buildTemplateDefaultFormData(
  fields: NonNullable<MemberTemplate["fields"]>,
): Record<string, unknown> {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return fields.reduce<Record<string, unknown>>((defaults, field) => {
    const explicitDefault = typeof field.default_value === "string" ? field.default_value.trim() : "";
    if (explicitDefault) {
      defaults[field.maps_to_model_field] = explicitDefault;
      return defaults;
    }
    if (field.display_type === "date" && field.maps_to_model_field === "record_date") {
      defaults[field.maps_to_model_field] = today;
    }
    return defaults;
  }, {});
}


function titleizeFieldKey(fieldKey: string): string {
  return fieldKey
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}


function dedupeMemberColumns(columns: MemberTableColumn[]): MemberTableColumn[] {
  const seen = new Set<string>();
  return columns.filter((column) => {
    if (seen.has(column.key)) return false;
    seen.add(column.key);
    return true;
  });
}


function pickPreferredTemplate(templates: MemberTemplate[]): MemberTemplate | null {
  if (templates.length === 0) return null;

  return [...templates].sort((left, right) => {
    const defaultDelta = Number(right.is_default) - Number(left.is_default);
    if (defaultDelta !== 0) return defaultDelta;

    const createDelta = Number(Boolean(right.can_create)) - Number(Boolean(left.can_create));
    if (createDelta !== 0) return createDelta;

    const fieldDelta = (right.field_count ?? 0) - (left.field_count ?? 0);
    if (fieldDelta !== 0) return fieldDelta;

    return Date.parse(right.updated_at) - Date.parse(left.updated_at);
  })[0] ?? null;
}


function mapBackendFieldToColumn(
  field: MemberModuleMetadata["table_columns"][number],
): MemberTableColumn {
  return {
    key: field.key,
    label: field.label,
    displayType: field.display_type,
    options: field.options,
  };
}


function getModuleDateKey(
  module: ModuleConfig,
  template: MemberTemplate | null,
  backendMetadata?: MemberModuleMetadata,
): string | undefined {
  if (backendMetadata?.date_field) return backendMetadata.date_field;
  if (module.dateKey) return module.dateKey;

  const fields = template?.fields ?? [];
  const preferredDateField = PREFERRED_DATE_FIELD_KEYS.find((fieldKey) =>
    fields.some((field) => field.maps_to_model_field === fieldKey)
  );
  if (preferredDateField) return preferredDateField;

  return fields.find((field) =>
    !HIDDEN_MEMBER_FIELD_KEYS.has(field.maps_to_model_field)
    && (field.display_type === "date" || field.display_type === "datetime")
  )?.maps_to_model_field;
}


function getModuleTableColumns(
  module: ModuleConfig,
  template: MemberTemplate | null,
  dateKey?: string,
  backendMetadata?: MemberModuleMetadata,
): MemberTableColumn[] {
  const templateFields = (template?.fields ?? [])
    .filter((field) =>
      !HIDDEN_MEMBER_FIELD_KEYS.has(field.maps_to_model_field)
      && field.maps_to_model_field !== dateKey
    )
    .slice(0, 4)
    .map((field) => ({
      key: field.maps_to_model_field,
      label: field.label,
      displayType: field.display_type,
      options: field.options,
    }));

  if (backendMetadata?.table_columns?.length) {
    return backendMetadata.table_columns
      .map(mapBackendFieldToColumn)
      .filter((column) => column.key !== dateKey);
  }
  if (templateFields.length > 0) return templateFields;
  return module.columns.filter((column) => column.key !== dateKey);
}


function getModuleFilterFields(
  module: ModuleConfig,
  template: MemberTemplate | null,
  dateKey?: string,
  backendMetadata?: MemberModuleMetadata,
): MemberTableColumn[] {
  const templateFields = (template?.fields ?? [])
    .filter((field) => !HIDDEN_MEMBER_FIELD_KEYS.has(field.maps_to_model_field))
    .map((field) => ({
      key: field.maps_to_model_field,
      label: field.label,
      displayType: field.display_type,
      options: field.options,
    }));

  if (backendMetadata?.filter_fields?.length) {
    return dedupeMemberColumns(backendMetadata.filter_fields.map(mapBackendFieldToColumn));
  }
  if (templateFields.length > 0) {
    return dedupeMemberColumns(templateFields);
  }

  const fallbackFields: MemberTableColumn[] = [
    ...(dateKey ? [{
      key: dateKey,
      label: titleizeFieldKey(dateKey),
      displayType: "date",
    }] : []),
    ...module.columns,
  ];
  return dedupeMemberColumns(fallbackFields);
}


function getRecordValue(record: MemberRecord, column: MemberTableColumn): unknown {
  const displayValue = (record as Record<string, unknown>)[`${column.key}_display`];
  if (displayValue !== null && displayValue !== undefined && displayValue !== "") {
    return displayValue;
  }

  const topLevelValue = (record as Record<string, unknown>)[column.key];
  if (topLevelValue !== null && topLevelValue !== undefined && topLevelValue !== "") {
    return topLevelValue;
  }

  return record.extra_data?.[column.key];
}


function getRecordDateValue(record: MemberRecord, dateKey?: string): string | undefined {
  if (dateKey) {
    const topLevelValue = (record as Record<string, unknown>)[dateKey];
    if (typeof topLevelValue === "string" && topLevelValue) return topLevelValue;

    const extraValue = record.extra_data?.[dateKey];
    if (typeof extraValue === "string" && extraValue) return extraValue;
  }

  const eventDate = record.extra_data?.event_date;
  if (typeof eventDate === "string" && eventDate) return eventDate;

  const transactionDate = record.extra_data?.transaction_date;
  if (typeof transactionDate === "string" && transactionDate) return transactionDate;

  return record.created_at;
}


function buildModuleActivityChart(
  memberName: string,
  data: Array<{ label: string; value: number }>,
): CRMAnalyticsChart | null {
  if (data.length < 2) return null;
  return {
    id: "member_module_activity",
    type: "bar",
    title: "Activity by module",
    description: `Records captured for ${memberName} across the CRM workspace.`,
    data,
  };
}


function buildOperationalMixChart(data: Array<{ label: string; value: number }>): CRMAnalyticsChart | null {
  if (data.length < 2) return null;
  return {
    id: "member_operational_mix",
    type: "bar",
    title: "Operational mix",
    description: "Key member-level operational and institutional signals.",
    data,
  };
}


function buildAggregateMemberTrendChart(
  moduleAnalytics: Partial<Record<ModelSlug, CRMAnalyticsResult>> | undefined,
): CRMAnalyticsChart | null {
  const timelineCharts = Object.values(moduleAnalytics ?? {})
    .map((moduleAnalyticsItem) => moduleAnalyticsItem?.charts.find((chart) => chart.type === "timeline") ?? null)
    .filter((chart): chart is CRMAnalyticsChart => Boolean(chart) && chart.data.some((point) => point.value > 0));

  if (timelineCharts.length === 0) return null;

  const monthOrder = Array.from(
    new Set(
      timelineCharts.flatMap((chart) => chart.data.map((point) => point.label))
    )
  ).sort((left, right) => {
    const leftDate = Date.parse(`01 ${left}`);
    const rightDate = Date.parse(`01 ${right}`);
    if (Number.isNaN(leftDate) || Number.isNaN(rightDate)) return left.localeCompare(right);
    return leftDate - rightDate;
  });
  const totals = new Map(monthOrder.map((label) => [label, 0]));

  timelineCharts.forEach((chart) => {
    chart.data.forEach((point) => {
      totals.set(point.label, (totals.get(point.label) ?? 0) + point.value);
    });
  });

  const data = monthOrder.map((label) => ({ label, value: totals.get(label) ?? 0 }));

  if (data.every((point) => point.value <= 0)) return null;

  return {
    id: "member_activity_trend",
    type: "line",
    title: "Member activity trend",
    description: "Cross-module activity trend built from this member's captured records.",
    data,
  };
}


function buildModuleInsightChart(
  slug: ModelSlug,
  label: string,
  analytics: CRMAnalyticsResult | undefined,
  prefer: "trend" | "breakdown",
): CRMAnalyticsChart | null {
  if (!analytics) return null;

  const meaningfulCharts = analytics.charts.filter(
    (chart) => chart.data.length > 1 && !LOW_SIGNAL_MEMBER_CHART_IDS.has(chart.id)
  );
  if (meaningfulCharts.length === 0) return null;

  const selectedChart = prefer === "trend"
    ? meaningfulCharts.find((chart) => chart.type === "timeline") ?? meaningfulCharts[0]
    : meaningfulCharts.find((chart) => chart.type !== "timeline") ?? meaningfulCharts[0];

  if (!selectedChart) return null;

  const isTimeline = selectedChart.type === "timeline";
  const title = isTimeline
    ? `${label} trend`
    : selectedChart.title.toLowerCase().startsWith(label.toLowerCase())
      ? selectedChart.title
      : `${label} ${selectedChart.title}`.trim();

  return {
    ...selectedChart,
    id: `member_${slug}_${selectedChart.id}`,
    type: isTimeline ? "line" : selectedChart.type,
    title,
    description: isTimeline
      ? `How ${label.toLowerCase()} records have moved over time for this member.`
      : selectedChart.description,
  };
}


function MemberRecordsTable({
  records,
  columns,
  dateKey,
}: {
  records: MemberRecord[];
  columns: MemberTableColumn[];
  dateKey?: string;
}) {
  if (records.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No records yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            {columns.map((column) => (
              <TableHead key={column.key}>{column.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow key={record.id}>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {formatDate(getRecordDateValue(record, dateKey))}
              </TableCell>
              {columns.map((column) => (
                <TableCell key={column.key} className="align-top text-sm">
                  {formatValue(getRecordValue(record, column), column.displayType)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}


function FieldInput({
  field,
  value,
  onChange,
}: {
  field: NonNullable<MemberTemplate["fields"]>[number];
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const baseClass =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

  if (field.display_type === "textarea" || field.display_type === "rich_text") {
    return (
      <textarea
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        className={`${baseClass} min-h-[100px]`}
      />
    );
  }

  if (field.display_type === "dropdown" && field.options.length > 0) {
    return (
      <select
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        className={baseClass}
      >
        <option value="">Select…</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    );
  }

  if (field.display_type === "boolean") {
    return (
      <select
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        className={baseClass}
      >
        <option value="">Select…</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }

  if (field.display_type === "date") {
    return (
      <input
        type="date"
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        className={baseClass}
      />
    );
  }

  if (field.display_type === "datetime") {
    return (
      <input
        type="datetime-local"
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        className={baseClass}
      />
    );
  }

  if (field.display_type === "number" || field.display_type === "decimal") {
    return (
      <input
        type="number"
        step={field.display_type === "decimal" ? "any" : "1"}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        className={baseClass}
      />
    );
  }

  return (
    <input
      type="text"
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value)}
      className={baseClass}
      placeholder={field.placeholder || field.help_text}
    />
  );
}


function TemplateSubmissionModal({
  memberName,
  memberNumber,
  template,
  onClose,
  onSubmit,
}: {
  memberName: string;
  memberNumber: string;
  template: MemberTemplate;
  onClose: () => void;
  onSubmit: (template: MemberTemplate, payload: Record<string, unknown>) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const visibleFields = useMemo(
    () => (template.fields ?? []).filter((field) => !HIDDEN_MEMBER_FIELD_KEYS.has(field.maps_to_model_field)),
    [template.fields],
  );
  const [formData, setFormData] = useState<Record<string, unknown>>(() => buildTemplateDefaultFormData(visibleFields));

  useEffect(() => {
    setFormData(buildTemplateDefaultFormData(visibleFields));
  }, [template.id, visibleFields]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(template, formData);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="max-h-[90vh] w-full max-w-2xl overflow-hidden">
        <CardHeader className="border-b border-border">
          <CardTitle>{template.name}</CardTitle>
          <CardDescription>
            Submit data for {memberName}
          </CardDescription>
        </CardHeader>
        <CardContent className="max-h-[70vh] overflow-y-auto p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 rounded-xl border border-border bg-muted/30 p-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Member</p>
                <p className="text-sm font-semibold text-foreground">{memberName}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Member Number</p>
                <p className="text-sm font-semibold text-foreground">{memberNumber}</p>
              </div>
            </div>

            {visibleFields.length === 0 ? (
              <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                This template only uses the member context values. Submit to create the record.
              </div>
            ) : (
              visibleFields.map((field) => (
                <div key={field.id} className="space-y-2">
                  <label className="block text-sm font-medium text-foreground">
                    {field.label}
                    {field.is_required && <span className="ml-1 text-destructive">*</span>}
                  </label>
                  <FieldInput
                    field={field}
                    value={formData[field.maps_to_model_field]}
                    onChange={(next) =>
                      setFormData((current) => ({
                        ...current,
                        [field.maps_to_model_field]: next,
                      }))
                    }
                  />
                  {field.help_text && (
                    <p className="text-xs text-muted-foreground">{field.help_text}</p>
                  )}
                </div>
              ))
            )}

            <div className="flex justify-end gap-3 border-t border-border pt-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit Record"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}


export default function MemberDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const coopId = params.cooperative_id as string;
  const memberId = params.memberId as string;

  const [activeTab, setActiveTab] = useState("overview");
  const [selectedTemplate, setSelectedTemplate] = useState<MemberTemplate | null>(null);
  const [importTarget, setImportTarget] = useState<ModuleKey | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [moduleFiltersByKey, setModuleFiltersByKey] = useState<Record<ModuleKey, ModuleFilterState>>(() =>
    Object.fromEntries(
      MODULES.map((module) => [module.key, { ...EMPTY_MODULE_FILTER_STATE }])
    ) as Record<ModuleKey, ModuleFilterState>
  );

  const updateModuleFilter = (moduleKey: ModuleKey, patch: Partial<ModuleFilterState>) => {
    setModuleFiltersByKey((current) => ({
      ...current,
      [moduleKey]: {
        ...current[moduleKey],
        ...patch,
      },
    }));
  };

  const { data: dashboardData, loading: dashboardLoading, error: dashboardError, refresh: refreshDashboard } = useMemberDashboard(coopId, memberId);
  const { data: templatesData, refresh: refreshTemplates } = useMemberFormTemplates(coopId, memberId);
  const { submit: submitWithContext } = useMemberContextSubmission(coopId);

  const moduleRecordQueryByKey = useMemo(() => {
    return Object.fromEntries(
      MODULES.map((module) => {
        const filterState = moduleFiltersByKey[module.key];
        const filters: Record<string, string> = {};
        if (filterState.fieldKey && filterState.fieldValue.trim()) {
          filters[filterState.fieldKey] = filterState.fieldValue.trim();
        }
        return [
          module.key,
          {
            search: filterState.search.trim(),
            filters,
          },
        ];
      })
    ) as Record<ModuleKey, { search: string; filters: Record<string, string> }>;
  }, [moduleFiltersByKey]);

  const production = useMemberRecords(coopId, memberId, "production", {
    page: 1,
    pageSize: 20,
    search: moduleRecordQueryByKey.production.search,
    filters: moduleRecordQueryByKey.production.filters,
    enabled: Boolean(dashboardData?.permissions?.production?.can_view),
  });
  const livestock = useMemberRecords(coopId, memberId, "livestock", {
    page: 1,
    pageSize: 20,
    search: moduleRecordQueryByKey.livestock.search,
    filters: moduleRecordQueryByKey.livestock.filters,
    enabled: Boolean(dashboardData?.permissions?.livestock?.can_view),
  });
  const governance = useMemberRecords(coopId, memberId, "governance", {
    page: 1,
    pageSize: 20,
    search: moduleRecordQueryByKey.governance.search,
    filters: moduleRecordQueryByKey.governance.filters,
    enabled: Boolean(dashboardData?.permissions?.governance?.can_view),
  });
  const financial = useMemberRecords(coopId, memberId, "financial", {
    page: 1,
    pageSize: 20,
    search: moduleRecordQueryByKey.financial.search,
    filters: moduleRecordQueryByKey.financial.filters,
    enabled: Boolean(dashboardData?.permissions?.finance?.can_view),
  });
  const land = useMemberRecords(coopId, memberId, "land", {
    page: 1,
    pageSize: 20,
    search: moduleRecordQueryByKey.land.search,
    filters: moduleRecordQueryByKey.land.filters,
    enabled: Boolean(dashboardData?.permissions?.land?.can_view),
  });
  const herds = useMemberRecords(coopId, memberId, "herds", {
    page: 1,
    pageSize: 20,
    search: moduleRecordQueryByKey.herds.search,
    filters: moduleRecordQueryByKey.herds.filters,
    enabled: Boolean(dashboardData?.permissions?.herds?.can_view),
  });

  const productionImport = useCRMImport(coopId, "production", { memberId });
  const livestockImport = useCRMImport(coopId, "livestock", { memberId });
  const governanceImport = useCRMImport(coopId, "governance", { memberId });
  const financeImport = useCRMImport(coopId, "finance", { memberId });
  const landImport = useCRMImport(coopId, "land", { memberId });
  const herdsImport = useCRMImport(coopId, "herds", { memberId });

  const recordsByKey = {
    production,
    livestock,
    governance,
    financial,
    land,
    herds,
  } as const;

  const importHooks = {
    production: productionImport,
    livestock: livestockImport,
    governance: governanceImport,
    financial: financeImport,
    land: landImport,
    herds: herdsImport,
  } as const;

  const templateGroups = useMemo(() => {
    const grouped: Record<string, MemberTemplate[]> = {};
    (templatesData?.templates ?? []).forEach((template) => {
      if (!grouped[template.target_model]) grouped[template.target_model] = [];
      grouped[template.target_model].push(template);
    });
    return grouped;
  }, [templatesData?.templates]);

  const moduleTableConfigByKey = useMemo(() => {
    return Object.fromEntries(
      MODULES.map((module) => {
        const moduleTemplates = templateGroups[module.targetModel] ?? [];
        const preferredTemplate = pickPreferredTemplate(moduleTemplates);
        const backendMetadata = dashboardData?.module_metadata?.[module.modelSlug];
        const dateKey = getModuleDateKey(module, preferredTemplate, backendMetadata);
        const columns = getModuleTableColumns(module, preferredTemplate, dateKey, backendMetadata);
        const filterFields = getModuleFilterFields(module, preferredTemplate, dateKey, backendMetadata);
        return [module.key, { dateKey, columns, filterFields }];
      })
    ) as Record<ModuleKey, { dateKey?: string; columns: MemberTableColumn[]; filterFields: MemberTableColumn[] }>;
  }, [dashboardData?.module_metadata, templateGroups]);

  const visibleModules = useMemo(
    () =>
      MODULES.filter((module) =>
        Boolean(dashboardData?.permissions?.[module.modelSlug]?.can_view)
      ),
    [dashboardData?.permissions]
  );

  useEffect(() => {
    if (activeTab === "overview") return;
    if (!visibleModules.some((module) => module.key === activeTab)) {
      setActiveTab("overview");
    }
  }, [activeTab, visibleModules]);

  const refreshAll = async () => {
    await Promise.all([
      refreshDashboard(),
      refreshTemplates(),
      production.refresh(),
      livestock.refresh(),
      governance.refresh(),
      financial.refresh(),
      land.refresh(),
      herds.refresh(),
    ]);
  };

  if (dashboardError) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-destructive">
          {dashboardError}
        </CardContent>
      </Card>
    );
  }

  if (dashboardLoading || !dashboardData) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading member dashboard…
        </div>
      </div>
    );
  }

  const { member, member_status_options, analytics, recent_activity, permissions, module_analytics } = dashboardData;
  const analyticsSummary = getAnalyticsSummary(analytics);
  const memberName = getMemberDisplayName(member);
  const memberStatusLabel = formatStatusLabel(member.status);
  const canEditMember = Boolean(permissions?.members?.can_edit);
  const importConfig = importTarget ? MODULES.find((module) => module.key === importTarget) : null;
  const activeImportHook = importTarget ? importHooks[importTarget] : null;
  const moduleActivity = [
    { label: "Production", value: analytics.production.total_records },
    { label: "Livestock", value: analytics.livestock.total_events },
    { label: "Governance", value: analytics.governance.total_records },
    { label: "Finance", value: analytics.financial.total_records },
    { label: "Land", value: analytics.assets.land_records },
    { label: "Herds", value: analytics.assets.herd_records },
  ].filter((item) => item.value > 0);

  const operationalMix = [
    { label: "Vaccinations", value: analytics.livestock.vaccinations },
    { label: "Treatments", value: analytics.livestock.treatments },
    { label: "Meetings", value: analytics.governance.meetings },
    { label: "Certificates", value: analytics.governance.certificates },
    { label: "Contributions", value: analytics.financial.contributions },
    { label: "Loan Repayments", value: analytics.financial.loans },
  ].filter((item) => item.value > 0);

  const moduleInsightCharts = MODULE_CHART_PRIORITIES
    .map(({ slug, label, prefer }) =>
      buildModuleInsightChart(slug, label, module_analytics?.[slug], prefer)
    )
    .filter((chart): chart is CRMAnalyticsChart => Boolean(chart));

  const overviewAnalyticsPanel: Pick<CRMAnalyticsResult, "cards" | "charts" | "highlights"> = {
    cards: [
      {
        id: "total_activity_records",
        label: "Total activities",
        value: analyticsSummary.totalActivities.toLocaleString(),
        helper_text: analyticsSummary.latestActivity
          ? `Latest activity: ${formatDate(analyticsSummary.latestActivity)}`
          : "No activity recorded yet.",
        tone: "primary",
      },
      {
        id: "production_records",
        label: "Production records",
        value: analytics.production.total_records.toLocaleString(),
        helper_text: analytics.production.latest_date
          ? `Latest production: ${formatDate(analytics.production.latest_date)}`
          : "No production records yet.",
        tone: "default",
      },
      {
        id: "livestock_events",
        label: "Livestock events",
        value: analytics.livestock.total_events.toLocaleString(),
        helper_text: `${analytics.livestock.vaccinations} vaccinations · ${analytics.livestock.treatments} treatments`,
        tone: "accent",
      },
      {
        id: "financial_records",
        label: "Financial records",
        value: analytics.financial.total_records.toLocaleString(),
        helper_text: `${analytics.financial.contributions} contributions · ${analytics.financial.loans} loan repayments`,
        tone: "default",
      },
    ],
    charts: [
      buildAggregateMemberTrendChart(module_analytics),
      buildModuleActivityChart(memberName, moduleActivity),
      moduleInsightCharts.find((chart) => chart.id.startsWith("member_production_")) ?? null,
      moduleInsightCharts.find((chart) => chart.id.startsWith("member_governance_")) ?? null,
      moduleInsightCharts.find((chart) => chart.id.startsWith("member_finance_")) ?? null,
      buildOperationalMixChart(operationalMix),
      ...moduleInsightCharts.filter(
        (chart) =>
          !chart.id.startsWith("member_production_")
          && !chart.id.startsWith("member_governance_")
          && !chart.id.startsWith("member_finance_")
      ),
    ].filter((chart): chart is CRMAnalyticsChart => Boolean(chart)).slice(0, MEMBER_OVERVIEW_CHART_LIMIT),
    highlights: [
      {
        label: "Member since",
        value: formatDate(analytics.overall.member_since),
      },
      {
        label: "Status",
        value: memberStatusLabel,
      },
      {
        label: "Latest activity",
        value: analyticsSummary.latestActivity ? formatDate(analyticsSummary.latestActivity) : "No activity yet",
      },
      {
        label: "Seasons tracked",
        value: analytics.production.seasons.length > 0 ? analytics.production.seasons.join(", ") : "No seasons logged",
      },
    ],
  };

  const handleTemplateSubmit = async (template: MemberTemplate, payload: Record<string, unknown>) => {
    await submitWithContext({
      template_id: template.id,
      member_id: memberId,
      payload,
    });
    await refreshAll();
  };

  const handleStatusUpdate = async (nextStatus: string) => {
    if (nextStatus === member.status || updatingStatus) return;

    setUpdatingStatus(true);
    try {
      await apiFetch(`/api/crm/${coopId}/members/${memberId}/`, {
        method: "PATCH",
        body: { status: nextStatus },
      });
      toast.success(`Member status set to ${formatStatusLabel(nextStatus)}.`);
      await refreshDashboard();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update member status.";
      toast.error(message);
    } finally {
      setUpdatingStatus(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{memberName}</h1>
            <p className="text-sm text-muted-foreground">Member {member.member_number}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={member.status === "ACTIVE" ? "default" : "secondary"}>{memberStatusLabel}</Badge>
          {canEditMember && (member_status_options?.length ?? 0) > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={updatingStatus}>
                  {updatingStatus ? "Updating…" : "Set Status"}
                  <ChevronDown className="ml-2 h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {member_status_options?.map((option) => {
                  const isCurrent = option.value === member.status;
                  return (
                    <DropdownMenuItem
                      key={option.value}
                      className="flex items-center justify-between gap-3"
                      disabled={isCurrent || updatingStatus}
                      onClick={() => void handleStatusUpdate(option.value)}
                    >
                      <span>{option.label}</span>
                      <Check className={`h-4 w-4 ${isCurrent ? "opacity-100 text-primary" : "opacity-0"}`} />
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <ModelAnalyticsPanel modelSlug="members" analytics={overviewAnalyticsPanel} />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex w-full flex-wrap gap-2">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {visibleModules.map((module) => (
            <TabsTrigger key={module.key} value={module.key}>
              {module.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>Open the model workspaces tied to this member's records.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {visibleModules.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No model workspaces are available for your account.</p>
                ) : (
                  visibleModules.map((module) => (
                    <Button
                      key={module.key}
                      variant="outline"
                      className="w-full justify-between"
                      onClick={() => router.push(`/crm/${coopId}/${module.modelSlug}`)}
                    >
                      <span>{module.label}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Latest member-scoped records across all CRM modules.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {recent_activity.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No activity recorded for this member yet.</p>
                ) : (
                  recent_activity.map((activity) => (
                    <div key={`${activity.type}-${activity.data?.id}`} className="rounded-xl border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{activity.title}</p>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">{activity.type}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">{formatDate(activity.date)}</p>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {visibleModules.map((module) => {
          const recordsHook = recordsByKey[module.key];
          const moduleAllowsCapture = MEMBER_DASHBOARD_IMPORT_MODULES.has(module.key);
          const availableTemplates = templateGroups[module.targetModel] ?? [];
          const moduleTemplates = moduleAllowsCapture
            ? availableTemplates.filter((template) => template.can_create)
            : [];
          const moduleTableConfig = moduleTableConfigByKey[module.key] ?? {
            dateKey: module.dateKey,
            columns: module.columns,
            filterFields: module.columns,
          };
          const moduleFilterState = moduleFiltersByKey[module.key];
          const selectedFilterField = moduleTableConfig.filterFields.find(
            (field) => field.key === moduleFilterState.fieldKey
          );
          const modulePermission = permissions?.[module.modelSlug] ?? {
            can_view: false,
            can_create: false,
            can_edit: false,
            can_delete: false,
          };

          return (
            <TabsContent key={module.key} value={module.key}>
              <Card>
                <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle>{module.label}</CardTitle>
                    <CardDescription>{module.description}</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {modulePermission.can_view && (
                      <>
                        <Button variant="outline" onClick={() => importHooks[module.key].downloadExport("csv")}>
                          <Download className="mr-2 h-4 w-4" />
                          CSV
                        </Button>
                        <Button variant="outline" onClick={() => importHooks[module.key].downloadExport("xlsx")}>
                          <Download className="mr-2 h-4 w-4" />
                          Excel
                        </Button>
                      </>
                    )}
                    {modulePermission.can_create && moduleAllowsCapture && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline">
                            <Upload className="mr-2 h-4 w-4" />
                            Import
                            <ChevronDown className="ml-2 h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuItem
                            className="gap-3 py-2.5"
                            onClick={() => setImportTarget(module.key)}
                          >
                            <FileUp className="h-4 w-4 text-primary" />
                            <div>
                              <p className="text-sm font-semibold">Import Records</p>
                              <p className="text-[10px] text-muted-foreground">
                                Open the validation and upload flow
                              </p>
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="gap-3 py-2.5"
                            onClick={() => importHooks[module.key].downloadTemplate()}
                          >
                            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                            <div>
                              <p className="text-sm font-semibold">Download Template</p>
                              <p className="text-[10px] text-muted-foreground">
                                Get the member-scoped CSV template
                              </p>
                            </div>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!moduleAllowsCapture && module.key === "governance" && (
                    <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                      Governance records are managed from the Governance model page, where you can add them manually or import them from files.
                    </div>
                  )}

                  {modulePermission.can_create && moduleAllowsCapture && moduleTemplates.length > 0 && (
                    <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-muted/20 p-3">
                      {moduleTemplates.map((template) => (
                        <Button
                          key={template.id}
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedTemplate(template)}
                        >
                          <Plus className="mr-2 h-3.5 w-3.5" />
                          {template.name}
                        </Button>
                      ))}
                    </div>
                  )}

                  <div className="grid gap-3 rounded-xl border border-border bg-muted/10 p-3 lg:grid-cols-[1.4fr,1fr,1fr,auto]">
                    <input
                      value={moduleFilterState.search}
                      onChange={(event) =>
                        updateModuleFilter(module.key, { search: event.target.value })
                      }
                      placeholder={`Search ${module.label.toLowerCase()} records…`}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                    <select
                      value={moduleFilterState.fieldKey}
                      onChange={(event) =>
                        updateModuleFilter(module.key, {
                          fieldKey: event.target.value,
                          fieldValue: "",
                        })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    >
                      <option value="">Filter field</option>
                      {moduleTableConfig.filterFields.map((field) => (
                        <option key={field.key} value={field.key}>
                          {field.label}
                        </option>
                      ))}
                    </select>

                    {selectedFilterField?.options && selectedFilterField.options.length > 0 ? (
                      <select
                        value={moduleFilterState.fieldValue}
                        onChange={(event) =>
                          updateModuleFilter(module.key, { fieldValue: event.target.value })
                        }
                        disabled={!moduleFilterState.fieldKey}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">Select value</option>
                        {selectedFilterField.options.map((option) => (
                          <option key={option} value={option}>
                            {option.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    ) : selectedFilterField?.displayType === "boolean" ? (
                      <select
                        value={moduleFilterState.fieldValue}
                        onChange={(event) =>
                          updateModuleFilter(module.key, { fieldValue: event.target.value })
                        }
                        disabled={!moduleFilterState.fieldKey}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">Select value</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    ) : (
                      <input
                        type={
                          selectedFilterField?.displayType === "date"
                            ? "date"
                            : selectedFilterField?.displayType === "number" || selectedFilterField?.displayType === "decimal"
                              ? "number"
                              : "text"
                        }
                        value={moduleFilterState.fieldValue}
                        onChange={(event) =>
                          updateModuleFilter(module.key, { fieldValue: event.target.value })
                        }
                        disabled={!moduleFilterState.fieldKey}
                        placeholder={moduleFilterState.fieldKey ? "Filter value" : "Select a field first"}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => updateModuleFilter(module.key, { ...EMPTY_MODULE_FILTER_STATE })}
                      disabled={
                        !moduleFilterState.search
                        && !moduleFilterState.fieldKey
                        && !moduleFilterState.fieldValue
                      }
                    >
                      Clear
                    </Button>
                  </div>

                  {recordsHook.loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading {module.label.toLowerCase()} records…
                    </div>
                  ) : recordsHook.error ? (
                    <p className="text-sm text-destructive">{recordsHook.error}</p>
                  ) : (
                    <MemberRecordsTable
                      records={recordsHook.data?.data ?? []}
                      columns={moduleTableConfig.columns}
                      dateKey={moduleTableConfig.dateKey}
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>

      {selectedTemplate && (
        <TemplateSubmissionModal
          memberName={memberName}
          memberNumber={member.member_number}
          template={selectedTemplate}
          onClose={() => setSelectedTemplate(null)}
          onSubmit={handleTemplateSubmit}
        />
      )}

      {importConfig && activeImportHook && (
        <CRMImportModal
          modelSlug={importConfig.modelSlug}
          modelLabel={`${importConfig.label} for ${member.member_number}`}
          onImport={(file, dryRun) => activeImportHook.importFile(file, dryRun)}
          onDownloadTemplate={activeImportHook.downloadTemplate}
          importing={activeImportHook.importing}
          onClose={() => setImportTarget(null)}
          onSuccess={refreshAll}
        />
      )}
    </div>
  );
}
