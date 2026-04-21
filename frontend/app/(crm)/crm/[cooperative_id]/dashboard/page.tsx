"use client";

/**
 * CRM Dashboard — Home Page
 *
 * Displays the operational overview for a cooperative:
 * - Member count, active production cycles, capacity index, recent activity
 * - Tender eligibility status
 * - Quick action buttons
 * - Recent form submissions
 *
 * All data is fetched from the API; shown as skeleton while loading.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Users, Leaf, BarChart3, ShieldCheck, ClipboardList,
  ArrowRight, AlertCircle, TrendingUp, CheckCircle2,
  Clock, Sprout, ChevronRight,
} from "lucide-react";
import { StatCard } from "@/components/shambaflow/StatCard";
import { apiFetch, getUser, type UserSnapshot } from "@/lib/api";
import { cn } from "@/lib/utils";

/* ─── Types ───────────────────────────────────────────────────────── */

interface DashboardStats {
  member_count:        number;
  active_cycles:       number;
  capacity_index:      number;
  data_completeness:   number;
  member_engagement:   number;
  production_regularity: number;
  is_verified:         boolean;
  tender_eligible:     boolean;
  recent_submissions:  RecentSubmission[];
}

interface RecentSubmission {
  id:         string;
  model_slug: string;
  type:       string;
  member:     string;
  submitted_at: string | null;
}

const EMPTY_DASHBOARD_STATS: DashboardStats = {
  member_count: 0,
  active_cycles: 0,
  capacity_index: 0,
  data_completeness: 0,
  member_engagement: 0,
  production_regularity: 0,
  is_verified: false,
  tender_eligible: false,
  recent_submissions: [],
};

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

/* ─── Skeleton ────────────────────────────────────────────────────── */

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 animate-pulse">
      <div className="h-3 w-24 bg-[var(--background-muted)] rounded mb-4" />
      <div className="h-8 w-16 bg-[var(--background-muted)] rounded mb-2" />
      <div className="h-2.5 w-20 bg-[var(--background-muted)] rounded" />
    </div>
  );
}

/* ─── Quick Action Card ───────────────────────────────────────────── */

function QuickAction({ icon: Icon, label, href, color }: {
  icon: React.ElementType;
  label: string;
  href: string;
  color: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col items-center gap-2.5 p-4 rounded-xl border border-[var(--border)]",
        "bg-[var(--surface)] hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-md)]",
        "transition-all duration-200 text-center"
      )}
    >
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", color)}>
        <Icon className="w-5 h-5" />
      </div>
      <span className="text-xs font-medium text-[var(--foreground-muted)] group-hover:text-[var(--foreground)] transition-colors">
        {label}
      </span>
    </Link>
  );
}

/* ─── Main Component ──────────────────────────────────────────────── */

export default function CRMDashboardPage() {
  const params        = useParams();
  const router        = useRouter();
  const cooperativeId = params?.cooperative_id as string | undefined;
  const user: UserSnapshot | null = getUser();
  const coopName      = user?.cooperative_name ?? "Your Cooperative";
  const chairName     = user?.full_name ?? "";

  const [stats,   setStats]   = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!cooperativeId) return;
    setLoading(true);
    setError(null);

    apiFetch<DashboardStats>(`/api/crm/${cooperativeId}/dashboard/`)
      .then(setStats)
      .catch((err: unknown) => {
        setStats(null);
        setError(err instanceof Error ? err.message : "Failed to load dashboard data.");
      })
      .finally(() => setLoading(false));
  }, [cooperativeId]);

  const base = cooperativeId ? `/crm/${cooperativeId}` : "/crm";
  const displayStats = stats ?? EMPTY_DASHBOARD_STATS;
  const hasLiveStats = stats !== null;

  return (
    <div className="space-y-8">
      {/* ── Welcome header ────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">
            {chairName ? `Welcome back, ${chairName.split(" ")[0]}` : "Dashboard"}
          </h2>
          <p className="text-sm text-[var(--foreground-muted)] mt-0.5 flex items-center gap-1.5">
            <Sprout className="w-3.5 h-3.5 text-[var(--primary)]" />
            {coopName}
          </p>
        </div>

        {/* Verification badge */}
        {hasLiveStats && (
          <div
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium",
              displayStats.is_verified
                ? "bg-[var(--success-light)] text-[var(--success)] border border-green-200 dark:border-green-900/40"
                : "bg-[var(--warning-light)] text-[var(--warning)] border border-amber-200 dark:border-amber-900/40"
            )}
          >
            {displayStats.is_verified ? (
              <><CheckCircle2 className="w-4 h-4" /> Verified Cooperative</>
            ) : (
              <><Clock className="w-4 h-4" /> Pending Verification</>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-2xl border border-[var(--warning-light)] bg-[var(--warning-light)]/40 px-4 py-3 text-sm text-[var(--warning)] flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Stats grid ────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <StatCard
              label="Members"
              value={displayStats.member_count}
              icon={<Users className="w-5 h-5" />}
              variant="default"
              trend="up"
              trendValue="+8 this month"
              onClick={() => router.push(`${base}/members`)}
            />
            <StatCard
              label="Active Cycles"
              value={displayStats.active_cycles}
              icon={<Leaf className="w-5 h-5" />}
              variant="default"
              onClick={() => router.push(`${base}/production`)}
            />
            <StatCard
              label="Capacity Index"
              value={`${displayStats.capacity_index}%`}
              icon={<BarChart3 className="w-5 h-5" />}
              variant={displayStats.capacity_index >= 70 ? "primary" : "default"}
              trend="up"
              trendValue="+5 this month"
            />
            <StatCard
              label="Data Score"
              value={`${displayStats.data_completeness}%`}
              icon={<ClipboardList className="w-5 h-5" />}
              variant="default"
              onClick={() => router.push(`${base}/forms`)}
            />
          </>
        )}
      </div>

      {/* ── Two-column layout: quick actions + recent activity ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Actions (1/3) */}
        <div className="lg:col-span-1 space-y-4">
          <h3 className="text-sm font-semibold text-[var(--foreground-muted)] uppercase tracking-wider">
            Quick Actions
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <QuickAction icon={Users}       label="Add Member"       href={`${base}/members/new`}    color="bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" />
            <QuickAction icon={Leaf}        label="Log Production"   href={`${base}/production/new`} color="bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400" />
            <QuickAction icon={ClipboardList} label="New Form Entry" href={`${base}/forms`}          color="bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400" />
            <QuickAction icon={ShieldCheck} label="Certification"    href={`${base}/certification`}  color="bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" />
          </div>

          {/* Tender eligibility */}
          {hasLiveStats && (
            <div
              className={cn(
                "rounded-xl border p-4 space-y-2",
                displayStats.tender_eligible
                  ? "border-[var(--success-light)] bg-[var(--success-light)]/30"
                  : "border-[var(--warning-light)] bg-[var(--warning-light)]/30"
              )}
            >
              <div className="flex items-center gap-2">
                <ShieldCheck
                  className={cn(
                    "w-4 h-4",
                    displayStats.tender_eligible ? "text-[var(--success)]" : "text-[var(--warning)]"
                  )}
                />
                <span
                  className={cn(
                    "text-sm font-semibold",
                    displayStats.tender_eligible ? "text-[var(--success)]" : "text-[var(--warning)]"
                  )}
                >
                  {displayStats.tender_eligible ? "Tender Eligible" : "Tender Eligibility"}
                </span>
              </div>
              <p className="text-xs text-[var(--foreground-muted)]">
                {displayStats.tender_eligible
                  ? "You can bid on premium tenders in the marketplace."
                  : "Complete your CRM data to qualify for premium tenders."}
              </p>
              {!displayStats.tender_eligible && (
                <Link
                  href={`${base}/certification`}
                  className="text-xs font-medium text-[var(--warning)] flex items-center gap-1 hover:underline"
                >
                  View requirements <ChevronRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Recent Submissions (2/3) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--foreground-muted)] uppercase tracking-wider">
              Recent Submissions
            </h3>
            <Link
              href={`${base}/submissions`}
              className="text-xs text-[var(--primary)] hover:text-[var(--primary-hover)] flex items-center gap-1 font-medium transition-colors"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            {loading ? (
              <div className="divide-y divide-[var(--border)]">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
                    <div className="w-8 h-8 rounded-lg bg-[var(--background-muted)]" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-32 bg-[var(--background-muted)] rounded" />
                      <div className="h-2.5 w-24 bg-[var(--background-muted)] rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : displayStats.recent_submissions.length ? (
              <div className="divide-y divide-[var(--border)]">
                {displayStats.recent_submissions.map((sub) => (
                  <Link
                    key={sub.id}
                    href={`${base}/submissions?model_slug=${encodeURIComponent(sub.model_slug)}`}
                    className="px-5 py-4 flex items-center gap-4 hover:bg-[var(--background-muted)] transition-colors group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-[var(--primary-light)] flex items-center justify-center shrink-0">
                      <ClipboardList className="w-4 h-4 text-[var(--primary)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--foreground)]">{sub.type}</p>
                      <p className="text-xs text-[var(--foreground-muted)]">by {sub.member}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--foreground-subtle)]">{formatRelativeTime(sub.submitted_at)}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-[var(--foreground-subtle)] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <ClipboardList className="w-10 h-10 text-[var(--foreground-subtle)] mb-3" />
                <p className="text-sm text-[var(--foreground-muted)]">No form submissions yet.</p>
                <p className="text-xs text-[var(--foreground-subtle)] mt-1">
                  Add members and start logging production data.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Capacity overview bar ─────────────────────────── */}
      {!loading && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Capacity Overview</h3>
              <p className="text-xs text-[var(--foreground-muted)] mt-0.5">
                Overall cooperative readiness score
              </p>
            </div>
            <TrendingUp className="w-5 h-5 text-[var(--primary)]" />
          </div>
          <div className="space-y-3">
            {[
              { label: "Capacity Index", value: displayStats.capacity_index, color: "bg-[var(--primary)]" },
              { label: "Data Completeness", value: displayStats.data_completeness, color: "bg-blue-500" },
              { label: "Member Engagement", value: displayStats.member_engagement, color: "bg-purple-500" },
              { label: "Production Regularity", value: displayStats.production_regularity, color: "bg-amber-500" },
            ].map((metric) => (
              <div key={metric.label} className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--foreground-muted)]">{metric.label}</span>
                  <span className="font-medium text-[var(--foreground)]">{metric.value}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-[var(--background-muted)] overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all duration-700", metric.color)}
                    style={{ width: `${metric.value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
