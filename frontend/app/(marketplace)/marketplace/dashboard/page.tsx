"use client";

/**
 * Marketplace Dashboard — Buyer Home
 *
 * Shows:
 * - Active tenders summary
 * - Bids received count
 * - Shortlisted cooperatives
 * - Recent tender activity
 * - Quick actions (create tender, browse cooperatives)
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Briefcase, FileText, Star, TrendingUp, PlusCircle,
  Search, ChevronRight, ArrowRight, Building2, Clock,
  CheckCircle2, AlertCircle, BarChart3,
} from "lucide-react";
import { StatCard } from "@/components/shambaflow/StatCard";
import { apiFetch, getUser } from "@/lib/api";
import { cn } from "@/lib/utils";

/* ─── Types ───────────────────────────────────────────────────────── */

interface BuyerDashboardStats {
  active_tenders:       number;
  bids_received:        number;
  shortlisted:          number;
  completed_tenders:    number;
  recent_activity:      ActivityItem[];
}

interface ActivityItem {
  id:      string;
  title:   string;
  type:    "bid_received" | "tender_closed" | "tender_published" | "bid_accepted";
  time:    string;
  coop?:   string;
}

/* ─── Tender status badge ─────────────────────────────────────────── */

const STATUS_CONFIG = {
  OPEN:      { label: "Open",      color: "bg-[var(--success-light)] text-[var(--success)]" },
  CLOSED:    { label: "Closed",    color: "bg-[var(--background-muted)] text-[var(--foreground-muted)]" },
  AWARDED:   { label: "Awarded",   color: "bg-[var(--info-light)] text-[var(--info)]" },
  CANCELLED: { label: "Cancelled", color: "bg-[var(--destructive-light)] text-[var(--destructive)]" },
};

/* ─── Activity item ───────────────────────────────────────────────── */

function ActivityRow({ item }: { item: ActivityItem }) {
  const icons = {
    bid_received:     { icon: FileText, color: "text-blue-500 bg-blue-50 dark:bg-blue-900/30" },
    tender_closed:    { icon: AlertCircle, color: "text-amber-500 bg-amber-50 dark:bg-amber-900/30" },
    tender_published: { icon: Briefcase, color: "text-[var(--primary)] bg-[var(--primary-light)]" },
    bid_accepted:     { icon: CheckCircle2, color: "text-[var(--success)] bg-[var(--success-light)]" },
  };

  const { icon: Icon, color } = icons[item.type] ?? icons.tender_published;

  return (
    <div className="flex items-start gap-4 py-3.5 px-5 hover:bg-[var(--background-muted)] transition-colors group">
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5", color)}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--foreground)]">{item.title}</p>
        {item.coop && (
          <p className="text-xs text-[var(--foreground-muted)] mt-0.5">by {item.coop}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-[var(--foreground-subtle)]">{item.time}</span>
        <ChevronRight className="w-3.5 h-3.5 text-[var(--foreground-subtle)] opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );
}

/* ─── Main Page ───────────────────────────────────────────────────── */

export default function MarketplaceDashboardPage() {
  const user        = getUser() as Record<string, string> | null;
  const displayName = user?.full_name ?? user?.email ?? "Buyer";
  const company     = user?.company_name ?? "";

  const [stats,   setStats]   = useState<BuyerDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<BuyerDashboardStats>("/api/marketplace/dashboard/")
      .then(setStats)
      .catch(() => {
        // Demo data while API is being built
        setStats({
          active_tenders:    4,
          bids_received:     12,
          shortlisted:       3,
          completed_tenders: 8,
          recent_activity: [
            { id: "1", type: "bid_received",     title: "New bid on \"Maize Supply — 10T\"", coop: "Meru Central Farmers Coop", time: "15m ago" },
            { id: "2", type: "bid_accepted",      title: "Your bid accepted on \"Dairy Supply Q1\"", time: "2h ago" },
            { id: "3", type: "tender_published",  title: "Tender \"Fresh Vegetables — 5T\" published", time: "5h ago" },
            { id: "4", type: "bid_received",      title: "New bid on \"Tomatoes Monthly Contract\"", coop: "Kiambu Horticulture Coop", time: "Yesterday" },
            { id: "5", type: "tender_closed",     title: "Tender \"Beans Supply\" has closed for bids", time: "Yesterday" },
          ],
        });
      })
      .finally(() => setLoading(false));
  }, []);

  function SkeletonCard() {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 animate-pulse">
        <div className="h-3 w-20 bg-[var(--background-muted)] rounded mb-4" />
        <div className="h-8 w-16 bg-[var(--background-muted)] rounded mb-2" />
        <div className="h-2.5 w-24 bg-[var(--background-muted)] rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Header ──────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">
            Welcome back, {displayName.split(" ")[0]}
          </h2>
          {company && (
            <p className="text-sm text-[var(--foreground-muted)] mt-0.5 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-[var(--primary)]" />
              {company}
            </p>
          )}
        </div>

        <Link
          href="/marketplace/create"
          className="inline-flex items-center gap-2 px-5 h-10 rounded-xl text-sm font-semibold
                     bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)]
                     shadow-[var(--shadow-green)] transition-all duration-200"
        >
          <PlusCircle className="w-4 h-4" />
          Post a Tender
        </Link>
      </div>

      {/* ── Stats grid ────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <Link href="/marketplace/my-tenders">
              <StatCard
                label="Active Tenders" value={stats?.active_tenders ?? 0}
                icon={<Briefcase className="w-5 h-5" />} variant="primary"
              />
            </Link>
            <Link href="/marketplace/bids">
              <StatCard
                label="Bids Received" value={stats?.bids_received ?? 0}
                icon={<FileText className="w-5 h-5" />} variant="default"
                trend="up" trendValue="+3 this month"
              />
            </Link>
            <Link href="/marketplace/shortlisted">
              <StatCard
                label="Shortlisted" value={stats?.shortlisted ?? 0}
                icon={<Star className="w-5 h-5" />} variant="default"
              />
            </Link>
            <Link href="/marketplace/history">
              <StatCard
                label="Completed" value={stats?.completed_tenders ?? 0}
                icon={<CheckCircle2 className="w-5 h-5" />} variant="default"
              />
            </Link>
          </>
        )}
      </div>

      {/* ── Two-column: quick actions + activity ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick actions */}
        <div className="lg:col-span-1 space-y-4">
          <h3 className="text-sm font-semibold text-[var(--foreground-muted)] uppercase tracking-wider">
            Quick Actions
          </h3>

          <div className="space-y-2">
            {[
              { label: "Post new tender",          href: "/marketplace/create",       icon: PlusCircle,  color: "text-[var(--primary)]  bg-[var(--primary-light)]" },
              { label: "Browse cooperatives",      href: "/marketplace/cooperatives", icon: Search,       color: "text-blue-600 bg-blue-50 dark:bg-blue-900/30" },
              { label: "View bids received",       href: "/marketplace/bids",         icon: FileText,     color: "text-purple-600 bg-purple-50 dark:bg-purple-900/30" },
              { label: "My active tenders",        href: "/marketplace/my-tenders",   icon: Briefcase,    color: "text-amber-600 bg-amber-50 dark:bg-amber-900/30" },
              { label: "Trade history",            href: "/marketplace/history",      icon: BarChart3,    color: "text-green-600 bg-green-50 dark:bg-green-900/30" },
            ].map((a) => (
              <Link
                key={a.label}
                href={a.href}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border)]
                           bg-[var(--surface)] hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-sm)]
                           transition-all duration-150 group"
              >
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", a.color)}>
                  <a.icon className="w-4 h-4" />
                </div>
                <span className="flex-1 text-sm font-medium text-[var(--foreground-muted)] group-hover:text-[var(--foreground)] transition-colors">
                  {a.label}
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-[var(--foreground-subtle)] opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--foreground-muted)] uppercase tracking-wider">
              Recent Activity
            </h3>
            <Link
              href="/marketplace/my-tenders"
              className="text-xs text-[var(--primary)] hover:text-[var(--primary-hover)] flex items-center gap-1 font-medium transition-colors"
            >
              All tenders <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            {loading ? (
              <div className="divide-y divide-[var(--border)]">
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
                    <div className="w-8 h-8 rounded-lg bg-[var(--background-muted)]" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-48 bg-[var(--background-muted)] rounded" />
                      <div className="h-2.5 w-32 bg-[var(--background-muted)] rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : stats?.recent_activity.length ? (
              <div className="divide-y divide-[var(--border)]">
                {stats.recent_activity.map((item) => (
                  <ActivityRow key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Briefcase className="w-10 h-10 text-[var(--foreground-subtle)] mb-3" />
                <p className="text-sm text-[var(--foreground-muted)]">No tender activity yet.</p>
                <Link
                  href="/marketplace/create"
                  className="mt-3 text-sm text-[var(--primary)] hover:text-[var(--primary-hover)] font-medium flex items-center gap-1.5"
                >
                  <PlusCircle className="w-3.5 h-3.5" /> Post your first tender
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Supply insight card ──────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Supply Intelligence</h3>
            <p className="text-xs text-[var(--foreground-muted)] mt-0.5">
              Verified cooperative capacity available for your sourcing needs
            </p>
          </div>
          <Link
            href="/marketplace/cooperatives"
            className="text-sm text-[var(--primary)] hover:text-[var(--primary-hover)] font-medium flex items-center gap-1.5 transition-colors"
          >
            Browse all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Verified Coops",    value: "2,400+", sub: "Available to bid" },
            { label: "Avg. Capacity",     value: "78%",    sub: "Index score" },
            { label: "Active Categories", value: "12",     sub: "Crop & livestock" },
            { label: "Regions Covered",   value: "47",     sub: "Counties in Kenya" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl bg-[var(--background-muted)] p-4 text-center"
            >
              <p className="text-xl font-bold text-[var(--primary)] font-[var(--font-sans)]">{stat.value}</p>
              <p className="text-xs font-medium text-[var(--foreground)] mt-0.5">{stat.label}</p>
              <p className="text-[10px] text-[var(--foreground-subtle)] mt-0.5">{stat.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}