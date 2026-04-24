"use client";

import { getAccessToken } from "@/lib/api";

export const CHAT_OPEN_EVENT = "sf:chat-open-thread";
export const CHAT_THREAD_UPDATED_EVENT = "sf:chat-thread-updated";

export interface ChatOpenDetail {
  tenderId: string;
  cooperativeId?: string | null;
}

export interface ChatThreadUpdatedDetail {
  tenderId: string;
  cooperativeId: string;
}

export function buildChatThreadId(tenderId: string, cooperativeId: string) {
  return `${tenderId}:${cooperativeId}`;
}

export function openMarketplaceChat(detail: ChatOpenDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT, { detail }));
}

export function notifyMarketplaceChatThreadUpdated(detail: ChatThreadUpdatedDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHAT_THREAD_UPDATED_EVENT, { detail }));
}

export function buildMarketplaceChatWebSocketUrl() {
  const token = getAccessToken();
  if (!token) return null;

  const rawBase = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";
  const base = rawBase.startsWith("http")
    ? rawBase.replace(/^http/i, "ws")
    : rawBase;
  const url = new URL("/ws/marketplace/chat/", base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("token", token);
  return url.toString();
}

export function formatPresenceLabel(partnerIsOnline: boolean, lastSeenAt: string | null) {
  if (partnerIsOnline) return "Online";
  if (!lastSeenAt) return "Offline";

  const timestamp = new Date(lastSeenAt);
  if (Number.isNaN(timestamp.getTime())) return "Offline";

  const diffMs = Date.now() - timestamp.getTime();
  const diffSeconds = Math.max(Math.round(diffMs / 1000), 0);
  if (diffSeconds < 60) return "Seen just now";
  if (diffSeconds < 3600) return `Seen ${Math.round(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `Seen ${Math.round(diffSeconds / 3600)}h ago`;
  return `Seen ${Math.round(diffSeconds / 86400)}d ago`;
}
