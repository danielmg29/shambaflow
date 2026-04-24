"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  CircleDot,
  Loader2,
  MessageSquareText,
  Mic,
  Paperclip,
  Search,
  SendHorizonal,
  SmilePlus,
  X,
} from "lucide-react";

import { type UserSnapshot, apiFetch } from "@/lib/api";
import {
  CHAT_OPEN_EVENT,
  buildChatThreadId,
  buildMarketplaceChatWebSocketUrl,
  formatPresenceLabel,
  notifyMarketplaceChatThreadUpdated,
  type ChatOpenDetail,
} from "@/lib/marketplace-chat";
import { formatDateTime, formatRelativeTime } from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

type ViewerRole = "buyer" | "cooperative";

interface ChatAttachment {
  url: string;
  name: string;
  media_type: string | null;
  kind: "image" | "video" | "audio" | "document";
}

interface ChatMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  sender_name: string;
  sender_type: string;
  sender_cooperative_id: string | null;
  sender_avatar_url: string | null;
  recipient_cooperative_id: string | null;
  recipient_cooperative: string | null;
  body: string;
  message_type: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT";
  metadata: Record<string, unknown>;
  attachment: ChatAttachment | null;
  preview_text: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  is_mine: boolean;
}

interface ChatThread {
  id: string;
  tender_id: string;
  tender_title: string;
  tender_status: string;
  tender_status_display: string;
  cooperative_id: string;
  cooperative_name: string;
  buyer_company_name: string;
  viewer_role: ViewerRole;
  partner_user_id: string | null;
  partner_name: string;
  partner_role: "CHAIR" | "BUYER";
  partner_avatar_url: string | null;
  partner_is_online: boolean;
  partner_last_seen_at: string | null;
  messages_count: number;
  unread_messages: number;
  last_message_at: string | null;
  last_message_type: ChatMessage["message_type"] | null;
  last_message_preview: string;
  last_message_sender_name: string | null;
  can_send: boolean;
  href: string;
}

interface ChatConversationPayload {
  conversation: {
    thread_id: string;
    tender_id: string;
    tender_title: string;
    buyer_company_name: string;
    cooperative_id: string;
    cooperative_name: string;
    can_send: boolean;
    message_count: number;
    partner_user_id: string | null;
    partner_name: string;
    partner_avatar_url: string | null;
    partner_is_online: boolean;
    partner_last_seen_at: string | null;
  };
  thread: ChatThread;
  messages: ChatMessage[];
}

interface ChatThreadsPayload {
  viewer_role: ViewerRole;
  summary: {
    threads_count: number;
    unread_messages: number;
    online_threads: number;
  };
  threads: ChatThread[];
}

interface PendingAttachment {
  file: File;
  metadata: Record<string, unknown>;
  source: "upload" | "recorded";
}

const EMOJI_OPTIONS = ["😀", "😄", "🙂", "😉", "😍", "🤝", "🙏", "🌽", "☕", "🚚", "✅", "📦"];
const THREAD_ACTIVITY_TIMEOUT_MS = 8000;
const HEARTBEAT_INTERVAL_MS = 25000;
const RECONNECT_DELAY_MS = 3000;

function getInitials(label: string) {
  const parts = label.split(/\s+/).filter(Boolean);
  if (!parts.length) return "SF";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function computeAttachmentKind(file: File | null) {
  if (!file) return "document" as const;
  if (file.type.startsWith("image/")) return "image" as const;
  if (file.type.startsWith("video/")) return "video" as const;
  if (file.type.startsWith("audio/")) return "audio" as const;
  return "document" as const;
}

function computeOutgoingMessageType(file: File | null): ChatMessage["message_type"] {
  const kind = computeAttachmentKind(file);
  if (kind === "image") return "IMAGE";
  if (kind === "video") return "VIDEO";
  if (kind === "audio") return "AUDIO";
  if (kind === "document") return "DOCUMENT";
  return "TEXT";
}

function upsertThread(threads: ChatThread[], incoming: ChatThread) {
  const next = threads.some((item) => item.id === incoming.id)
    ? threads.map((item) => (item.id === incoming.id ? { ...item, ...incoming } : item))
    : [incoming, ...threads];

  return next.sort((left, right) => {
    const leftTime = left.last_message_at ? new Date(left.last_message_at).getTime() : 0;
    const rightTime = right.last_message_at ? new Date(right.last_message_at).getTime() : 0;
    return rightTime - leftTime;
  });
}

function appendUniqueMessage(messages: ChatMessage[], incoming: ChatMessage) {
  if (messages.some((item) => item.id === incoming.id)) return messages;
  return [...messages, incoming].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  );
}

function AttachmentPreview({ attachment }: { attachment: ChatAttachment }) {
  if (attachment.kind === "image") {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
        className="mt-3 block overflow-hidden rounded-2xl border border-[var(--border)] bg-black/5"
      >
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

function PartnerAvatar({ label, src, isOnline }: { label: string; src: string | null; isOnline?: boolean }) {
  return (
    <div className="relative h-10 w-10 shrink-0">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label} className="h-10 w-10 rounded-full object-cover" />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary)] text-xs font-semibold text-white">
          {getInitials(label)}
        </div>
      )}
      {typeof isOnline === "boolean" && (
        <span
          className={cn(
            "absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[var(--surface)]",
            isOnline ? "bg-emerald-500" : "bg-slate-300"
          )}
        />
      )}
    </div>
  );
}

export function MarketplaceChatLauncher({
  variant,
  cooperativeId,
  user,
}: {
  variant: "crm" | "marketplace";
  cooperativeId?: string;
  user: UserSnapshot | null;
}) {
  const supported = Boolean(user && (user.user_type === "BUYER" || user.user_type === "CHAIR"));
  const viewerRole: ViewerRole | null = user?.user_type === "BUYER"
    ? "buyer"
    : user?.user_type === "CHAIR"
      ? "cooperative"
      : null;
  const shellLabel = variant === "marketplace" ? "buyer" : "cooperative";

  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messagesByThread, setMessagesByThread] = useState<Record<string, ChatMessage[]>>({});
  const [conversationByThread, setConversationByThread] = useState<Record<string, ChatConversationPayload["conversation"]>>({});
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [search, setSearch] = useState("");
  const [body, setBody] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [sending, setSending] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [recording, setRecording] = useState(false);
  const [mobileConversationVisible, setMobileConversationVisible] = useState(false);
  const [partnerActivityByThread, setPartnerActivityByThread] = useState<Record<string, string | null>>({});

  const loadConversation = useCallback(async (thread: ChatThread, silent = false) => {
    if (!thread) return;
    if (!silent) setConversationLoading(true);
    setConversationError(null);

    const params = viewerRole === "buyer"
      ? `?cooperative_id=${encodeURIComponent(thread.cooperative_id)}`
      : "";

    try {
      const response = await apiFetch<ChatConversationPayload>(
        `/api/marketplace/tenders/${thread.tender_id}/messages/${params}`
      );
      setConversationByThread((current) => ({
        ...current,
        [thread.id]: response.conversation,
      }));
      setMessagesByThread((current) => ({
        ...current,
        [thread.id]: response.messages ?? [],
      }));
      setThreads((current) => upsertThread(current, response.thread));
      notifyMarketplaceChatThreadUpdated({
        tenderId: response.thread.tender_id,
        cooperativeId: response.thread.cooperative_id,
      });
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : "Failed to load the conversation.");
    } finally {
      if (!silent) setConversationLoading(false);
    }
  }, [viewerRole]);

  const pendingOpenThreadRef = useRef<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const activityTimeoutsRef = useRef<Record<string, number>>({});
  const typingTimeoutRef = useRef<number | null>(null);
  const activeThreadRef = useRef<ChatThread | null>(null);
  const selectedThreadIdRef = useRef<string | null>(null);
  const drawerOpenRef = useRef(false);
  const loadConversationRef = useRef(loadConversation);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);

  const unreadCount = useMemo(
    () => threads.reduce((count, item) => count + item.unread_messages, 0),
    [threads]
  );
  const activeThread = useMemo(
    () => threads.find((item) => item.id === selectedThreadId) ?? null,
    [selectedThreadId, threads]
  );
  const activeMessages = useMemo(
    () => (selectedThreadId ? messagesByThread[selectedThreadId] ?? [] : []),
    [messagesByThread, selectedThreadId]
  );
  const partnerActivity = selectedThreadId ? partnerActivityByThread[selectedThreadId] : null;
  const visibleThreads = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return threads;
    return threads.filter((item) => (
      item.partner_name.toLowerCase().includes(term)
      || item.tender_title.toLowerCase().includes(term)
      || item.cooperative_name.toLowerCase().includes(term)
      || item.buyer_company_name.toLowerCase().includes(term)
    ));
  }, [search, threads]);

  const sendSocketEvent = useCallback((event: string, payload: Record<string, unknown> = {}) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ event, ...payload }));
  }, []);

  const refreshThreads = useCallback(async (silent = false) => {
    if (!supported) return;
    if (!silent) setThreadsLoading(true);
    setThreadsError(null);
    try {
      const response = await apiFetch<ChatThreadsPayload>("/api/marketplace/chat/threads/");
      setThreads(response.threads ?? []);
      if (!selectedThreadId && response.threads?.length) {
        const nextThread = pendingOpenThreadRef.current
          ? response.threads.find((item) => item.id === pendingOpenThreadRef.current) ?? response.threads[0]
          : response.threads[0];
        setSelectedThreadId(nextThread.id);
      }
      if (pendingOpenThreadRef.current) {
        const pending = response.threads.find((item) => item.id === pendingOpenThreadRef.current);
        if (pending) {
          setSelectedThreadId(pending.id);
          setMobileConversationVisible(true);
          pendingOpenThreadRef.current = null;
        }
      }
    } catch (error) {
      setThreadsError(error instanceof Error ? error.message : "Failed to load chat threads.");
    } finally {
      if (!silent) setThreadsLoading(false);
    }
  }, [selectedThreadId, supported]);

  const handleSelectThread = useCallback((thread: ChatThread) => {
    setOpen(true);
    setSelectedThreadId(thread.id);
    setMobileConversationVisible(true);
    setComposerError(null);
    setBody("");
    setPendingAttachment(null);
    setShowEmojiPicker(false);
  }, []);

  const emitIdleActivity = useCallback(() => {
    if (!activeThread) return;
    sendSocketEvent("chat.activity", {
      tender_id: activeThread.tender_id,
      cooperative_id: activeThread.cooperative_id,
      state: "idle",
    });
  }, [activeThread, sendSocketEvent]);

  useEffect(() => {
    activeThreadRef.current = activeThread;
    selectedThreadIdRef.current = selectedThreadId;
    drawerOpenRef.current = open;
    loadConversationRef.current = loadConversation;
  }, [activeThread, loadConversation, open, selectedThreadId]);

  const handleSend = useCallback(async () => {
    if (!activeThread) return;
    if (!body.trim() && !pendingAttachment?.file) return;

    setSending(true);
    setComposerError(null);
    emitIdleActivity();

    const formData = new FormData();
    if (body.trim()) formData.append("body", body.trim());
    if (pendingAttachment?.file) {
      formData.append("attachment", pendingAttachment.file);
      formData.append("message_type", computeOutgoingMessageType(pendingAttachment.file));
      if (Object.keys(pendingAttachment.metadata).length > 0) {
        formData.append("metadata", JSON.stringify(pendingAttachment.metadata));
      }
    }
    if (viewerRole === "buyer") {
      formData.append("cooperative_id", activeThread.cooperative_id);
    }

    try {
      const response = await apiFetch<{ item: ChatMessage; thread: ChatThread }>(
        `/api/marketplace/tenders/${activeThread.tender_id}/messages/`,
        { method: "POST", body: formData }
      );
      setMessagesByThread((current) => ({
        ...current,
        [activeThread.id]: appendUniqueMessage(current[activeThread.id] ?? [], response.item),
      }));
      setThreads((current) => upsertThread(current, response.thread));
      setBody("");
      setPendingAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      notifyMarketplaceChatThreadUpdated({
        tenderId: activeThread.tender_id,
        cooperativeId: activeThread.cooperative_id,
      });
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Failed to send the message.");
    } finally {
      setSending(false);
    }
  }, [activeThread, body, emitIdleActivity, pendingAttachment, viewerRole]);

  const handleChooseFile = useCallback((file: File | null) => {
    if (!file) {
      setPendingAttachment(null);
      return;
    }
    setPendingAttachment({
      file,
      metadata: {},
      source: "upload",
    });
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (recording) return;
    if (typeof window === "undefined" || !window.navigator?.mediaDevices?.getUserMedia) {
      setComposerError("Voice recording is not supported in this browser.");
      return;
    }

    try {
      const stream = await window.navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];
      recordingStartedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const extension = blob.type.includes("ogg") ? "ogg" : "webm";
        const durationSeconds = recordingStartedAtRef.current
          ? Math.max(Math.round((Date.now() - recordingStartedAtRef.current) / 1000), 1)
          : 1;
        const file = new File([blob], `voice-note-${Date.now()}.${extension}`, { type: blob.type || "audio/webm" });
        setPendingAttachment({
          file,
          metadata: {
            source: "recorded",
            duration_seconds: durationSeconds,
          },
          source: "recorded",
        });
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        recordedChunksRef.current = [];
        recordingStartedAtRef.current = null;
        setRecording(false);
        emitIdleActivity();
      };
      recorder.start();
      setRecording(true);
      setComposerError(null);
      if (activeThread) {
        sendSocketEvent("chat.activity", {
          tender_id: activeThread.tender_id,
          cooperative_id: activeThread.cooperative_id,
          state: "recording",
        });
      }
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Microphone access was not granted.");
    }
  }, [activeThread, emitIdleActivity, recording, sendSocketEvent]);

  const handleStopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
  }, []);

  useEffect(() => {
    if (!supported) return;
    void refreshThreads();
  }, [refreshThreads, supported]);

  useEffect(() => {
    if (!supported) return;
    const intervalId = window.setInterval(() => {
      void refreshThreads(true);
    }, 45000);
    return () => window.clearInterval(intervalId);
  }, [refreshThreads, supported]);

  useEffect(() => {
    if (!supported) return;

    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const url = buildMarketplaceChatWebSocketUrl();
      if (!url) return;

      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        setSocketConnected(true);
        sendSocketEvent("chat.heartbeat");
        if (heartbeatIntervalRef.current) {
          window.clearInterval(heartbeatIntervalRef.current);
        }
        heartbeatIntervalRef.current = window.setInterval(() => {
          sendSocketEvent("chat.heartbeat");
        }, HEARTBEAT_INTERVAL_MS);
        if (activeThreadRef.current) {
          sendSocketEvent("chat.thread.open", {
            tender_id: activeThreadRef.current.tender_id,
            cooperative_id: activeThreadRef.current.cooperative_id,
          });
        }
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as Record<string, unknown>;
          const eventName = String(payload.event ?? "");
          if (eventName === "chat.message.created") {
            const incomingThread = payload.thread as ChatThread;
            const incomingMessage = payload.message as ChatMessage;
            setThreads((current) => upsertThread(current, incomingThread));
            setMessagesByThread((current) => ({
              ...current,
              [incomingThread.id]: appendUniqueMessage(current[incomingThread.id] ?? [], incomingMessage),
            }));
            notifyMarketplaceChatThreadUpdated({
              tenderId: incomingThread.tender_id,
              cooperativeId: incomingThread.cooperative_id,
            });
            if (drawerOpenRef.current && selectedThreadIdRef.current === incomingThread.id && !incomingMessage.is_mine) {
              void loadConversationRef.current(incomingThread, true);
            }
            return;
          }

          if (eventName === "chat.thread.read") {
            const updatedThread = payload.thread as ChatThread;
            setThreads((current) => upsertThread(current, updatedThread));
            notifyMarketplaceChatThreadUpdated({
              tenderId: updatedThread.tender_id,
              cooperativeId: updatedThread.cooperative_id,
            });
            return;
          }

          if (eventName === "chat.presence.changed") {
            const presence = payload.presence as { user_id?: string; is_online?: boolean; last_seen_at?: string | null };
            if (!presence?.user_id) return;
            setThreads((current) => current.map((thread) => (
              thread.partner_user_id === presence.user_id
                ? {
                    ...thread,
                    partner_is_online: Boolean(presence.is_online),
                    partner_last_seen_at: presence.last_seen_at ?? null,
                  }
                : thread
            )));
            return;
          }

          if (eventName === "chat.activity.changed") {
            const threadId = String(payload.thread_id ?? "");
            const activity = payload.activity as { state?: string; expires_in_seconds?: number } | undefined;
            if (!threadId || !activity?.state) return;
            if (activityTimeoutsRef.current[threadId]) {
              window.clearTimeout(activityTimeoutsRef.current[threadId]);
            }
            if (activity.state === "idle") {
              setPartnerActivityByThread((current) => ({ ...current, [threadId]: null }));
              return;
            }
            setPartnerActivityByThread((current) => ({ ...current, [threadId]: activity.state ?? null }));
            activityTimeoutsRef.current[threadId] = window.setTimeout(() => {
              setPartnerActivityByThread((current) => ({ ...current, [threadId]: null }));
            }, (activity.expires_in_seconds ?? THREAD_ACTIVITY_TIMEOUT_MS / 1000) * 1000);
          }
        } catch {
          // Ignore malformed websocket payloads and keep the chat alive.
        }
      };

      socket.onclose = () => {
        setSocketConnected(false);
        if (heartbeatIntervalRef.current) {
          window.clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        if (!disposed) {
          reconnectTimeoutRef.current = window.setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (heartbeatIntervalRef.current) window.clearInterval(heartbeatIntervalRef.current);
      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);
      Object.values(activityTimeoutsRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId));
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      socketRef.current?.close();
    };
  }, [sendSocketEvent, supported]);

  useEffect(() => {
    if (!open || !activeThread) return;
    sendSocketEvent("chat.thread.open", {
      tender_id: activeThread.tender_id,
      cooperative_id: activeThread.cooperative_id,
    });
    void loadConversation(activeThread);
  }, [activeThread, loadConversation, open, sendSocketEvent]);

  useEffect(() => {
    if (!open) {
      setMobileConversationVisible(false);
      emitIdleActivity();
      sendSocketEvent("chat.thread.close");
    }
  }, [emitIdleActivity, open, sendSocketEvent]);

  useEffect(() => {
    if (!activeThread || !open) return;
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    if (recording) return;

    if (body.trim()) {
      sendSocketEvent("chat.activity", {
        tender_id: activeThread.tender_id,
        cooperative_id: activeThread.cooperative_id,
        state: "typing",
      });
      typingTimeoutRef.current = window.setTimeout(() => {
        emitIdleActivity();
      }, 1800);
      return;
    }

    emitIdleActivity();
  }, [activeThread, body, emitIdleActivity, open, recording, sendSocketEvent]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activeMessages.length, open, selectedThreadId]);

  useEffect(() => {
    if (!supported) return;

    const handleOpenThread = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<ChatOpenDetail>;
      const detail = event.detail;
      if (!detail?.tenderId) return;

      const resolvedCooperativeId = detail.cooperativeId ?? cooperativeId ?? user?.cooperative_id ?? null;
      if (!resolvedCooperativeId) return;

      const threadId = buildChatThreadId(detail.tenderId, resolvedCooperativeId);
      pendingOpenThreadRef.current = threadId;
      setOpen(true);

      const thread = threads.find((item) => item.id === threadId);
      if (thread) {
        handleSelectThread(thread);
      } else {
        void refreshThreads(true);
      }
    };

    window.addEventListener(CHAT_OPEN_EVENT, handleOpenThread as EventListener);
    return () => {
      window.removeEventListener(CHAT_OPEN_EVENT, handleOpenThread as EventListener);
    };
  }, [cooperativeId, handleSelectThread, refreshThreads, supported, threads, user?.cooperative_id]);

  if (!supported || !viewerRole) {
    return null;
  }

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-[var(--foreground-muted)] transition-colors hover:bg-[var(--background-muted)] hover:text-[var(--foreground)]"
          aria-label={`Chat${unreadCount > 0 ? ` — ${unreadCount} unread` : ""}${socketConnected ? " — online" : " — offline"}`}
        >
          <MessageSquareText className="h-4.5 w-4.5" />
          <span
            className={cn(
              "absolute bottom-0.5 left-0.5 h-2.5 w-2.5 rounded-full border border-[var(--surface)]",
              socketConnected ? "bg-emerald-500" : "bg-slate-300"
            )}
          />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-[1080px]">
          <div className="flex h-full min-h-0 flex-col">
            <SheetHeader
              className="border-b border-[var(--border)] px-6 py-5 text-left"
              style={{
                background:
                  "linear-gradient(132deg, color-mix(in oklch, var(--foreground) 86%, var(--primary) 14%) 0%, color-mix(in oklch, var(--primary) 78%, var(--foreground) 22%) 42%, color-mix(in oklch, var(--secondary) 48%, var(--primary) 52%) 100%)",
              }}
            >
              <div className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/85">
                <CircleDot className="h-3.5 w-3.5" />
                Tender Negotiations
              </div>
              <SheetTitle className="mt-3 text-white">Buyer and chair negotiation inbox</SheetTitle>
              <SheetDescription className="text-white/72">
                Live tender conversations for the {shellLabel} workspace with unread counts, presence, typing signals, emoji, and voice notes.
              </SheetDescription>
            </SheetHeader>

            <div className="grid min-h-0 flex-1 md:grid-cols-[340px_minmax(0,1fr)]">
              <aside className={cn(
                "border-r border-[var(--border)] bg-[var(--surface)]",
                mobileConversationVisible ? "hidden md:flex" : "flex",
                "min-h-0 flex-col"
              )}>
                <div className="border-b border-[var(--border)] px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--foreground)]">Inbox</p>
                      <p className="text-xs text-[var(--foreground-subtle)]">
                        {socketConnected ? "Live chat connected" : "Live chat reconnecting"} · {unreadCount} unread
                      </p>
                    </div>
                    <span className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                      socketConnected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                    )}>
                      {socketConnected ? "Online" : "Offline"}
                    </span>
                  </div>
                  <div className="relative mt-4">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--foreground-subtle)]" />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search buyer, chair, or tender"
                      className="h-11 w-full rounded-2xl border border-[var(--input-border)] bg-[var(--input-bg)] pl-10 pr-4 text-sm text-[var(--input-text)] focus:border-[var(--input-border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]"
                    />
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                  {threadsLoading && !threads.length ? (
                    <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-4 text-sm text-[var(--foreground-muted)]">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading conversations…
                    </div>
                  ) : threadsError ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                      {threadsError}
                    </div>
                  ) : visibleThreads.length ? visibleThreads.map((thread) => (
                    <button
                      key={thread.id}
                      type="button"
                      onClick={() => handleSelectThread(thread)}
                      className={cn(
                        "mb-2 flex w-full items-start gap-3 rounded-[22px] border px-4 py-4 text-left transition-colors",
                        selectedThreadId === thread.id
                          ? "border-emerald-300 bg-emerald-50"
                          : "border-[var(--border)] bg-[var(--background)] hover:border-[var(--border-strong)]"
                      )}
                    >
                      <PartnerAvatar
                        label={thread.partner_name}
                        src={thread.partner_avatar_url}
                        isOnline={thread.partner_is_online}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                              {thread.partner_name}
                            </p>
                            <p className="truncate text-xs text-[var(--foreground-subtle)]">
                              {thread.tender_title}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[11px] font-medium text-[var(--foreground-subtle)]">
                              {thread.last_message_at ? formatRelativeTime(thread.last_message_at) : "New"}
                            </p>
                            {thread.unread_messages > 0 && (
                              <span className="mt-1 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                {thread.unread_messages}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm text-[var(--foreground-muted)]">
                          {thread.last_message_preview}
                        </p>
                        <p className="mt-2 text-[11px] font-medium text-[var(--foreground-subtle)]">
                          {formatPresenceLabel(thread.partner_is_online, thread.partner_last_seen_at)}
                        </p>
                      </div>
                    </button>
                  )) : (
                    <div className="rounded-[24px] border border-dashed border-[var(--border)] bg-[var(--background)] px-5 py-10 text-center">
                      <p className="text-sm font-semibold text-[var(--foreground)]">No live negotiation threads yet.</p>
                      <p className="mt-2 text-sm text-[var(--foreground-muted)]">
                        Tender conversations will appear here once a buyer and cooperative chair enter negotiation.
                      </p>
                    </div>
                  )}
                </div>
              </aside>

              <section className={cn(
                "min-h-0 flex-col bg-[var(--background)]",
                mobileConversationVisible ? "flex" : "hidden md:flex"
              )}>
                {!activeThread ? (
                  <div className="flex flex-1 items-center justify-center px-8 text-center">
                    <div className="max-w-md space-y-3">
                      <p className="text-lg font-semibold text-[var(--foreground)]">Select a negotiation thread.</p>
                      <p className="text-sm text-[var(--foreground-muted)]">
                        Open a buyer or chair conversation from the left list, or launch one directly from a tender workspace.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4">
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => setMobileConversationVisible(false)}
                          className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] text-[var(--foreground-muted)] transition-colors hover:bg-[var(--background-muted)] hover:text-[var(--foreground)] md:hidden"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <PartnerAvatar
                          label={activeThread.partner_name}
                          src={activeThread.partner_avatar_url}
                          isOnline={activeThread.partner_is_online}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-base font-semibold text-[var(--foreground)]">
                                {activeThread.partner_name}
                              </p>
                              <p className="truncate text-sm text-[var(--foreground-muted)]">
                                {activeThread.tender_title}
                              </p>
                            </div>
                            <Link
                              href={activeThread.href}
                              className="text-xs font-semibold text-[var(--primary)] transition-colors hover:text-[var(--primary-hover)]"
                            >
                              Open tender page
                            </Link>
                          </div>
                          <p className="mt-1 text-xs text-[var(--foreground-subtle)]">
                            {partnerActivity
                              ? partnerActivity === "recording"
                                ? `${activeThread.partner_name} is recording a voice message...`
                                : `${activeThread.partner_name} is typing...`
                              : formatPresenceLabel(activeThread.partner_is_online, activeThread.partner_last_seen_at)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
                      {conversationLoading && !activeMessages.length ? (
                        <div className="flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm text-[var(--foreground-muted)]">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading conversation…
                        </div>
                      ) : null}

                      {conversationError && (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {conversationError}
                        </div>
                      )}

                      {!activeMessages.length && !conversationLoading && !conversationError ? (
                        <div className="rounded-[22px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center">
                          <p className="text-sm font-semibold text-[var(--foreground)]">No negotiation messages yet.</p>
                          <p className="mt-2 text-sm text-[var(--foreground-muted)]">
                            Start with a question, revised term, emoji, image, video, document, or voice note.
                          </p>
                        </div>
                      ) : null}

                      {activeMessages.map((message) => (
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
                            <span
                              className={cn(
                                "text-[11px] font-medium",
                                message.is_mine ? "text-emerald-700/80" : "text-[var(--foreground-subtle)]"
                              )}
                            >
                              {formatDateTime(message.created_at)}
                            </span>
                          </div>
                          {message.body ? (
                            <p
                              className={cn(
                                "mt-2 whitespace-pre-wrap text-sm leading-6",
                                message.is_mine ? "text-emerald-900" : "text-[var(--foreground-muted)]"
                              )}
                            >
                              {message.body}
                            </p>
                          ) : null}
                          {message.attachment ? <AttachmentPreview attachment={message.attachment} /> : null}
                        </article>
                      ))}
                    </div>

                    <div className="border-t border-[var(--border)] bg-[var(--surface)] px-5 py-5">
                      {composerError && (
                        <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {composerError}
                        </div>
                      )}

                      {pendingAttachment ? (
                        <div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm text-[var(--foreground)]">
                          {pendingAttachment.source === "recorded" ? <Mic className="h-4 w-4 text-emerald-600" /> : <Paperclip className="h-4 w-4 text-[var(--foreground-subtle)]" />}
                          <span className="max-w-[280px] truncate">{pendingAttachment.file.name}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingAttachment(null);
                              if (fileInputRef.current) fileInputRef.current.value = "";
                            }}
                            className="rounded-full p-0.5 text-[var(--foreground-subtle)] transition-colors hover:bg-[var(--background-muted)] hover:text-[var(--foreground)]"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : null}

                      <div className="relative">
                        <Textarea
                          rows={4}
                          value={body}
                          onChange={(event) => setBody(event.target.value)}
                          placeholder="Write your negotiation message or add an emoji before sending."
                          className="min-h-[116px] rounded-[22px] border-[var(--input-border)] bg-[var(--input-bg)] pr-12 text-[var(--input-text)]"
                          disabled={!activeThread.can_send || recording}
                        />
                        <button
                          type="button"
                          onClick={() => setShowEmojiPicker((current) => !current)}
                          className="absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)]"
                          disabled={!activeThread.can_send}
                        >
                          <SmilePlus className="h-4 w-4" />
                        </button>
                        {showEmojiPicker && (
                          <div className="absolute bottom-14 right-0 grid w-[220px] grid-cols-4 gap-2 rounded-[22px] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-xl)]">
                            {EMOJI_OPTIONS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => {
                                  setBody((current) => `${current}${emoji}`);
                                  setShowEmojiPicker(false);
                                }}
                                className="rounded-2xl px-2 py-2 text-xl transition-colors hover:bg-[var(--background-muted)]"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            ref={fileInputRef}
                            type="file"
                            className="hidden"
                            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                            onChange={(event) => handleChooseFile(event.target.files?.[0] ?? null)}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => fileInputRef.current?.click()}
                            className="rounded-2xl"
                            disabled={!activeThread.can_send || recording}
                          >
                            <Paperclip className="h-4 w-4" />
                            Attach media
                          </Button>
                          <Button
                            type="button"
                            variant={recording ? "default" : "outline"}
                            onClick={() => {
                              if (recording) {
                                handleStopRecording();
                              } else {
                                void handleStartRecording();
                              }
                            }}
                            className="rounded-2xl"
                            disabled={!activeThread.can_send}
                          >
                            <Mic className="h-4 w-4" />
                            {recording ? "Stop recording" : "Voice note"}
                          </Button>
                          <div className="text-xs text-[var(--foreground-subtle)]">
                            Images, video, documents, and recorded voice notes are supported.
                          </div>
                        </div>

                        <Button
                          type="button"
                          onClick={() => void handleSend()}
                          disabled={sending || !activeThread.can_send || (!body.trim() && !pendingAttachment?.file)}
                          className="rounded-2xl"
                        >
                          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
                          Send message
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </section>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default MarketplaceChatLauncher;
