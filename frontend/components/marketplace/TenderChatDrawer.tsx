"use client";

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  MessageSquareText,
  Paperclip,
  SendHorizonal,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/marketplace";
import { cn } from "@/lib/utils";

interface ChatAttachment {
  url: string;
  name: string;
  media_type: string | null;
  kind: "image" | "video" | "audio" | "document";
}

interface ChatMessage {
  id: string;
  sender_name: string;
  sender_type: string;
  body: string;
  attachment: ChatAttachment | null;
  created_at: string;
  is_mine: boolean;
}

interface ChatConversationPayload {
  conversation: {
    tender_id: string;
    tender_title: string;
    buyer_company_name: string;
    cooperative_id: string;
    cooperative_name: string;
    can_send: boolean;
    message_count: number;
  };
  messages: ChatMessage[];
}

function AttachmentPreview({ attachment }: { attachment: ChatAttachment }) {
  if (attachment.kind === "image") {
    return (
      <a href={attachment.url} target="_blank" rel="noreferrer" className="mt-3 block overflow-hidden rounded-2xl border border-[var(--border)] bg-black/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={attachment.url} alt={attachment.name} className="max-h-72 w-full object-cover" />
      </a>
    );
  }

  if (attachment.kind === "video") {
    return (
      <video controls className="mt-3 max-h-72 w-full rounded-2xl border border-[var(--border)] bg-black/90">
        <source src={attachment.url} type={attachment.media_type ?? undefined} />
      </video>
    );
  }

  if (attachment.kind === "audio") {
    return (
      <audio controls className="mt-3 w-full">
        <source src={attachment.url} type={attachment.media_type ?? undefined} />
      </audio>
    );
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white/70 px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--border-strong)]"
    >
      <Paperclip className="h-4 w-4" />
      {attachment.name}
    </a>
  );
}

export function TenderChatDrawer({
  open,
  onOpenChange,
  tenderId,
  tenderTitle,
  userRole,
  cooperativeId,
  partnerLabel,
  onConversationUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenderId: string;
  tenderTitle: string;
  userRole: "buyer" | "cooperative";
  cooperativeId?: string | null;
  partnerLabel: string;
  onConversationUpdated?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ChatConversationPayload | null>(null);
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);

  useEffect(() => {
    if (!open) return;
    if (userRole === "buyer" && !cooperativeId) {
      setPayload(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    const params = userRole === "buyer" && cooperativeId
      ? `?cooperative_id=${encodeURIComponent(cooperativeId)}`
      : "";

    apiFetch<ChatConversationPayload>(`/api/marketplace/tenders/${tenderId}/messages/${params}`)
      .then(setPayload)
      .catch((err) => {
        setPayload(null);
        setError(err instanceof Error ? err.message : "Failed to load the conversation.");
      })
      .finally(() => setLoading(false));
  }, [cooperativeId, open, tenderId, userRole]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [payload?.messages.length, open]);

  async function handleSend() {
    if (!body.trim() && !attachment) return;

    setSending(true);
    setError(null);
    const formData = new FormData();
    if (body.trim()) formData.append("body", body.trim());
    if (attachment) formData.append("attachment", attachment);
    if (userRole === "buyer" && cooperativeId) formData.append("cooperative_id", cooperativeId);

    try {
      const response = await apiFetch<{ item: ChatMessage }>(`/api/marketplace/tenders/${tenderId}/messages/`, {
        method: "POST",
        body: formData,
      });
      setPayload((current) => current ? {
        ...current,
        messages: [...current.messages, response.item],
        conversation: {
          ...current.conversation,
          message_count: current.conversation.message_count + 1,
        },
      } : current);
      setBody("");
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onConversationUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send the message.");
    } finally {
      setSending(false);
    }
  }

  const showSelectionPrompt = userRole === "buyer" && !cooperativeId;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full p-0 sm:max-w-[560px]">
        <div className="flex h-full flex-col">
          <SheetHeader
            className="border-b border-[var(--border)] px-6 py-5 text-left"
            style={{
              background:
                "linear-gradient(132deg, color-mix(in oklch, var(--foreground) 86%, var(--primary) 14%) 0%, color-mix(in oklch, var(--primary) 78%, var(--foreground) 22%) 42%, color-mix(in oklch, var(--secondary) 48%, var(--primary) 52%) 100%)",
            }}
          >
            <div className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/85">
              <MessageSquareText className="h-3.5 w-3.5" />
              Negotiation Chat
            </div>
            <SheetTitle className="mt-3 text-white">{partnerLabel}</SheetTitle>
            <SheetDescription className="text-white/72">
              {tenderTitle}. Share text, documents, images, audio, or video with the live tender negotiation thread.
            </SheetDescription>
          </SheetHeader>

          {showSelectionPrompt ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center">
              <div className="max-w-sm space-y-3">
                <p className="text-base font-semibold text-[var(--foreground)]">Select a cooperative conversation first.</p>
                <p className="text-sm text-[var(--foreground-muted)]">
                  Open this drawer from a specific bid card so the chat is linked to the right negotiation thread.
                </p>
              </div>
            </div>
          ) : loading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="inline-flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm text-[var(--foreground-muted)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading conversation…
              </div>
            </div>
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto bg-[var(--background)] px-6 py-5">
                {error && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {error}
                  </div>
                )}

                {!payload?.messages.length && !error && (
                  <div className="rounded-[22px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center">
                    <p className="text-sm font-semibold text-[var(--foreground)]">No negotiation messages yet.</p>
                    <p className="mt-2 text-sm text-[var(--foreground-muted)]">
                      Start the thread with a question, revised term, image, video, or supporting document.
                    </p>
                  </div>
                )}

                {payload?.messages.map((message) => (
                  <article
                    key={message.id}
                    className={cn(
                      "max-w-[88%] rounded-[24px] border px-4 py-3 shadow-[var(--shadow-sm)]",
                      message.is_mine
                        ? "ml-auto border-emerald-200 bg-emerald-50 text-emerald-950"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
                    )}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm font-semibold">{message.sender_name}</p>
                      <span className={cn(
                        "text-[11px] font-medium",
                        message.is_mine ? "text-emerald-700/80" : "text-[var(--foreground-subtle)]"
                      )}>
                        {formatDateTime(message.created_at)}
                      </span>
                    </div>
                    {message.body && (
                      <p className={cn(
                        "mt-2 whitespace-pre-wrap text-sm leading-6",
                        message.is_mine ? "text-emerald-900" : "text-[var(--foreground-muted)]"
                      )}>
                        {message.body}
                      </p>
                    )}
                    {message.attachment && <AttachmentPreview attachment={message.attachment} />}
                  </article>
                ))}
              </div>

              <div className="border-t border-[var(--border)] bg-[var(--surface)] px-6 py-5">
                {attachment && (
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm text-[var(--foreground)]">
                    <Paperclip className="h-4 w-4 text-[var(--foreground-subtle)]" />
                    <span className="max-w-[240px] truncate">{attachment.name}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setAttachment(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="rounded-full p-0.5 text-[var(--foreground-subtle)] transition-colors hover:bg-[var(--background-muted)] hover:text-[var(--foreground)]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                <Textarea
                  rows={4}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Write your negotiation message, question, or revised term here."
                  className="min-h-[116px] rounded-[22px] border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--input-text)]"
                />

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-2xl"
                    >
                      <Paperclip className="h-4 w-4" />
                      Attach media
                    </Button>
                    <p className="text-xs text-[var(--foreground-subtle)]">
                      Images, videos, audio, and documents are supported.
                    </p>
                  </div>

                  <Button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={sending || (!body.trim() && !attachment)}
                    className="rounded-2xl"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
                    Send message
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default TenderChatDrawer;
