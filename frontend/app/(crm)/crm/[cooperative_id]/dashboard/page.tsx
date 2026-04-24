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
  ArrowUpRight, Clock, Sprout, ChevronRight, BriefcaseBusiness,
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
  waste_volume_kg:     number;
  waste_rate:          number;
  is_verified:         boolean;
  tender_eligible:     boolean;
  recent_submissions:  RecentSubmission[];
  stat_cards: Array<{
    id: string;
    label: string;
    value: string | number;
    trend: "up" | "down" | "neutral";
    trend_value: string;
    tone: "default" | "primary" | "accent";
  }>;
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
  waste_volume_kg: 0,
  waste_rate: 0,
  is_verified: false,
  tender_eligible: false,
  recent_submissions: [],
  stat_cards: [],
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

const crmHeroStyle = {
  background:
    "radial-gradient(circle at top left, color-mix(in oklch, var(--secondary) 18%, transparent) 0%, transparent 30%), radial-gradient(circle at bottom right, color-mix(in oklch, var(--primary) 24%, transparent) 0%, transparent 34%), linear-gradient(128deg, color-mix(in oklch, var(--foreground) 86%, var(--primary) 14%) 0%, color-mix(in oklch, var(--primary) 78%, var(--foreground) 22%) 44%, color-mix(in oklch, var(--secondary) 52%, var(--primary) 48%) 100%)",
  boxShadow: "0 24px 84px color-mix(in oklch, var(--primary) 24%, transparent)",
};

const crmStatIcons = {
  members: <Users className="w-5 h-5" />,
  active_cycles: <Leaf className="w-5 h-5" />,
  capacity_index: <BarChart3 className="w-5 h-5" />,
  data_score: <ClipboardList className="w-5 h-5" />,
  waste_tracked: <AlertCircle className="w-5 h-5" />,
} as const;

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

function QuickAction({ icon: Icon, label, href, color, target, rel }: {
  icon: React.ElementType;
  label: string;
  href: string;
  color: string;
  target?: string;
  rel?: string;
}) {
  return (
    <Link
      href={href}
      target={target}
      rel={rel}
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
  const isChair       = user?.user_type === "CHAIR";

  const [stats,   setStats]   = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
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
  const marketplaceHref = "/marketplace/discover";
  const displayStats = stats ?? EMPTY_DASHBOARD_STATS;
  const hasLiveStats = stats !== null;

  return (
    <div className="space-y-8">
      <section
        className="overflow-hidden rounded-[30px] border border-[var(--border)] p-6 text-white sm:p-8"
        style={crmHeroStyle}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/88">
              <Sprout className="w-3.5 h-3.5" />
              Cooperative CRM
            </div>
            <div>
              <h2 className="text-3xl font-bold tracking-tight font-[var(--font-sans)]">
                {chairName ? `Welcome back, ${chairName.split(" ")[0]}` : "CRM Dashboard"}
              </h2>
              <p className="mt-2 flex items-center gap-2 text-sm text-white/80">
                <Sprout className="w-3.5 h-3.5 text-white/72" />
                {coopName}
              </p>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/78">
                Keep operations, production quality, and tender readiness aligned from one brand-led workspace.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {isChair && (
                <Link
                  href={marketplaceHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold shadow-[0_16px_40px_rgba(0,0,0,0.16)] transition-colors hover:bg-white/92"
                  style={{ color: "color-mix(in oklch, var(--foreground) 18%, black)" }}
                >
                  <BriefcaseBusiness className="w-4 h-4" />
                  Open Tender Marketplace
                  <ArrowUpRight className="w-4 h-4" />
                </Link>
              )}
              {hasLiveStats && (
                <div className="inline-flex items-center gap-2 rounded-full border border-white/16 bg-black/12 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm">
                  {displayStats.is_verified ? (
                    <><CheckCircle2 className="w-4 h-4 text-white/88" /> Verified Cooperative</>
                  ) : (
                    <><Clock className="w-4 h-4 text-white/78" /> Pending Verification</>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: "Active cycles", value: String(displayStats.active_cycles) },
              { label: "Waste tracked", value: `${displayStats.waste_rate}% of output` },
            ].map((item) => (
              <div key={item.label} className="sf-hero-panel rounded-[22px] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/62">{item.label}</p>
                <p className="mt-2 text-lg font-semibold text-white">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

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
          displayStats.stat_cards.map((card) => (
            <StatCard
              key={card.id}
              label={card.label}
              value={card.value}
              icon={crmStatIcons[card.id as keyof typeof crmStatIcons]}
              variant={card.tone}
              trend={card.trend}
              trendValue={card.trend_value}
              onClick={() => {
                if (card.id === "members") router.push(`${base}/members`);
                if (card.id === "active_cycles") router.push(`${base}/production`);
                if (card.id === "data_score") router.push(`${base}/forms`);
              }}
            />
          ))
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
            <QuickAction icon={Users} label="Add Member" href={`${base}/members/new`} color="sf-tone-info" />
            <QuickAction icon={Leaf} label="Log Production" href={`${base}/production/new`} color="sf-tone-success" />
            <QuickAction icon={ClipboardList} label="New Form Entry" href={`${base}/forms`} color="sf-tone-neutral" />
            <QuickAction icon={ShieldCheck} label="Certification" href={`${base}/certification`} color="sf-tone-warning" />
            {isChair && (
              <QuickAction
                icon={BriefcaseBusiness}
                label="Marketplace"
                href={marketplaceHref}
                target="_blank"
                rel="noreferrer"
                color="bg-[var(--primary-light)] text-[var(--primary)]"
              />
            )}
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
              {isChair && (
                <Link
                  href={marketplaceHref}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "text-xs font-medium flex items-center gap-1 hover:underline",
                    displayStats.tender_eligible ? "text-[var(--success)]" : "text-[var(--foreground-muted)]"
                  )}
                >
                  Browse tenders <ArrowUpRight className="w-3 h-3" />
                </Link>
              )}
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
                      <span className="text-xs text-[var(--foreground-subtle)]">{mounted ? formatRelativeTime(sub.submitted_at) : "Recently"}</span>
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
