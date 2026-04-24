"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  MessageSquareText,
  NotebookPen,
  ShieldCheck,
  Upload,
  WalletCards,
} from "lucide-react";

import { AnimatedAlert } from "@/components/ui/animated-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SafeRichText } from "@/components/ui/safe-rich-text";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, getUser } from "@/lib/api";
import { CHAT_THREAD_UPDATED_EVENT, openMarketplaceChat } from "@/lib/marketplace-chat";
import {
  bidStatusTone,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDecimal,
  formatQuantityRange,
  tenderStatusTone,
} from "@/lib/marketplace";
import { cn } from "@/lib/utils";

interface DocumentItem {
  id: string;
  title: string;
  file: string;
  uploaded_at: string;
}

interface CooperativeTenderDetailPayload {
  viewer_role: "cooperative";
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
  cooperative: {
    id: string;
    name: string;
    region: string;
    capacity_index: number | null;
    is_premium_eligible: boolean;
    is_verified: boolean;
  };
  documents: DocumentItem[];
  eligibility: {
    is_eligible: boolean;
    reason: string;
    capacity_index: number | null;
    is_premium_eligible: boolean;
    is_verified: boolean;
  };
  my_bid: {
    id: string;
    status: string;
    status_display: string;
    offered_quantity_kg: number;
    offered_price_ksh: number;
    proposed_delivery_date: string;
    submitted_at: string | null;
    created_at: string;
    updated_at: string;
    narrative_text: string;
    terms_notes: string;
    revision_number: number;
    documents: DocumentItem[];
  } | null;
  bid_history: Array<{
    id: string;
    status: string;
    status_display: string;
    offered_quantity_kg: number;
    offered_price_ksh: number;
    proposed_delivery_date: string;
    submitted_at: string | null;
    created_at: string;
    updated_at: string;
    narrative_text: string;
    terms_notes: string;
    revision_number: number;
    documents: DocumentItem[];
  }>;
  can_submit_bid: boolean;
  can_chat: boolean;
  message_summary: {
    messages_count: number;
    unread_messages: number;
    last_message_at: string | null;
  };
  recent_messages: Array<{
    id: string;
    sender_name: string;
    body: string;
    created_at: string;
    attachment: {
      name: string;
    } | null;
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

const cooperativeTenderHeroStyle = {
  background:
    "radial-gradient(circle at top left, color-mix(in oklch, var(--secondary) 20%, transparent) 0%, transparent 30%), radial-gradient(circle at bottom right, color-mix(in oklch, var(--primary) 24%, transparent) 0%, transparent 34%), linear-gradient(132deg, color-mix(in oklch, var(--foreground) 86%, var(--primary) 14%) 0%, color-mix(in oklch, var(--primary) 76%, var(--foreground) 24%) 42%, color-mix(in oklch, var(--secondary) 52%, var(--primary) 48%) 100%)",
  boxShadow: "0 24px 80px color-mix(in oklch, var(--primary) 24%, transparent)",
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Label className="text-sm font-medium text-[var(--foreground)]">{children}</Label>;
}

export default function CooperativeTenderDetailPage() {
  const params = useParams<{ tenderId: string }>();
  const tenderId = params.tenderId;
  const [viewer, setViewer] = useState<ReturnType<typeof getUser>>(null);

  const [payload, setPayload] = useState<CooperativeTenderDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [savingStatus, setSavingStatus] = useState<"DRAFT" | "SUBMITTED" | "WITHDRAW" | null>(null);

  const [offeredQuantity, setOfferedQuantity] = useState("");
  const [offeredPrice, setOfferedPrice] = useState("");
  const [proposedDeliveryDate, setProposedDeliveryDate] = useState("");
  const [narrative, setNarrative] = useState("");
  const [termsNotes, setTermsNotes] = useState("");
  const [documents, setDocuments] = useState<File[]>([]);

  useEffect(() => {
    setViewer(getUser());
  }, []);

  const cooperativeId = viewer?.cooperative_id ?? payload?.cooperative.id ?? null;
  const chairOnly = Boolean(viewer && viewer.user_type === "CHAIR" && viewer.cooperative_id);
  const crmBase = viewer?.cooperative_id ? `/crm/${viewer.cooperative_id}` : "/crm";

  const loadTender = useCallback(async () => {
    const nextPayload = await apiFetch<CooperativeTenderDetailPayload>(`/api/marketplace/cooperative/tenders/${tenderId}/`);
    setPayload(nextPayload);
    return nextPayload;
  }, [tenderId]);

  useEffect(() => {
    if (!viewer) return;
    if (!chairOnly) {
      setLoading(false);
      return;
    }
    void loadTender()
      .catch((err) => setAlert({ type: "error", text: err instanceof Error ? err.message : "Failed to load the tender workspace." }))
      .finally(() => setLoading(false));
  }, [chairOnly, loadTender, viewer]);

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

  useEffect(() => {
    if (!payload?.my_bid) {
      setOfferedQuantity("");
      setOfferedPrice("");
      setProposedDeliveryDate("");
      setNarrative("");
      setTermsNotes("");
      return;
    }

    setOfferedQuantity(String(payload.my_bid.offered_quantity_kg ?? ""));
    setOfferedPrice(String(payload.my_bid.offered_price_ksh ?? ""));
    setProposedDeliveryDate(payload.my_bid.proposed_delivery_date ?? "");
    setNarrative(payload.my_bid.narrative_text ?? "");
    setTermsNotes(payload.my_bid.terms_notes ?? "");
  }, [payload?.my_bid]);

  const formReady = useMemo(
    () => Boolean(offeredQuantity.trim() && offeredPrice.trim() && proposedDeliveryDate),
    [offeredPrice, offeredQuantity, proposedDeliveryDate]
  );

  if (viewer && !chairOnly) {
    return (
      <div className="rounded-[24px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
        <p className="text-lg font-semibold text-[var(--foreground)]">Tender marketplace access is limited to the cooperative chair for now.</p>
        <Link href={`${crmBase}/dashboard`} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)]">
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
      </div>
    );
  }

  async function handleSave(status: "DRAFT" | "SUBMITTED") {
    if (!formReady) {
      setAlert({ type: "error", text: "Quantity, price, and proposed delivery date are required before saving." });
      return;
    }

    setSavingStatus(status);
    setAlert(null);

    const formData = new FormData();
    formData.append("offered_quantity_kg", offeredQuantity.trim());
    formData.append("offered_price_ksh", offeredPrice.trim());
    formData.append("proposed_delivery_date", proposedDeliveryDate);
    formData.append("narrative", narrative.trim());
    formData.append("terms_notes", termsNotes.trim());
    formData.append("status", status);
    documents.forEach((file) => formData.append("documents", file));

    try {
      await apiFetch(`/api/marketplace/cooperative/tenders/${tenderId}/bid/`, {
        method: "POST",
        body: formData,
      });
      await loadTender();
      setDocuments([]);
      setAlert({ type: "success", text: status === "SUBMITTED" ? "Bid submitted successfully." : "Bid draft saved." });
    } catch (error) {
      setAlert({ type: "error", text: error instanceof Error ? error.message : "Failed to save the bid." });
    } finally {
      setSavingStatus(null);
    }
  }

  async function handleWithdraw() {
    setSavingStatus("WITHDRAW");
    setAlert(null);
    try {
      await apiFetch(`/api/marketplace/cooperative/tenders/${tenderId}/bid/`, { method: "PATCH" });
      await loadTender();
      setAlert({ type: "success", text: "Bid withdrawn successfully." });
    } catch (error) {
      setAlert({ type: "error", text: error instanceof Error ? error.message : "Failed to withdraw the bid." });
    } finally {
      setSavingStatus(null);
    }
  }

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

  if (!payload) {
    return (
      <div className="rounded-[24px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
        <p className="text-lg font-semibold text-[var(--foreground)]">Tender not found.</p>
        <Link href="/marketplace/discover" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)]">
          <ArrowLeft className="h-4 w-4" />
          Back to marketplace
        </Link>
      </div>
    );
  }

  const { tender } = payload;
  const canWithdraw = payload.my_bid && ["DRAFT", "SUBMITTED", "SHORTLISTED"].includes(payload.my_bid.status);

  return (
    <div className="space-y-8">
      <section
        className="overflow-hidden rounded-[28px] border border-[var(--border)] p-6 text-white sm:p-8"
        style={cooperativeTenderHeroStyle}
      >
        <div className="space-y-5">
          <Button asChild variant="outline" className="rounded-full border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white hover:bg-white/15">
            <Link href="/marketplace/discover">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to marketplace
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
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{tender.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/82">
              {tender.product_name} for {payload.buyer.company_name} · Delivery to {tender.delivery_location}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {[
              { label: "Quantity window", value: formatQuantityRange(tender.quantity_kg_min, tender.quantity_kg_max) },
              { label: "Bid deadline", value: formatDateTime(tender.bid_deadline) },
              { label: "Your capacity", value: payload.cooperative.capacity_index != null ? `${Math.round(payload.cooperative.capacity_index)}/100` : "Not scored" },
              { label: "Responses", value: String(tender.total_bids) },
              { label: "Buyer type", value: payload.buyer.buyer_type_display ?? "Not set" },
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
        motionKey={alert?.text ?? "cooperative-tender-alert"}
        className={cn(
          "flex items-start gap-3 rounded-2xl border px-4 py-4 text-sm",
          alert?.type === "success" ? "sf-tone-success" : "sf-tone-danger"
        )}
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{alert?.text ?? ""}</p>
      </AnimatedAlert>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Eligibility" value={payload.eligibility.is_eligible ? "Ready" : "Blocked"} hint={payload.eligibility.reason} />
        <SummaryCard label="Current bid" value={payload.my_bid?.status_display ?? "No bid"} hint={payload.my_bid ? `Revision ${payload.my_bid.revision_number}` : "Create a draft or submit a response."} />
        <SummaryCard label="Negotiation chat" value={`${payload.message_summary.messages_count}`} hint={payload.message_summary.last_message_at ? `Last activity ${formatDateTime(payload.message_summary.last_message_at)}` : "No messages exchanged yet."} />
        <SummaryCard label="Buyer documents" value={String(payload.documents.length)} hint="Supporting specs or procurement files attached by the buyer." />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
        <div className="space-y-6">
          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary)]">
                <NotebookPen className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Tender brief</h2>
                <p className="text-sm text-[var(--foreground-muted)]">
                  Review the buyer context, procurement notes, and file attachments before you send or revise your bid.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Buyer</p>
                <p className="mt-2 text-sm font-medium text-[var(--foreground)]">{payload.buyer.company_name}</p>
                <p className="mt-1 text-sm text-[var(--foreground-muted)]">
                  {payload.buyer.region || "Region not specified"}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Delivery window</p>
                <p className="mt-2 text-sm font-medium text-[var(--foreground)]">
                  {formatDate(tender.delivery_start)} to {formatDate(tender.delivery_end)}
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-[22px] border border-[var(--border)] bg-[var(--background)] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Quality specifications</p>
              <SafeRichText
                value={tender.quality_specs}
                emptyText="No detailed specifications were provided for this tender."
                className="mt-3"
              />
            </div>

            <div className="mt-6 rounded-[22px] border border-[var(--border)] bg-[var(--background)] p-5">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-[var(--primary)]" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Tender documents</p>
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
                      <p className="mt-1 text-xs text-[var(--foreground-subtle)]">Uploaded {formatDateTime(document.uploaded_at)}</p>
                    </div>
                    <span className="text-xs font-semibold text-[var(--primary)]">Open</span>
                  </a>
                )) : (
                  <p className="text-sm text-[var(--foreground-muted)]">No buyer-side tender documents were attached.</p>
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
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Bid composer</h2>
                <p className="text-sm text-[var(--foreground-muted)]">
                  Save a draft, submit your response, or update the current negotiation terms when the tender is under review.
                </p>
              </div>
            </div>

            <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
              <p className="text-sm font-semibold text-[var(--foreground)]">
                {payload.can_submit_bid ? "Bid actions enabled" : "Bid actions locked"}
              </p>
              <p className="mt-1 text-sm text-[var(--foreground-muted)]">{payload.eligibility.reason}</p>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <FieldLabel>Offered quantity (kg)</FieldLabel>
                <Input
                  type="number"
                  value={offeredQuantity}
                  onChange={(event) => setOfferedQuantity(event.target.value)}
                  disabled={!payload.can_submit_bid}
                  className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
                />
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Offered price (KES)</FieldLabel>
                <Input
                  type="number"
                  value={offeredPrice}
                  onChange={(event) => setOfferedPrice(event.target.value)}
                  disabled={!payload.can_submit_bid}
                  className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
                />
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Proposed delivery date</FieldLabel>
                <Input
                  type="date"
                  value={proposedDeliveryDate}
                  onChange={(event) => setProposedDeliveryDate(event.target.value)}
                  disabled={!payload.can_submit_bid}
                  className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
                />
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Supporting documents</FieldLabel>
                <input
                  type="file"
                  multiple
                  disabled={!payload.can_submit_bid}
                  onChange={(event) => setDocuments(Array.from(event.target.files ?? []))}
                  className="block w-full rounded-2xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--input-text)] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
            </div>

            {documents.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {documents.map((file) => (
                  <span key={`${file.name}-${file.size}`} className="rounded-full border border-[var(--border)] bg-[var(--background)] px-3 py-1 text-xs font-semibold text-[var(--foreground-muted)]">
                    {file.name}
                  </span>
                ))}
              </div>
            )}

            <label className="mt-4 block space-y-1.5">
              <FieldLabel>Bid narrative</FieldLabel>
              <Textarea
                rows={5}
                value={narrative}
                onChange={(event) => setNarrative(event.target.value)}
                disabled={!payload.can_submit_bid}
                placeholder="Summarize how the cooperative will deliver this tender, the sourcing confidence, and any negotiation context the buyer should know."
                className="rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3 text-[var(--input-text)] disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            <label className="mt-4 block space-y-1.5">
              <FieldLabel>Terms notes</FieldLabel>
              <Textarea
                rows={4}
                value={termsNotes}
                onChange={(event) => setTermsNotes(event.target.value)}
                disabled={!payload.can_submit_bid}
                placeholder="Add packaging, delivery milestones, documentation promises, or any commercial notes."
                className="rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3 text-[var(--input-text)] disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => void handleSave("DRAFT")}
                disabled={!payload.can_submit_bid || savingStatus !== null}
                variant="outline"
                className="h-11 rounded-2xl px-4"
              >
                {savingStatus === "DRAFT" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Save draft
              </Button>
              <Button
                type="button"
                onClick={() => void handleSave("SUBMITTED")}
                disabled={!payload.can_submit_bid || savingStatus !== null}
                className="h-11 rounded-2xl px-4"
              >
                {savingStatus === "SUBMITTED" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Submit bid
              </Button>
              {canWithdraw && (
                <Button
                  type="button"
                  onClick={() => void handleWithdraw()}
                  disabled={savingStatus !== null}
                  variant="destructive"
                  className="h-11 rounded-2xl px-4"
                >
                  {savingStatus === "WITHDRAW" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Withdraw bid
                </Button>
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
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Negotiation drawer</h2>
                <p className="text-sm text-[var(--foreground-muted)]">
                  Open the drawer to send media and messages directly to the buyer during negotiation.
                </p>
              </div>
            </div>

            <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] p-4">
              <p className="text-sm font-semibold text-[var(--foreground)]">
                {payload.can_chat ? "Chat connected" : "Chat locked"}
              </p>
              <p className="mt-1 text-sm text-[var(--foreground-muted)]">
                {payload.can_chat
                  ? payload.message_summary.last_message_at
                    ? `Last activity ${formatDateTime(payload.message_summary.last_message_at)}`
                    : "Messages are enabled for this tender negotiation."
                  : "Messages open once your cooperative has a submitted bid on this tender."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {payload.message_summary.unread_messages > 0 && (
                  <span className="sf-tone-success rounded-full border px-3 py-1 text-xs font-semibold">
                    {payload.message_summary.unread_messages} unread
                  </span>
                )}
                <span className="rounded-full bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--foreground-muted)]">
                  {payload.message_summary.messages_count} messages
                </span>
              </div>
              <Button
                type="button"
                onClick={() => {
                  if (!cooperativeId) return;
                  openMarketplaceChat({ tenderId, cooperativeId });
                }}
                disabled={!payload.can_chat || !cooperativeId}
                className="mt-4 h-11 rounded-2xl px-4"
              >
                <MessageSquareText className="h-4 w-4" />
                Open negotiation chat
              </Button>
            </div>

            <div className="mt-4 space-y-3">
              {payload.recent_messages.length ? payload.recent_messages.map((message) => (
                <div key={message.id} className="rounded-[18px] border border-[var(--border)] bg-[var(--background)] px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[var(--foreground)]">{message.sender_name}</p>
                    <span className="text-xs font-semibold text-[var(--foreground-subtle)]">{formatDateTime(message.created_at)}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--foreground-muted)]">
                    {message.body || message.attachment?.name || "Attachment shared"}
                  </p>
                </div>
              )) : (
                <p className="text-sm text-[var(--foreground-muted)]">No negotiation messages yet.</p>
              )}
            </div>
          </section>

          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary)]">
                <WalletCards className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Bid history</h2>
                <p className="text-sm text-[var(--foreground-muted)]">
                  Every revision your cooperative has sent for this tender.
                </p>
              </div>
            </div>
            <div className="space-y-3">
              {payload.bid_history.length ? payload.bid_history.map((bid) => (
                <article key={bid.id} className="rounded-[18px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", bidStatusTone(bid.status))}>
                      {bid.status_display}
                    </span>
                    <span className="text-xs text-[var(--foreground-subtle)]">Revision {bid.revision_number}</span>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                    {formatCurrency(bid.offered_price_ksh)} for {formatDecimal(bid.offered_quantity_kg, 0)} kg
                  </p>
                  <p className="mt-1 text-sm text-[var(--foreground-muted)]">
                    Proposed delivery {formatDate(bid.proposed_delivery_date)}
                  </p>
                  {bid.documents.length > 0 && (
                    <div className="mt-3 space-y-2">
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
                  )}
                </article>
              )) : (
                <p className="text-sm text-[var(--foreground-muted)]">No bid revisions have been created yet.</p>
              )}
            </div>
          </section>

          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary)]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Qualification snapshot</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--foreground-muted)]">
                  Cooperative verification: <strong>{payload.cooperative.is_verified ? "Verified" : "Pending"}</strong>.
                  Premium readiness: <strong>{payload.cooperative.is_premium_eligible ? "Eligible" : "Not yet"}</strong>.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
