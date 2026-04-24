"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Plus,
  Search,
} from "lucide-react";

import { AnimatedAlert } from "@/components/ui/animated-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  formatCurrency,
  formatDate,
  formatQuantityRange,
  tenderStatusTone,
} from "@/lib/marketplace";
import { stripRichText } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

interface TenderItem {
  id: string;
  title: string;
  product_category: string;
  product_category_display: string;
  product_name: string;
  status: string;
  status_display: string;
  eligibility_tier: string;
  eligibility_tier_display: string;
  quantity_kg_min: number;
  quantity_kg_max: number;
  quality_specs_text: string;
  delivery_location: string;
  delivery_start: string;
  delivery_end: string;
  bid_deadline: string;
  indicative_price_min_ksh: number | null;
  indicative_price_max_ksh: number | null;
  total_bids: number;
  href: string;
}

interface TendersPayload {
  items: TenderItem[];
  total: number;
  filters: {
    search: string;
    status: string;
    sort: string;
  };
  status_counts: Record<string, number>;
  category_options: Array<{ value: string; label: string }>;
  eligibility_options: Array<{ value: string; label: string }>;
  onboarding: {
    is_complete: boolean;
    completion_percent: number;
  };
}

function localDateOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function localDateTimeOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

const buyerTendersHeroStyle = {
  background:
    "radial-gradient(circle at top left, color-mix(in oklch, var(--surface) 16%, transparent) 0%, transparent 28%), linear-gradient(135deg, color-mix(in oklch, var(--foreground) 78%, var(--info) 22%) 0%, color-mix(in oklch, var(--info) 66%, var(--foreground) 34%) 46%, color-mix(in oklch, var(--secondary) 46%, var(--surface) 54%) 100%)",
  boxShadow: "0 24px 80px color-mix(in oklch, var(--info) 24%, transparent)",
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Label className="text-sm font-medium text-[var(--foreground)]">{children}</Label>;
}

export default function MarketplaceTendersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [payload, setPayload] = useState<TendersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sort, setSort] = useState("recent");
  const [showComposer, setShowComposer] = useState(searchParams.get("mode") === "create");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [submittingStatus, setSubmittingStatus] = useState<"DRAFT" | "PUBLISHED" | null>(null);

  const [title, setTitle] = useState("");
  const [productCategory, setProductCategory] = useState("CEREALS");
  const [productName, setProductName] = useState("");
  const [eligibilityTier, setEligibilityTier] = useState("OPEN");
  const [quantityMin, setQuantityMin] = useState("1000");
  const [quantityMax, setQuantityMax] = useState("2500");
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [deliveryStart, setDeliveryStart] = useState(localDateOffset(7));
  const [deliveryEnd, setDeliveryEnd] = useState(localDateOffset(21));
  const [bidDeadline, setBidDeadline] = useState(localDateTimeOffset(5));
  const [qualitySpecs, setQualitySpecs] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [minCapacityIndex, setMinCapacityIndex] = useState("60");

  const loadTenders = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter && statusFilter !== "ALL") params.set("status", statusFilter);
    if (sort) params.set("sort", sort);
    const query = params.toString();
    const data = await apiFetch<TendersPayload>(`/api/marketplace/tenders/${query ? `?${query}` : ""}`);
    setPayload(data);
    setSearchInput(data.filters.search ?? "");
  }, [search, sort, statusFilter]);

  useEffect(() => {
    setShowComposer(searchParams.get("mode") === "create");
  }, [searchParams]);

  useEffect(() => {
    loadTenders()
      .catch(() => setMessage({ type: "error", text: "Unable to load buyer tenders right now." }))
      .finally(() => setLoading(false));
  }, [loadTenders]);

  const statusPills = useMemo(() => {
    if (!payload) return [];
    return [
      { key: "ALL", label: "All", count: payload.status_counts.ALL ?? 0 },
      { key: "PUBLISHED", label: "Published", count: payload.status_counts.PUBLISHED ?? 0 },
      { key: "UNDER_REVIEW", label: "Under review", count: payload.status_counts.UNDER_REVIEW ?? 0 },
      { key: "DRAFT", label: "Drafts", count: payload.status_counts.DRAFT ?? 0 },
      { key: "AWARDED", label: "Awarded", count: payload.status_counts.AWARDED ?? 0 },
      { key: "CLOSED", label: "Closed", count: payload.status_counts.CLOSED ?? 0 },
    ];
  }, [payload]);

  const resetComposer = () => {
    setTitle("");
    setProductCategory(payload?.category_options[0]?.value ?? "CEREALS");
    setProductName("");
    setEligibilityTier(payload?.eligibility_options[0]?.value ?? "OPEN");
    setQuantityMin("1000");
    setQuantityMax("2500");
    setDeliveryLocation("");
    setDeliveryStart(localDateOffset(7));
    setDeliveryEnd(localDateOffset(21));
    setBidDeadline(localDateTimeOffset(5));
    setQualitySpecs("");
    setPriceMin("");
    setPriceMax("");
    setMinCapacityIndex("60");
  };

  const toggleComposer = () => {
    const nextState = !showComposer;
    setShowComposer(nextState);
    router.replace(nextState ? "/marketplace/tenders?mode=create" : "/marketplace/tenders");
    if (!nextState) resetComposer();
  };

  const submitTender = useCallback(async (status: "DRAFT" | "PUBLISHED") => {
    setSubmittingStatus(status);
    setMessage(null);
    try {
      const response = await apiFetch<{ message: string; tender: { id: string } }>("/api/marketplace/tenders/", {
        method: "POST",
        body: {
          title: title.trim(),
          product_category: productCategory,
          product_name: productName.trim(),
          status,
          eligibility_tier: eligibilityTier,
          quantity_kg_min: quantityMin,
          quantity_kg_max: quantityMax,
          delivery_location: deliveryLocation.trim(),
          delivery_start: deliveryStart,
          delivery_end: deliveryEnd,
          bid_deadline: bidDeadline,
          quality_specs: stripRichText(qualitySpecs).trim() ? qualitySpecs : "",
          indicative_price_min_ksh: priceMin.trim() || null,
          indicative_price_max_ksh: priceMax.trim() || null,
          min_capacity_index: minCapacityIndex,
        },
      });
      resetComposer();
      router.push(`/marketplace/tenders/${response.tender.id}`);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Tender creation failed.";
      setMessage({ type: "error", text });
    } finally {
      setSubmittingStatus(null);
    }
  }, [
    bidDeadline,
    deliveryEnd,
    deliveryLocation,
    deliveryStart,
    eligibilityTier,
    minCapacityIndex,
    priceMax,
    priceMin,
    productCategory,
    productName,
    qualitySpecs,
    quantityMax,
    quantityMin,
    router,
    title,
  ]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm text-[var(--foreground-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading tender workspace…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section
        className="overflow-hidden rounded-[28px] border border-[var(--border)] p-6 text-white sm:p-8"
        style={buyerTendersHeroStyle}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-4">
            <Badge className="w-fit border-white/14 bg-white/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-none hover:bg-white/12">
              <BriefcaseBusiness className="h-3.5 w-3.5" />
              Buyer Tenders
            </Badge>
            <div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Publish, track, and review buyer tenders.</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/82">
                This page is your buyer-side tender desk: create a sourcing request, watch the response pipeline, and open the detail view for deeper bid review.
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={toggleComposer}
            className="h-11 rounded-2xl bg-white px-5 shadow-[0_14px_30px_rgba(0,0,0,0.14)] hover:bg-white/90"
            style={{ color: "color-mix(in oklch, var(--foreground) 18%, black)" }}
          >
            <Plus className="h-4 w-4" />
            {showComposer ? "Hide composer" : "Create tender"}
          </Button>
        </div>
      </section>

      <AnimatedAlert
        show={Boolean(message)}
        motionKey={message?.text ?? "buyer-tenders-message"}
        className={cn(
          "flex items-start gap-3 rounded-2xl border px-4 py-4 text-sm",
          message?.type === "success" ? "sf-tone-success" : "sf-tone-danger"
        )}
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{message?.text ?? ""}</p>
      </AnimatedAlert>

      {showComposer && (
        <Card className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] py-0 shadow-[var(--shadow-sm)]">
          <CardContent className="p-6">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary)]">
                <CalendarClock className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Tender composer</h2>
                <p className="text-sm text-[var(--foreground-muted)]">
                  Save a draft while the sourcing brief is still evolving, or publish immediately to invite cooperative responses.
                </p>
              </div>
            </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 sm:col-span-2">
              <FieldLabel>Tender title</FieldLabel>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="White Maize Supply - Q3 2026"
                className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
              />
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Product category</FieldLabel>
              <Select value={productCategory} onValueChange={setProductCategory}>
                <SelectTrigger className="h-11 w-full rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-sm text-[var(--input-text)]">
                  <SelectValue placeholder="Select product category" />
                </SelectTrigger>
                <SelectContent>
                  {payload?.category_options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Product name</FieldLabel>
              <Input
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
                placeholder="White Maize"
                className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
              />
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Eligibility tier</FieldLabel>
              <Select value={eligibilityTier} onValueChange={setEligibilityTier}>
                <SelectTrigger className="h-11 w-full rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-sm text-[var(--input-text)]">
                  <SelectValue placeholder="Select eligibility tier" />
                </SelectTrigger>
                <SelectContent>
                  {payload?.eligibility_options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Delivery location</FieldLabel>
              <Input
                value={deliveryLocation}
                onChange={(event) => setDeliveryLocation(event.target.value)}
                placeholder="Nairobi distribution centre"
                className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
              />
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Minimum quantity (kg)</FieldLabel>
              <Input
                type="number"
                value={quantityMin}
                onChange={(event) => setQuantityMin(event.target.value)}
                className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
              />
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Maximum quantity (kg)</FieldLabel>
              <Input
                type="number"
                value={quantityMax}
                onChange={(event) => setQuantityMax(event.target.value)}
                className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
              />
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Delivery start</FieldLabel>
              <Input
                type="date"
                value={deliveryStart}
                onChange={(event) => setDeliveryStart(event.target.value)}
                className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
              />
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Delivery end</FieldLabel>
              <Input
                type="date"
                value={deliveryEnd}
                onChange={(event) => setDeliveryEnd(event.target.value)}
                className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
              />
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Bid deadline</FieldLabel>
              <Input
                type="datetime-local"
                value={bidDeadline}
                onChange={(event) => setBidDeadline(event.target.value)}
                className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
              />
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Minimum capacity index</FieldLabel>
              <Input
                type="number"
                min={0}
                max={100}
                value={minCapacityIndex}
                onChange={(event) => setMinCapacityIndex(event.target.value)}
                className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
              />
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Indicative price min (KES)</FieldLabel>
              <Input
                type="number"
                value={priceMin}
                onChange={(event) => setPriceMin(event.target.value)}
                className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
              />
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Indicative price max (KES)</FieldLabel>
              <Input
                type="number"
                value={priceMax}
                onChange={(event) => setPriceMax(event.target.value)}
                className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
              />
            </label>
            <label className="space-y-1.5 sm:col-span-2">
              <FieldLabel>Quality specifications</FieldLabel>
              <RichTextEditor
                value={qualitySpecs}
                onChange={setQualitySpecs}
                placeholder="Include grade, moisture level, packaging, certification, or delivery constraints."
                className="text-[var(--input-text)]"
              />
            </label>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              onClick={() => void submitTender("DRAFT")}
              disabled={Boolean(submittingStatus)}
              variant="outline"
              className="h-11 rounded-2xl px-5"
            >
              {submittingStatus === "DRAFT" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Save draft
            </Button>
            <Button
              type="button"
              onClick={() => void submitTender("PUBLISHED")}
              disabled={Boolean(submittingStatus)}
              className="h-11 rounded-2xl px-5"
            >
              {submittingStatus === "PUBLISHED" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Publish tender
            </Button>
          </div>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] py-0 shadow-[var(--shadow-sm)]">
        <CardContent className="p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Tender library</h2>
            <p className="text-sm text-[var(--foreground-muted)]">
              Filter across live, draft, and completed buyer tenders.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setSearch(searchInput.trim());
              }}
              className="relative"
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--foreground-subtle)]" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search title, product, or location"
                className="h-11 w-full rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] pl-10 pr-4 text-[var(--input-text)] sm:w-72"
              />
            </form>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="h-11 w-full rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-sm text-[var(--input-text)] sm:w-[180px]">
                <SelectValue placeholder="Sort tenders" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Most recent</SelectItem>
                <SelectItem value="deadline">Earliest deadline</SelectItem>
                <SelectItem value="bids">Most responses</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {statusPills.map((pill) => (
            <Button
              key={pill.key}
              type="button"
              size="sm"
              variant={statusFilter === pill.key ? "default" : "outline"}
              onClick={() => setStatusFilter(pill.key)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold",
                statusFilter !== pill.key && "border-[var(--border)] bg-[var(--background)] text-[var(--foreground-muted)]"
              )}
            >
              {pill.label} · {pill.count}
            </Button>
          ))}
        </div>

        <div className="mt-6 space-y-4">
          {payload?.items.length ? payload.items.map((tender) => (
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
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--foreground-muted)]">
                      {tender.eligibility_tier_display}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--foreground)]">{tender.title}</h3>
                    <p className="mt-1 text-sm text-[var(--foreground-muted)]">
                      {tender.product_name} · {tender.delivery_location}
                    </p>
                  </div>
                  <div className="grid gap-3 text-sm text-[var(--foreground-muted)] sm:grid-cols-4">
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
                      <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Price range</p>
                      <p className="mt-1 font-medium text-[var(--foreground)]">
                        {tender.indicative_price_min_ksh != null || tender.indicative_price_max_ksh != null
                          ? `${formatCurrency(tender.indicative_price_min_ksh)} - ${formatCurrency(tender.indicative_price_max_ksh)}`
                          : "Not set"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Responses</p>
                      <p className="mt-1 font-medium text-[var(--foreground)]">{tender.total_bids}</p>
                    </div>
                  </div>
                  {tender.quality_specs_text && (
                    <p className="text-sm leading-6 text-[var(--foreground-muted)]">
                      {tender.quality_specs_text}
                    </p>
                  )}
                </div>
                <Button asChild variant="outline" className="h-10 rounded-2xl px-4">
                  <Link href={tender.href}>View detail</Link>
                </Button>
              </div>
            </article>
          )) : (
            <div className="rounded-[22px] border border-dashed border-[var(--border)] bg-[var(--background)] px-6 py-12 text-center">
              <p className="text-lg font-semibold text-[var(--foreground)]">No tenders match this view.</p>
              <p className="mt-2 text-sm text-[var(--foreground-muted)]">
                Adjust the filters or create a fresh tender to begin collecting cooperative bids.
              </p>
              <Button
                type="button"
                onClick={toggleComposer}
                className="mt-5 h-10 rounded-2xl px-4"
              >
                <Plus className="h-4 w-4" />
                Create tender
              </Button>
            </div>
          )}
        </div>
        </CardContent>
      </Card>
    </div>
  );
}
