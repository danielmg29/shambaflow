"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  ClipboardCheck,
  Clock3,
  Loader2,
  Settings,
  Sparkles,
  UsersRound,
} from "lucide-react";

import BuyerInsightsPanel, { type BuyerDashboardAnalytics } from "@/components/marketplace/BuyerInsightsPanel";
import { StatCard } from "@/components/shambaflow/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch, getUser, type UserSnapshot } from "@/lib/api";
import {
  formatDate,
  formatRelativeTime,
  formatQuantityRange,
  tenderStatusTone,
} from "@/lib/marketplace";
import { cn } from "@/lib/utils";

interface FeaturedTender {
  id: string;
  title: string;
  product_category_display: string;
  product_name: string;
  status: string;
  status_display: string;
  quantity_kg_min: number;
  quantity_kg_max: number;
  total_bids: number;
  bid_deadline: string;
  delivery_location: string;
  href: string;
}

interface ActivityItem {
  id: string;
  type: string;
  title: string;
  description: string;
  timestamp: string;
  href: string;
}

interface DashboardHeroCard {
  id: string;
  label: string;
  value: string;
}

interface DashboardSummaryCard {
  id: string;
  label: string;
  value: string;
  trend: "up" | "down" | "neutral";
  trend_value: string;
  tone: "default" | "primary" | "accent";
}

interface DashboardPayload {
  summary: {
    active_tenders: number;
    bids_received: number;
    shortlisted: number;
    completed_tenders: number;
    draft_tenders: number;
    profile_completion: number;
  };
  onboarding: {
    is_complete: boolean;
    completion_percent: number;
    missing_fields: string[];
  };
  hero_cards: DashboardHeroCard[];
  summary_cards: DashboardSummaryCard[];
  analytics: BuyerDashboardAnalytics;
  featured_tenders: FeaturedTender[];
  recent_activity: ActivityItem[];
}

const buyerDashboardHeroStyle = {
  background:
    "radial-gradient(circle at top left, color-mix(in oklch, var(--secondary) 20%, transparent) 0%, transparent 30%), radial-gradient(circle at bottom right, color-mix(in oklch, var(--primary) 24%, transparent) 0%, transparent 34%), linear-gradient(132deg, color-mix(in oklch, var(--foreground) 86%, var(--primary) 14%) 0%, color-mix(in oklch, var(--primary) 78%, var(--foreground) 22%) 45%, color-mix(in oklch, var(--secondary) 54%, var(--primary) 46%) 100%)",
  boxShadow: "0 24px 80px color-mix(in oklch, var(--primary) 24%, transparent)",
};

const dashboardCardIcons = {
  active_tenders: <BriefcaseBusiness className="h-5 w-5" />,
  responses: <UsersRound className="h-5 w-5" />,
  shortlisted: <Sparkles className="h-5 w-5" />,
  completed: <ClipboardCheck className="h-5 w-5" />,
  drafts: <Settings className="h-5 w-5" />,
} as const;

export default function MarketplaceDashboardPage() {
  const user = getUser() as UserSnapshot | null;
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<DashboardPayload>("/api/marketplace/dashboard/")
      .then(setPayload)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm text-[var(--foreground-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading buyer studio…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section
        className="overflow-hidden rounded-[28px] border border-[var(--border)] p-6 text-white sm:p-8"
        style={buyerDashboardHeroStyle}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-4">
            <Badge className="w-fit border-white/14 bg-white/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-none hover:bg-white/12">
              <BriefcaseBusiness className="h-3.5 w-3.5" />
              Buyer Studio
            </Badge>
            <div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {`Welcome back${user?.first_name ? `, ${user.first_name}` : ""}.`}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/82 sm:text-base">
                Run your sourcing marketplace from one standalone workspace with live tenders, cooperative responses, and buyer readiness in view.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                asChild
                className="h-11 rounded-2xl bg-white px-5 shadow-[0_12px_30px_rgba(0,0,0,0.14)] hover:bg-white/90"
                style={{ color: "color-mix(in oklch, var(--foreground) 18%, black)" }}
              >
                <Link href="/marketplace/tenders?mode=create">
                  Publish a tender
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-2xl border-white/16 bg-black/14 px-5 text-white backdrop-blur-sm hover:bg-black/20">
                <Link href="/marketplace/tenders">
                  Review tenders
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {(payload?.hero_cards ?? []).map((item) => (
              <div key={item.label} className="sf-hero-panel rounded-[22px] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/65">{item.label}</p>
                <p className="mt-2 text-sm font-semibold text-white">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {!payload?.onboarding.is_complete && (
        <section className="sf-tone-warning rounded-[24px] border p-5 shadow-[var(--shadow-sm)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold">Buyer onboarding still has gaps.</p>
              <p className="mt-1 text-sm">
                Missing fields: {payload.onboarding.missing_fields.join(", ")}.
              </p>
            </div>
            <Button asChild variant="outline" className="h-10 rounded-2xl px-4">
              <Link href="/marketplace/onboarding">
                Complete onboarding
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {(payload?.summary_cards ?? []).map((card) => (
          <StatCard
            key={card.id}
            label={card.label}
            value={card.value}
            icon={dashboardCardIcons[card.id as keyof typeof dashboardCardIcons]}
            variant={card.tone}
            trend={card.trend}
            trendValue={card.trend_value}
          />
        ))}
      </div>

      <BuyerInsightsPanel analytics={payload?.analytics} />

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">Live tender portfolio</h2>
              <p className="text-sm text-[var(--foreground-muted)]">
                Your most recent or most active sourcing opportunities.
              </p>
            </div>
            <Link
              href="/marketplace/tenders"
              className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)]"
            >
              All tenders
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="space-y-4">
            {payload?.featured_tenders.length ? payload.featured_tenders.map((tender) => (
              <article key={tender.id} className="rounded-[22px] border border-[var(--border)] bg-[var(--background)] p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", tenderStatusTone(tender.status))}>
                        {tender.status_display}
                      </span>
                      <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--foreground-muted)]">
                        {tender.product_category_display}
                      </span>
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-[var(--foreground)]">{tender.title}</h3>
                      <p className="mt-1 text-sm text-[var(--foreground-muted)]">
                        {tender.product_name} · {tender.delivery_location}
                      </p>
                    </div>
                    <div className="grid gap-3 text-sm text-[var(--foreground-muted)] sm:grid-cols-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Quantity</p>
                        <p className="mt-1 font-medium text-[var(--foreground)]">
                          {formatQuantityRange(tender.quantity_kg_min, tender.quantity_kg_max)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Bid deadline</p>
                        <p className="mt-1 font-medium text-[var(--foreground)]">{formatDate(tender.bid_deadline)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Responses</p>
                        <p className="mt-1 font-medium text-[var(--foreground)]">{tender.total_bids}</p>
                      </div>
                    </div>
                  </div>
                  <Link
                    href={tender.href}
                    className="inline-flex h-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface)]"
                  >
                    View details
                  </Link>
                </div>
              </article>
            )) : (
              <div className="rounded-[22px] border border-dashed border-[var(--border)] bg-[var(--background)] px-6 py-12 text-center">
                <p className="text-lg font-semibold text-[var(--foreground)]">No tenders yet.</p>
                <p className="mt-2 text-sm text-[var(--foreground-muted)]">
                  Publish your first sourcing request to start collecting cooperative responses.
                </p>
                <Link
                  href="/marketplace/tenders?mode=create"
                  className="mt-5 inline-flex h-10 items-center gap-2 rounded-2xl bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-fg)]"
                >
                  Start a tender
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            )}
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary)]">
                <Clock3 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Recent activity</h2>
                <p className="text-sm text-[var(--foreground-muted)]">
                  Buyer-side tender events and cooperative responses.
                </p>
              </div>
            </div>
            <div className="space-y-3">
              {payload?.recent_activity.length ? payload.recent_activity.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="block rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4 transition-colors hover:border-[var(--border-strong)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[var(--foreground)]">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--foreground-muted)]">{item.description}</p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-[var(--foreground-subtle)]">
                      {formatRelativeTime(item.timestamp)}
                    </span>
                  </div>
                </Link>
              )) : (
                <p className="text-sm text-[var(--foreground-muted)]">Activity will appear here once tenders are published.</p>
              )}
            </div>
          </section>

          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary)]">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Buyer workspace shortcuts</h2>
                <p className="text-sm text-[var(--foreground-muted)]">
                  Jump into the next task without opening the sidebar.
                </p>
              </div>
            </div>
            <div className="grid gap-3">
              {[
                { href: "/marketplace/tenders", label: "Manage tenders", icon: BriefcaseBusiness },
                { href: "/marketplace/onboarding", label: "Review onboarding", icon: ClipboardCheck },
                { href: "/marketplace/profile", label: "Update buyer profile", icon: Building2 },
                { href: "/marketplace/settings", label: "Account settings", icon: Settings },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4 transition-colors hover:border-[var(--border-strong)]"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary)]">
                    <item.icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-[var(--foreground)]">{item.label}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-[var(--foreground-subtle)]" />
                </Link>
              ))}
            </div>
          </section>

          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary)]">
                <UsersRound className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Buyer readiness snapshot</h2>
                <p className="text-sm text-[var(--foreground-muted)]">
                  Profile completion influences how fast you can move from sourcing need to live tender.
                </p>
              </div>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-[var(--background-muted)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${payload?.summary.profile_completion ?? 0}%`,
                  background:
                    "linear-gradient(90deg, color-mix(in oklch, var(--primary) 86%, var(--surface) 14%) 0%, color-mix(in oklch, var(--secondary) 70%, var(--primary) 30%) 100%)",
                }}
              />
            </div>
            <p className="mt-4 text-sm text-[var(--foreground-muted)]">
              Completion is currently <strong>{payload?.summary.profile_completion ?? 0}%</strong>.
              Use onboarding and profile settings to keep the buyer account tender-ready.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
