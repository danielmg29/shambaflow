"use client";

/**
 * FormRenderer — Renders an active form template for data entry.
 *
 * Used by CRM modules (Member, Production, Livestock, Governance, Finance)
 * to present dynamic data-entry forms derived from cooperative-configured
 * FormTemplate records.
 *
 * Fetches the ACTIVE template for the given (coopId, targetModel),
 * renders each field as the correct input type, and submits via
 * POST /api/form-builder/{coopId}/submit/{templateId}/
 */

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Label }    from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge }    from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2, Loader2, AlertCircle, FileText,
  MapPin, Upload, ToggleLeft, ToggleRight,
} from "lucide-react";

import {
  useActiveTemplate,
  useFormSubmit,
  type TemplateField,
  type TargetModel,
} from "@/hooks/useFormBuilder";

/* ─── Props ───────────────────────────────────────────────────────── */

interface FormRendererProps {
  coopId:           string;
  targetModel:      TargetModel;
  /** Called after a successful submission with the created record ID */
  onSubmitSuccess?: (recordId: string) => void;
  /** Optional custom submit handler for edit/update flows */
  onSubmit?:        (payload: Record<string, unknown>) => Promise<void>;
  /** Slot for extra static fields that always appear above dynamic fields */
  staticFields?:    React.ReactNode;
  /** Initial values for editing existing records */
  initialValues?:   Record<string, unknown>;
  /** Custom label for the submit button */
  submitLabel?:     string;
}

/* ─── Main component ──────────────────────────────────────────────── */

export function FormRenderer({
  coopId,
  targetModel,
  onSubmitSuccess,
  onSubmit,
  staticFields,
  initialValues,
  submitLabel = "Save Record",
}: FormRendererProps) {
  const { template, loading, error } = useActiveTemplate(coopId, targetModel);
  const { submit, submitting, result, error: submitError, reset } = useFormSubmit(
    coopId,
    template?.id ?? ""
  );

  const [formValues,    setFormValues]    = useState<Record<string, unknown>>({});
  const [fieldErrors,   setFieldErrors]   = useState<Record<string, string>>({});
  const [touched,       setTouched]       = useState<Record<string, boolean>>({});
  const [customSubmitting, setCustomSubmitting] = useState(false);
  const [customSubmitError, setCustomSubmitError] = useState<string | null>(null);

  /* ── Initialize form values from initialValues prop ───────────────── */
  useEffect(() => {
    if (template && initialValues) {
      // Populate form values based on template field mappings
      const populatedValues: Record<string, unknown> = {};

      template.fields.forEach((field) => {
        const fieldValue = initialValues[field.maps_to_model_field];
        if (fieldValue !== undefined && fieldValue !== null) {
          populatedValues[field.maps_to_model_field] = fieldValue;
        }
      });

      setFormValues(populatedValues);
    } else if (template && !initialValues) {
      setFormValues({});
    }
    setFieldErrors({});
    setTouched({});
    setCustomSubmitError(null);
  }, [template, initialValues]);

  /* ── Field-level change handler ─────────────────────────────────── */
  const handleChange = useCallback((fieldName: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [fieldName]: value }));
    if (touched[fieldName]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
    }
  }, [touched]);

  const handleBlur = useCallback((fieldName: string) => {
    setTouched((prev) => ({ ...prev, [fieldName]: true }));
  }, []);

  /* ── Client-side validation ─────────────────────────────────────── */
  const validate = useCallback((): boolean => {
    if (!template?.fields) return true;
    const errors: Record<string, string> = {};

    for (const field of template.fields) {
      const val = formValues[field.maps_to_model_field];
      const isEmpty = val === undefined || val === null || val === "";

      if (field.is_required && isEmpty) {
        errors[field.maps_to_model_field] = `${field.label} is required`;
        continue;
      }
      if (isEmpty) continue;

      const rules = field.validation_rules ?? {};

      if (
        (field.display_type === "number" || field.display_type === "decimal") &&
        typeof val === "string"
      ) {
        const num = Number(val);
        if (isNaN(num)) {
          errors[field.maps_to_model_field] = "Must be a number";
        } else {
          if (rules.min_value !== undefined && num < rules.min_value) {
            errors[field.maps_to_model_field] = `Minimum value is ${rules.min_value}`;
          }
          if (rules.max_value !== undefined && num > rules.max_value) {
            errors[field.maps_to_model_field] = `Maximum value is ${rules.max_value}`;
          }
        }
      }

      if (typeof val === "string" && rules.min_length && val.length < rules.min_length) {
        errors[field.maps_to_model_field] = `Minimum ${rules.min_length} characters`;
      }
      if (typeof val === "string" && rules.max_length && val.length > rules.max_length) {
        errors[field.maps_to_model_field] = `Maximum ${rules.max_length} characters`;
      }
      if (typeof val === "string" && rules.regex_pattern) {
        try {
          if (!new RegExp(rules.regex_pattern).test(val)) {
            errors[field.maps_to_model_field] =
              rules.regex_message ?? "Invalid format";
          }
        } catch {
          /* Invalid regex in template — skip client-side check */
        }
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [template, formValues]);

  /* ── Submit ─────────────────────────────────────────────────────── */
  const handleSubmit = useCallback(async () => {
    /* Mark all fields touched so errors become visible */
    if (template?.fields) {
      const allTouched = Object.fromEntries(
        template.fields.map((f) => [f.maps_to_model_field, true])
      );
      setTouched(allTouched);
    }

    if (!validate()) return;

    try {
      if (onSubmit) {
        setCustomSubmitting(true);
        setCustomSubmitError(null);
        await onSubmit(formValues);
        return;
      }
      const res = await submit(formValues);
      onSubmitSuccess?.(res.created_record_id);
    } catch (error) {
      if (onSubmit) {
        const message = error instanceof Error ? error.message : "Submission failed";
        setCustomSubmitError(message);
      } else {
        /* Error shown via submitError */
      }
    } finally {
      if (onSubmit) {
        setCustomSubmitting(false);
      }
    }
  }, [template, validate, onSubmit, formValues, submit, onSubmitSuccess]);

  /* ── Handle "submit another" ────────────────────────────────────── */
  const handleReset = useCallback(() => {
    setFormValues({});
    setFieldErrors({});
    setTouched({});
    setCustomSubmitError(null);
    reset();
  }, [reset]);

  /* ── Loading state ──────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-2">
          <Loader2 size={24} className="animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading form…</p>
        </div>
      </div>
    );
  }

  /* ── No active template ─────────────────────────────────────────── */
  if (error || !template) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 py-12 text-center px-6">
        <FileText size={24} className="mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm font-semibold text-muted-foreground">No active form template</p>
        <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs mx-auto">
          A Chair or Manager must create and activate a form template for{" "}
          <span className="font-mono font-semibold">{targetModel}</span> before data can be
          entered here.
        </p>
      </div>
    );
  }

  /* ── Success state ──────────────────────────────────────────────── */
  if (result) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-xl border border-primary/20 bg-primary/5 py-12 text-center px-6"
      >
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={22} className="text-primary" />
        </div>
        <p className="text-base font-bold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
          Record saved
        </p>
        <p className="text-xs text-muted-foreground mt-1 mb-5">
          Submitted successfully · ID:{" "}
          <span className="font-mono">{result.created_record_id}</span>
        </p>
        <Button variant="outline" size="sm" onClick={handleReset}>
          Submit another entry
        </Button>
      </motion.div>
    );
  }

  /* ── Form ────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-6">
      {/* Template header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
            {template.name}
          </p>
          {template.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{template.description}</p>
          )}
        </div>
        <Badge variant="outline" className="text-[10px] font-mono border-border text-muted-foreground">
          v{template.version}
        </Badge>
      </div>

      {/* Static fields slot */}
      {staticFields && <div>{staticFields}</div>}

      {/* Divider if both exist */}
      {staticFields && template.fields.length > 0 && (
        <div className="border-t border-border" />
      )}

      {/* Dynamic fields */}
      <div className="space-y-5">
        {template.fields.map((field) => (
          <FieldInput
            key={field.id}
            field={field}
            value={formValues[field.maps_to_model_field]}
            error={touched[field.maps_to_model_field] ? fieldErrors[field.maps_to_model_field] : undefined}
            onChange={(val) => handleChange(field.maps_to_model_field, val)}
            onBlur={() => handleBlur(field.maps_to_model_field)}
          />
        ))}
      </div>

      {/* Server-side submission error */}
      <AnimatePresence>
        {(customSubmitError ?? submitError) && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-xl px-4 py-3"
          >
            <AlertCircle size={14} /> {customSubmitError ?? submitError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Submit button */}
      <Button
        className="w-full bg-primary hover:bg-primary/90 font-semibold gap-2"
        onClick={handleSubmit}
        disabled={submitting || customSubmitting}
      >
        {(submitting || customSubmitting) ? (
          <><Loader2 size={15} className="animate-spin" /> Saving…</>
        ) : (
          submitLabel
        )}
      </Button>
    </div>
  );
}

/* ─── Individual field renderer ───────────────────────────────────── */

interface FieldInputProps {
  field:    TemplateField;
  value:    unknown;
  error?:   string;
  onChange: (val: unknown) => void;
  onBlur:   () => void;
}

function FieldInput({ field, value, error, onChange, onBlur }: FieldInputProps) {
  const strValue = value !== undefined && value !== null ? String(value) : "";

  const wrapper = (children: React.ReactNode) => (
    <div className="space-y-1.5">
      <Label className="text-sm font-semibold flex items-center gap-1">
        {field.label}
        {field.is_required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {field.help_text && !error && (
        <p className="text-xs text-muted-foreground">{field.help_text}</p>
      )}
      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle size={10} /> {error}
        </p>
      )}
    </div>
  );

  const inputClass = `${error ? "border-destructive focus-visible:ring-destructive/30" : ""}`;

  switch (field.display_type) {
    /* ── Text ── */
    case "text":
      return wrapper(
        <Input
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={field.placeholder}
          className={inputClass}
        />
      );

    /* ── Textarea ── */
    case "textarea":
      return wrapper(
        <Textarea
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={field.placeholder}
          rows={3}
          className={`resize-none ${inputClass}`}
        />
      );

    /* ── Number / Decimal ── */
    case "number":
    case "decimal":
      return wrapper(
        <Input
          type="number"
          step={field.display_type === "decimal" ? "0.01" : "1"}
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={field.placeholder}
          min={field.validation_rules?.min_value}
          max={field.validation_rules?.max_value}
          className={inputClass}
        />
      );

    /* ── Date ── */
    case "date":
      return wrapper(
        <Input
          type="date"
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={inputClass}
        />
      );

    /* ── Datetime ── */
    case "datetime":
      return wrapper(
        <Input
          type="datetime-local"
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={inputClass}
        />
      );

    /* ── Boolean ── */
    case "boolean": {
      const boolVal = value === true || value === "true" || value === "1";
      return wrapper(
        <button
          type="button"
          onClick={() => { onChange(!boolVal); onBlur(); }}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors w-full text-left ${
            boolVal
              ? "border-primary/30 bg-primary/5 text-primary"
              : "border-border bg-muted/20 text-muted-foreground"
          } ${error ? "border-destructive/50" : ""}`}
        >
          {boolVal ? (
            <ToggleRight size={20} className="text-primary flex-shrink-0" />
          ) : (
            <ToggleLeft size={20} className="flex-shrink-0" />
          )}
          <span className="text-sm font-medium">
            {boolVal ? "Yes" : "No"}
          </span>
        </button>
      );
    }

    /* ── Dropdown ── */
    case "dropdown":
      return wrapper(
        <Select
          value={strValue}
          onValueChange={(v) => { onChange(v); onBlur(); }}
        >
          <SelectTrigger className={inputClass}>
            <SelectValue placeholder={field.placeholder ?? "Select an option…"} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    /* ── Multi-select ── */
    case "multi_select": {
      const selected: string[] =
        Array.isArray(value) ? value : strValue ? strValue.split(",").filter(Boolean) : [];

      const toggle = (opt: string) => {
        const next = selected.includes(opt)
          ? selected.filter((v) => v !== opt)
          : [...selected, opt];
        onChange(next);
        onBlur();
      };

      return wrapper(
        <div className={`flex flex-wrap gap-2 p-3 rounded-xl border ${error ? "border-destructive/50" : "border-input"} bg-background`}>
          {(field.options ?? []).map((opt) => {
            const active = selected.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(opt)}
                className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  active
                    ? "bg-primary text-white border-primary"
                    : "bg-muted/50 text-muted-foreground border-border hover:border-primary/30"
                }`}
              >
                {opt}
              </button>
            );
          })}
          {(field.options ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground italic">No options configured.</p>
          )}
        </div>
      );
    }

    /* ── GPS ── */
    case "gps": {
      const coordStr = strValue || "";
      const [lat, lng] = coordStr.split(",").map(Number);

      const capture = () => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            onChange(`${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`);
            onBlur();
          },
          () => {}
        );
      };

      return wrapper(
        <div className="space-y-2">
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${error ? "border-destructive/50" : "border-input"} bg-muted/20`}>
            <MapPin size={16} className="text-muted-foreground flex-shrink-0" />
            {coordStr ? (
              <span className="text-sm font-mono text-foreground flex-1">
                {lat?.toFixed(4)}, {lng?.toFixed(4)}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground flex-1">
                No location captured
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-shrink-0 text-xs gap-1"
              onClick={capture}
            >
              <MapPin size={11} /> Capture
            </Button>
          </div>
          {/* Manual entry fallback */}
          <Input
            value={coordStr}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            placeholder="lat,lng  e.g.  -1.286389,36.817223"
            className="text-xs font-mono"
          />
        </div>
      );
    }

    /* ── File upload ── */
    case "file_upload":
      return wrapper(
        <label
          className={`flex items-center gap-3 px-4 py-5 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
            error
              ? "border-destructive/40 hover:border-destructive/60"
              : "border-border hover:border-primary/40 hover:bg-muted/10"
          }`}
        >
          <Upload size={18} className="text-muted-foreground flex-shrink-0" />
          <div className="flex-1 min-w-0">
            {value instanceof File ? (
              <div>
                <p className="text-sm font-medium text-foreground truncate">{value.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(value.size / 1024).toFixed(1)} KB
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium text-foreground">
                  Click to upload
                </p>
                <p className="text-xs text-muted-foreground">
                  {field.placeholder ?? "Any file type accepted"}
                </p>
              </div>
            )}
          </div>
          <input
            type="file"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) { onChange(file); onBlur(); }
            }}
          />
        </label>
      );

    default:
      return wrapper(
        <Input
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={field.placeholder}
          className={inputClass}
        />
      );
  }
}
