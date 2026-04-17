"use client";

/**
 * CRMImportModal
 * ==============
 * Two-stage import flow that matches the backend exactly:
 *
 *   Stage 1 — Drop Zone
 *     Drag-and-drop or click-to-select a CSV or XLSX file.
 *     "Download Template" triggers GET /import/template/ to get correct headers.
 *
 *   Stage 2 — Dry Run Preview  (dry_run=true)
 *     Validates headers and every row without writing to the DB.
 *     Shows success count + per-row errors.
 *     If all rows pass → "Confirm Import" button fires real import.
 *     If errors exist  → user fixes file and re-uploads.
 *
 *   Stage 3 — Result
 *     Shows final success count after real import.
 *     "Done" closes the modal and triggers a table refresh.
 *
 * Props
 * ─────
 *   modelSlug          — e.g. "members"
 *   modelLabel         — e.g. "Members"
 *   onImport           — calls useCRMImport.importFile(file, dryRun)
 *   onDownloadTemplate — calls useCRMImport.downloadTemplate()
 *   importing          — loading state from the hook
 *   onClose            — close handler (also called on success)
 *   onSuccess          — called after a real (non-dry) import succeeds
 *
 * Backend response shape (ImportResult):
 *   { success, parse_error, dry_run, total_rows, success_count, error_count,
 *     imported_count, created_ids, header_validation, row_validation,
 *     error_rows: [{ row_number, errors: string[], raw_row }] }
 *
 *   Header errors arrive in header_validation.errors.
 *   Row errors arrive in error_rows array.
 */

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Download,
  RefreshCcw,
  ChevronDown,
  ChevronUp,
  Loader2,
  ArrowRight,
} from "lucide-react";
import type { ImportResult } from "@/hooks/useCRMData";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  modelSlug:          string;
  modelLabel:         string;
  onImport:           (file: File, dryRun: boolean) => Promise<ImportResult | null>;
  onDownloadTemplate: () => void;
  importing:          boolean;
  onClose:            () => void;
  onSuccess:          () => void;
}

// ── Stage types ───────────────────────────────────────────────────────────────

type Stage = "drop" | "processing" | "preview" | "result";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Separate header-level errors from row-level errors. */
function splitErrors(result: ImportResult) {
  const headerErrors: string[] = [];
  // Add header validation errors if present
  if (result.header_validation?.errors.length) {
    headerErrors.push(...result.header_validation.errors);
  }
  // error_rows already contains only row-level errors
  const rowErrors = result.error_rows;
  return { headerErrors, rowErrors };
}

function formatRowErrors(errors: string[]): string {
  return errors.join(" · ");
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function CRMImportModal({
  modelSlug,
  modelLabel,
  onImport,
  onDownloadTemplate,
  importing,
  onClose,
  onSuccess,
}: Props) {
  const [stage,      setStage]      = useState<Stage>("drop");
  const [dragOver,   setDragOver]   = useState(false);
  const [file,       setFile]       = useState<File | null>(null);
  const [dryResult,  setDryResult]  = useState<ImportResult | null>(null);
  const [realResult, setRealResult] = useState<ImportResult | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── File selection ───────────────────────────────────────────────────────────

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) { setFile(dropped); setDryResult(null); }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setDryResult(null); }
  };

  // ── Stage 1 → Stage 2: Dry Run ───────────────────────────────────────────────

  const handleValidate = async () => {
    if (!file) return;
    setStage("processing");
    const res = await onImport(file, true);   // dryRun = true
    if (res) {
      setDryResult(res);
      setStage("preview");
    } else {
      setStage("drop");
    }
  };

  // ── Stage 2 → Stage 3: Real Import ───────────────────────────────────────────

  const handleConfirmImport = async () => {
    if (!file) return;
    setStage("processing");
    const res = await onImport(file, false);  // dryRun = false
    if (res) {
      setRealResult(res);
      setStage("result");
      if (res.error_count === 0) onSuccess();
    } else {
      setStage("preview");
    }
  };

  // ── Reset ────────────────────────────────────────────────────────────────────

  const reset = () => {
    setFile(null);
    setDryResult(null);
    setRealResult(null);
    setStage("drop");
    setShowErrors(false);
  };

  // ── Derived values ────────────────────────────────────────────────────────────

  const previewData = dryResult  ? splitErrors(dryResult)  : null;
  const resultData  = realResult ? splitErrors(realResult) : null;
  const dryAllGood  = dryResult  && dryResult.error_count === 0 && dryResult.total_rows > 0;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      {/* Modal card */}
      <motion.div
        className="relative z-10 w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "var(--background)", border: "1px solid var(--border)" }}
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        transition={{ duration: 0.18 }}
      >
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: "var(--primary-light)" }}
            >
              <FileSpreadsheet className="w-5 h-5" style={{ color: "var(--primary)" }} />
            </div>
            <div>
              <p className="font-semibold text-sm" style={{ color: "var(--foreground)" }}>
                Import {modelLabel}
              </p>
              <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                {stage === "drop"       && "Upload a CSV or XLSX file"}
                {stage === "processing" && "Validating your file…"}
                {stage === "preview"    && (dryAllGood ? "Validation passed — ready to import" : "Validation issues found")}
                {stage === "result"     && "Import complete"}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: "var(--foreground-muted)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Stage progress dots ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-5 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          {(["drop", "preview", "result"] as const).map((s, i) => {
            const stageIdx  = ["drop", "preview", "result"].indexOf(stage);
            const thisIdx   = i;
            const active    = stage === s;
            const done      = thisIdx < stageIdx || stage === "processing" && thisIdx <= 0;
            return (
              <div key={s} className="flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                  style={{
                    background: active || done ? "var(--primary)" : "var(--border)",
                    color:      active || done ? "#fff" : "var(--foreground-muted)",
                  }}
                >
                  {i + 1}
                </div>
                <span
                  className="text-xs"
                  style={{ color: active ? "var(--foreground)" : "var(--foreground-muted)" }}
                >
                  {["Select file", "Validate", "Done"][i]}
                </span>
                {i < 2 && (
                  <div
                    className="w-8 h-px mx-1"
                    style={{ background: thisIdx < stageIdx ? "var(--primary)" : "var(--border)" }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* ── Body ───────────────────────────────────────────────────────────── */}
        <div className="p-5">
          <AnimatePresence mode="wait">

            {/* ════ Stage 1: Drop Zone ════════════════════════════════════════ */}
            {(stage === "drop") && (
              <motion.div
                key="drop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                {/* Drop area */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => inputRef.current?.click()}
                  className="relative cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all"
                  style={{
                    borderColor: dragOver || file ? "var(--primary)" : "var(--border)",
                    background:  dragOver || file ? "var(--primary-light)" : "transparent",
                  }}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    className="hidden"
                    accept=".csv,.xlsx"
                    onChange={handleFileChange}
                  />

                  {file ? (
                    <div className="flex flex-col items-center gap-2">
                      <FileSpreadsheet className="w-10 h-10" style={{ color: "var(--primary)" }} />
                      <p className="font-semibold text-sm" style={{ color: "var(--foreground)" }}>
                        {file.name}
                      </p>
                      <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                        {(file.size / 1024).toFixed(1)} KB ·{" "}
                        <span
                          className="underline cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); setFile(null); }}
                        >
                          Remove
                        </span>
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <Upload className="w-10 h-10" style={{ color: "var(--foreground-muted)" }} />
                      <p className="font-medium text-sm" style={{ color: "var(--foreground)" }}>
                        Drag & drop or click to select
                      </p>
                      <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                        Accepts CSV or Excel (.xlsx) · Max 5,000 rows
                      </p>
                    </div>
                  )}
                </div>

                {/* Template download tip */}
                <div
                  className="flex items-center justify-between rounded-lg px-4 py-3"
                  style={{ background: "var(--primary-light)", border: "1px solid var(--border)" }}
                >
                  <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                    Need the correct column headers? Download the template.
                  </p>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDownloadTemplate(); }}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                    style={{ color: "var(--primary)", background: "var(--background)" }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Template
                  </button>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={onClose}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors"
                    style={{ background: "var(--surface)", color: "var(--foreground-muted)", border: "1px solid var(--border)" }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleValidate}
                    disabled={!file}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
                    style={{ background: "var(--primary)", color: "#fff" }}
                  >
                    Validate File
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ════ Stage: Processing ═════════════════════════════════════════ */}
            {stage === "processing" && (
              <motion.div
                key="processing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 py-12"
              >
                <Loader2 className="w-10 h-10 animate-spin" style={{ color: "var(--primary)" }} />
                <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                  {importing ? "Importing records…" : "Validating file…"}
                </p>
                <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                  Checking headers, field types, and required values
                </p>
              </motion.div>
            )}

            {/* ════ Stage 2: Dry-run Preview ══════════════════════════════════ */}
            {stage === "preview" && dryResult && previewData && (
              <motion.div
                key="preview"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                {/* Summary banner */}
                <div
                  className="flex items-start gap-3 rounded-xl p-4"
                  style={{
                    background: dryAllGood ? "var(--primary-light)" : "#fef2f2",
                    border:     `1px solid ${dryAllGood ? "var(--primary)" : "#fca5a5"}`,
                  }}
                >
                  {dryAllGood ? (
                    <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "var(--primary)" }} />
                  ) : (
                    <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-amber-500" />
                  )}
                  <div>
                    <p className="font-semibold text-sm" style={{ color: "var(--foreground)" }}>
                      {dryAllGood
                        ? `${dryResult.success_count} of ${dryResult.total_rows} rows ready to import`
                        : `${dryResult.error_count} error${dryResult.error_count !== 1 ? "s" : ""} found in ${dryResult.total_rows} rows`}
                    </p>
                    {dryResult.error_count > 0 && dryResult.success_count > 0 && (
                      <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
                        {dryResult.success_count} row{dryResult.success_count !== 1 ? "s" : ""} would be imported —{" "}
                        {dryResult.error_count} would be skipped
                      </p>
                    )}
                  </div>
                </div>

                {/* Header errors */}
                {previewData.headerErrors.length > 0 && (
                  <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #fca5a5" }}>
                    <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: "#fef2f2" }}>
                      <XCircle className="w-4 h-4 text-red-500" />
                      <p className="text-xs font-semibold text-red-700">Column header errors</p>
                    </div>
                    <ul className="px-4 py-3 space-y-1">
                      {previewData.headerErrors.map((e, i) => (
                        <li key={i} className="text-xs text-red-600 flex items-start gap-1.5">
                          <span className="mt-0.5 shrink-0">•</span> {e}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Row errors (collapsible) */}
                {previewData.rowErrors.length > 0 && (
                  <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                    <button
                      onClick={() => setShowErrors((v) => !v)}
                      className="w-full px-4 py-3 flex items-center justify-between transition-colors hover:opacity-80"
                      style={{ background: "var(--surface)" }}
                    >
                      <span className="text-xs font-semibold flex items-center gap-2" style={{ color: "var(--foreground)" }}>
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        Row errors ({previewData.rowErrors.length})
                      </span>
                      {showErrors
                        ? <ChevronUp className="w-4 h-4" style={{ color: "var(--foreground-muted)" }} />
                        : <ChevronDown className="w-4 h-4" style={{ color: "var(--foreground-muted)" }} />}
                    </button>

                    <AnimatePresence>
                      {showErrors && (
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: "auto" }}
                          exit={{ height: 0 }}
                          className="overflow-hidden"
                        >
                          <div
                            className="max-h-48 overflow-y-auto divide-y text-xs"
                            style={{ borderTop: "1px solid var(--border)" }}
                          >
                            {previewData.rowErrors.slice(0, 50).map((e, i) => (
                              <div key={i} className="px-4 py-2.5">
                                <p className="font-semibold mb-0.5" style={{ color: "var(--foreground)" }}>
                                  Row {e.row_number}
                                </p>
                                <p className="text-red-500">{formatRowErrors(e.errors)}</p>
                              </div>
                            ))}
                            {previewData.rowErrors.length > 50 && (
                              <p className="px-4 py-2" style={{ color: "var(--foreground-muted)" }}>
                                …and {previewData.rowErrors.length - 50} more
                              </p>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={reset}
                    className="flex items-center justify-center gap-2 flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors"
                    style={{ background: "var(--surface)", color: "var(--foreground-muted)", border: "1px solid var(--border)" }}
                  >
                    <RefreshCcw className="w-3.5 h-3.5" />
                    Change File
                  </button>

                  {dryAllGood ? (
                    <button
                      onClick={handleConfirmImport}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
                      style={{ background: "var(--primary)", color: "#fff" }}
                    >
                      Import {dryResult.success_count} Records
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  ) : (
                    // Partial — still allow import of valid rows
                    dryResult.success_count > 0 ? (
                      <button
                        onClick={handleConfirmImport}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
                        style={{ background: "var(--primary)", color: "#fff" }}
                      >
                        Import {dryResult.success_count} valid rows
                      </button>
                    ) : (
                      <button
                        disabled
                        className="flex-1 py-2.5 rounded-xl text-sm font-semibold opacity-40"
                        style={{ background: "var(--border)", color: "var(--foreground-muted)" }}
                      >
                        No valid rows to import
                      </button>
                    )
                  )}
                </div>
              </motion.div>
            )}

            {/* ════ Stage 3: Result ════════════════════════════════════════════ */}
            {stage === "result" && realResult && resultData && (() => {
              const allOk = realResult.error_count === 0;
              return (
                <motion.div
                  key="result"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  {/* Summary */}
                  <div
                    className="flex items-start gap-3 rounded-xl p-4"
                    style={{
                      background: allOk ? "var(--primary-light)" : "#fef2f2",
                      border:     `1px solid ${allOk ? "var(--primary)" : "#fca5a5"}`,
                    }}
                  >
                    {allOk ? (
                      <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "var(--primary)" }} />
                    ) : (
                      <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-amber-500" />
                    )}
                    <div>
                      <p className="font-semibold text-sm" style={{ color: "var(--foreground)" }}>
                        {realResult.success_count} record{realResult.success_count !== 1 ? "s" : ""} imported successfully
                      </p>
                      {realResult.error_count > 0 && (
                        <p className="text-xs mt-0.5 text-red-600">
                          {realResult.error_count} row{realResult.error_count !== 1 ? "s" : ""} skipped due to errors
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Skipped row errors */}
                  {resultData.rowErrors.length > 0 && (
                    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                      <button
                        onClick={() => setShowErrors((v) => !v)}
                        className="w-full px-4 py-3 flex items-center justify-between"
                        style={{ background: "var(--surface)" }}
                      >
                        <span className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>
                          Skipped rows ({resultData.rowErrors.length})
                        </span>
                        {showErrors ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      <AnimatePresence>
                        {showErrors && (
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: "auto" }}
                            exit={{ height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="max-h-40 overflow-y-auto divide-y text-xs" style={{ borderTop: "1px solid var(--border)" }}>
                              {resultData.rowErrors.map((e, i) => (
                                <div key={i} className="px-4 py-2.5">
                                  <p className="font-semibold mb-0.5" style={{ color: "var(--foreground)" }}>Row {e.row_number}</p>
                                  <p className="text-red-500">{formatRowErrors(e.errors)}</p>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-3 pt-1">
                    {realResult.error_count > 0 && (
                      <button
                        onClick={reset}
                        className="flex items-center justify-center gap-2 flex-1 py-2.5 rounded-xl text-sm font-medium"
                        style={{ background: "var(--surface)", color: "var(--foreground-muted)", border: "1px solid var(--border)" }}
                      >
                        <RefreshCcw className="w-3.5 h-3.5" />
                        Fix & Re-import
                      </button>
                    )}
                    <button
                      onClick={onClose}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                      style={{ background: "var(--primary)", color: "#fff" }}
                    >
                      Done
                    </button>
                  </div>
                </motion.div>
              );
            })()}

          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
