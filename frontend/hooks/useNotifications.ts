"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/api";

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  category: string;
  event_type: string;
  priority: string;
  action_url: string;
  delivery_channels: string[];
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  updated_at: string;
  cooperative_id: string | null;
  data: Record<string, unknown>;
}

interface NotificationListResponse {
  items: NotificationItem[];
  total: number;
  unread_count: number;
}

interface NotificationUpdateResponse {
  notification: NotificationItem;
  unread_count: number;
}

interface NotificationMarkAllResponse {
  unread_count: number;
}

export function useNotifications(limit = 8) {
  const isMountedRef = useRef(true);

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const data = await apiFetch<NotificationListResponse>(`/api/notifications/?limit=${limit}`);
      if (!isMountedRef.current) return;
      setItems(data.items ?? []);
      setUnreadCount(data.unread_count ?? 0);
    } catch {
      if (!isMountedRef.current) return;
      if (!silent) {
        setItems([]);
        setUnreadCount(0);
      }
    } finally {
      if (!isMountedRef.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [limit]);

  useEffect(() => {
    isMountedRef.current = true;
    void load();

    const intervalId = window.setInterval(() => {
      void load(true);
    }, 30000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void load(true);
      }
    };

    window.addEventListener("focus", handleVisibility);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      isMountedRef.current = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisibility);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [load]);

  const markRead = useCallback(async (notificationId: string, isRead = true) => {
    setItems((prev) => prev.map((item) => (
      item.id === notificationId
        ? { ...item, is_read: isRead, read_at: isRead ? new Date().toISOString() : null }
        : item
    )));

    try {
      const data = await apiFetch<NotificationUpdateResponse>(`/api/notifications/${notificationId}/`, {
        method: "PATCH",
        body: { is_read: isRead },
      });
      if (!isMountedRef.current) return;
      setItems((prev) => prev.map((item) => (
        item.id === notificationId ? data.notification : item
      )));
      setUnreadCount(data.unread_count ?? 0);
    } catch (error) {
      if (isMountedRef.current) {
        void load(true);
      }
      throw error;
    }
  }, [load]);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((item) => (
      item.is_read ? item : { ...item, is_read: true, read_at: new Date().toISOString() }
    )));
    setUnreadCount(0);

    try {
      const data = await apiFetch<NotificationMarkAllResponse>("/api/notifications/read-all/", {
        method: "POST",
        body: {},
      });
      if (!isMountedRef.current) return;
      setUnreadCount(data.unread_count ?? 0);
    } catch (error) {
      if (isMountedRef.current) {
        void load(true);
      }
      throw error;
    }
  }, [load]);

  return {
    items,
    unreadCount,
    loading,
    refreshing,
    refresh: () => load(true),
    markRead,
    markAllRead,
  };
}
