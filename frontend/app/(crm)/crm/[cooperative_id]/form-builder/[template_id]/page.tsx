"use client";

/**
 * ShambaFlow – Form Builder: Template Editor  (v2)
 * Route: /crm/[cooperative_id]/form-builder/[template_id]
 *
 * What changed from v1:
 *  - Removed useModelFields() — static Django columns are gone
 *  - Added useSkeletonSchema() — fetches skeleton field + cooperative DFDs
 *  - ShambaFormBuilder now receives skeletonField + registryFields instead
 *    of availableFields (Django columns)
 *  - BuilderField.maps_to_model_field → BuilderField.field_key
 *  - serverToBuilder / builderToServer updated accordingly
 *  - onRegistryUpdate callback refreshes the schema after a new DFD is
 *    registered from inside the builder
 *
 * Save Draft diff logic is identical to v1 — it still compares local vs
 * server TemplateField lists and calls addField / updateField / deleteField.
 * The only difference is that each field now carries a field_key instead
 * of a maps_to_model_field Django column name.
 */

import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter }              from "next/navigation";
import Link                                  from "next/link";
import { motion, AnimatePresence }           from "framer-motion";
import { Badge }  from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, Copy, Loader2, AlertCircle, CheckCircle2,
  Clock, Layers, Zap, BarChart3, ShieldCheck, BookOpen, Trash2,
} from "lucide-react";

import {
  useTemplate,
  useSkeletonSchema,
  useTemplateMutations,
  useFieldMutations,
  useIssueMutations,
  type Template,
  type TemplateField,
  type Issue,
} from "@/hooks/useFormBuilder";

import {
  ShambaFormBuilder,
  type BuilderField,
} from "@/components/shambaflow/ShambaFormBuilder";
import { IssuesPanel } from "@/components/shambaflow/IssuesPanel";

/* ══════════════════════════════════════════════════════════════════
   STATUS CONFIG
══════════════════════════════════════════════════════════════════ */

const STATUS_CONFIG = {
  DRAFT:      { label: "Draft",      colour: "bg-muted text-muted-foreground border-border",                            Icon: Clock        },
  VALIDATING: { label: "Validating", colour: "bg-[var(--info-light)] text-[var(--info)] border-[var(--info)]/30",       Icon: Loader2      },
  HAS_ISSUES: { label: "Has Issues", colour: "bg-[var(--warning-light)] text-[var(--warning)] border-[var(--warning)]/30", Icon: AlertCircle  },
  ACTIVE:     { label: "Active",     colour: "bg-primary/10 text-primary border-primary/20",                            Icon: CheckCircle2 },
  INACTIVE:   { label: "Inactive",   colour: "bg-muted text-muted-foreground/60 border-border",                         Icon: Layers       },
} as const;

/* ══════════════════════════════════════════════════════════════════
   CONVERSION HELPERS
══════════════════════════════════════════════════════════════════ */

/**
 * Convert a server TemplateField to the local BuilderField.
 *
 * In v2 maps_to_model_field IS the field_key.
 * dfd_id is not stored server-side on TemplateField, so we leave it null
 * here — ShambaFormBuilder only needs dfd_id when adding new fields from
 * the registry picker, not when loading existing ones.
 */
function serverToBuilder(f: TemplateField): BuilderField {
  return {
    id:           f.id,
    dfd_id:       null,
    field_key:    f.maps_to_model_field,
    label:        f.label,
    display_type: f.display_type,
    tag:          f.tag,
    is_system:    false,   // system field is never persisted as a TemplateField
    is_locked:    false,   // not available in TemplateField; informational only
    is_required:  f.is_required,
    placeholder:  f.placeholder || undefined,
    help_text:    f.help_text   || undefined,
    options:      f.options.length > 0 ? f.options : undefined,
    validation_rules:  Object.keys(f.validation_rules ?? {}).length > 0
      ? f.validation_rules : undefined,
    conditional_rule:  f.conditional_rule ?? undefined,
  };
}

/**
 * Convert a local BuilderField back to the TemplateField payload the server expects.
 * maps_to_model_field receives field_key.
 */
function builderToServer(f: BuilderField): Partial<TemplateField> {
  return {
    label:               f.label,
    display_type:        f.display_type,
    tag:                 f.tag,
    maps_to_model_field: f.field_key,
    // Skeleton fields (is_system=true) map to real model columns.
    // Every DFD-backed field (is_system=false) is a custom field stored in extra_data.
    is_custom_field:     !f.is_system,
    is_required:         f.is_required,
    placeholder:         f.placeholder         ?? "",
    help_text:           f.help_text           ?? "",
    options:             f.options             ?? [],
    validation_rules:    f.validation_rules    ?? {},
    conditional_rule:    f.conditional_rule    ?? null,
  };
}

function buildFieldIssueMap(issues: Issue[]): Record<string, Issue[]> {
  const map: Record<string, Issue[]> = {};
  for (const issue of issues) {
    if (issue.affected_field) {
      if (!map[issue.affected_field]) map[issue.affected_field] = [];
      map[issue.affected_field].push(issue);
    }
    if (issue.conflicting_field) {
      if (!map[issue.conflicting_field]) map[issue.conflicting_field] = [];
      map[issue.conflicting_field].push(issue);
    }
  }
  return map;
}

/* ══════════════════════════════════════════════════════════════════
   PAGE
══════════════════════════════════════════════════════════════════ */

export default function TemplateEditorPage() {
  const params     = useParams<{ cooperative_id: string; template_id: string }>();
  const router     = useRouter();
  const coopId     = params.cooperative_id;
  const templateId = params.template_id;

  /* ── Data fetching ── */
  const { template, loading, error, refresh } = useTemplate(coopId, templateId);

  /*
   * useSkeletonSchema replaces useModelFields.
   * Returns: skeletonField (system discriminator) + cooperative DFDs.
   * We refetch after a new DFD is registered from inside the builder.
   */
  const {
    schema,
    loading:  schemaLoading,
    error:    schemaError,
    refresh:  refreshSchema,
  } = useSkeletonSchema(coopId, template?.target_model ?? "");

  /* ── Mutation hooks ── */
  const templateMuts = useTemplateMutations(coopId);
  const fieldMuts    = useFieldMutations(coopId, templateId);
  const issueMuts    = useIssueMutations(coopId, templateId);

  /* ── Local state ── */
  const [localFields,     setLocalFields]     = useState<BuilderField[]>([]);
  const [issues,          setIssues]          = useState<Issue[]>([]);
  const [issuesPanelOpen, setIssuesPanelOpen] = useState(true);
  const [saveStatus,      setSaveStatus]      = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError,       setSaveError]       = useState<string | null>(null);
  const [confirmDelete,   setConfirmDelete]   = useState(false);
  const [deleting,        setDeleting]        = useState(false);

  /* Initialise local fields when template loads */
  useEffect(() => {
    if (template) {
      setLocalFields((template.fields ?? []).map(serverToBuilder));
      setIssues(template.issues ?? []);
    }
  }, [template?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ══════════════════════════════════════════════════════════════
     SAVE DRAFT
     Diffs local state against the server snapshot and syncs.
  ══════════════════════════════════════════════════════════════ */
  const handleSaveDraft = useCallback(
    async (current: BuilderField[]) => {
      setSaveStatus("saving");
      setSaveError(null);
      try {
        const serverFields = template?.fields ?? [];
        const serverIds    = new Set(serverFields.map((f) => f.id));
        const localIds     = new Set(current.map((f) => f.id));

        /* Delete fields removed locally */
        await Promise.all(
          serverFields
            .filter((f) => !localIds.has(f.id))
            .map((f) => fieldMuts.deleteField(f.id))
        );

        /* Create new fields (temp IDs start with "local_") */
        const toCreate = current.filter((f) => f.id.startsWith("local_"));
        const created  = await Promise.all(
          toCreate.map((f) => fieldMuts.addField(builderToServer(f)))
        );
        const idMap = new Map<string, string>(
          toCreate.map((f, i) => [f.id, created[i].id])
        );

        /* Update existing fields */
        await Promise.all(
          current
            .filter((f) => !f.id.startsWith("local_") && serverIds.has(f.id))
            .map((f) => fieldMuts.updateField(f.id, builderToServer(f)))
        );

        /* Reorder with resolved IDs */
        await fieldMuts.reorderFields(
          current.map((f, i) => ({
            id:          idMap.get(f.id) ?? f.id,
            field_order: i + 1,
          }))
        );

        // Persist the latest local snapshot so any remount (triggered by refresh/loading)
        // doesn't wipe the builder state. Also resolves temp local_* IDs to server UUIDs.
        setLocalFields(
          current.map((f) => ({
            ...f,
            id: idMap.get(f.id) ?? f.id,
          }))
        );

        await refresh();
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2500);
        return true;
      } catch (e: unknown) {
        setSaveError(e instanceof Error ? e.message : "Save failed");
        setSaveStatus("error");
        return false;
      }
    },
    [template, fieldMuts, refresh]
  );

  /* ══════════════════════════════════════════════════════════════
     VALIDATE
  ══════════════════════════════════════════════════════════════ */
  const handleValidate = useCallback(
    async (current: BuilderField[]) => {
      const saved = await handleSaveDraft(current);
      if (!saved) return;
      try {
        const result = await templateMuts.validateTemplate(templateId);
        setIssues(result.issues);
        setIssuesPanelOpen(true);
        await refresh();
      } catch (e: unknown) {
        setSaveError(e instanceof Error ? e.message : "Validation failed");
        setSaveStatus("error");
      }
    },
    [handleSaveDraft, templateMuts, templateId, refresh]
  );

  /* ══════════════════════════════════════════════════════════════
     ACTIVATE
  ══════════════════════════════════════════════════════════════ */
  const handleActivate = useCallback(async () => {
    try {
      await templateMuts.activateTemplate(templateId);
      router.push(`/crm/${coopId}/form-builder`);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Activation failed");
      setSaveStatus("error");
    }
  }, [templateMuts, templateId, coopId, router]);

  /* ══════════════════════════════════════════════════════════════
     DUPLICATE
  ══════════════════════════════════════════════════════════════ */
  const handleDuplicate = useCallback(async () => {
    try {
      const copy = await templateMuts.duplicateTemplate(templateId);
      router.push(`/crm/${coopId}/form-builder/${copy.id}`);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Duplicate failed");
      setSaveStatus("error");
    }
  }, [templateMuts, templateId, coopId, router]);

  const handleDelete = useCallback(() => {
    setConfirmDelete(true);
  }, []);

  const confirmDeleteTemplate = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await templateMuts.deleteTemplate(templateId);
      router.push(`/crm/${coopId}/form-builder`);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Delete failed");
      setSaveStatus("error");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [deleting, templateMuts, templateId, coopId, router]);

  /* ══════════════════════════════════════════════════════════════
     ACKNOWLEDGE ISSUE
  ══════════════════════════════════════════════════════════════ */
  const handleAcknowledge = useCallback(
    async (issueId: string) => {
      const { issue: updated } = await issueMuts.acknowledgeIssue(issueId);
      setIssues((prev) =>
        prev.map((i) => (i.id === issueId ? { ...i, ...updated } : i))
      );
    },
    [issueMuts]
  );

  /* ── Derived ── */
  const fieldIssueMap     = buildFieldIssueMap(issues);
  const hasBlockingErrors = issues.some((i) => i.severity === "ERROR");
  const pendingWarnings   = issues.filter(
    (i) => i.severity === "WARNING" && !i.is_acknowledged
  ).length;
  const canActivate = !hasBlockingErrors && pendingWarnings === 0 && localFields.length > 0;

  const statusCfg  = STATUS_CONFIG[template?.status ?? "DRAFT"];
  const StatusIcon = statusCfg.Icon;

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={28} className="animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading template…</p>
        </div>
      </div>
    );
  }

  /* ── Error ── */
  if (error || !template) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <AlertCircle size={32} className="mx-auto text-destructive" />
          <p className="text-sm font-semibold">{error ?? "Template not found"}</p>
          <Button variant="outline" onClick={() => router.back()}>Go back</Button>
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-background">

      {/* ── Sticky top bar ── */}
      <div className="bg-card border-b border-border sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={`/crm/${coopId}/form-builder`}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            >
              <ChevronLeft size={15} /> Templates
            </Link>
            <span className="text-muted-foreground/40">/</span>
            <p
              className="text-sm font-bold text-foreground truncate"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {template.name}
            </p>
            <Badge
              variant="outline"
              className={`text-[10px] h-5 px-2 flex items-center gap-1 flex-shrink-0 ${statusCfg.colour}`}
            >
              <StatusIcon size={9} />
              {statusCfg.label}
            </Badge>
            <span className="text-[10px] text-muted-foreground font-mono flex-shrink-0">
              v{template.version}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <AnimatePresence mode="wait">
              {saveStatus === "saving" && (
                <motion.span
                  key="saving"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="text-xs text-muted-foreground flex items-center gap-1"
                >
                  <Loader2 size={11} className="animate-spin" /> Saving…
                </motion.span>
              )}
              {saveStatus === "saved" && (
                <motion.span
                  key="saved"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="text-xs text-primary flex items-center gap-1"
                >
                  <CheckCircle2 size={11} /> Saved
                </motion.span>
              )}
              {saveStatus === "error" && (
                <motion.span
                  key="error"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="text-xs text-destructive flex items-center gap-1"
                >
                  <AlertCircle size={11} /> {saveError ?? "Error"}
                </motion.span>
              )}
            </AnimatePresence>
            <Button
              variant="outline" size="sm" className="gap-1.5 text-xs h-8"
              onClick={handleDuplicate}
            >
              <Copy size={13} /> Duplicate
            </Button>
            {template.status !== "ACTIVE" && (
              <Button
                variant="outline" size="sm" className="gap-1.5 text-xs h-8"
                onClick={handleDelete}
              >
                <Trash2 size={13} /> Delete
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Metadata bar ── */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center gap-6 text-xs text-muted-foreground flex-wrap">
          <div className="flex items-center gap-1.5">
            <BarChart3 size={11} />
            <span className="font-mono font-semibold text-foreground">{template.target_model}</span>
            <span>target model</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Layers size={11} />
            <span>{localFields.length} field{localFields.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <BookOpen size={11} />
            {schemaLoading ? (
              <span className="flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Loading registry…</span>
            ) : (
              <span>
                {schema?.cooperative_fields.length ?? 0} registered field{(schema?.cooperative_fields.length ?? 0) !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          {issues.length > 0 && (
            <div className="flex items-center gap-1.5">
              <ShieldCheck size={11} />
              <span>
                {issues.filter((i) => i.severity === "ERROR").length} errors,{" "}
                {issues.filter((i) => i.severity === "WARNING").length} warnings
              </span>
            </div>
          )}
          {template.description && (
            <span className="ml-auto italic text-muted-foreground/70 truncate max-w-xs">
              {template.description}
            </span>
          )}
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* Global error bar */}
        {saveError && saveStatus === "error" && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-xl px-4 py-3">
            <AlertCircle size={15} /> {saveError}
          </div>
        )}

        {/* Schema error banner */}
        {schemaError && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertCircle size={15} />
            <span>
              Could not load field registry: {schemaError}. The registry panel will be empty.
            </span>
          </div>
        )}

        {/* ── Builder ── */}
        <ShambaFormBuilder
          coopId={coopId}
          targetModel={template.target_model}
          templateName={template.name}
          skeletonField={schema?.skeleton_field ?? null}
          registryFields={schema?.cooperative_fields ?? []}
          initialFields={localFields}
          semanticIssues={issues}
          fieldIssueMap={fieldIssueMap}
          isValidating={templateMuts.validating}
          canActivate={canActivate}
          onSaveDraft={handleSaveDraft}
          onValidate={handleValidate}
          onActivate={handleActivate}
          onIgnoreIssue={handleAcknowledge}
          ignoringIssueId={issueMuts.acknowledging}
          onRegistryUpdate={refreshSchema}
        />

        {/* ── Issues panel ── */}
        <IssuesPanel
          issues={issues}
          isExpanded={issuesPanelOpen}
          onToggle={() => setIssuesPanelOpen((v) => !v)}
          onAcknowledge={handleAcknowledge}
          acknowledging={issueMuts.acknowledging}
        />

        {/* ── Activation panel ── */}
        {template.status !== "ACTIVE" && (
          <div
            className={`rounded-xl border p-5 ${
              canActivate
                ? "bg-primary/5 border-primary/20"
                : "bg-muted/30 border-border"
            }`}
          >
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    canActivate ? "bg-primary/10" : "bg-muted"
                  }`}
                >
                  <Zap size={15} className={canActivate ? "text-primary" : "text-muted-foreground"} />
                </div>
                <div>
                  <p
                    className="text-sm font-bold text-foreground"
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    {canActivate ? "Ready to activate" : "Not ready for activation"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {canActivate
                      ? "All issues resolved. Activation will make this template live for data entry."
                      : hasBlockingErrors
                      ? "Resolve all errors before activating."
                      : pendingWarnings > 0
                      ? "Ignore or resolve all warnings before activating."
                      : localFields.length === 0
                      ? "Add at least one field from the registry."
                      : "Run validation first."}
                  </p>
                </div>
              </div>
              <Button
                className="bg-primary hover:bg-primary/90 font-semibold gap-2"
                disabled={!canActivate || templateMuts.activating}
                onClick={handleActivate}
              >
                {templateMuts.activating
                  ? <><Loader2 size={14} className="animate-spin" /> Activating…</>
                  : <><CheckCircle2 size={14} /> Activate Template</>}
              </Button>
            </div>
          </div>
        )}

        {/* ── Active template notice ── */}
        {template.status === "ACTIVE" && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4 flex items-center gap-3">
            <CheckCircle2 size={16} className="text-primary flex-shrink-0" />
            <div>
              <p
                className="text-sm font-semibold text-foreground"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                Template is live
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                <span className="font-mono font-semibold">{template.target_model}</span> data
                entry is using this template. To make changes, duplicate and activate a new version.
              </p>
            </div>
            <Button
              variant="outline" size="sm"
              className="flex-shrink-0 gap-1.5"
              onClick={handleDuplicate}
            >
              <Copy size={13} /> Duplicate & Edit
            </Button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
            onClick={() => setConfirmDelete(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4"
            >
              <h3 className="font-bold text-foreground">Delete template?</h3>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{template.name}</span> will be permanently removed.
                This cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 rounded-lg border border-border py-2 text-sm text-foreground hover:bg-muted transition"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteTemplate}
                  disabled={deleting}
                  className="flex-1 rounded-lg bg-destructive hover:bg-destructive/90 py-2 text-sm font-semibold text-white transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting ? <><Loader2 size={13} className="animate-spin" /> Deleting...</> : "Delete"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
