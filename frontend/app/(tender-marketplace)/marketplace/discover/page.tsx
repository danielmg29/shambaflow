"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  Clock3,
  HandCoins,
  Loader2,
  MapPin,
  MessageSquareText,
  Search,
  ShieldCheck,
  Sparkles,
  Sprout,
  TrendingUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch, getUser, type UserSnapshot } from "@/lib/api";
import {
  bidStatusTone,
  formatCurrency,
  formatDate,
  formatQuantityRange,
  formatRelativeTime,
  tenderStatusTone,
} from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { MarketplacePromoCard, type MarketplacePromotion } from "@/components/marketplace/MarketplacePromoCard";

interface CooperativeTenderPayload {
  summary: {
    open_tenders: number;
    eligible_now: number;
    my_active_bids: number;
    shortlisted_bids: number;
    awarded_bids: number;
    unread_messages: number;
  };
  hero_metrics: Array<{
    id: string;
    label: string;
    value: string;
  }>;
  summary_cards: Array<{
    id: string;
    label: string;
    value: string;
    hint: string;
  }>;
  items: Array<{
    id: string;
    title: string;
    product_category_display: string;
    product_name: string;
    status: string;
    status_display: string;
    eligibility_tier_display: string;
    quantity_kg_min: number;
    quantity_kg_max: number;
    quality_specs_text: string;
    delivery_location: string;
    bid_deadline: string;
    indicative_price_min_ksh: number | null;
    indicative_price_max_ksh: number | null;
    min_capacity_index: number;
    total_bids: number;
    is_deadline_passed: boolean;
    is_boosted: boolean;
    published_at: string | null;
    created_at: string;
    buyer: {
      company_name: string;
      buyer_type_display: string | null;
      region: string;
      website: string;
      description_text: string;
      company_logo: string | null;
    };
    eligibility: {
      is_eligible: boolean;
      reason: string;
      capacity_index: number | null;
      is_premium_eligible: boolean;
      is_verified: boolean;
    };
    my_bid: {
      status: string;
      status_display: string;
      offered_price_ksh: number;
      offered_quantity_kg: number;
      revision_number: number;
    } | null;
    can_submit_bid: boolean;
    unread_messages: number;
  }>;
  promotions: MarketplacePromotion[];
  filters: {
    search: string;
    status: string;
    sort: string;
  };
  status_counts: Record<string, number>;
}

const quickSearchTerms = [
  "White maize",
  "Coffee cherries",
  "French beans",
  "Tea leaf",
  "Dairy supply",
  "Export fruit",
];

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">{label}</p>
      <p className="mt-3 text-3xl font-bold tracking-tight text-[var(--foreground)]">{value}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--foreground-muted)]">{hint}</p>
    </div>
  );
}

function BuyerBadge({
  buyer,
}: {
  buyer: CooperativeTenderPayload["items"][number]["buyer"];
}) {
  return (
    <div className="flex items-center gap-3">
      {buyer.company_logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={buyer.company_logo}
          alt={buyer.company_name}
          className="h-11 w-11 rounded-2xl border border-[var(--border)] bg-[var(--background)] object-cover"
        />
      ) : (
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary)]">
          <Building2 className="h-5 w-5" />
        </div>
      )}
      <div>
        <p className="text-sm font-semibold text-[var(--foreground)]">{buyer.company_name}</p>
        <p className="mt-1 text-xs text-[var(--foreground-muted)]">
          {[buyer.buyer_type_display, buyer.region].filter(Boolean).join(" · ") || "Buyer profile"}
        </p>
      </div>
    </div>
  );
}

function summarize(value: string, maxLength = 180): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength).trimEnd()}…`;
}

const discoverHeroStyle = {
  background:
    "radial-gradient(circle at top left, color-mix(in oklch, var(--secondary) 20%, transparent) 0%, transparent 30%), radial-gradient(circle at bottom right, color-mix(in oklch, var(--primary) 24%, transparent) 0%, transparent 34%), linear-gradient(128deg, color-mix(in oklch, var(--foreground) 86%, var(--primary) 14%) 0%, color-mix(in oklch, var(--primary) 76%, var(--foreground) 24%) 40%, color-mix(in oklch, var(--secondary) 52%, var(--primary) 48%) 100%)",
  boxShadow: "0 28px 90px color-mix(in oklch, var(--primary) 24%, transparent)",
};

export default function CooperativeMarketplaceDiscoverPage() {
  const [viewer, setViewer] = useState<UserSnapshot | null>(null);
  const [payload, setPayload] = useState<CooperativeTenderPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [sort, setSort] = useState("recent");

  useEffect(() => {
    setViewer(getUser());
  }, []);

  const chairOnlyAccess = Boolean(
    viewer && viewer.user_type === "CHAIR" && viewer.cooperative_id
  );
  const crmBase = viewer?.cooperative_id ? `/crm/${viewer.cooperative_id}` : "/crm";

  const loadWorkspace = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status && status !== "ALL") params.set("status", status);
    if (sort) params.set("sort", sort);
    const query = params.toString();
    const data = await apiFetch<CooperativeTenderPayload>(`/api/marketplace/cooperative/tenders/${query ? `?${query}` : ""}`);
    setPayload(data);
    setSearchInput(data.filters.search ?? "");
  }, [search, sort, status]);

  useEffect(() => {
    if (!viewer || !chairOnlyAccess) {
      if (viewer && !chairOnlyAccess) setLoading(false);
      return;
    }

    setLoading(true);
    void loadWorkspace()
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the marketplace."))
      .finally(() => setLoading(false));
  }, [chairOnlyAccess, loadWorkspace, viewer]);

  const statusPills = useMemo(() => [
    { key: "ALL", label: "All briefs", count: payload?.status_counts.ALL ?? 0 },
    { key: "OPEN", label: "Open now", count: payload?.status_counts.OPEN ?? 0 },
    { key: "MY_BIDS", label: "My bids", count: payload?.status_counts.MY_BIDS ?? 0 },
    { key: "NEGOTIATION", label: "Negotiation", count: payload?.status_counts.NEGOTIATION ?? 0 },
    { key: "AWARDED", label: "Awarded", count: payload?.status_counts.AWARDED ?? 0 },
  ], [payload]);

  const featuredMatches = useMemo(
    () => payload?.items.filter((item) => item.eligibility.is_eligible && item.can_submit_bid).slice(0, 3) ?? [],
    [payload]
  );

  if (!viewer || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm text-[var(--foreground-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading agricultural tender marketplace…
        </div>
      </div>
    );
  }

  if (!chairOnlyAccess) {
    return (
      <div className="rounded-[24px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
        <p className="text-lg font-semibold text-[var(--foreground)]">Tender marketplace access is limited to the cooperative chair for now.</p>
        <Link href={`${crmBase}/dashboard`} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)]">
          <ArrowRight className="h-4 w-4 rotate-180" />
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section
        className="overflow-hidden rounded-[32px] border border-[var(--border)] text-white"
        style={discoverHeroStyle}
      >
        <div className="grid gap-8 px-6 py-7 sm:px-8 lg:grid-cols-[minmax(0,1.2fr)_360px] lg:items-end">
          <div className="space-y-6">
            <Badge className="w-fit border-white/14 bg-white/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-none hover:bg-white/12">
              <BriefcaseBusiness className="h-3.5 w-3.5" />
              Marketplace For Cooperative Chairs
            </Badge>
            <div className="space-y-3">
              <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">
                Bid on agricultural contracts that actually match your cooperative’s capacity.
              </h1>
              <p className="max-w-3xl text-sm leading-7 text-white/82">
                Browse buyer demand the way you would on a modern bidding platform: compare qualification fit, pricing signals, deadlines, and competition before you commit time to a response.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                asChild
                className="h-11 rounded-2xl bg-white px-5 shadow-[0_16px_40px_rgba(0,0,0,0.16)] hover:bg-white/90"
                style={{ color: "color-mix(in oklch, var(--foreground) 18%, black)" }}
              >
                <Link href={`${crmBase}/dashboard`}>Back to CRM</Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-2xl border-white/20 bg-black/12 px-5 text-white backdrop-blur-sm hover:bg-black/20">
                <Link href={`${crmBase}/certification`}>
                  Improve qualification score
                  <TrendingUp className="h-4 w-4" />
                </Link>
              </Button>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                setSearch(searchInput.trim());
              }}
              className="relative max-w-2xl"
            >
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search buyer briefs, products, regions, or company names"
                className="h-12 w-full rounded-2xl border-white/18 bg-white/10 pl-11 pr-32 text-sm text-white placeholder:text-white/55 focus-visible:border-white/28 focus-visible:ring-white/25"
              />
              <Button
                type="submit"
                className="absolute right-1.5 top-1.5 h-9 rounded-xl bg-white px-4 hover:bg-white/90"
                style={{ color: "color-mix(in oklch, var(--foreground) 18%, black)" }}
              >
                Search
              </Button>
            </form>

            <div className="flex flex-wrap gap-2">
              {quickSearchTerms.map((term) => (
                <Button
                  key={term}
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSearchInput(term);
                    setSearch(term);
                  }}
                  className="rounded-full border-white/18 bg-white/10 px-4 text-white hover:bg-white/16"
                >
                  {term}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[26px] border border-white/15 bg-black/14 p-5 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-white/88">
                <Sparkles className="h-4 w-4" />
                <p className="text-sm font-semibold">Tender-marketplace workflow</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-white/76">
                Evaluate buyer briefs, jump into a bid workspace, and keep negotiations moving without burying the experience inside the CRM shell.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(payload?.hero_metrics ?? []).map((item) => (
                <div key={item.label} className="sf-hero-panel rounded-[22px] px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/62">{item.label}</p>
                  <p className="mt-2 text-lg font-semibold text-white">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {error && (
        <section className="sf-tone-danger rounded-[20px] border px-4 py-3 text-sm">
          {error}
        </section>
      )}

      {payload?.promotions?.length ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {payload.promotions.map((promotion, index) => (
            <MarketplacePromoCard
              key={promotion.id}
              promotion={promotion}
              className={cn(index === 0 && "xl:col-span-2")}
            />
          ))}
        </section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {(payload?.summary_cards ?? []).map((card) => (
          <SummaryCard
            key={card.id}
            label={card.label}
            value={card.value}
            hint={card.hint}
          />
        ))}
      </div>

      <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Tender feed</h2>
            <p className="text-sm text-[var(--foreground-muted)]">
              Browse opportunities the way you would on a modern marketplace, then open the full workspace when a brief fits your cooperative.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex flex-wrap gap-2">
              {statusPills.map((pill) => (
                <Button
                  key={pill.key}
                  type="button"
                  size="sm"
                  variant={status === pill.key ? "default" : "outline"}
                  onClick={() => setStatus(pill.key)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-semibold",
                    status !== pill.key && "border-[var(--border)] bg-[var(--background)] text-[var(--foreground-muted)]"
                  )}
                >
                  {pill.label} · {pill.count}
                </Button>
              ))}
            </div>

            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="h-10 w-full rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-sm text-[var(--input-text)] sm:w-[180px]">
                <SelectValue placeholder="Sort tenders" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Most recent</SelectItem>
                <SelectItem value="deadline">Nearest deadline</SelectItem>
                <SelectItem value="responses">Most responses</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_360px]">
        <div className="space-y-4">
          {payload?.items.length ? payload.items.map((item) => (
            <article key={item.id} className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", tenderStatusTone(item.status))}>
                        {item.status_display}
                      </span>
                      <span className="rounded-full border border-[var(--border)] bg-[var(--background)] px-3 py-1 text-xs font-semibold text-[var(--foreground-muted)]">
                        {item.product_category_display}
                      </span>
                      <span className="rounded-full border border-[var(--border)] bg-[var(--background)] px-3 py-1 text-xs font-semibold text-[var(--foreground-muted)]">
                        {item.eligibility_tier_display}
                      </span>
                      {item.is_boosted && (
                        <span className="sf-tone-warning rounded-full border px-3 py-1 text-xs font-semibold">
                          Boosted buyer brief
                        </span>
                      )}
                      {item.unread_messages > 0 && (
                        <span className="sf-tone-success rounded-full border px-3 py-1 text-xs font-semibold">
                          {item.unread_messages} unread
                        </span>
                      )}
                    </div>

                    <BuyerBadge buyer={item.buyer} />

                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">{item.title}</h3>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary-light)] px-3 py-1 text-xs font-semibold text-[var(--primary)]">
                          <Clock3 className="h-3.5 w-3.5" />
                          Posted {formatRelativeTime(item.published_at ?? item.created_at)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[var(--foreground-muted)]">
                        {item.product_name} · Delivery to {item.delivery_location}
                        {item.buyer.description_text ? ` · ${summarize(item.buyer.description_text, 110)}` : ""}
                      </p>
                    </div>

                    <div className="grid gap-3 text-sm text-[var(--foreground-muted)] sm:grid-cols-2 xl:grid-cols-5">
                      <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Quantity</p>
                        <p className="mt-2 font-semibold text-[var(--foreground)]">
                          {formatQuantityRange(item.quantity_kg_min, item.quantity_kg_max)}
                        </p>
                      </div>
                      <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Deadline</p>
                        <p className="mt-2 font-semibold text-[var(--foreground)]">{formatDate(item.bid_deadline)}</p>
                      </div>
                      <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Indicative price</p>
                        <p className="mt-2 font-semibold text-[var(--foreground)]">
                          {item.indicative_price_min_ksh != null || item.indicative_price_max_ksh != null
                            ? `${formatCurrency(item.indicative_price_min_ksh)} - ${formatCurrency(item.indicative_price_max_ksh)}`
                            : "Not disclosed"}
                        </p>
                      </div>
                      <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Buyer competition</p>
                        <p className="mt-2 font-semibold text-[var(--foreground)]">{item.total_bids} proposals</p>
                      </div>
                      <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Minimum capacity</p>
                        <p className="mt-2 font-semibold text-[var(--foreground)]">{item.min_capacity_index}/100</p>
                      </div>
                    </div>

                    <div className="rounded-[22px] border border-[var(--border)] bg-[var(--background)] p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-2 rounded-full bg-[var(--primary-light)] px-3 py-1 text-xs font-semibold text-[var(--primary)]">
                          <Sprout className="h-3.5 w-3.5" />
                          Quality fit
                        </span>
                        <span className={cn(
                          "rounded-full border px-3 py-1 text-xs font-semibold",
                          item.eligibility.is_verified
                            ? "sf-tone-success"
                            : "sf-tone-warning"
                        )}>
                          {item.eligibility.is_verified ? "Verified cooperative" : "Verification pending"}
                        </span>
                        <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--foreground-muted)]">
                          Capacity {item.eligibility.capacity_index != null ? `${Math.round(item.eligibility.capacity_index)}/100` : "not scored"}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-[var(--foreground-muted)]">
                        {summarize(item.quality_specs_text, 220) || "No detailed quality specification preview was added to this brief."}
                      </p>
                      <div className="mt-4 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-[var(--foreground)]">
                            {item.eligibility.is_eligible ? "You’re eligible to respond" : "Qualification check"}
                          </p>
                          <span className={cn(
                            "rounded-full border px-3 py-1 text-xs font-semibold",
                            item.can_submit_bid ? "sf-tone-success" : "sf-tone-neutral"
                          )}>
                            {item.can_submit_bid ? "Bid workspace open" : "Read-only for now"}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[var(--foreground-muted)]">{item.eligibility.reason}</p>
                      </div>
                    </div>

                    {item.my_bid && (
                      <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", bidStatusTone(item.my_bid.status))}>
                            {item.my_bid.status_display}
                          </span>
                          <span className="text-xs font-semibold text-[var(--foreground-subtle)]">
                            Revision {item.my_bid.revision_number}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[var(--foreground-muted)]">
                          Current offer: {formatCurrency(item.my_bid.offered_price_ksh)} for {item.my_bid.offered_quantity_kg.toLocaleString()} kg.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex w-full max-w-sm flex-col gap-3">
                    <Button asChild className="h-12 rounded-2xl px-5">
                      <Link href={`/marketplace/discover/${item.id}`}>
                        {item.can_submit_bid ? "Open bid workspace" : "Review tender detail"}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>

                    <div className="rounded-[22px] border border-[var(--border)] bg-[var(--background)] p-4">
                      <div className="flex items-center gap-2 text-[var(--foreground)]">
                        <ShieldCheck className="h-4 w-4 text-[var(--primary)]" />
                        <p className="text-sm font-semibold">Buyer-facing readiness</p>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[var(--foreground-muted)]">
                        {item.can_submit_bid
                          ? "Your cooperative can move directly into a draft or submitted bid for this brief."
                          : item.my_bid
                            ? "This brief already has your bid history. Open the workspace to review revisions and negotiation."
                            : "Keep this brief on radar while you improve qualification or wait for the buyer timeline to reopen."}
                      </p>
                      <div className="mt-4 grid gap-2 text-xs font-semibold text-[var(--foreground-muted)]">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5 text-[var(--foreground-subtle)]" />
                          {item.delivery_location}
                        </div>
                        <div className="flex items-center gap-2">
                          <HandCoins className="h-3.5 w-3.5 text-[var(--foreground-subtle)]" />
                          {item.is_deadline_passed ? "Deadline passed" : "Still accepting bids"}
                        </div>
                        <div className="flex items-center gap-2">
                          <MessageSquareText className="h-3.5 w-3.5 text-[var(--foreground-subtle)]" />
                          {item.unread_messages > 0
                            ? `${item.unread_messages} unread negotiation messages`
                            : "No unread negotiation messages"}
                        </div>
                      </div>
                      {item.buyer.website ? (
                        <a
                          href={item.buyer.website}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-4 inline-flex text-sm font-semibold text-[var(--primary)] hover:underline"
                        >
                          Visit buyer website
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </article>
          )) : (
            <section className="rounded-[28px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
              <p className="text-lg font-semibold text-[var(--foreground)]">No tenders matched this view.</p>
              <p className="mt-2 text-sm text-[var(--foreground-muted)]">
                Change the filters or broaden the search to surface more buyer opportunities.
              </p>
            </section>
          )}
        </div>

        <aside className="space-y-6 xl:sticky xl:top-24 xl:self-start">
          <section className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[var(--primary)]" />
              <h2 className="text-base font-semibold text-[var(--foreground)]">Best-fit shortlist</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--foreground-muted)]">
              The strongest opportunities are the ones where your cooperative is eligible today and the buyer timeline is still live.
            </p>
            <div className="mt-4 space-y-3">
              {featuredMatches.length ? featuredMatches.map((item) => (
                <Link
                  key={item.id}
                  href={`/marketplace/discover/${item.id}`}
                  className="block rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4 transition-colors hover:border-[var(--border-strong)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[var(--foreground)]">{item.title}</p>
                    <ArrowRight className="h-4 w-4 text-[var(--foreground-subtle)]" />
                  </div>
                  <p className="mt-2 text-sm text-[var(--foreground-muted)]">{item.buyer.company_name}</p>
                  <p className="mt-1 text-xs text-[var(--foreground-subtle)]">
                    Deadline {formatDate(item.bid_deadline)} · {item.total_bids} proposals
                  </p>
                </Link>
              )) : (
                <p className="text-sm text-[var(--foreground-muted)]">No high-fit tenders surfaced yet. Improving verification and capacity will increase the shortlist.</p>
              )}
            </div>
          </section>

          <section className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4 text-[var(--primary)]" />
              <h2 className="text-base font-semibold text-[var(--foreground)]">Negotiation pulse</h2>
            </div>
            <div className="mt-4 grid gap-3">
              <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Unread tender chats</p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-[var(--foreground)]">{payload?.summary.unread_messages ?? 0}</p>
              </div>
              <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Shortlisted bids</p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-[var(--foreground)]">{payload?.summary.shortlisted_bids ?? 0}</p>
              </div>
              <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Award momentum</p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-[var(--foreground)]">{payload?.summary.awarded_bids ?? 0}</p>
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[var(--primary)]" />
              <h2 className="text-base font-semibold text-[var(--foreground)]">How to win more briefs</h2>
            </div>
            <div className="mt-4 space-y-4 text-sm leading-6 text-[var(--foreground-muted)]">
              <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                <p className="font-semibold text-[var(--foreground)]">Respond before the market crowds in</p>
                <p className="mt-1">Most buyers compare speed, reliability, and commercial clarity before price alone.</p>
              </div>
              <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                <p className="font-semibold text-[var(--foreground)]">Use the quality brief as your script</p>
                <p className="mt-1">Mirror the buyer’s grade, packaging, and delivery language so your proposal feels tailored.</p>
              </div>
              <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                <p className="font-semibold text-[var(--foreground)]">Upgrade eligibility when blocked</p>
                <p className="mt-1">If a tender is visible but locked, improving verification and capacity score will unlock better-fit opportunities.</p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
