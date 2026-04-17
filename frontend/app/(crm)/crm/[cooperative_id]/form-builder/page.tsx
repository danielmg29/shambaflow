"use client";

/**
 * ShambaFlow – Form Builder List Page  (v2)
 * Route: /crm/[cooperative_id]/form-builder
 *
 * What changed from v1:
 *  - Added "Field Registry" tab alongside "Templates"
 *  - Field Registry tab shows all DFDs per target model with full
 *    create / edit / deactivate capability
 *  - Templates tab is unchanged
 *  - Cooperatives are guided to register fields BEFORE building templates
 */

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Search, Copy, Archive, ChevronRight, FileText,
  Loader2, AlertCircle, CheckCircle2, Clock, Layers,
  ShieldAlert, Zap, BookOpen, Lock, Pencil, Trash2, X,
  Sparkles, Shield, ChevronDown,
} from "lucide-react";
import {
  useTemplates, useTemplateMutations,
  useFieldRegistry, useFieldRegistryMutations,
  usePreflightCheck,
  type Template, type TargetModel, type TemplateStatus,
  type DynamicFieldDefinition, type FieldTag, type DisplayType, type RegistrySemanticIssue,
} from "@/hooks/useFormBuilder";
import { Input }  from "@/components/ui/input";
import { Label }  from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge }  from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";

/* ══════════════════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════════════════ */

const STATUS_CONFIG: Record<TemplateStatus, { label: string; colour: string; Icon: React.ElementType }> = {
  DRAFT:      { label: "Draft",      colour: "text-muted-foreground",                               Icon: Clock        },
  VALIDATING: { label: "Validating", colour: "text-[var(--info)]",                                  Icon: Loader2      },
  HAS_ISSUES: { label: "Has Issues", colour: "text-[var(--warning)]",                               Icon: ShieldAlert  },
  ACTIVE:     { label: "Active",     colour: "text-primary",                                        Icon: CheckCircle2 },
  INACTIVE:   { label: "Inactive",   colour: "text-muted-foreground/60",                            Icon: Archive      },
};

const TARGET_COLOURS: Record<TargetModel, string> = {
  MEMBER:     "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  PRODUCTION: "bg-primary/10 text-primary border-primary/20",
  LIVESTOCK:  "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  GOVERNANCE: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
  FINANCE:    "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  LAND:       "bg-lime-500/10 text-lime-600 dark:text-lime-400 border-lime-500/20",
  HERD:       "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
};

const ALL_MODELS: TargetModel[] = ["MEMBER", "PRODUCTION", "LIVESTOCK", "GOVERNANCE", "FINANCE", "LAND", "HERD"];

const TARGET_MODELS: { value: TargetModel | ""; label: string }[] = [
  { value: "",           label: "All Models"  },
  { value: "MEMBER",     label: "Member"      },
  { value: "PRODUCTION", label: "Production"  },
  { value: "LIVESTOCK",  label: "Livestock"   },
  { value: "GOVERNANCE", label: "Governance"  },
  { value: "FINANCE",    label: "Finance"     },
  { value: "LAND",       label: "Land"        },
  { value: "HERD",       label: "Herd"        },
];

const STATUSES: { value: TemplateStatus | ""; label: string }[] = [
  { value: "",           label: "All Statuses" },
  { value: "ACTIVE",     label: "Active"       },
  { value: "DRAFT",      label: "Draft"        },
  { value: "HAS_ISSUES", label: "Has Issues"   },
  { value: "INACTIVE",   label: "Inactive"     },
];

const DISPLAY_TYPES: DisplayType[] = [
  "text", "textarea", "number", "decimal", "date", "datetime",
  "boolean", "dropdown", "multi_select", "gps", "file_upload",
];

const TAGS: FieldTag[] = ["CAPACITY", "GOVERNANCE", "FINANCIAL", "INFORMATIONAL"];

function RegistrySemanticPreview({ semanticIssues }: { semanticIssues: RegistrySemanticIssue[] }) {
  if (semanticIssues.length === 0) return null;

  return (
    <div className="space-y-2">
      {semanticIssues.map((issue, index) => {
        const isError = issue.severity === "ERROR";
        return (
          <div
            key={`${issue.issue_type}-${index}`}
            className={`rounded-lg border px-3 py-2 space-y-1 ${
              isError
                ? "border-destructive/30 bg-destructive/5"
                : "border-[var(--warning)]/30 bg-[var(--warning-light)]"
            }`}
          >
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={`text-[9px] px-1 h-4 ${
                  isError
                    ? "border-destructive/30 text-destructive"
                    : "border-[var(--warning)]/30 text-[var(--warning)]"
                }`}
              >
                {issue.severity}
              </Badge>
              <span className="text-[10px] font-semibold text-foreground">{issue.issue_type.replaceAll("_", " ")}</span>
            </div>
            <p className="text-xs text-foreground/85">{issue.description}</p>
            {issue.conflicting_labels.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {issue.conflicting_labels.map((label) => (
                  <span
                    key={label}
                    className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded border border-border"
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}
            {issue.suggestion && (
              <p className="text-[10px] text-muted-foreground">{issue.suggestion}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   TEMPLATE CARD
══════════════════════════════════════════════════════════════════ */

function TemplateCard({
  template, coopId, onDuplicate, onDeactivate, onDelete,
}: {
  template: Template; coopId: string;
  onDuplicate:  (id: string) => void;
  onDeactivate: (id: string) => void;
  onDelete:     (id: string) => void;
}) {
  const router     = useRouter();
  const statusCfg  = STATUS_CONFIG[template.status];
  const StatusIcon = statusCfg.Icon;
  const fieldCount = template.fields?.length ?? 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="group relative bg-card rounded-xl border border-border hover:border-primary/30 hover:shadow-sm transition-all duration-200 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-muted border border-border flex items-center justify-center flex-shrink-0 mt-0.5">
            <FileText size={16} className="text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground text-sm leading-snug truncate">{template.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              v{template.version}
              {fieldCount > 0 && <> · {fieldCount} field{fieldCount !== 1 ? "s" : ""}</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => onDuplicate(template.id)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition" title="Duplicate">
            <Copy size={14} />
          </button>
          {template.status === "ACTIVE" && (
            <button onClick={() => onDeactivate(template.id)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-[var(--warning)] hover:bg-[var(--warning-light)] opacity-0 group-hover:opacity-100 transition" title="Deactivate">
              <Archive size={14} />
            </button>
          )}
          {template.status !== "ACTIVE" && (
            <button onClick={() => onDelete(template.id)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition" title="Delete">
              <Trash2 size={14} />
            </button>
          )}
          <button onClick={() => router.push(`/crm/${coopId}/form-builder/${template.id}`)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition">
            Edit <ChevronRight size={12} />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-4 flex-wrap">
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${TARGET_COLOURS[template.target_model]}`}>
          {template.target_model}
        </span>
        <span className={`flex items-center gap-1 text-xs font-medium ${statusCfg.colour}`}>
          <StatusIcon size={11} /> {statusCfg.label}
        </span>
        {template.is_default && (
          <span className="flex items-center gap-1 text-xs font-medium text-primary">
            <Zap size={10} /> Default
          </span>
        )}
      </div>
      {template.description && (
        <p className="mt-3 text-xs text-muted-foreground leading-relaxed line-clamp-2">{template.description}</p>
      )}
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   CREATE TEMPLATE MODAL
══════════════════════════════════════════════════════════════════ */

function CreateModal({ coopId, onClose, onCreated }: {
  coopId: string; onClose: () => void; onCreated: (t: Template) => void;
}) {
  const { createTemplate } = useTemplateMutations(coopId);
  const [name,   setName]   = useState("");
  const [model,  setModel]  = useState<TargetModel>("MEMBER");
  const [desc,   setDesc]   = useState("");
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState("");

  const handleCreate = async () => {
    if (!name.trim()) { setErr("Name is required."); return; }
    setSaving(true); setErr("");
    try {
      const t = await createTemplate({ name: name.trim(), target_model: model, description: desc });
      onCreated(t);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to create.");
    } finally { setSaving(false); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
        <h2 className="text-lg font-bold text-foreground">New Form Template</h2>
        {err && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            <AlertCircle size={14} /> {err}
          </div>
        )}
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-foreground">Template Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="e.g. Seasonal Harvest Record"
            className="w-full rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-foreground">Target Model</label>
          <select value={model} onChange={(e) => setModel(e.target.value as TargetModel)}
            className="w-full rounded-lg border border-input bg-background text-foreground px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            {TARGET_MODELS.filter((m) => m.value).map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-foreground">
            Description <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2}
            placeholder="What is this template for?"
            className="w-full rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted transition">
            Cancel
          </button>
          <button onClick={handleCreate} disabled={saving}
            className="flex-1 rounded-lg bg-primary hover:bg-primary/90 py-2.5 text-sm font-bold text-primary-foreground transition disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <><Loader2 size={14} className="animate-spin" /> Creating…</> : "Create Template"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   REGISTER / EDIT FIELD MODAL  (Field Registry)
══════════════════════════════════════════════════════════════════ */

function FieldModal({
  coopId,
  targetModel,
  editing,
  onClose,
  onSaved,
}: {
  coopId:      string;
  targetModel: TargetModel;
  editing:     DynamicFieldDefinition | null;
  onClose:     () => void;
  onSaved:     () => void;
}) {
  const { registerField, updateField, saving } = useFieldRegistryMutations();

  const [label,       setLabel]       = useState(editing?.label       ?? "");
  const [displayType, setDisplayType] = useState<DisplayType>(editing?.display_type ?? "text");
  const [tag,         setTag]         = useState<FieldTag>(editing?.tag ?? "INFORMATIONAL");
  const [isRequired,  setIsRequired]  = useState(editing?.is_required  ?? false);
  const [helpText,    setHelpText]    = useState(editing?.help_text    ?? "");
  const [options,     setOptions]     = useState<string[]>(editing?.options ?? []);
  const [newOpt,      setNewOpt]      = useState("");
  const [serverError, setServerError] = useState("");
  const [validationRequested, setValidationRequested] = useState(false);

  const isEditing  = !!editing;
  const isLocked   = editing?.is_locked ?? false;

  /* Pre-flight check — only for new fields or label changes */
  const { result: conflict, checking } = usePreflightCheck(
    coopId, targetModel, label, displayType,
    editing?.id, // exclude self when editing
  );

  const addOpt = () => {
    const v = newOpt.trim();
    if (v) {
      setValidationRequested(false);
      setOptions((p) => [...p, v]);
      setNewOpt("");
    }
  };

  const handleSave = async () => {
    if (!label.trim()) { setServerError("Label is required."); return; }
    if (conflict && !conflict.can_save) return;
    setServerError("");
    try {
      if (isEditing) {
        await updateField(editing.id, {
          label, display_type: displayType, tag,
          is_required: isRequired, help_text: helpText, options,
        });
      } else {
        await registerField({
          cooperative_id: coopId, target_model: targetModel,
          label: label.trim(), display_type: displayType, tag,
          is_required: isRequired, help_text: helpText, options,
        });
      }
      onSaved();
    } catch (e: unknown) {
      setServerError(e instanceof Error ? e.message : "Failed to save field.");
    }
  };

  const needsOptions = displayType === "dropdown" || displayType === "multi_select";

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground">
              {isEditing ? "Edit Field" : "Register Field"}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="font-mono font-semibold text-foreground">{targetModel}</span> registry
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition">
            <X size={16} />
          </button>
        </div>

        {isLocked && (
          <div className="flex items-start gap-2 text-xs bg-muted/40 border border-border rounded-lg px-3 py-2">
            <Lock size={12} className="mt-0.5 text-muted-foreground flex-shrink-0" />
            <span className="text-muted-foreground">
              This field has been used in submissions. The field key is locked and cannot be changed.
              You can still edit the label, help text, options, and other display properties.
            </span>
          </div>
        )}

        {serverError && (
          <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        {/* Label */}
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Label <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Input
              value={label}
              onChange={(e) => { setLabel(e.target.value); setServerError(""); setValidationRequested(false); }}
              placeholder="e.g. First Name, Harvest Weight (kg)"
              className={`h-9 text-sm pr-8 ${conflict && !conflict.can_save ? "border-destructive focus-visible:ring-destructive" : ""}`}
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
              {checking && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
              {!checking && conflict && !conflict.can_save && <AlertCircle size={13} className="text-destructive" />}
              {!checking && conflict && conflict.can_save && label.trim().length >= 2 && (
                <CheckCircle2 size={13} className="text-primary" />
              )}
            </div>
          </div>
          {conflict?.semantic_issues?.length ? (
            <RegistrySemanticPreview semanticIssues={conflict.semantic_issues} />
          ) : null}
          {conflict?.suggested_key && label.trim().length >= 2 && (
            <p className="text-[10px] text-muted-foreground">
              Key: <span className="font-mono">{editing?.field_key ?? conflict.suggested_key}</span>
              {isLocked && <Lock size={9} className="inline ml-1 text-muted-foreground" />}
            </p>
          )}
          {conflict?.warning_count ? (
            <p className="text-[10px] text-muted-foreground">
              {conflict.warning_count} warning{conflict.warning_count !== 1 ? "s" : ""} can be ignored if the label is intentional.
            </p>
          ) : null}
          {validationRequested && conflict ? (
            <p className={`text-[10px] ${conflict.can_save ? "text-primary" : "text-destructive"}`}>
              {conflict.can_save
                ? conflict.warning_count > 0
                  ? `Validated with ${conflict.warning_count} warning${conflict.warning_count !== 1 ? "s" : ""}.`
                  : "Validated. No field-level semantic issues found."
                : "Validation found blocking field-level issues."}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Field Type</Label>
            <Select value={displayType} onValueChange={(v) => { setDisplayType(v as DisplayType); setValidationRequested(false); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DISPLAY_TYPES.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Tag</Label>
            <Select value={tag} onValueChange={(v) => setTag(v as FieldTag)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TAGS.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Help Text <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Input value={helpText} onChange={(e) => setHelpText(e.target.value)}
            placeholder="Guidance for data entry staff…" className="h-8 text-sm" />
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
          <p className="text-xs font-semibold text-foreground">Required by default</p>
          <button onClick={() => setIsRequired((v) => !v)}
            className={`w-9 h-5 rounded-full transition-colors ${isRequired ? "bg-primary" : "bg-muted border border-border"}`}>
            <div className={`w-4 h-4 rounded-full bg-card shadow-sm transition-transform mx-0.5 ${isRequired ? "translate-x-4" : "translate-x-0"}`} />
          </button>
        </div>

        {needsOptions && (
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Options</Label>
            <div className="space-y-1.5">
              {options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50 border border-border group">
                  <span className="text-xs flex-1">{opt}</span>
                  <button onClick={() => setOptions((p) => p.filter((_, i) => i !== idx))}
                    className="p-0.5 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition">
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={newOpt} onChange={(e) => setNewOpt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOpt(); } }}
                placeholder="Add option…" className="h-7 text-xs" />
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={addOpt}>
                <Plus size={11} />
              </Button>
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button
            onClick={() => setValidationRequested(true)}
            disabled={checking || !label.trim()}
            className="rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition disabled:opacity-50"
          >
            {checking ? "Validating…" : "Validate"}
          </button>
          <button onClick={onClose} className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted transition">
            Cancel
          </button>
          <button onClick={handleSave}
            disabled={saving || (conflict ? !conflict.can_save : false) || !label.trim()}
            className="flex-1 rounded-lg bg-primary hover:bg-primary/90 py-2.5 text-sm font-bold text-primary-foreground transition disabled:opacity-50 flex items-center justify-center gap-2">
            {saving
              ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
              : isEditing ? "Save Changes" : <><Sparkles size={14} /> Register Field</>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   FIELD REGISTRY TAB
══════════════════════════════════════════════════════════════════ */

function FieldRegistryTab({ coopId }: { coopId: string }) {
  const [activeModel,   setActiveModel]   = useState<TargetModel>("MEMBER");
  const [showModal,     setShowModal]     = useState(false);
  const [editingField,  setEditingField]  = useState<DynamicFieldDefinition | null>(null);
  const [confirmDeact,  setConfirmDeact]  = useState<DynamicFieldDefinition | null>(null);

  const { fields, loading, error, refresh } = useFieldRegistry(coopId, activeModel, { include_inactive: true });
  const { deactivateField, deactivating }   = useFieldRegistryMutations();

  const active   = fields.filter((f) => f.is_active);
  const inactive = fields.filter((f) => !f.is_active);

  const handleDeactivate = async (dfd: DynamicFieldDefinition) => {
    await deactivateField(dfd.id);
    setConfirmDeact(null);
    refresh();
  };

  return (
    <div className="space-y-5">
      {/* Model tabs */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {ALL_MODELS.map((m) => (
          <button
            key={m}
            onClick={() => setActiveModel(m)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeModel === m
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Header for current model */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-foreground">
            {activeModel} Fields
          </h3>
          <p className="text-xs text-muted-foreground">
            {active.length} active · {inactive.length} inactive
          </p>
        </div>
        <button
          onClick={() => { setEditingField(null); setShowModal(true); }}
          className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground px-3 py-2 rounded-lg text-xs font-bold transition"
        >
          <Plus size={13} /> Register Field
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-primary" size={24} />
        </div>
      )}
      {!loading && error && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {!loading && !error && active.length === 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="text-center py-14 space-y-3">
          <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mx-auto">
            <BookOpen size={24} className="text-muted-foreground/40" />
          </div>
          <div>
            <p className="font-semibold text-foreground text-sm">No fields registered yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Register the fields your cooperative needs to collect for{" "}
              <span className="font-mono">{activeModel}</span> records.
            </p>
          </div>
          <button
            onClick={() => { setEditingField(null); setShowModal(true); }}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-xs font-semibold hover:bg-primary/90 transition"
          >
            <Sparkles size={13} /> Register First Field
          </button>
        </motion.div>
      )}

      {/* Skeleton field notice */}
      {!loading && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/20 bg-primary/5">
          <Shield size={14} className="text-primary flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-foreground">System field included automatically</p>
            <p className="text-[10px] text-muted-foreground">
              Every {activeModel} record always includes the system discriminator field.
              It cannot be removed or edited.
            </p>
          </div>
        </div>
      )}

      {/* Active fields */}
      {active.length > 0 && (
        <div className="space-y-2">
          {active.map((dfd) => (
            <FieldRow
              key={dfd.id}
              dfd={dfd}
              onEdit={() => { setEditingField(dfd); setShowModal(true); }}
              onDeactivate={() => setConfirmDeact(dfd)}
              deactivating={deactivating === dfd.id}
            />
          ))}
        </div>
      )}

      {/* Inactive fields (collapsed) */}
      {inactive.length > 0 && (
        <details className="group">
          <summary className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none py-2">
            <ChevronDown size={13} className="group-open:rotate-180 transition-transform" />
            {inactive.length} deactivated field{inactive.length !== 1 ? "s" : ""}
            <span className="text-[10px]">(keys preserved)</span>
          </summary>
          <div className="space-y-2 mt-2">
            {inactive.map((dfd) => (
              <FieldRow key={dfd.id} dfd={dfd} inactive />
            ))}
          </div>
        </details>
      )}

      {/* Register / Edit modal */}
      <AnimatePresence>
        {showModal && (
          <FieldModal
            coopId={coopId}
            targetModel={activeModel}
            editing={editingField}
            onClose={() => { setShowModal(false); setEditingField(null); }}
            onSaved={() => { setShowModal(false); setEditingField(null); refresh(); }}
          />
        )}
      </AnimatePresence>

      {/* Deactivate confirm */}
      <AnimatePresence>
        {confirmDeact && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setConfirmDeact(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
              <h3 className="font-bold text-foreground">Deactivate field?</h3>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{confirmDeact.label}</span> will be hidden from new templates.
                The key <span className="font-mono">{confirmDeact.field_key}</span> is preserved permanently — historical data remains intact.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDeact(null)}
                  className="flex-1 rounded-lg border border-border py-2 text-sm text-foreground hover:bg-muted transition">
                  Cancel
                </button>
                <button
                  onClick={() => handleDeactivate(confirmDeact)}
                  disabled={deactivating === confirmDeact.id}
                  className="flex-1 rounded-lg bg-destructive hover:bg-destructive/90 py-2 text-sm font-semibold text-white transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deactivating === confirmDeact.id
                    ? <><Loader2 size={13} className="animate-spin" /> Deactivating…</>
                    : "Deactivate"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FieldRow({
  dfd, onEdit, onDeactivate, deactivating, inactive,
}: {
  dfd:           DynamicFieldDefinition;
  onEdit?:       () => void;
  onDeactivate?: () => void;
  deactivating?: boolean;
  inactive?:     boolean;
}) {
  const TAG_COLOURS: Record<FieldTag, string> = {
    CAPACITY:      "bg-primary/10 text-primary border-primary/20",
    GOVERNANCE:    "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
    FINANCIAL:     "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    INFORMATIONAL: "bg-muted text-muted-foreground border-border",
  };

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border bg-card group transition ${
      inactive ? "opacity-50 border-border/50" : "border-border hover:border-primary/20"
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-foreground">{dfd.label}</p>
          {dfd.is_locked && <Lock size={10} className="text-muted-foreground/60" />}
          {dfd.is_required && (
            <span className="text-[9px] font-bold text-destructive">REQUIRED</span>
          )}
          {inactive && <Badge variant="outline" className="text-[9px] h-4 px-1">INACTIVE</Badge>}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-[10px] font-mono text-muted-foreground">{dfd.field_key}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-[10px] text-muted-foreground">{dfd.display_type}</span>
          <Badge variant="outline" className={`text-[9px] h-3.5 px-1 ${TAG_COLOURS[dfd.tag]}`}>
            {dfd.tag}
          </Badge>
        </div>
        {dfd.help_text && (
          <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1">{dfd.help_text}</p>
        )}
      </div>
      {!inactive && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          <button onClick={onEdit} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition" title="Edit">
            <Pencil size={13} />
          </button>
          <button onClick={onDeactivate} disabled={deactivating}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition disabled:opacity-50" title="Deactivate">
            {deactivating ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          </button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   PAGE
══════════════════════════════════════════════════════════════════ */

export default function FormBuilderListPage() {
  const params = useParams<{ cooperative_id: string }>();
  const router = useRouter();
  const coopId = params.cooperative_id;

  const [tab,          setTab]          = useState<"templates" | "registry">("templates");
  const [search,       setSearch]       = useState("");
  const [modelFilter,  setModelFilter]  = useState<TargetModel | "">("");
  const [statusFilter, setStatusFilter] = useState<TemplateStatus | "">("");
  const [showCreate,   setShowCreate]   = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { templates, loading, error, refresh, setTemplates } = useTemplates(coopId, {
    target_model: modelFilter || undefined,
    status:       statusFilter || undefined,
  });
  const { duplicateTemplate, updateTemplate, deleteTemplate } = useTemplateMutations(coopId);

  const handleDuplicate = useCallback(async (id: string) => {
    try {
      const copy = await duplicateTemplate(id);
      setTemplates((prev) => [copy, ...prev]);
      router.push(`/crm/${coopId}/form-builder/${copy.id}`);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : "Failed to duplicate."); }
  }, [duplicateTemplate, coopId, router, setTemplates]);

  const handleDeactivate = useCallback(async (id: string) => {
    if (!confirm("Deactivate this template? Data entry will stop using it.")) return;
    try { await updateTemplate(id, {}); refresh(); }
    catch (e: unknown) { alert(e instanceof Error ? e.message : "Failed to deactivate."); }
  }, [updateTemplate, refresh]);

  const handleDelete = useCallback((template: Template) => {
    setConfirmDelete(template);
  }, []);

  const confirmDeleteTemplate = useCallback(async () => {
    if (!confirmDelete || deleting) return;
    const id = confirmDelete.id;
    setDeleting(true);
    try {
      await deleteTemplate(id);
      // Adaptive convergence: update local list immediately, then reconcile with server.
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      setConfirmDelete(null);
      refresh();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to delete.");
      refresh();
    } finally {
      setDeleting(false);
    }
  }, [confirmDelete, deleteTemplate, deleting, refresh, setTemplates]);

  const filtered = templates.filter((t) => !search || t.name.toLowerCase().includes(search.toLowerCase()));
  const active   = filtered.filter((t) => t.status === "ACTIVE");
  const drafts   = filtered.filter((t) => ["DRAFT", "HAS_ISSUES", "VALIDATING"].includes(t.status));
  const inactive = filtered.filter((t) => t.status === "INACTIVE");

  const selectCls = "rounded-xl border border-input bg-background text-foreground text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">Form Builder</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Define your cooperative&apos;s fields, then build collection templates
            </p>
          </div>
          {tab === "templates" ? (
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2.5 rounded-xl text-sm font-bold transition">
              <Plus size={16} /> New Template
            </button>
          ) : null}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">

        {/* Tab bar */}
        <div className="flex items-center gap-1 p-1 bg-muted rounded-xl w-fit">
          <button
            onClick={() => setTab("templates")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
              tab === "templates"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText size={14} /> Templates
          </button>
          <button
            onClick={() => setTab("registry")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
              tab === "registry"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <BookOpen size={14} /> Field Registry
          </button>
        </div>

        {/* ── Templates tab ── */}
        {tab === "templates" && (
          <div className="space-y-5">
            {/* Filter bar */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates…"
                  className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value as TargetModel | "")} className={selectCls}>
                {TARGET_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TemplateStatus | "")} className={selectCls}>
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            {loading && <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-primary" size={28} /></div>}
            {!loading && error && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3">
                <AlertCircle size={16} /> {error}
              </div>
            )}
            {!loading && !error && filtered.length === 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20 space-y-4">
                <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mx-auto">
                  <Layers size={28} className="text-muted-foreground/50" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">No templates found</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {search ? "Try a different search term." : "Register your fields first, then create a template."}
                  </p>
                </div>
                {!search && (
                  <div className="flex items-center gap-3 justify-center">
                    <button onClick={() => setTab("registry")}
                      className="inline-flex items-center gap-2 border border-border text-foreground px-4 py-2 rounded-lg text-sm font-semibold hover:bg-muted transition">
                      <BookOpen size={14} /> Open Field Registry
                    </button>
                    <button onClick={() => setShowCreate(true)}
                      className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 transition">
                      <Plus size={14} /> Create Template
                    </button>
                  </div>
                )}
              </motion.div>
            )}
            {!loading && !error && filtered.length > 0 && (
              <div className="space-y-8">
                {[
                  { label: "Active",               items: active,   colour: "text-primary" },
                  { label: "Drafts & In-progress", items: drafts,   colour: "text-muted-foreground" },
                  { label: "Inactive",             items: inactive, colour: "text-muted-foreground/60" },
                ].filter((g) => g.items.length > 0).map((group) => (
                  <div key={group.label}>
                    <h2 className={`text-xs font-bold uppercase tracking-widest mb-3 ${group.colour}`}>
                      {group.label} ({group.items.length})
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <AnimatePresence>
                        {group.items.map((t) => (
                          <TemplateCard key={t.id} template={t} coopId={coopId}
                            onDuplicate={handleDuplicate} onDeactivate={handleDeactivate} onDelete={() => handleDelete(t)} />
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Field Registry tab ── */}
        {tab === "registry" && <FieldRegistryTab coopId={coopId} />}
      </div>

      <AnimatePresence>
        {showCreate && (
          <CreateModal coopId={coopId} onClose={() => setShowCreate(false)}
            onCreated={(t) => { setTemplates((prev) => [t, ...prev]); setShowCreate(false); router.push(`/crm/${coopId}/form-builder/${t.id}`); }} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
            onClick={() => setConfirmDelete(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4"
            >
              <h3 className="font-bold text-foreground">Delete template?</h3>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{confirmDelete.name}</span> will be permanently removed.
                This cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDelete(null)}
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
