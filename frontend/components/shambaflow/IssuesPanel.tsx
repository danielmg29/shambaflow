"use client";

/**
 * IssuesPanel — Semantic validation issues display  (v2)
 *
 * What changed from v1:
 *  - Added CUSTOM_KEY_MISSING_DEF to ISSUE_LABELS (new check 10 from form_semantic)
 *  - IssuesBanner export kept intact
 *  - Everything else unchanged — this component just renders Issue objects
 */

import { motion, AnimatePresence } from "framer-motion";
import { Badge }  from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ShieldAlert, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronRight, Lightbulb, XCircle, ArrowRight,
} from "lucide-react";
import type { Issue } from "@/hooks/useFormBuilder";

/* ── Issue type → human label ─────────────────────────────────── */

const ISSUE_LABELS: Record<string, string> = {
  LABEL_DUPLICATE:        "Duplicate Label",
  ABBREVIATION_CLASH:     "Abbreviation Clash",
  SWAHILI_SYNONYM:        "Bilingual Synonym",
  LABEL_CORE_CONFLICT:    "Core Field Conflict",
  MODEL_FIELD_CLASH:      "Model Column Clash",
  TYPE_MISMATCH:          "Type Mismatch",
  REDUNDANT_CORE:         "Redundant Core Field",
  MISSING_REQUIRED:       "Missing Required Field",
  NUMERIC_UNIT_AMBIGUITY: "Numeric Unit Ambiguity",
  CUSTOM_KEY_MISSING_DEF: "Unregistered Custom Field",  // ← new in v2
};

/* ── Props ─────────────────────────────────────────────────────── */

interface IssuesPanelProps {
  issues:          Issue[];
  isExpanded:      boolean;
  onToggle:        () => void;
  onAcknowledge:   (issueId: string) => void;
  onFieldSelect?:  (fieldId: string) => void;
  acknowledging?:  string | null;
}

/* ── Main component ─────────────────────────────────────────────── */

export function IssuesPanel({
  issues,
  isExpanded,
  onToggle,
  onAcknowledge,
  onFieldSelect,
  acknowledging,
}: IssuesPanelProps) {
  const errors   = issues.filter((i) => i.severity === "ERROR");
  const warnings = issues.filter((i) => i.severity === "WARNING");
  const pending  = warnings.filter((w) => !w.is_acknowledged);
  const blocking = errors.length > 0;

  if (issues.length === 0) {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-center gap-3">
        <CheckCircle2 size={15} className="text-primary flex-shrink-0" />
        <p className="text-sm text-foreground/80">
          No semantic issues found — template is ready to activate.
        </p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border overflow-hidden transition-colors ${
      blocking
        ? "border-destructive/30 bg-destructive/[0.02]"
        : "border-[var(--warning)]/30 bg-[var(--warning-light)]"
    }`}>
      {/* Toggle header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-black/[0.02] transition-colors text-left"
      >
        <div className="flex items-center gap-2.5">
          <ShieldAlert size={15} className={blocking ? "text-destructive" : "text-[var(--warning)]"} />
          <span className="text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
            Semantic Validation
          </span>
          <div className="flex items-center gap-1.5">
            {errors.length > 0 && (
              <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-destructive/40 text-destructive bg-destructive/5 font-bold">
                {errors.length}&nbsp;ERROR{errors.length !== 1 ? "S" : ""}
              </Badge>
            )}
            {pending.length > 0 && (
              <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-[var(--warning)]/40 text-[var(--warning)] bg-[var(--warning-light)] font-bold">
                {pending.length}&nbsp;WARNING{pending.length !== 1 ? "S" : ""}
              </Badge>
            )}
            {pending.length === 0 && warnings.length > 0 && (
              <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-border text-muted-foreground font-bold">
                {warnings.length}&nbsp;ACK&apos;D
              </Badge>
            )}
          </div>
        </div>
        {isExpanded
          ? <ChevronDown size={14} className="text-muted-foreground" />
          : <ChevronRight size={14} className="text-muted-foreground" />}
      </button>

      {/* Issue list */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {blocking && (
              <div className="flex items-start gap-2.5 px-4 py-3 bg-destructive/5 border-t border-destructive/15">
                <XCircle size={13} className="text-destructive mt-0.5 flex-shrink-0" />
                <p className="text-xs text-destructive/90">
                  {errors.length} error{errors.length !== 1 ? "s" : ""} must be resolved before
                  this template can be activated. Errors cannot be ignored — fix the
                  underlying fields.
                </p>
              </div>
            )}
            <div className="divide-y divide-border/60">
              {errors.map((issue) => (
                <IssueRow key={issue.id} issue={issue} onFieldSelect={onFieldSelect} />
              ))}
              {warnings.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  onAcknowledge={issue.is_acknowledged ? undefined : () => onAcknowledge(issue.id)}
                  onFieldSelect={onFieldSelect}
                  isAcknowledging={acknowledging === issue.id}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Single issue row ──────────────────────────────────────────── */

function IssueRow({
  issue, onAcknowledge, onFieldSelect, isAcknowledging,
}: {
  issue:            Issue;
  onAcknowledge?:   () => void;
  onFieldSelect?:   (fieldId: string) => void;
  isAcknowledging?: boolean;
}) {
  const isError = issue.severity === "ERROR";

  return (
    <div className={`px-4 py-4 transition-opacity ${issue.is_acknowledged ? "opacity-50" : "opacity-100"}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
          isError ? "bg-destructive/10" : "bg-[var(--warning-light)]"
        }`}>
          <AlertTriangle size={10} className={isError ? "text-destructive" : "text-[var(--warning)]"} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <Badge variant="outline" className={`text-[9px] h-4 px-1 font-bold ${
              isError
                ? "border-destructive/30 text-destructive bg-destructive/5"
                : "border-[var(--warning)]/30 text-[var(--warning)] bg-[var(--warning-light)]"
            }`}>
              {issue.severity}
            </Badge>
            <span className="text-[10px] font-bold text-foreground/60 uppercase tracking-wider">
              {ISSUE_LABELS[issue.issue_type] ?? issue.issue_type}
            </span>
          </div>

          <p className="text-xs text-foreground/80 leading-relaxed mb-2">
            {issue.description}
          </p>

          {(issue.affected_field_label || issue.conflicting_field_label) && (
            <div className="flex items-center gap-2 flex-wrap mb-2.5">
              {issue.affected_field_label && (
                <button
                  onClick={() => issue.affected_field && onFieldSelect?.(issue.affected_field)}
                  className="text-[10px] font-mono bg-muted/70 border border-border px-1.5 py-0.5 rounded-md text-foreground hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-colors"
                >
                  {issue.affected_field_label}
                </button>
              )}
              {issue.conflicting_field_label && (
                <>
                  <ArrowRight size={10} className="text-muted-foreground" />
                  <button
                    onClick={() => issue.conflicting_field && onFieldSelect?.(issue.conflicting_field)}
                    className="text-[10px] font-mono bg-muted/70 border border-border px-1.5 py-0.5 rounded-md text-foreground hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-colors"
                  >
                    {issue.conflicting_field_label}
                  </button>
                </>
              )}
            </div>
          )}

          {issue.suggestion && (
            <div className="flex items-start gap-1.5 p-2.5 rounded-lg bg-muted/40 border border-border/50 mb-2.5">
              <Lightbulb size={10} className="text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-[10px] text-muted-foreground leading-relaxed">{issue.suggestion}</p>
            </div>
          )}

          {!isError && (
            <div>
              {issue.is_acknowledged ? (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 size={9} className="text-primary" />
                  Acknowledged
                  {issue.acknowledged_at && (
                    <>&nbsp;·&nbsp;{new Date(issue.acknowledged_at).toLocaleDateString()}</>
                  )}
                </span>
              ) : onAcknowledge ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2 border-[var(--warning)]/40 text-[var(--warning)] hover:bg-[var(--warning-light)] hover:border-[var(--warning)]/60 gap-1"
                  onClick={onAcknowledge}
                  disabled={isAcknowledging}
                >
                  {isAcknowledging ? (
                    <><span className="animate-spin text-xs">⟳</span> Ignoring…</>
                  ) : (
                    <><CheckCircle2 size={9} /> Ignore warning</>
                  )}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Compact banner ─────────────────────────────────────────────── */

export function IssuesBanner({ issues, onViewAll }: { issues: Issue[]; onViewAll?: () => void }) {
  if (issues.length === 0) return null;
  const errors   = issues.filter((i) => i.severity === "ERROR");
  const warnings = issues.filter((i) => i.severity === "WARNING" && !i.is_acknowledged);
  const blocking = errors.length > 0;

  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border text-xs ${
      blocking
        ? "bg-destructive/5 border-destructive/20 text-destructive"
        : "bg-[var(--warning-light)] border-[var(--warning)]/30 text-[var(--warning)]"
    }`}>
      <div className="flex items-center gap-2">
        <AlertTriangle size={13} />
        <span className="font-semibold">
          {blocking
            ? `${errors.length} error${errors.length !== 1 ? "s" : ""} blocking activation`
            : `${warnings.length} unacknowledged warning${warnings.length !== 1 ? "s" : ""}`}
        </span>
      </div>
      {onViewAll && (
        <button onClick={onViewAll} className="underline underline-offset-2 font-medium hover:opacity-70 transition-opacity">
          View all
        </button>
      )}
    </div>
  );
}
