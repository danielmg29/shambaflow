"use client";

/**
 * ShambaFormBuilder — Visual Form Template Editor  (v2)
 * =====================================================
 * Architecture change from v1:
 *
 * v1: User added blank fields and mapped them to Django model columns.
 *     "Maps to Model Field" was a dropdown of CharField, DecimalField, etc.
 *
 * v2: User picks from their cooperative's Field Registry (DynamicFieldDefinitions).
 *     Fields are BORN in the Registry, not in the template editor.
 *     The template editor only decides WHICH registered fields to include
 *     and template-level overrides (required, placeholder, help_text,
 *     conditional visibility).
 *
 * Flow:
 *   1. User opens template editor.
 *   2. Right panel shows the Field Registry for this target model.
 *      — Skeleton field (system, always first, cannot be removed)
 *      — Cooperative-defined DFDs (registered via the Field Registry page)
 *   3. User clicks a DFD → it appears in the field list.
 *   4. Clicking a field pill opens the config panel for template-level tweaks.
 *   5. DFD label / type are shown but NOT editable here (edit in Registry).
 *   6. "Register New Field" button opens a modal calling POST /dynamic-fields/
 *      with pre-flight duplicate check as the user types.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge }    from "@/components/ui/badge";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Label }    from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  GripVertical, Plus, Trash2, Eye, Save, ShieldAlert, AlertTriangle,
  CheckCircle2, Settings2, Type, Hash, Calendar, ToggleLeft, List,
  MapPin, Upload, X, ChevronsUpDown, SlidersHorizontal, Lock,
  Shield, Loader2, AlertCircle, BookOpen, Sparkles, Pencil,
} from "lucide-react";

import type { Issue, DynamicFieldDefinition, SkeletonField, FieldTag,
              DisplayType, ValidationRules, ConflictResult, RegistrySemanticIssue } from "@/hooks/useFormBuilder";
import { usePreflightCheck, useFieldRegistryMutations,
         type TargetModel, type RegisterFieldPayload } from "@/hooks/useFormBuilder";

export type { DisplayType, FieldTag, ValidationRules };

/* ══════════════════════════════════════════════════════════════════
   TYPES
══════════════════════════════════════════════════════════════════ */

export interface ConditionalRule {
  show_when_field: string;
  show_when_value: string;
}

/**
 * BuilderField — one entry in the template's field list.
 *
 * Key differences from v1:
 *  - maps_to_model_field  → field_key  (a DFD.field_key or skeleton key)
 *  - dfd_id added         (null for the skeleton field)
 *  - is_system added      (true for the skeleton discriminator)
 *  - label / display_type come FROM the DFD and are display-only in this editor
 */
export interface BuilderField {
  id:           string;    // local "local_N" or server UUID
  dfd_id:       string | null;
  field_key:    string;    // DFD.field_key or skeleton discriminator key
  label:        string;    // from DFD (display only here)
  display_type: DisplayType;
  tag:          FieldTag;
  is_system:    boolean;   // true = skeleton discriminator (first, non-removable)
  is_locked:    boolean;   // from DFD — informational
  // Template-level overrides (user can set these per-template)
  is_required:      boolean;
  placeholder?:     string;
  help_text?:       string;
  options?:         string[];
  validation_rules?: ValidationRules;
  conditional_rule?: ConditionalRule | null;
}

export interface ShambaFormBuilderProps {
  coopId:          string;
  targetModel:     TargetModel;
  templateName:    string;
  /** Skeleton field for this target model (from useSkeletonSchema) */
  skeletonField:   SkeletonField | null;
  /** Cooperative's registered DFDs for this target model */
  registryFields:  DynamicFieldDefinition[];
  /** Current fields in the template */
  initialFields?:  BuilderField[];
  semanticIssues?: Issue[];
  fieldIssueMap?:  Record<string, Issue[]>;
  isValidating?:   boolean;
  canActivate?:    boolean;
  onSaveDraft?:    (fields: BuilderField[]) => void;
  onValidate?:     (fields: BuilderField[]) => void;
  onActivate?:     () => void;
  onIgnoreIssue?:  (issueId: string) => void;
  ignoringIssueId?: string | null;
  /** Called after a new DFD is registered so parent can refresh registry */
  onRegistryUpdate?: () => void;
}

/* ══════════════════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════════════════ */

const TYPE_ICONS: Partial<Record<DisplayType, React.ElementType>> = {
  text:         Type,
  textarea:     Type,
  number:       Hash,
  decimal:      Hash,
  date:         Calendar,
  datetime:     Calendar,
  boolean:      ToggleLeft,
  dropdown:     List,
  multi_select: List,
  gps:          MapPin,
  file_upload:  Upload,
  relation:     BookOpen,
};

const TAG_COLORS: Record<FieldTag, string> = {
  CAPACITY:      "bg-primary/10 text-primary border-primary/20",
  GOVERNANCE:    "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
  FINANCIAL:     "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  INFORMATIONAL: "bg-muted text-muted-foreground border-border",
};

const DISPLAY_TYPES: DisplayType[] = [
  "text", "textarea", "number", "decimal", "date", "datetime",
  "boolean", "dropdown", "multi_select", "gps", "file_upload",
];

const TAGS: FieldTag[] = ["CAPACITY", "GOVERNANCE", "FINANCIAL", "INFORMATIONAL"];

function RegistrySemanticPreview({
  semanticIssues,
}: {
  semanticIssues: RegistrySemanticIssue[];
}) {
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
   FIELD PILL
══════════════════════════════════════════════════════════════════ */

function FieldPill({
  field, isSelected, issues, onSelect, onRemove,
}: {
  field:      BuilderField;
  isSelected: boolean;
  issues?:    Issue[];
  onSelect:   () => void;
  onRemove:   () => void;
}) {
  const Icon       = TYPE_ICONS[field.display_type] ?? Type;
  const hasError   = issues?.some((i) => i.severity === "ERROR");
  const hasWarning = issues?.some((i) => i.severity === "WARNING" && !i.is_acknowledged);
  const issueCount = issues?.filter((i) => !i.is_acknowledged).length ?? 0;

  return (
    <Reorder.Item value={field} className="list-none" drag={!field.is_system}>
      <div
        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-150 ${
          field.is_system
            ? "border-primary/30 bg-primary/5 cursor-default"
            : isSelected
            ? "border-primary bg-primary/5 shadow-sm"
            : hasError
            ? "border-destructive/30 bg-destructive/[0.02] hover:border-destructive/50"
            : hasWarning
            ? "border-[var(--warning)]/40 bg-[var(--warning-light)] hover:border-[var(--warning)]/60"
            : "border-border bg-card hover:border-primary/30 hover:bg-muted/30"
        }`}
        onClick={field.is_system ? undefined : onSelect}
      >
        {/* Drag handle — hidden for system fields */}
        {field.is_system ? (
          <Shield size={15} className="text-primary/60 flex-shrink-0" />
        ) : (
          <GripVertical size={15} className="text-muted-foreground/50 flex-shrink-0 cursor-grab active:cursor-grabbing" />
        )}

        {/* Type icon */}
        <div className={`relative w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
          field.is_system
            ? "bg-primary text-white"
            : isSelected
            ? "bg-primary text-white"
            : "bg-muted text-muted-foreground"
        }`}>
          <Icon size={13} />
          {issueCount > 0 && (
            <span className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold text-white ${
              hasError ? "bg-destructive" : "bg-[var(--warning)]"
            }`}>
              {issueCount}
            </span>
          )}
        </div>

        {/* Label + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold text-foreground truncate" style={{ fontFamily: "var(--font-sans)" }}>
              {field.label}
            </p>
            {field.is_system && (
              <span className="text-[9px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                SYSTEM
              </span>
            )}
            {field.is_required && !field.is_system && (
              <span className="text-[9px] font-bold text-destructive">REQUIRED</span>
            )}
            {field.is_locked && !field.is_system && (
              <Lock size={9} className="text-muted-foreground/60" />
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] text-muted-foreground">{field.display_type}</span>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-[10px] text-muted-foreground font-mono">{field.field_key}</span>
            <Badge variant="outline" className={`text-[9px] px-1 h-3.5 ml-auto ${TAG_COLORS[field.tag]}`}>
              {field.tag}
            </Badge>
          </div>
        </div>

        {/* Remove — disabled for system fields */}
        {!field.is_system && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </Reorder.Item>
  );
}

/* ══════════════════════════════════════════════════════════════════
   TEMPLATE-LEVEL CONFIG PANEL
   (Only overrides — label/type come from the DFD and are read-only)
══════════════════════════════════════════════════════════════════ */

function FieldConfigPanel({
  field,
  allFields,
  onChange,
  issues = [],
  onIgnoreIssue,
  ignoringIssueId,
  onEditRegistryField,
}: {
  field:     BuilderField;
  allFields: BuilderField[];
  onChange:  (updated: BuilderField) => void;
  issues?:   Issue[];
  onIgnoreIssue?: (issueId: string) => void;
  ignoringIssueId?: string | null;
  onEditRegistryField?: () => void;
}) {
  const [newOption, setNewOption] = useState("");
  const update = (patch: Partial<BuilderField>) => onChange({ ...field, ...patch });
  const updateRules = (patch: Partial<ValidationRules>) =>
    update({ validation_rules: { ...(field.validation_rules ?? {}), ...patch } });

  const addOption = () => {
    const val = newOption.trim();
    if (!val) return;
    update({ options: [...(field.options ?? []), val] });
    setNewOption("");
  };
  const removeOption = (idx: number) =>
    update({ options: (field.options ?? []).filter((_, i) => i !== idx) });

  const needsOptions    = field.display_type === "dropdown" || field.display_type === "multi_select";
  const needsNumeric    = field.display_type === "number"   || field.display_type === "decimal";
  const needsLength     = field.display_type === "text"     || field.display_type === "textarea";
  const otherFields     = allFields.filter((f) => f.id !== field.id && !f.is_system);
  const relevantIssues  = issues.filter(
    (issue) =>
      issue.affected_field === field.id || issue.conflicting_field === field.id
  );

  return (
    <div className="space-y-4 p-4 overflow-y-auto max-h-[calc(100vh-200px)]">
      <div className="flex items-center gap-2">
        <Settings2 size={15} className="text-primary" />
        <h3 className="text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
          Template Overrides
        </h3>
      </div>

      {/* DFD identity — read-only */}
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            From Field Registry
          </p>
          {onEditRegistryField && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px] gap-1"
              onClick={onEditRegistryField}
            >
              <Pencil size={10} /> Edit registry field
            </Button>
          )}
        </div>
        <p className="text-sm font-semibold text-foreground">{field.label}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono text-muted-foreground">{field.field_key}</span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] text-muted-foreground">{field.display_type}</span>
          {field.is_locked && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <Lock size={9} /> locked
            </span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground italic">
          Edit the label and type in the Field Registry.
        </p>
      </div>

      {relevantIssues.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Semantic Notes</Label>
          <div className="space-y-2">
            {relevantIssues.map((issue) => {
              const isError = issue.severity === "ERROR";
              return (
                <div
                  key={issue.id}
                  className={`rounded-lg border px-3 py-2.5 space-y-2 ${
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
                    <span className="text-[10px] font-semibold text-foreground">
                      {issue.issue_type.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="text-xs text-foreground/85">{issue.description}</p>
                  {issue.suggestion && (
                    <p className="text-[10px] text-muted-foreground">{issue.suggestion}</p>
                  )}
                  {!isError && !issue.is_acknowledged && onIgnoreIssue && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px] gap-1 border-[var(--warning)]/40 text-[var(--warning)] hover:bg-[var(--warning-light)]"
                      onClick={() => onIgnoreIssue(issue.id)}
                      disabled={ignoringIssueId === issue.id}
                    >
                      {ignoringIssueId === issue.id ? (
                        <><Loader2 size={10} className="animate-spin" /> Ignoring…</>
                      ) : (
                        <><CheckCircle2 size={10} /> Ignore warning</>
                      )}
                    </Button>
                  )}
                  {!isError && issue.is_acknowledged && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <CheckCircle2 size={10} className="text-primary" /> Ignored for this template
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Required override */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
        <div>
          <p className="text-xs font-semibold text-foreground">Required in this template</p>
          <p className="text-[10px] text-muted-foreground">
            Override the registry default for this template only.
          </p>
        </div>
        <button
          onClick={() => update({ is_required: !field.is_required })}
          className={`w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
            field.is_required ? "bg-primary" : "bg-muted border border-border"
          }`}
        >
          <div className={`w-4 h-4 rounded-full bg-card shadow-sm transition-transform mx-0.5 ${
            field.is_required ? "translate-x-4" : "translate-x-0"
          }`} />
        </button>
      </div>

      {/* Placeholder override */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Placeholder <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Input
          value={field.placeholder ?? ""}
          onChange={(e) => update({ placeholder: e.target.value })}
          placeholder="Hint shown inside the input…"
          className="h-8 text-sm"
        />
      </div>

      {/* Help text override */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Help Text <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Input
          value={field.help_text ?? ""}
          onChange={(e) => update({ help_text: e.target.value })}
          placeholder="Displayed below the input…"
          className="h-8 text-sm"
        />
      </div>

      {/* Options override (dropdown/multi_select) */}
      {needsOptions && (
        <div className="space-y-2">
          <Label className="text-xs font-semibold flex items-center gap-1.5">
            <ChevronsUpDown size={11} /> Options Override
          </Label>
          <p className="text-[10px] text-muted-foreground">
            Overrides the registry options for this template only. Leave empty to use registry defaults.
          </p>
          <div className="space-y-1.5">
            {(field.options ?? []).map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50 border border-border group">
                <span className="text-xs flex-1 truncate">{opt}</span>
                <button onClick={() => removeOption(idx)} className="p-0.5 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition">
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newOption}
              onChange={(e) => setNewOption(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOption(); } }}
              placeholder="Add option…"
              className="h-7 text-xs"
            />
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={addOption}>
              <Plus size={11} />
            </Button>
          </div>
        </div>
      )}

      {/* Validation overrides */}
      {(needsNumeric || needsLength) && (
        <div className="space-y-2">
          <Label className="text-xs font-semibold flex items-center gap-1.5">
            <SlidersHorizontal size={11} /> Validation Overrides
          </Label>
          {needsNumeric && (
            <div className="grid grid-cols-2 gap-2">
              {(["min_value", "max_value"] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">{key === "min_value" ? "Min" : "Max"}</Label>
                  <Input
                    type="number"
                    value={field.validation_rules?.[key] ?? ""}
                    onChange={(e) => updateRules({ [key]: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="—"
                    className="h-7 text-xs"
                  />
                </div>
              ))}
            </div>
          )}
          {needsLength && (
            <div className="grid grid-cols-2 gap-2">
              {(["min_length", "max_length"] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">{key === "min_length" ? "Min length" : "Max length"}</Label>
                  <Input
                    type="number"
                    value={field.validation_rules?.[key] ?? ""}
                    onChange={(e) => updateRules({ [key]: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="—"
                    className="h-7 text-xs"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Conditional visibility */}
      {otherFields.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Show only when…</Label>
          <Select
            value={field.conditional_rule?.show_when_field ?? "__none__"}
            onValueChange={(v) =>
              update({
                conditional_rule: v === "__none__"
                  ? null
                  : { show_when_field: v, show_when_value: field.conditional_rule?.show_when_value ?? "" },
              })
            }
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs">Always visible</SelectItem>
              {otherFields.map((f) => (
                <SelectItem key={f.id} value={f.field_key} className="text-xs font-mono">
                  {f.label} ({f.field_key})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {field.conditional_rule?.show_when_field && (
            <Input
              value={field.conditional_rule.show_when_value}
              onChange={(e) =>
                update({ conditional_rule: { ...field.conditional_rule!, show_when_value: e.target.value } })
              }
              placeholder="Value that triggers visibility…"
              className="h-7 text-xs"
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   REGISTER FIELD MODAL
   Calls POST /dynamic-fields/ with pre-flight duplicate check
══════════════════════════════════════════════════════════════════ */

function RegistryFieldModal({
  coopId,
  targetModel,
  editing = null,
  onClose,
  onSaved,
}: {
  coopId:       string;
  targetModel:  TargetModel;
  editing?:     DynamicFieldDefinition | null;
  onClose:      () => void;
  onSaved:      (dfd: DynamicFieldDefinition) => void;
}) {
  const { registerField, updateField, saving } = useFieldRegistryMutations();

  const [label,       setLabel]       = useState(editing?.label ?? "");
  const [displayType, setDisplayType] = useState<DisplayType>(editing?.display_type ?? "text");
  const [tag,         setTag]         = useState<FieldTag>(editing?.tag ?? "INFORMATIONAL");
  const [isRequired,  setIsRequired]  = useState(editing?.is_required ?? false);
  const [helpText,    setHelpText]    = useState(editing?.help_text ?? "");
  const [options,     setOptions]     = useState<string[]>(editing?.options ?? []);
  const [newOpt,      setNewOpt]      = useState("");
  const [serverError, setServerError] = useState("");
  const [validationRequested, setValidationRequested] = useState(false);

  const isEditing = !!editing;
  const { result: conflict, checking } = usePreflightCheck(
    coopId,
    targetModel,
    label,
    displayType,
    editing?.id,
  );

  const addOpt = () => {
    const v = newOpt.trim();
    if (v) {
      setValidationRequested(false);
      setOptions((p) => [...p, v]);
      setNewOpt("");
    }
  };

  const handleSubmit = async () => {
    if (!label.trim()) { setServerError("Label is required."); return; }
    if (conflict && !conflict.can_save) return;
    setServerError("");
    try {
      const payload: RegisterFieldPayload = {
        cooperative_id: coopId,
        target_model:   targetModel,
        label:          label.trim(),
        display_type:   displayType,
        tag,
        is_required:    isRequired,
        help_text:      helpText,
        options:        displayType === "dropdown" || displayType === "multi_select" ? options : [],
      };
      const dfd = isEditing
        ? await updateField(editing.id, {
            label: payload.label,
            display_type: payload.display_type,
            tag: payload.tag,
            is_required: payload.is_required,
            help_text: payload.help_text,
            options: payload.options,
          })
        : await registerField(payload);
      onSaved(dfd);
    } catch (e: unknown) {
      setServerError(e instanceof Error ? e.message : "Registration failed.");
    }
  };

  const needsOptions = displayType === "dropdown" || displayType === "multi_select";

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground">
              {isEditing ? "Edit Registry Field" : "Register New Field"}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Adding to <span className="font-mono font-semibold text-foreground">{targetModel}</span> registry
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition">
            <X size={16} />
          </button>
        </div>

        {serverError && (
          <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        {/* Label with live pre-flight check */}
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Field Label <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Input
              value={label}
              onChange={(e) => { setLabel(e.target.value); setServerError(""); setValidationRequested(false); }}
              placeholder="e.g. First Name, Irrigation Type, Harvest Weight"
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
            </p>
          )}
          {conflict?.warning_count ? (
            <p className="text-[10px] text-muted-foreground">
              {conflict.warning_count} warning{conflict.warning_count !== 1 ? "s" : ""} can be ignored if the naming is intentional.
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
                {DISPLAY_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Tag</Label>
            <Select value={tag} onValueChange={(v) => setTag(v as FieldTag)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TAGS.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Help Text <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Input value={helpText} onChange={(e) => setHelpText(e.target.value)} placeholder="Guidance for data entry staff…" className="h-8 text-sm" />
        </div>

        {/* Required toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
          <p className="text-xs font-semibold text-foreground">Required by default</p>
          <button
            onClick={() => setIsRequired((v) => !v)}
            className={`w-9 h-5 rounded-full transition-colors ${isRequired ? "bg-primary" : "bg-muted border border-border"}`}
          >
            <div className={`w-4 h-4 rounded-full bg-card shadow-sm transition-transform mx-0.5 ${isRequired ? "translate-x-4" : "translate-x-0"}`} />
          </button>
        </div>

        {/* Options */}
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
          <button
            onClick={handleSubmit}
            disabled={saving || (conflict ? !conflict.can_save : false) || !label.trim()}
            className="flex-1 rounded-lg bg-primary hover:bg-primary/90 py-2.5 text-sm font-bold text-primary-foreground transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? (
              <><Loader2 size={14} className="animate-spin" /> Saving…</>
            ) : (
              <>{isEditing ? <><Pencil size={14} /> Save Changes</> : <><Sparkles size={14} /> Register Field</>}</>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
/* ══════════════════════════════════════════════════════════════════
   ID HELPERS
══════════════════════════════════════════════════════════════════ */

let _ctr = 0;
const newTempId = () => `local_${++_ctr}_${Date.now()}`;

function dfdToBuilderField(dfd: DynamicFieldDefinition): BuilderField {
  return {
    id:           newTempId(),
    dfd_id:       dfd.id,
    field_key:    dfd.field_key,
    label:        dfd.label,
    display_type: dfd.display_type,
    tag:          dfd.tag,
    is_system:    false,
    is_locked:    dfd.is_locked,
    is_required:  dfd.is_required,
    placeholder:  dfd.placeholder || undefined,
    help_text:    dfd.help_text   || undefined,
    options:      dfd.options.length > 0 ? dfd.options : undefined,
    validation_rules: Object.keys(dfd.validation_rules).length > 0
      ? dfd.validation_rules : undefined,
  };
}

function skeletonToBuilderField(skeleton: SkeletonField): BuilderField {
  return {
    id:           `skeleton_${skeleton.field_key}`,
    dfd_id:       null,
    field_key:    skeleton.field_key,
    label:        skeleton.label,
    display_type: skeleton.display_type,
    tag:          "INFORMATIONAL",
    is_system:    true,
    is_locked:    true,
    is_required:  skeleton.is_required,
    placeholder:  undefined,
    help_text:    skeleton.help_text || undefined,
    options:      skeleton.options || undefined,
    validation_rules: undefined,
  };
}

/* ══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════════ */

export function ShambaFormBuilder({
  coopId,
  targetModel,
  templateName,
  skeletonField = null,
  registryFields = [],
  initialFields = [],
  semanticIssues = [],
  fieldIssueMap = {},
  isValidating   = false,
  canActivate    = false,
  onSaveDraft,
  onValidate,
  onActivate,
  onIgnoreIssue,
  ignoringIssueId = null,
  onRegistryUpdate,
}: ShambaFormBuilderProps) {
  const [fields,         setFields]         = useState<BuilderField[]>(initialFields);
  const [selectedId,     setSelectedId]     = useState<string | null>(null);
  const [showPreview,    setShowPreview]    = useState(false);
  const [showRegister,   setShowRegister]   = useState(false);
  const [editingRegistryField, setEditingRegistryField] = useState<DynamicFieldDefinition | null>(null);
  const [confirmDeleteField, setConfirmDeleteField] = useState<BuilderField | null>(null);

  const fieldsRef = useRef<BuilderField[]>(initialFields);
  const safeRegistryFields = Array.isArray(registryFields) ? registryFields : [];

  const selectedField   = fields.find((f) => f.id === selectedId) ?? null;
  const usedKeys        = new Set(fields.map((f) => f.field_key));
  const selectedRegistryField = selectedField
    ? safeRegistryFields.find((dfd) => dfd.field_key === selectedField.field_key) ?? null
    : null;

  /* Available DFDs not yet added to the template */
  const availableToAdd  = safeRegistryFields.filter((d) => !usedKeys.has(d.field_key));

  const updateField = useCallback((updated: BuilderField) =>
    setFields((prev) => prev.map((f) => (f.id === updated.id ? updated : f))), []);

  const removeField = useCallback((id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  }, []);

  const addFromRegistry = (dfd: DynamicFieldDefinition) => {
    const bf = dfdToBuilderField(dfd);
    setFields((prev) => [...prev, bf]);
    setSelectedId(bf.id);
  };

  const applyRegistryFieldUpdate = useCallback((dfd: DynamicFieldDefinition) => {
    let nextFields: BuilderField[] = [];
    setFields((prev) => {
      nextFields = prev.map((field) =>
        field.field_key === dfd.field_key
          ? {
              ...field,
              label: dfd.label,
              display_type: dfd.display_type,
              tag: dfd.tag,
              is_locked: dfd.is_locked,
            }
          : field
      );
      return nextFields;
    });
    return nextFields;
  }, []);

  const handleRegistryFieldSaved = useCallback((dfd: DynamicFieldDefinition) => {
    const affectsCurrentTemplate = fields.some((field) => field.field_key === dfd.field_key);
    const nextFields = applyRegistryFieldUpdate(dfd);
    setEditingRegistryField(null);
    setShowRegister(false);
    onRegistryUpdate?.();
    if (affectsCurrentTemplate && nextFields.length > 0) {
      onValidate?.(nextFields.filter((field) => !field.is_system));
    }
  }, [applyRegistryFieldUpdate, fields, onRegistryUpdate, onValidate]);

  // Keep a ref of the current fields to support adaptive convergence on prop changes.
  useEffect(() => { fieldsRef.current = fields; }, [fields]);

  // Sync local state when the parent provides a new snapshot (e.g., after reload or save).
  useEffect(() => {
    // Only use user-defined fields, exclude system fields from form builder
    const userFields = (initialFields || []).filter(f => !f.is_system);
    setFields(userFields);
    setSelectedId((prevId) => {
      if (!prevId) return prevId;
      if (userFields.some((f) => f.id === prevId)) return prevId;
      const prevField = fieldsRef.current.find((f) => f.id === prevId);
      if (!prevField) return null;
      const match = userFields.find((f) => f.field_key === prevField.field_key);
      return match ? match.id : null;
    });
  }, [initialFields]);

  const errorCount   = semanticIssues.filter((i) => i.severity === "ERROR").length;
  const warningCount = semanticIssues.filter((i) => i.severity === "WARNING" && !i.is_acknowledged).length;

  return (
    <div className="flex flex-col gap-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
            {templateName}
          </h2>
          <p className="text-xs text-muted-foreground">
            Target: <span className="font-mono font-semibold text-foreground">{targetModel}</span>
            &nbsp;·&nbsp;{fields.length} field{fields.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={() => setShowPreview(!showPreview)}>
            <Eye size={13} /> {showPreview ? "Hide" : "Preview"}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={() => onValidate?.(fields.filter(f => !f.is_system))} disabled={isValidating}>
            {isValidating ? <span className="animate-spin text-xs">⟳</span> : <ShieldAlert size={13} />}
            {isValidating ? "Validating…" : "Validate"}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={() => onSaveDraft?.(fields.filter(f => !f.is_system))}>
            <Save size={13} /> Save Draft
          </Button>
          <Button size="sm" className="gap-1.5 text-xs h-8 bg-primary hover:bg-primary/90 font-semibold" disabled={!canActivate} onClick={onActivate}>
            <CheckCircle2 size={13} /> Activate
          </Button>
        </div>
      </div>

      {/* ── Semantic issues banner ── */}
      <AnimatePresence>
        {semanticIssues.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className={`rounded-xl border p-4 ${
              errorCount > 0
                ? "bg-destructive/5 border-destructive/20"
                : "bg-[var(--warning-light)] border-[var(--warning)]/30"
            }`}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle size={16} className={errorCount > 0 ? "text-destructive" : "text-[var(--warning)]"} />
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
                  {errorCount > 0
                    ? `${errorCount} error${errorCount !== 1 ? "s" : ""} blocking activation`
                    : `${warningCount} warning${warningCount !== 1 ? "s" : ""} detected`}
                </p>
                <div className="mt-2 space-y-1">
                  {semanticIssues.slice(0, 3).map((issue, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Badge variant="outline" className={`text-[9px] px-1 h-4 flex-shrink-0 mt-0.5 ${
                        issue.severity === "ERROR"
                          ? "border-destructive/30 text-destructive"
                          : "border-[var(--warning)]/30 text-[var(--warning)]"
                      }`}>
                        {issue.severity}
                      </Badge>
                      <p className="text-xs text-foreground/80">
                        <span className="font-semibold">{issue.affected_field_label}</span>: {issue.description}
                      </p>
                    </div>
                  ))}
                  {semanticIssues.length > 3 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      + {semanticIssues.length - 3} more — see issues panel below.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 3-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_300px_260px] gap-4">

        {/* ── Field list ── */}
        <Card className="border border-border bg-card">
          <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-bold" style={{ fontFamily: "var(--font-sans)" }}>
              Template Fields
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {fields.length === 0 ? (
              <div className="py-10 text-center">
                <BookOpen size={24} className="mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground mb-1">No fields added yet.</p>
                <p className="text-xs text-muted-foreground">Pick fields from the registry →</p>
              </div>
            ) : (
              <Reorder.Group axis="y" values={fields} onReorder={setFields} className="space-y-2">
                {fields.map((field) => (
                  <FieldPill
                    key={field.id}
                    field={field}
                    isSelected={selectedId === field.id}
                    issues={fieldIssueMap[field.id]}
                    onSelect={() => setSelectedId(field.id)}
                    onRemove={() => setConfirmDeleteField(field)}
                  />
                ))}
              </Reorder.Group>
            )}
          </CardContent>
        </Card>

        {/* ── Field Registry picker + Config panel ── */}
        <div className="space-y-3">
          {/* Registry picker */}
          <Card className="border border-border bg-card">
            <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-bold" style={{ fontFamily: "var(--font-sans)" }}>
                Field Registry
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                onClick={() => setShowRegister(true)}
              >
                <Plus size={11} /> Register
              </Button>
            </CardHeader>
            <CardContent className="pt-0 space-y-1.5">
              {/* Available DFDs */}
              {availableToAdd.length === 0 && safeRegistryFields.length === 0 && (
                <div className="py-4 text-center">
                  <p className="text-xs text-muted-foreground">No fields registered yet.</p>
                  <button onClick={() => setShowRegister(true)} className="text-xs text-primary hover:underline mt-1">
                    Register your first field →
                  </button>
                </div>
              )}
              {availableToAdd.length === 0 && safeRegistryFields.length > 0 && (
                <p className="text-xs text-muted-foreground py-2 text-center">
                  All registered fields added.
                </p>
              )}
              {availableToAdd.map((dfd) => (
                <button
                  key={dfd.id}
                  onClick={() => addFromRegistry(dfd)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 transition text-left group"
                >
                  <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10">
                    {(() => { const Ic = TYPE_ICONS[dfd.display_type] ?? Type; return <Ic size={11} className="text-muted-foreground group-hover:text-primary" />; })()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{dfd.label}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{dfd.field_key}</p>
                  </div>
                  <Plus size={11} className="text-muted-foreground group-hover:text-primary flex-shrink-0" />
                </button>
              ))}

              {/* Already-added DFDs (greyed out) */}
              {safeRegistryFields
                .filter((d) => usedKeys.has(d.field_key))
                .map((dfd) => (
                  <div key={dfd.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border/50 opacity-40 text-xs">
                    <CheckCircle2 size={11} className="text-primary flex-shrink-0" />
                    <span className="truncate text-foreground">{dfd.label}</span>
                    <span className="text-muted-foreground ml-auto flex-shrink-0">added</span>
                  </div>
                ))}
            </CardContent>
          </Card>

          {/* Config panel for selected field */}
          <AnimatePresence mode="wait">
            {selectedField && !selectedField.is_system ? (
              <motion.div
                key={selectedField.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
              >
                <Card className="border border-primary/20 bg-card">
                  <CardContent className="p-0">
                    <FieldConfigPanel
                      field={selectedField}
                      allFields={fields}
                      issues={fieldIssueMap[selectedField.id] ?? []}
                      onChange={updateField}
                      onIgnoreIssue={onIgnoreIssue}
                      ignoringIssueId={ignoringIssueId}
                      onEditRegistryField={
                        selectedRegistryField
                          ? () => setEditingRegistryField(selectedRegistryField)
                          : undefined
                      }
                    />
                  </CardContent>
                </Card>
              </motion.div>
            ) : (
              <motion.div key="empty-config" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Card className="border border-dashed border-border bg-muted/20">
                  <CardContent className="py-8 text-center">
                    <Settings2 size={20} className="mx-auto text-muted-foreground/30 mb-2" />
                    <p className="text-xs text-muted-foreground">
                      {selectedField?.is_system
                        ? "System fields cannot be configured."
                        : "Select a field to set overrides."}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Preview panel (xl only) ── */}
        {showPreview && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="hidden xl:block">
            <Card className="border border-border bg-card sticky top-20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold flex items-center gap-2" style={{ fontFamily: "var(--font-sans)" }}>
                  <Eye size={14} className="text-muted-foreground" /> Live Preview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 overflow-y-auto max-h-[60vh]">
                {fields.map((field) => <PreviewField key={field.id} field={field} />)}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>

      {/* Register field modal */}
      <AnimatePresence>
        {(showRegister || editingRegistryField) && (
          <RegistryFieldModal
            coopId={coopId}
            targetModel={targetModel}
            editing={editingRegistryField}
            onClose={() => {
              setShowRegister(false);
              setEditingRegistryField(null);
            }}
            onSaved={(dfd) => {
              if (editingRegistryField) {
                handleRegistryFieldSaved(dfd);
                return;
              }
              setShowRegister(false);
              onRegistryUpdate?.();
              addFromRegistry(dfd);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmDeleteField && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
            onClick={() => setConfirmDeleteField(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4"
            >
              <h3 className="font-bold text-foreground">Remove field?</h3>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{confirmDeleteField.label}</span> will be removed from this template.
                Save Draft to persist the change.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDeleteField(null)}
                  className="flex-1 rounded-lg border border-border py-2 text-sm text-foreground hover:bg-muted transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    removeField(confirmDeleteField.id);
                    setConfirmDeleteField(null);
                  }}
                  className="flex-1 rounded-lg bg-destructive hover:bg-destructive/90 py-2 text-sm font-semibold text-white transition"
                >
                  Remove
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   PREVIEW RENDERER
══════════════════════════════════════════════════════════════════ */

function PreviewField({ field }: { field: BuilderField }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-foreground flex items-center gap-1">
        {field.label}
        {field.is_required && <span className="text-destructive">*</span>}
        {field.is_system && <Shield size={9} className="text-primary" />}
      </label>
      {field.display_type === "textarea" ? (
        <div className="h-14 rounded-md border border-input bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {field.placeholder ?? "…"}
        </div>
      ) : field.display_type === "boolean" ? (
        <div className="flex items-center gap-2">
          <div className="w-8 h-4 rounded-full bg-muted border border-border" />
          <span className="text-xs text-muted-foreground">Off / On</span>
        </div>
      ) : field.display_type === "dropdown" || field.display_type === "multi_select" ? (
        <div className="h-8 rounded-md border border-input bg-muted/20 px-3 flex items-center text-xs text-muted-foreground justify-between">
          <span>{field.placeholder ?? "Select…"}</span>
          <ChevronsUpDown size={11} />
        </div>
      ) : (
        <div className="h-8 rounded-md border border-input bg-muted/20 px-3 flex items-center text-xs text-muted-foreground">
          {field.placeholder ?? "…"}
        </div>
      )}
      {field.help_text && <p className="text-[10px] text-muted-foreground">{field.help_text}</p>}
    </div>
  );
}
