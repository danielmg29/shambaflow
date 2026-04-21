"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Filter,
  FolderKanban,
  Search,
  UserRound,
} from "lucide-react";

import ModelAnalyticsPanel from "@/components/crm/model-analytics-panel";
import type { CRMAnalyticsCard, CRMAnalyticsChart, CRMAnalyticsHighlight } from "@/hooks/useCRMData";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

interface SubmissionItem {
  id: string;
  model_slug: string;
  module_label: string;
  type: string;
  title: string;
  member: string;
  member_id?: string | null;
  member_route?: string;
  submitted_at: string | null;
  collection_scope: string;
  route: string;
}

interface ModuleOption {
  value: string;
  label: string;
  count: number;
}

interface SubmissionsPayload {
  data: SubmissionItem[];
  page: number;
  page_size: number;
  total_pages: number;
  total_count: number;
  has_next: boolean;
  has_previous: boolean;
  cards: CRMAnalyticsCard[];
  charts: CRMAnalyticsChart[];
  highlights: CRMAnalyticsHighlight[];
  module_options: ModuleOption[];
}

const RELATIVE_TIME_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];

function formatRelativeTime(value: string | null | undefined) {
  if (!value) return "Recently";

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Recently";

  const deltaSeconds = Math.round((timestamp.getTime() - Date.now()) / 1000);
  const absoluteSeconds = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  for (const [unit, seconds] of RELATIVE_TIME_UNITS) {
    if (absoluteSeconds >= seconds) {
      return formatter.format(Math.round(deltaSeconds / seconds), unit);
    }
  }

  return formatter.format(deltaSeconds, "second");
}

function scopeLabel(scope: string) {
  return scope === "MEMBER" ? "Member-linked" : "Cooperative";
}

export default function CRMSubmissionsPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const cooperativeId = params?.cooperative_id as string;

  const initialSearch = searchParams.get("search") ?? "";
  const initialModel = searchParams.get("model_slug") ?? "";
  const initialPage = Number(searchParams.get("page") ?? "1") || 1;

  const [payload, setPayload] = useState<SubmissionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [appliedSearch, setAppliedSearch] = useState(initialSearch);
  const [modelFilter, setModelFilter] = useState(initialModel);
  const [page, setPage] = useState(initialPage);

  const syncUrl = useCallback((nextSearch: string, nextModel: string, nextPage: number) => {
    if (!cooperativeId) return;
    const query = new URLSearchParams();
    if (nextSearch) query.set("search", nextSearch);
    if (nextModel) query.set("model_slug", nextModel);
    if (nextPage > 1) query.set("page", String(nextPage));
    const href = query.toString()
      ? `/crm/${cooperativeId}/submissions?${query}`
      : `/crm/${cooperativeId}/submissions`;
    router.replace(href);
  }, [cooperativeId, router]);

  const fetchWorkspace = useCallback(async () => {
    if (!cooperativeId) return;

    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        page: String(page),
        page_size: "20",
      });
      if (appliedSearch) query.set("search", appliedSearch);
      if (modelFilter) query.set("model_slug", modelFilter);

      const nextPayload = await apiFetch<SubmissionsPayload>(`/api/crm/${cooperativeId}/submissions/?${query}`);
      setPayload(nextPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load submissions workspace.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, cooperativeId, modelFilter, page]);

  useEffect(() => {
    if (!cooperativeId) return;
    syncUrl(appliedSearch, modelFilter, page);
  }, [appliedSearch, cooperativeId, modelFilter, page, syncUrl]);

  useEffect(() => {
    void fetchWorkspace();
  }, [fetchWorkspace]);

  const activeModuleLabel = useMemo(
    () => payload?.module_options.find((option) => option.value === modelFilter)?.label ?? "All modules",
    [modelFilter, payload?.module_options]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--foreground-subtle)]">
            CRM Workspace
          </p>
          <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">Submissions</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--foreground-muted)]">
            Review all cooperative submissions in one place, with activity trends and module-level coverage that go beyond the dashboard snapshot.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/crm/${cooperativeId}/certification`}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
          >
            <FolderKanban className="h-4 w-4" />
            Certification Workspace
          </Link>
        </div>
      </div>

      <ModelAnalyticsPanel
        modelSlug="workspace"
        analytics={payload ? { cards: payload.cards, charts: payload.charts, highlights: payload.highlights } : null}
        loading={loading}
        error={error}
        onRetry={() => { void fetchWorkspace(); }}
      />

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">Filter Activity</h2>
            <p className="mt-1 text-sm text-[var(--foreground-muted)]">
              Currently viewing <span className="font-medium text-[var(--foreground)]">{activeModuleLabel}</span>.
            </p>
          </div>

          <form
            className="flex w-full max-w-xl items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setAppliedSearch(searchInput.trim());
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--foreground-subtle)]" />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search by title, member, or module"
                className="h-11 w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] pl-10 pr-4 text-sm text-[var(--input-text)] outline-none transition-colors focus:border-[var(--input-border-focus)] focus:ring-2 focus:ring-[var(--border-focus)]"
              />
            </div>
            <button
              type="submit"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-fg)] transition-colors hover:bg-[var(--primary-hover)]"
            >
              <Filter className="h-4 w-4" />
              Apply
            </button>
          </form>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setPage(1);
              setModelFilter("");
            }}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              !modelFilter
                ? "border-[var(--primary)] bg-[var(--primary-light)] text-[var(--primary)]"
                : "border-[var(--border)] text-[var(--foreground-muted)] hover:border-[var(--primary)]/30 hover:text-[var(--foreground)]"
            )}
          >
            All modules
          </button>
          {payload?.module_options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setPage(1);
                setModelFilter(option.value);
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                modelFilter === option.value
                  ? "border-[var(--primary)] bg-[var(--primary-light)] text-[var(--primary)]"
                  : "border-[var(--border)] text-[var(--foreground-muted)] hover:border-[var(--primary)]/30 hover:text-[var(--foreground)]"
              )}
            >
              {option.label} · {option.count}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-[var(--border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">All Submissions</h2>
            <p className="mt-1 text-sm text-[var(--foreground-muted)]">
              {loading ? "Loading submissions…" : `${payload?.total_count ?? 0} total entries in this workspace.`}
            </p>
          </div>
          {payload && payload.total_count > 0 && (
            <p className="text-xs font-medium text-[var(--foreground-subtle)]">
              Page {payload.page} of {Math.max(payload.total_pages, 1)}
            </p>
          )}
        </div>

        {loading ? (
          <div className="divide-y divide-[var(--border)]">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="animate-pulse px-5 py-4">
                <div className="h-4 w-48 rounded bg-[var(--background-muted)]" />
                <div className="mt-3 h-3 w-80 rounded bg-[var(--background-muted)]" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="px-5 py-12 text-center">
            <ClipboardList className="mx-auto h-10 w-10 text-[var(--destructive)]" />
            <p className="mt-4 text-sm font-medium text-[var(--destructive)]">{error}</p>
            <button
              type="button"
              onClick={() => { void fetchWorkspace(); }}
              className="mt-4 inline-flex h-10 items-center rounded-xl border border-[var(--border)] px-4 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/30 hover:text-[var(--primary)]"
            >
              Retry
            </button>
          </div>
        ) : payload?.data.length ? (
          <div className="divide-y divide-[var(--border)]">
            {payload.data.map((submission) => (
              <div key={`${submission.model_slug}-${submission.id}`} className="px-5 py-4 transition-colors hover:bg-[var(--background-muted)]/60">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--primary-light)] text-[var(--primary)]">
                        <ClipboardList className="h-4 w-4" />
                      </span>
                      <span className="rounded-full bg-[var(--background-muted)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
                        {submission.module_label}
                      </span>
                      <span className="rounded-full bg-[var(--success-light)]/70 px-2.5 py-1 text-[11px] font-semibold text-[var(--success)]">
                        {scopeLabel(submission.collection_scope)}
                      </span>
                    </div>

                    <div className="mt-3">
                      <p className="text-base font-semibold text-[var(--foreground)]">
                        {submission.title || submission.type}
                      </p>
                      <p className="mt-1 text-sm text-[var(--foreground-muted)]">
                        {submission.type}
                      </p>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--foreground-muted)]">
                      <span className="inline-flex items-center gap-1.5">
                        <UserRound className="h-4 w-4 text-[var(--foreground-subtle)]" />
                        {submission.member_route ? (
                          <Link href={submission.member_route} className="font-medium text-[var(--foreground)] hover:text-[var(--primary)]">
                            {submission.member}
                          </Link>
                        ) : (
                          <span className="font-medium text-[var(--foreground)]">{submission.member}</span>
                        )}
                      </span>
                      <span>{formatRelativeTime(submission.submitted_at)}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Link
                      href={submission.route}
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] px-4 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/30 hover:text-[var(--primary)]"
                    >
                      Open module
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-14 text-center">
            <ClipboardList className="mx-auto h-12 w-12 text-[var(--foreground-subtle)]" />
            <p className="mt-4 text-base font-semibold text-[var(--foreground)]">No submissions matched this view.</p>
            <p className="mt-2 text-sm text-[var(--foreground-muted)]">
              Try a different module filter or clear the search to see more activity.
            </p>
          </div>
        )}

        {payload && payload.total_pages > 1 && (
          <div className="flex flex-col gap-3 border-t border-[var(--border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[var(--foreground-muted)]">
              Showing page {payload.page} of {payload.total_pages}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!payload.has_previous}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] px-4 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/30 hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>
              <button
                type="button"
                disabled={!payload.has_next}
                onClick={() => setPage((current) => current + 1)}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] px-4 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/30 hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
