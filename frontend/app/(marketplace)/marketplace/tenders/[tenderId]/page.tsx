"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarRange,
  CheckCircle2,
  FileText,
  Loader2,
  MessageSquareText,
  NotebookPen,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import { AnimatedAlert } from "@/components/ui/animated-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SafeRichText } from "@/components/ui/safe-rich-text";
import { apiFetch } from "@/lib/api";
import { CHAT_THREAD_UPDATED_EVENT, openMarketplaceChat } from "@/lib/marketplace-chat";
import {
  bidStatusTone,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDecimal,
  formatQuantityRange,
  formatRelativeTime,
  tenderStatusTone,
} from "@/lib/marketplace";
import { cn } from "@/lib/utils";

interface DocumentItem {
  id: string;
  title: string;
  file: string;
  uploaded_at: string;
}

interface TenderDetailPayload {
  viewer_role: "buyer";
  tender: {
    id: string;
    title: string;
    product_category_display: string;
    product_name: string;
    status: string;
    status_display: string;
    eligibility_tier_display: string;
    quantity_kg_min: number;
    quantity_kg_max: number;
    quality_specs: string;
    quality_specs_text: string;
    delivery_location: string;
    delivery_start: string;
    delivery_end: string;
    bid_deadline: string;
    indicative_price_min_ksh: number | null;
    indicative_price_max_ksh: number | null;
    min_capacity_index: number;
    total_bids: number;
    published_at: string | null;
  };
  buyer: {
    company_name: string;
    buyer_type_display: string | null;
    region: string;
    website: string;
    description_text: string;
  };
  documents: DocumentItem[];
  bids_summary: {
    total: number;
    submitted: number;
    shortlisted: number;
    accepted: number;
    average_price_ksh: number | null;
  };
  bids: Array<{
    id: string;
    status: string;
    status_display: string;
    cooperative_id: string;
    cooperative_name: string;
    cooperative_region: string;
    offered_quantity_kg: number;
    offered_price_ksh: number;
    proposed_delivery_date: string;
    submitted_at: string | null;
    created_at: string;
    updated_at: string;
    narrative_text: string;
    terms_notes: string;
    capacity_index: number | null;
    is_premium_eligible: boolean;
    credibility_score: number | null;
    completion_rate: number | null;
    documents: DocumentItem[];
    unread_messages?: number;
    messages_count?: number;
    last_message_at?: string | null;
    can_negotiate?: boolean;
  }>;
  messages: Array<{
    id: string;
    sender_name: string;
    sender_type: string;
    body: string;
    created_at: string;
    attachment: {
      url: string;
      name: string;
      kind: string;
    } | null;
  }>;
  activity: Array<{
    id: string;
    title: string;
    description: string;
    timestamp: string;
  }>;
}

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
    <div className="rounded-[22px] border border-[var(--border)] bg-[var(--background)] p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">{label}</p>
      <p className="mt-3 text-2xl font-bold tracking-tight text-[var(--foreground)]">{value}</p>
      <p className="mt-2 text-sm text-[var(--foreground-muted)]">{hint}</p>
    </div>
  );
}

const buyerTenderDetailHeroStyle = {
  background:
    "radial-gradient(circle at top left, color-mix(in oklch, var(--surface) 16%, transparent) 0%, transparent 28%), linear-gradient(135deg, color-mix(in oklch, var(--foreground) 76%, var(--warning) 24%) 0%, color-mix(in oklch, var(--warning) 58%, var(--foreground) 42%) 46%, color-mix(in oklch, var(--surface) 76%, var(--warning) 24%) 100%)",
  boxShadow: "0 24px 80px color-mix(in oklch, var(--warning) 22%, transparent)",
};

export default function TenderDetailPage() {
  const params = useParams<{ tenderId: string }>();
  const tenderId = params.tenderId;

  const [payload, setPayload] = useState<TenderDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pendingBidId, setPendingBidId] = useState<string | null>(null);

  const loadTender = useCallback(async () => {
    const nextPayload = await apiFetch<TenderDetailPayload>(`/api/marketplace/tenders/${tenderId}/`);
    setPayload(nextPayload);
    return nextPayload;
  }, [tenderId]);

  useEffect(() => {
    loadTender()
      .catch(() => setAlert({ type: "error", text: "Unable to load this tender workspace right now." }))
      .finally(() => setLoading(false));
  }, [loadTender]);

  useEffect(() => {
    const handleChatUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ tenderId?: string }>).detail;
      if (detail?.tenderId === tenderId) {
        void loadTender();
      }
    };

    window.addEventListener(CHAT_THREAD_UPDATED_EVENT, handleChatUpdated as EventListener);
    return () => {
      window.removeEventListener(CHAT_THREAD_UPDATED_EVENT, handleChatUpdated as EventListener);
    };
  }, [loadTender, tenderId]);

  async function handleBidStatus(bidId: string, status: "SHORTLISTED" | "ACCEPTED" | "REJECTED") {
    setPendingBidId(bidId);
    setAlert(null);
    try {
      await apiFetch(`/api/marketplace/tenders/${tenderId}/bids/${bidId}/`, {
        method: "PATCH",
        body: { status },
      });
      await loadTender();
      setAlert({
        type: "success",
        text: status === "SHORTLISTED"
          ? "Bid shortlisted for negotiation."
          : status === "ACCEPTED"
            ? "Bid accepted and tender awarded."
            : "Bid decision saved.",
      });
    } catch (error) {
      setAlert({ type: "error", text: error instanceof Error ? error.message : "The bid action failed." });
    } finally {
      setPendingBidId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm text-[var(--foreground-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading tender detail…
        </div>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="rounded-[24px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
        <p className="text-lg font-semibold text-[var(--foreground)]">Tender not found.</p>
        <Link href="/marketplace/tenders" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)]">
          <ArrowLeft className="h-4 w-4" />
          Back to tenders
        </Link>
      </div>
    );
  }

  const { tender } = payload;
  const showDecisionButtons = !["AWARDED", "CLOSED", "CANCELLED"].includes(tender.status);

  return (
    <div className="space-y-8">
      <section
        className="overflow-hidden rounded-[28px] border border-[var(--border)] p-6 text-white sm:p-8"
        style={buyerTenderDetailHeroStyle}
      >
        <div className="space-y-5">
          <Button asChild variant="outline" className="rounded-full border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white hover:bg-white/15">
            <Link href="/marketplace/tenders">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to tenders
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("rounded-full border px-3 py-1 text-xs font-semibold", tenderStatusTone(tender.status))}>
              {tender.status_display}
            </Badge>
            <Badge className="rounded-full border border-white/16 bg-black/16 px-3 py-1 text-xs font-semibold text-white/90 shadow-none">
              {tender.product_category_display}
            </Badge>
            <Badge className="rounded-full border border-white/16 bg-black/16 px-3 py-1 text-xs font-semibold text-white/90 shadow-none">
              {tender.eligibility_tier_display}
            </Badge>
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{tender.title}</h1>
            <p className="max-w-3xl text-sm leading-6 text-white/84">
              {tender.product_name} for {payload.buyer.company_name} · Delivery to {tender.delivery_location}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {[
              { label: "Quantity window", value: formatQuantityRange(tender.quantity_kg_min, tender.quantity_kg_max) },
              { label: "Bid deadline", value: formatDateTime(tender.bid_deadline) },
              {
                label: "Indicative price",
                value: tender.indicative_price_min_ksh != null || tender.indicative_price_max_ksh != null
                  ? `${formatCurrency(tender.indicative_price_min_ksh)} - ${formatCurrency(tender.indicative_price_max_ksh)}`
                  : "Not set",
              },
              { label: "Minimum capacity", value: `${tender.min_capacity_index}/100` },
              { label: "Documents", value: String(payload.documents.length) },
            ].map((item) => (
              <div key={item.label} className="rounded-[22px] border border-white/16 bg-black/14 px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/65">{item.label}</p>
                <p className="mt-2 text-sm font-semibold text-white">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <AnimatedAlert
        show={Boolean(alert)}
        motionKey={alert?.text ?? "buyer-tender-detail-alert"}
        className={cn(
          "flex items-start gap-3 rounded-2xl border px-4 py-4 text-sm",
          alert?.type === "success" ? "sf-tone-success" : "sf-tone-danger"
        )}
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{alert?.text ?? ""}</p>
      </AnimatedAlert>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Submitted bids"
          value={String(payload.bids_summary.submitted)}
          hint="Responses currently in the general review queue."
        />
        <SummaryCard
          label="Shortlisted"
          value={String(payload.bids_summary.shortlisted)}
          hint="Cooperatives moving deeper into commercial evaluation."
        />
        <SummaryCard
          label="Accepted"
          value={String(payload.bids_summary.accepted)}
          hint="Responses converted into the winning supply relationship."
        />
        <SummaryCard
          label="Average price"
          value={formatCurrency(payload.bids_summary.average_price_ksh)}
          hint="Mean cooperative quote across current responses."
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary)]">
                <NotebookPen className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Sourcing brief</h2>
                <p className="text-sm text-[var(--foreground-muted)]">
                  The details cooperatives are responding to in this tender cycle.
                </p>
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Delivery window</p>
                <p className="mt-2 text-sm font-medium text-[var(--foreground)]">
                  {formatDate(tender.delivery_start)} to {formatDate(tender.delivery_end)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Published</p>
                <p className="mt-2 text-sm font-medium text-[var(--foreground)]">
                  {tender.published_at ? formatDateTime(tender.published_at) : "Draft only"}
                </p>
              </div>
            </div>
            <div className="mt-6 rounded-[22px] border border-[var(--border)] bg-[var(--background)] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">
                Quality specifications
              </p>
              <SafeRichText
                value={tender.quality_specs}
                emptyText="No detailed specifications were added for this tender."
                className="mt-3"
              />
            </div>

            <div className="mt-6 rounded-[22px] border border-[var(--border)] bg-[var(--background)] p-5">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-[var(--primary)]" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">
                  Tender documents
                </p>
              </div>
              <div className="mt-4 space-y-3">
                {payload.documents.length ? payload.documents.map((document) => (
                  <a
                    key={document.id}
                    href={document.file}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-4 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 transition-colors hover:border-[var(--border-strong)]"
                  >
                    <div>
                      <p className="text-sm font-semibold text-[var(--foreground)]">{document.title}</p>
                      <p className="mt-1 text-xs text-[var(--foreground-subtle)]">
                        Uploaded {formatDateTime(document.uploaded_at)}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-[var(--primary)]">Open</span>
                  </a>
                )) : (
                  <p className="text-sm text-[var(--foreground-muted)]">
                    No extra tender documents were attached to this sourcing brief.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary)]">
                <WalletCards className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Bid responses</h2>
                <p className="text-sm text-[var(--foreground-muted)]">
                  Compare pricing, documents, credibility, and move each response through negotiation.
                </p>
              </div>
            </div>
            <div className="space-y-4">
              {payload.bids.length ? payload.bids.map((bid) => (
                <article key={bid.id} className="rounded-[22px] border border-[var(--border)] bg-[var(--background)] p-5">
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", bidStatusTone(bid.status))}>
                            {bid.status_display}
                          </span>
                          {bid.is_premium_eligible && (
                            <span className="sf-tone-info rounded-full border px-3 py-1 text-xs font-semibold">
                              Premium eligible
                            </span>
                          )}
                          {(bid.unread_messages ?? 0) > 0 && (
                            <span className="sf-tone-success rounded-full border px-3 py-1 text-xs font-semibold">
                              {bid.unread_messages} unread
                            </span>
                          )}
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-[var(--foreground)]">{bid.cooperative_name}</h3>
                          <p className="mt-1 text-sm text-[var(--foreground-muted)]">
                            {bid.cooperative_region} · Submitted {bid.submitted_at ? formatRelativeTime(bid.submitted_at) : formatRelativeTime(bid.created_at)}
                          </p>
                        </div>
                        <div className="grid gap-3 text-sm text-[var(--foreground-muted)] sm:grid-cols-4">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Quantity</p>
                            <p className="mt-1 font-medium text-[var(--foreground)]">{formatDecimal(bid.offered_quantity_kg, 0)} kg</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Price</p>
                            <p className="mt-1 font-medium text-[var(--foreground)]">{formatCurrency(bid.offered_price_ksh)}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Delivery date</p>
                            <p className="mt-1 font-medium text-[var(--foreground)]">{formatDate(bid.proposed_delivery_date)}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Capacity / credibility</p>
                            <p className="mt-1 font-medium text-[var(--foreground)]">
                              {(bid.capacity_index ?? 0) > 0 ? `${formatDecimal(bid.capacity_index, 0)}/100` : "—"} · {(bid.credibility_score ?? 0) > 0 ? `${formatDecimal(bid.credibility_score, 0)}/100` : "—"}
                            </p>
                          </div>
                        </div>
                        {bid.narrative_text && (
                          <p className="text-sm leading-6 text-[var(--foreground-muted)]">{bid.narrative_text}</p>
                        )}
                        {bid.terms_notes && (
                          <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground-muted)]">
                            <strong className="text-[var(--foreground)]">Terms notes:</strong> {bid.terms_notes}
                          </div>
                        )}
                        {bid.documents.length > 0 && (
                          <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-4">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">
                              Supporting documents
                            </p>
                            <div className="mt-3 grid gap-2">
                              {bid.documents.map((document) => (
                                <a
                                  key={document.id}
                                  href={document.file}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-2 text-sm font-medium text-[var(--primary)] hover:underline"
                                >
                                  <FileText className="h-4 w-4" />
                                  {document.title}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
                      {bid.can_negotiate && (
                        <Button
                          type="button"
                          onClick={() => openMarketplaceChat({ tenderId, cooperativeId: bid.cooperative_id })}
                          variant="outline"
                          className="h-10 rounded-2xl px-4"
                        >
                          <MessageSquareText className="h-4 w-4" />
                          Open negotiation
                        </Button>
                      )}

                      {showDecisionButtons && bid.status === "SUBMITTED" && (
                        <Button
                          type="button"
                          onClick={() => void handleBidStatus(bid.id, "SHORTLISTED")}
                          disabled={pendingBidId === bid.id}
                          variant="outline"
                          className="h-10 rounded-2xl border-[color:color-mix(in_oklch,var(--warning)_28%,var(--border))] bg-[color:color-mix(in_oklch,var(--warning)_16%,var(--surface))] px-4 text-[var(--warning)] hover:bg-[color:color-mix(in_oklch,var(--warning)_22%,var(--surface))] hover:text-[var(--warning)]"
                        >
                          {pendingBidId === bid.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          Shortlist
                        </Button>
                      )}

                      {showDecisionButtons && ["SUBMITTED", "SHORTLISTED"].includes(bid.status) && (
                        <>
                          <Button
                            type="button"
                            onClick={() => void handleBidStatus(bid.id, "ACCEPTED")}
                            disabled={pendingBidId === bid.id}
                            className="h-10 rounded-2xl px-4"
                          >
                            {pendingBidId === bid.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            Accept bid
                          </Button>
                          <Button
                            type="button"
                            onClick={() => void handleBidStatus(bid.id, "REJECTED")}
                            disabled={pendingBidId === bid.id}
                            variant="destructive"
                            className="h-10 rounded-2xl px-4"
                          >
                            {pendingBidId === bid.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            Reject
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              )) : (
                <div className="rounded-[22px] border border-dashed border-[var(--border)] bg-[var(--background)] px-6 py-12 text-center">
                  <p className="text-lg font-semibold text-[var(--foreground)]">No bid responses yet.</p>
                  <p className="mt-2 text-sm text-[var(--foreground-muted)]">
                    Once cooperatives respond, the detail view will show price, quantity, and trust indicators here.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary)]">
                <MessageSquareText className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Negotiation channels</h2>
                <p className="text-sm text-[var(--foreground-muted)]">
                  Open the right-side drawer to negotiate directly with each cooperative.
                </p>
              </div>
            </div>
            <div className="space-y-3">
              {payload.bids.length ? payload.bids.map((bid) => (
                <Button
                  key={bid.id}
                  type="button"
                  variant="outline"
                  onClick={() => openMarketplaceChat({ tenderId, cooperativeId: bid.cooperative_id })}
                  className="flex h-auto w-full items-center justify-between gap-4 rounded-[20px] border-[var(--border)] bg-[var(--background)] px-4 py-4 text-left"
                >
                  <div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">{bid.cooperative_name}</p>
                    <p className="mt-1 text-sm text-[var(--foreground-muted)]">
                      {(bid.messages_count ?? 0) > 0
                        ? `${bid.messages_count} message${bid.messages_count === 1 ? "" : "s"} · Last activity ${bid.last_message_at ? formatRelativeTime(bid.last_message_at) : "recently"}`
                        : "No messages yet. Start the negotiation thread."}
                    </p>
                  </div>
                  <div className="text-right">
                    {(bid.unread_messages ?? 0) > 0 && (
                      <span className="sf-tone-success inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold">
                        {bid.unread_messages} unread
                      </span>
                    )}
                    <p className="mt-2 text-xs font-semibold text-[var(--primary)]">Open drawer</p>
                  </div>
                </Button>
              )) : (
                <p className="text-sm text-[var(--foreground-muted)]">Negotiation channels appear after the first cooperative response arrives.</p>
              )}
            </div>
          </section>

          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary)]">
                <MessageSquareText className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Recent messages</h2>
                <p className="text-sm text-[var(--foreground-muted)]">
                  Latest chat activity across all cooperative negotiation threads.
                </p>
              </div>
            </div>
            <div className="space-y-3">
              {payload.messages.length ? payload.messages.map((message) => (
                <div key={message.id} className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[var(--foreground)]">{message.sender_name}</p>
                    <span className="text-xs font-semibold text-[var(--foreground-subtle)]">
                      {formatRelativeTime(message.created_at)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--foreground-muted)]">
                    {message.body || message.attachment?.name || "Attachment shared"}
                  </p>
                </div>
              )) : (
                <p className="text-sm text-[var(--foreground-muted)]">No tender messages have been exchanged yet.</p>
              )}
            </div>
          </section>

          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary)]">
                <CalendarRange className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Timeline</h2>
                <p className="text-sm text-[var(--foreground-muted)]">
                  Key tender events ordered from most recent to oldest.
                </p>
              </div>
            </div>
            <div className="space-y-3">
              {payload.activity.map((item) => (
                <div key={item.id} className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[var(--foreground)]">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--foreground-muted)]">{item.description}</p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-[var(--foreground-subtle)]">
                      {formatRelativeTime(item.timestamp)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary)]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Tender guardrails</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--foreground-muted)]">
                  This tender requires at least a <strong>{tender.min_capacity_index}/100</strong> capacity index and is currently
                  scoped to <strong> {tender.eligibility_tier_display}</strong>.
                </p>
                <p className="mt-3 text-sm text-[var(--foreground-muted)]">
                  Buyer type: <strong className="text-[var(--foreground)]">{payload.buyer.buyer_type_display ?? "Not specified"}</strong>
                  {payload.buyer.region ? ` · Base region: ${payload.buyer.region}` : ""}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>

    </div>
  );
}
