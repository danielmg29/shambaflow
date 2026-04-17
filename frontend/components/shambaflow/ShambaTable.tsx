"use client";

/**
 * ShambaTable — Adaptive Data Table
 *
 * Variants: "members" | "tenders" | "bids" | "default"
 *
 * Toolbar (right side of header row):
 *  • Import CSV  — file picker, calls onImport with parsed rows
 *  • Import XLSX — file picker, calls onImport with parsed rows
 *  • Export CSV  — downloads filtered data as .csv
 *  • Export XLSX — downloads filtered data as .xlsx via SheetJS
 *
 * Adaptive Convergence: columns and cell renderers are schema-driven.
 */

import { useState, useRef, useCallback, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search, MoreHorizontal, ChevronLeft, ChevronRight,
  ArrowUpDown, ArrowUp, ArrowDown,
  Upload, Download, FileSpreadsheet, FileText, ChevronDown,
} from "lucide-react";

/* ─── Types ───────────────────────────────────────────────────────── */

export type TableVariant  = "members" | "tenders" | "bids" | "default";
export type SortDirection = "asc" | "desc" | null;

export interface ColumnDef<T = any> {
  key:         string;
  label:       string;
  sortable?:   boolean;
  width?:      string;
  render?:     (value: any, row: T) => React.ReactNode;
  mobileHide?: boolean;
}

export interface RowAction<T = any> {
  label:    string;
  onClick:  (row: T) => void;
  variant?: "default" | "destructive";
}

export interface ShambaTableProps<T = any> {
  variant?:            TableVariant;
  columns:             ColumnDef<T>[];
  data:                T[];
  keyField:            string;
  loading?:            boolean;
  searchable?:         boolean;
  searchPlaceholder?:  string;
  totalCount?:         number;
  page?:               number;
  pageSize?:           number;
  onPageChange?:       (page: number) => void;
  onSort?:             (key: string, direction: SortDirection) => void;
  onImport?:           (rows: Record<string, string>[], fileType: "csv" | "xlsx") => void;
  rowActions?:         RowAction<T>[];
  emptyMessage?:       string;
  className?:          string;
  exportFileName?:     string;
  toolbarActions?:     ReactNode;
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

function SortIcon({ direction }: { direction: SortDirection }) {
  if (direction === "asc")  return <ArrowUp   size={12} className="text-primary" />;
  if (direction === "desc") return <ArrowDown size={12} className="text-primary" />;
  return <ArrowUpDown size={12} className="text-muted-foreground opacity-60" />;
}

function SkeletonRow({ colCount }: { colCount: number }) {
  return (
    <TableRow>
      {Array.from({ length: colCount }).map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 bg-muted rounded animate-pulse" style={{ width: `${60 + (i % 3) * 15}%` }} />
        </TableCell>
      ))}
    </TableRow>
  );
}

function rowsToCsv(rows: Record<string, any>[], columns: ColumnDef[]): string {
  const headers = columns.map((c) => `"${c.label}"`).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => `"${String(row[c.key] ?? "").replace(/"/g, '""')}"`).join(",")
  );
  return [headers, ...lines].join("\n");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href    = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseCsv(text: string): Record<string, string>[] {
  const lines   = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.replace(/^"|"$/g, "").trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
}

/* ─── Component ────────────────────────────────────────────────────── */

export function ShambaTable<T = any>({
  variant           = "default",
  columns,
  data,
  keyField,
  loading           = false,
  searchable        = true,
  searchPlaceholder = "Search...",
  totalCount,
  page              = 1,
  pageSize          = 20,
  onPageChange,
  onSort,
  onImport,
  rowActions        = [],
  emptyMessage      = "No records found.",
  className,
  exportFileName    = "shambaflow-export",
  toolbarActions,
}: ShambaTableProps<T>) {
  const [search,  setSearch]  = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>(null);

  const csvInputRef  = useRef<HTMLInputElement>(null);
  const xlsxInputRef = useRef<HTMLInputElement>(null);

  const filteredData = search
    ? data.filter((row) => Object.values(row).some((v) => String(v).toLowerCase().includes(search.toLowerCase())))
    : data;

  const handleSort = (key: string) => {
    const next: SortDirection = sortKey !== key ? "asc" : sortDir === "asc" ? "desc" : null;
    setSortKey(next ? key : null);
    setSortDir(next);
    onSort?.(key, next);
  };

  const totalPages = totalCount ? Math.ceil(totalCount / pageSize) : 1;
  const accentRow  = variant === "members" ? "hover:bg-primary/5" : variant === "tenders" ? "hover:bg-secondary/5" : "hover:bg-muted/40";

  const handleExportCsv = useCallback(() => {
    const csv  = rowsToCsv(filteredData as Record<string, any>[], columns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, `${exportFileName}.csv`);
  }, [filteredData, columns, exportFileName]);

  const handleExportXlsx = useCallback(async () => {
    try {
      const XLSX = await import("xlsx");
      const ws   = XLSX.utils.json_to_sheet(filteredData.map((row) => Object.fromEntries(columns.map((c) => [c.label, row[c.key] ?? ""]))));
      const wb   = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Export");
      XLSX.writeFile(wb, `${exportFileName}.xlsx`);
    } catch {
      const csv  = rowsToCsv(filteredData as Record<string, any>[], columns);
      const blob = new Blob([csv], { type: "application/vnd.ms-excel" });
      downloadBlob(blob, `${exportFileName}.xlsx`);
    }
  }, [filteredData, columns, exportFileName]);

  const handleImportCsv = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onImport?.(parseCsv(ev.target?.result as string), "csv");
    reader.readAsText(file);
    e.target.value = "";
  }, [onImport]);

  const handleImportXlsx = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX   = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb     = XLSX.read(buffer, { type: "array" });
      const ws     = wb.Sheets[wb.SheetNames[0]];
      const rows   = XLSX.utils.sheet_to_json<Record<string, string>>(ws);
      onImport?.(rows, "xlsx");
    } catch { console.error("Failed to parse XLSX"); }
    e.target.value = "";
  }, [onImport]);

  return (
    <div className={`flex flex-col gap-3 ${className ?? ""}`}>

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">

        {/* Left — search + count */}
        <div className="flex items-center gap-3 flex-wrap flex-1">
          {searchable && (
            <div className="relative flex-1 max-w-xs min-w-[180px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={searchPlaceholder} className="pl-8 h-9 text-sm bg-background" />
            </div>
          )}
          {totalCount !== undefined && (
            <p className="text-xs text-muted-foreground whitespace-nowrap" style={{ fontFamily: "var(--font-sans)" }}>
              {filteredData.length} of {totalCount} records
            </p>
          )}
        </div>

        {/* Right — Import + custom actions + Export */}
        <div className="flex items-center gap-2">

          {/* Hidden file inputs */}
          <input ref={csvInputRef}  type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportCsv} />
          <input ref={xlsxInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportXlsx} />

          {/* Import */}
          {onImport && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-2 text-sm font-semibold border-border hover:border-primary/40 hover:text-primary transition-colors">
                  <Upload size={14} />
                  <span className="hidden sm:inline">Import</span>
                  <ChevronDown size={12} className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem className="gap-3 cursor-pointer py-2.5" onClick={() => csvInputRef.current?.click()}>
                  <FileText size={15} className="text-blue-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">Import CSV</p>
                    <p className="text-[10px] text-muted-foreground">Comma-separated values</p>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-3 cursor-pointer py-2.5" onClick={() => xlsxInputRef.current?.click()}>
                  <FileSpreadsheet size={15} className="text-green-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">Import Excel</p>
                    <p className="text-[10px] text-muted-foreground">.xlsx — Excel workbook</p>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {toolbarActions}

          {/* Export */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-2 text-sm font-semibold border-border hover:border-primary/40 hover:text-primary transition-colors">
                <Download size={14} />
                <span className="hidden sm:inline">Export</span>
                <ChevronDown size={12} className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <div className="px-2 py-1.5">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  {filteredData.length} row{filteredData.length !== 1 ? "s" : ""}
                </p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-3 cursor-pointer py-2.5" onClick={handleExportCsv}>
                <FileText size={15} className="text-blue-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Export as CSV</p>
                  <p className="text-[10px] text-muted-foreground">Universal — opens in any app</p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-3 cursor-pointer py-2.5" onClick={handleExportXlsx}>
                <FileSpreadsheet size={15} className="text-green-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Export as Excel</p>
                  <p className="text-[10px] text-muted-foreground">.xlsx — Microsoft Excel</p>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30 border-b border-border">
                {columns.map((col) => (
                  <TableHead key={col.key}
                    className={`text-xs font-bold text-foreground/60 uppercase tracking-wider whitespace-nowrap py-3 ${col.mobileHide ? "hidden sm:table-cell" : ""} ${col.width ?? ""}`}
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    {col.sortable ? (
                      <button onClick={() => handleSort(col.key)} className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                        {col.label} <SortIcon direction={sortKey === col.key ? sortDir : null} />
                      </button>
                    ) : col.label}
                  </TableHead>
                ))}
                {rowActions.length > 0 && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} colCount={columns.length + (rowActions.length ? 1 : 0)} />)
              ) : filteredData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length + (rowActions.length ? 1 : 0)} className="py-14 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                        <Search size={16} className="text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-sans)" }}>{emptyMessage}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredData.map((row, rowIndex) => (
                <motion.tr key={row[keyField]}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ duration: 0.18, delay: rowIndex * 0.025 }}
                  className={`border-b border-border/60 transition-colors ${accentRow} last:border-0`}
                >
                  {columns.map((col) => (
                    <TableCell key={col.key} className={`py-3.5 text-sm ${col.mobileHide ? "hidden sm:table-cell" : ""}`}>
                      {col.render ? col.render(row[col.key], row) : (
                        <span className="text-foreground/80" style={{ fontFamily: "var(--font-serif)" }}>{row[col.key] ?? "—"}</span>
                      )}
                    </TableCell>
                  ))}
                  {rowActions.length > 0 && (
                    <TableCell className="py-3.5 pr-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                            <MoreHorizontal size={15} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[150px]">
                          {rowActions.map((action, ai) => (
                            <DropdownMenuItem key={ai} onClick={() => action.onClick(row)}
                              className={`text-sm ${action.variant === "destructive" ? "text-destructive focus:text-destructive focus:bg-destructive/10" : ""}`}>
                              {action.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </motion.tr>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ── Pagination ──────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-sans)" }}>Page {page} of {totalPages}</p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => onPageChange?.(page - 1)}>
              <ChevronLeft size={14} />
            </Button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map((pageNum) => (
              <Button key={pageNum} variant={page === pageNum ? "default" : "outline"} size="sm"
                className={`h-7 w-7 p-0 text-xs ${page === pageNum ? "bg-primary hover:bg-primary/90 border-primary" : ""}`}
                onClick={() => onPageChange?.(pageNum)}>
                {pageNum}
              </Button>
            ))}
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page >= totalPages} onClick={() => onPageChange?.(page + 1)}>
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Pre-built column sets ───────────────────────────────────────── */

export const MEMBER_COLUMNS: ColumnDef[] = [
  {
    key: "name", label: "Member", sortable: true,
    render: (value, row) => (
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-[11px] font-bold flex-shrink-0">
          {String(value).slice(0, 2).toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground leading-none" style={{ fontFamily: "var(--font-sans)" }}>{value}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{row.member_id}</p>
        </div>
      </div>
    ),
  },
  { key: "region",          label: "Region",     sortable: true, mobileHide: true },
  { key: "production_type", label: "Production", mobileHide: true },
  {
    key: "status", label: "Status",
    render: (v) => {
      const cfg: Record<string, string> = {
        active: "bg-primary/10 text-primary border-primary/20",
        inactive: "bg-muted text-muted-foreground border-border",
        pending: "bg-amber-50 text-amber-700 border-amber-200",
      };
      return <Badge variant="outline" className={`text-[10px] ${cfg[v] ?? cfg.inactive}`}>{String(v).charAt(0).toUpperCase() + String(v).slice(1)}</Badge>;
    },
  },
  { key: "join_date", label: "Joined", sortable: true, mobileHide: true },
];

export const TENDER_COLUMNS: ColumnDef[] = [
  {
    key: "title", label: "Tender",
    render: (value, row) => (
      <div>
        <p className="text-sm font-semibold text-foreground leading-snug" style={{ fontFamily: "var(--font-sans)" }}>{value}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{row.product_type} · {row.region}</p>
      </div>
    ),
  },
  { key: "quantity_kg", label: "Volume (kg)", sortable: true, mobileHide: true, render: (v) => <span className="font-semibold text-foreground tabular-nums">{Number(v).toLocaleString()}</span> },
  { key: "deadline",    label: "Closes",      sortable: true, mobileHide: true },
  { key: "bid_count",   label: "Bids",        sortable: true },
  {
    key: "status", label: "Status",
    render: (v) => {
      const cfg: Record<string, string> = {
        open: "bg-primary/10 text-primary border-primary/20",
        closing_soon: "bg-amber-50 text-amber-700 border-amber-200",
        closed: "bg-muted text-muted-foreground border-border",
        awarded: "bg-secondary/15 text-secondary-foreground border-secondary/30",
      };
      const lbl: Record<string, string> = { open: "Open", closing_soon: "Closing Soon", closed: "Closed", awarded: "Awarded" };
      return <Badge variant="outline" className={`text-[10px] ${cfg[v] ?? cfg.closed}`}>{lbl[v] ?? v}</Badge>;
    },
  },
];

export const BID_COLUMNS: ColumnDef[] = [
  {
    key: "cooperative_name", label: "Cooperative",
    render: (value, row) => (
      <div>
        <p className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>{value}</p>
        <p className="text-[10px] text-muted-foreground">{row.region}</p>
      </div>
    ),
  },
  { key: "offered_price_kes", label: "Price / kg", sortable: true, render: (v) => <span className="font-semibold tabular-nums">KES {Number(v).toLocaleString()}</span> },
  {
    key: "capacity_score", label: "Capacity", sortable: true, mobileHide: true,
    render: (v) => (
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full" style={{ width: `${v}%` }} />
        </div>
        <span className="text-xs text-primary font-bold tabular-nums">{v}</span>
      </div>
    ),
  },
  { key: "submitted_at", label: "Submitted", sortable: true, mobileHide: true },
  {
    key: "status", label: "Status",
    render: (v) => {
      const cfg: Record<string, string> = {
        submitted: "bg-primary/10 text-primary border-primary/20",
        shortlisted: "bg-secondary/15 text-secondary-foreground border-secondary/30",
        rejected: "bg-muted text-muted-foreground border-border",
      };
      return <Badge variant="outline" className={`text-[10px] ${cfg[v] ?? cfg.submitted}`}>{String(v).charAt(0).toUpperCase() + String(v).slice(1)}</Badge>;
    },
  },
];
