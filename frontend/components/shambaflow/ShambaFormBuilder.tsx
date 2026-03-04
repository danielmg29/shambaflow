"use client";

/**
 * ShambaFormBuilder — Visual Form Template UI
 *
 * Used in the CRM "Form Builder" module.
 * The Chair uses this to design custom data-entry forms that create
 * real records in target model tables (Member, ProductionRecord, etc.)
 *
 * This is the UI shell — it renders draggable field cards, a field
 * configuration panel, and a live preview pane.
 * Actual drag-and-drop logic uses the browser's native Drag API
 * (no external DnD library required).
 */

import { useState, useCallback } from "react";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GripVertical,
  Plus,
  Trash2,
  Eye,
  Save,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Settings2,
  Type,
  Hash,
  Calendar,
  ToggleLeft,
  List,
  MapPin,
  Upload,
} from "lucide-react";

/* ─── Types ───────────────────────────────────────────────────────── */

export type DisplayType =
  | "text" | "textarea" | "number" | "decimal" | "date"
  | "boolean" | "dropdown" | "multi_select" | "gps" | "file_upload";

export type FieldTag = "CAPACITY" | "GOVERNANCE" | "FINANCIAL" | "INFORMATIONAL";

export interface BuilderField {
  id:                  string;
  label:               string;
  display_type:        DisplayType;
  tag:                 FieldTag;
  maps_to_model_field: string;
  is_required:         boolean;
  placeholder?:        string;
  help_text?:          string;
  options?:            string[];   // for dropdown/multi_select
}

export interface SemanticIssue {
  field_label:   string;
  issue_type:    string;
  severity:      "ERROR" | "WARNING";
  description:   string;
  suggestion?:   string;
}

export interface ShambaFormBuilderProps {
  templateName:       string;
  targetModel:        string;      // e.g. "ProductionRecord"
  availableFields:    { field_name: string; verbose_name: string; django_type: string }[];
  initialFields?:     BuilderField[];
  semanticIssues?:    SemanticIssue[];
  isValidating?:      boolean;
  canActivate?:       boolean;
  onSaveDraft?:       (fields: BuilderField[]) => void;
  onValidate?:        (fields: BuilderField[]) => void;
  onActivate?:        () => void;
}

/* ─── Field type icons ────────────────────────────────────────────── */

const TYPE_ICONS: Record<DisplayType, React.ElementType> = {
  text:         Type,
  textarea:     Type,
  number:       Hash,
  decimal:      Hash,
  date:         Calendar,
  boolean:      ToggleLeft,
  dropdown:     List,
  multi_select: List,
  gps:          MapPin,
  file_upload:  Upload,
};

const TAG_COLORS: Record<FieldTag, string> = {
  CAPACITY:      "bg-primary/10 text-primary border-primary/20",
  GOVERNANCE:    "bg-violet-50 text-violet-700 border-violet-200",
  FINANCIAL:     "bg-amber-50 text-amber-700 border-amber-200",
  INFORMATIONAL: "bg-muted text-muted-foreground border-border",
};

/* ─── Field pill (draggable card in the builder) ──────────────────── */

function FieldPill({
  field,
  isSelected,
  onSelect,
  onRemove,
}: {
  field:      BuilderField;
  isSelected: boolean;
  onSelect:   () => void;
  onRemove:   () => void;
}) {
  const Icon = TYPE_ICONS[field.display_type] ?? Type;

  return (
    <Reorder.Item
      value={field}
      className="list-none"
    >
      <div
        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-150 ${
          isSelected
            ? "border-primary bg-primary/5 shadow-sm"
            : "border-border bg-card hover:border-primary/30 hover:bg-muted/30"
        }`}
        onClick={onSelect}
      >
        {/* Drag handle */}
        <GripVertical size={15} className="text-muted-foreground/50 flex-shrink-0 cursor-grab active:cursor-grabbing" />

        {/* Icon */}
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
          isSelected ? "bg-primary text-white" : "bg-muted text-muted-foreground"
        }`}>
          <Icon size={13} />
        </div>

        {/* Label + badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold text-foreground truncate" style={{ fontFamily: "var(--font-sans)" }}>
              {field.label || <span className="text-muted-foreground italic">Untitled field</span>}
            </p>
            {field.is_required && (
              <span className="text-[9px] font-bold text-destructive">REQUIRED</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] text-muted-foreground">{field.display_type}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-[10px] text-muted-foreground font-mono">{field.maps_to_model_field || "unmapped"}</span>
            <Badge variant="outline" className={`text-[9px] px-1 h-3.5 ml-auto ${TAG_COLORS[field.tag]}`}>
              {field.tag}
            </Badge>
          </div>
        </div>

        {/* Remove */}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </Reorder.Item>
  );
}

/* ─── Field config panel ──────────────────────────────────────────── */

function FieldConfigPanel({
  field,
  availableFields,
  onChange,
}: {
  field:           BuilderField;
  availableFields: { field_name: string; verbose_name: string; django_type: string }[];
  onChange:        (updated: BuilderField) => void;
}) {
  const update = (patch: Partial<BuilderField>) => onChange({ ...field, ...patch });

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 mb-4">
        <Settings2 size={15} className="text-primary" />
        <h3 className="text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
          Field Settings
        </h3>
      </div>

      {/* Label */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Label</Label>
        <Input
          value={field.label}
          onChange={(e) => update({ label: e.target.value })}
          placeholder="e.g. Harvest Volume (kg)"
          className="h-8 text-sm"
        />
      </div>

      {/* Display type */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Field Type</Label>
        <Select value={field.display_type} onValueChange={(v) => update({ display_type: v as DisplayType })}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["text","textarea","number","decimal","date","boolean","dropdown","multi_select","gps","file_upload"] as DisplayType[]).map((t) => (
              <SelectItem key={t} value={t} className="text-sm">{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Maps to model field */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Maps to Model Field</Label>
        <Select
          value={field.maps_to_model_field}
          onValueChange={(v) => update({ maps_to_model_field: v })}
        >
          <SelectTrigger className="h-8 text-sm font-mono">
            <SelectValue placeholder="Select column…" />
          </SelectTrigger>
          <SelectContent>
            {availableFields.map((f) => (
              <SelectItem key={f.field_name} value={f.field_name} className="text-sm font-mono">
                {f.field_name}
                <span className="text-muted-foreground ml-1">({f.django_type})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">
          The actual database column this field writes to.
        </p>
      </div>

      {/* Tag */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Tag (influences analytics)</Label>
        <Select value={field.tag} onValueChange={(v) => update({ tag: v as FieldTag })}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["CAPACITY","GOVERNANCE","FINANCIAL","INFORMATIONAL"] as FieldTag[]).map((t) => (
              <SelectItem key={t} value={t} className="text-sm">{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Placeholder */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Placeholder</Label>
        <Input
          value={field.placeholder ?? ""}
          onChange={(e) => update({ placeholder: e.target.value })}
          placeholder="Hint text for data-entry staff…"
          className="h-8 text-sm"
        />
      </div>

      {/* Help text */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Help Text</Label>
        <Input
          value={field.help_text ?? ""}
          onChange={(e) => update({ help_text: e.target.value })}
          placeholder="Displayed below the input…"
          className="h-8 text-sm"
        />
      </div>

      {/* Required toggle */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
        <div>
          <p className="text-xs font-semibold text-foreground">Required</p>
          <p className="text-[10px] text-muted-foreground">Form cannot be submitted without this field.</p>
        </div>
        <button
          onClick={() => update({ is_required: !field.is_required })}
          className={`w-9 h-5 rounded-full transition-colors ${field.is_required ? "bg-primary" : "bg-muted"}`}
        >
          <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform mx-0.5 ${field.is_required ? "translate-x-4" : "translate-x-0"}`} />
        </button>
      </div>
    </div>
  );
}

/* ─── Main component ──────────────────────────────────────────────── */

let _idCounter = 0;
const newId = () => `field_${++_idCounter}_${Date.now()}`;

const DEFAULT_FIELD = (): BuilderField => ({
  id:                  newId(),
  label:               "",
  display_type:        "text",
  tag:                 "INFORMATIONAL",
  maps_to_model_field: "",
  is_required:         false,
});

export function ShambaFormBuilder({
  templateName,
  targetModel,
  availableFields,
  initialFields = [],
  semanticIssues = [],
  isValidating   = false,
  canActivate    = false,
  onSaveDraft,
  onValidate,
  onActivate,
}: ShambaFormBuilderProps) {
  const [fields, setFields]         = useState<BuilderField[]>(initialFields);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const selectedField = fields.find((f) => f.id === selectedId) ?? null;

  const addField = useCallback(() => {
    const f = DEFAULT_FIELD();
    setFields((prev) => [...prev, f]);
    setSelectedId(f.id);
  }, []);

  const updateField = useCallback((updated: BuilderField) => {
    setFields((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  }, []);

  const removeField = useCallback((id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  }, []);

  const errorCount   = semanticIssues.filter((i) => i.severity === "ERROR").length;
  const warningCount = semanticIssues.filter((i) => i.severity === "WARNING").length;

  return (
    <div className="flex flex-col gap-4">
      {/* Header bar */}
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
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={() => onValidate?.(fields)}>
            {isValidating ? (
              <span className="animate-spin">⟳</span>
            ) : (
              <ShieldAlert size={13} />
            )}
            Validate
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={() => onSaveDraft?.(fields)}>
            <Save size={13} /> Save Draft
          </Button>
          <Button
            size="sm"
            className="gap-1.5 text-xs h-8 bg-primary hover:bg-primary/90 font-semibold"
            disabled={!canActivate}
            onClick={onActivate}
          >
            <CheckCircle2 size={13} /> Activate
          </Button>
        </div>
      </div>

      {/* Semantic issues banner */}
      <AnimatePresence>
        {semanticIssues.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`rounded-xl border p-4 ${
              errorCount > 0
                ? "bg-destructive/5 border-destructive/20"
                : "bg-amber-50 border-amber-200"
            }`}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle size={16} className={errorCount > 0 ? "text-destructive" : "text-amber-600"} />
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
                  {errorCount > 0
                    ? `${errorCount} error${errorCount !== 1 ? "s" : ""} block activation`
                    : `${warningCount} warning${warningCount !== 1 ? "s" : ""} detected`}
                </p>
                <div className="mt-2 space-y-1">
                  {semanticIssues.slice(0, 4).map((issue, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Badge
                        variant="outline"
                        className={`text-[9px] px-1 h-4 flex-shrink-0 mt-0.5 ${
                          issue.severity === "ERROR"
                            ? "border-destructive/30 text-destructive"
                            : "border-amber-300 text-amber-700"
                        }`}
                      >
                        {issue.severity}
                      </Badge>
                      <p className="text-xs text-foreground/80">
                        <span className="font-semibold">{issue.field_label}</span>: {issue.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main 3-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_320px_260px] gap-4">
        {/* Fields list */}
        <Card className="border border-border bg-card">
          <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-bold" style={{ fontFamily: "var(--font-sans)" }}>
              Form Fields
            </CardTitle>
            <Button size="sm" className="h-7 gap-1.5 text-xs bg-primary hover:bg-primary/90" onClick={addField}>
              <Plus size={13} /> Add Field
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {fields.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-muted-foreground mb-3">No fields yet.</p>
                <Button variant="outline" size="sm" onClick={addField} className="gap-1.5">
                  <Plus size={13} /> Add your first field
                </Button>
              </div>
            ) : (
              <Reorder.Group
                axis="y"
                values={fields}
                onReorder={setFields}
                className="space-y-2"
              >
                {fields.map((field) => (
                  <FieldPill
                    key={field.id}
                    field={field}
                    isSelected={selectedId === field.id}
                    onSelect={() => setSelectedId(field.id)}
                    onRemove={() => removeField(field.id)}
                  />
                ))}
              </Reorder.Group>
            )}
          </CardContent>
        </Card>

        {/* Config panel */}
        <AnimatePresence mode="wait">
          {selectedField ? (
            <motion.div
              key={selectedField.id}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.2 }}
            >
              <Card className="border border-primary/20 bg-card sticky top-20">
                <CardContent className="p-0">
                  <FieldConfigPanel
                    field={selectedField}
                    availableFields={availableFields}
                    onChange={updateField}
                  />
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <Card className="border border-dashed border-border bg-muted/20 sticky top-20">
                <CardContent className="py-16 text-center">
                  <Settings2 size={24} className="mx-auto text-muted-foreground/40 mb-2" />
                  <p className="text-xs text-muted-foreground">Select a field to configure it.</p>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Preview panel (xl only, or toggle) */}
        {showPreview && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="hidden xl:block"
          >
            <Card className="border border-border bg-card sticky top-20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold flex items-center gap-2" style={{ fontFamily: "var(--font-sans)" }}>
                  <Eye size={14} className="text-muted-foreground" /> Live Preview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {fields.map((field) => (
                  <div key={field.id} className="space-y-1">
                    <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                      {field.label || <span className="italic text-muted-foreground">Untitled</span>}
                      {field.is_required && <span className="text-destructive">*</span>}
                    </label>
                    {field.display_type === "textarea" ? (
                      <div className="h-16 rounded-md border border-input bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        {field.placeholder ?? "…"}
                      </div>
                    ) : field.display_type === "boolean" ? (
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-4 rounded-full bg-muted border border-border" />
                        <span className="text-xs text-muted-foreground">Off / On</span>
                      </div>
                    ) : (
                      <div className="h-8 rounded-md border border-input bg-muted/20 px-3 flex items-center text-xs text-muted-foreground">
                        {field.placeholder ?? "…"}
                      </div>
                    )}
                    {field.help_text && (
                      <p className="text-[10px] text-muted-foreground">{field.help_text}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>
    </div>
  );
}