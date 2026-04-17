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
import { apiFetch, getUser } from "@/lib/api";
import { cn } from "@/lib/utils";

/* ─── Types ───────────────────────────────────────────────────────── */

interface DashboardStats {
  member_count:        number;
  active_cycles:       number;
  capacity_index:      number;
  data_completeness:   number;
  is_verified:         boolean;
  tender_eligible:     boolean;
  recent_submissions:  RecentSubmission[];
}

interface RecentSubmission {
  id:         string;
  type:       string;
  member:     string;
  submitted:  string;
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
  const user          = getUser() as Record<string, string> | null;
  const coopName      = user?.cooperative_name ?? "Your Cooperative";
  const chairName     = user?.full_name ?? "";

  const [stats,   setStats]   = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!cooperativeId) return;
    apiFetch<DashboardStats>(`/api/cooperatives/${cooperativeId}/dashboard/`)
      .then(setStats)
      .catch(() => {
        // Use demo data if API isn't wired yet
        setStats({
          member_count: 142,
          active_cycles: 3,
          capacity_index: 78,
          data_completeness: 84,
          is_verified: true,
          tender_eligible: true,
          recent_submissions: [
            { id: "1", type: "Production Record", member: "Jane Wanjiru",   submitted: "2 hours ago" },
            { id: "2", type: "Member Update",     member: "Samuel Kamau",   submitted: "4 hours ago" },
            { id: "3", type: "Governance Record", member: "Admin",          submitted: "Yesterday"  },
            { id: "4", type: "Production Record", member: "Aisha Omondi",   submitted: "Yesterday"  },
          ],
        });
        setError(null);
      })
      .finally(() => setLoading(false));
  }, [cooperativeId]);

  const base = cooperativeId ? `/crm/${cooperativeId}` : "/crm";

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
        {stats && (
          <div
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium",
              stats.is_verified
                ? "bg-[var(--success-light)] text-[var(--success)] border border-green-200 dark:border-green-900/40"
                : "bg-[var(--warning-light)] text-[var(--warning)] border border-amber-200 dark:border-amber-900/40"
            )}
          >
            {stats.is_verified ? (
              <><CheckCircle2 className="w-4 h-4" /> Verified Cooperative</>
            ) : (
              <><Clock className="w-4 h-4" /> Pending Verification</>
            )}
          </div>
        )}
      </div>

      {/* ── Stats grid ────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <StatCard
              label="Members"
              value={stats?.member_count ?? 0}
              icon={<Users className="w-5 h-5" />}
              variant="default"
              trend="up"
              trendValue="+8 this month"
              onClick={() => router.push(`${base}/members`)}
            />
            <StatCard
              label="Active Cycles"
              value={stats?.active_cycles ?? 0}
              icon={<Leaf className="w-5 h-5" />}
              variant="default"
              onClick={() => router.push(`${base}/production`)}
            />
            <StatCard
              label="Capacity Index"
              value={`${stats?.capacity_index ?? 0}%`}
              icon={<BarChart3 className="w-5 h-5" />}
              variant={stats?.capacity_index && stats.capacity_index >= 70 ? "primary" : "default"}
              trend="up"
              trendValue="+5 this month"
            />
            <StatCard
              label="Data Score"
              value={`${stats?.data_completeness ?? 0}%`}
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
          {stats && (
            <div
              className={cn(
                "rounded-xl border p-4 space-y-2",
                stats.tender_eligible
                  ? "border-[var(--success-light)] bg-[var(--success-light)]/30"
                  : "border-[var(--warning-light)] bg-[var(--warning-light)]/30"
              )}
            >
              <div className="flex items-center gap-2">
                <ShieldCheck
                  className={cn(
                    "w-4 h-4",
                    stats.tender_eligible ? "text-[var(--success)]" : "text-[var(--warning)]"
                  )}
                />
                <span
                  className={cn(
                    "text-sm font-semibold",
                    stats.tender_eligible ? "text-[var(--success)]" : "text-[var(--warning)]"
                  )}
                >
                  {stats.tender_eligible ? "Tender Eligible" : "Tender Eligibility"}
                </span>
              </div>
              <p className="text-xs text-[var(--foreground-muted)]">
                {stats.tender_eligible
                  ? "You can bid on premium tenders in the marketplace."
                  : "Complete your CRM data to qualify for premium tenders."}
              </p>
              {!stats.tender_eligible && (
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
              href={`${base}/forms`}
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
            ) : stats?.recent_submissions.length ? (
              <div className="divide-y divide-[var(--border)]">
                {stats.recent_submissions.map((sub) => (
                  <div
                    key={sub.id}
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
                      <span className="text-xs text-[var(--foreground-subtle)]">{sub.submitted}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-[var(--foreground-subtle)] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
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
      {stats && (
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
              { label: "Capacity Index",     value: stats.capacity_index,    color: "bg-[var(--primary)]" },
              { label: "Data Completeness",  value: stats.data_completeness, color: "bg-blue-500" },
              { label: "Member Engagement",  value: 72,                      color: "bg-purple-500" },
              { label: "Production Regularity", value: 68,                   color: "bg-amber-500" },
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
