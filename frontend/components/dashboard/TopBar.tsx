"use client";

/**
 * TopBar — Dashboard top navigation bar
 *
 * Used in both CRM and Marketplace layouts.
 * Contains: hamburger (mobile), page title, search (optional),
 * notifications bell, ThemeToggle, user avatar + dropdown.
 *
 * Responsive: collapses gracefully on mobile.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Menu, Bell, LogOut, User, Settings, ChevronDown,
  Sprout, Building2,
} from "lucide-react";
import MarketplaceChatLauncher from "@/components/marketplace/MarketplaceChatLauncher";
import { ThemeToggle } from "@/components/providers/ThemeToggle";
import {
  USER_UPDATED_EVENT,
  authApi,
  clearTokens,
  getUser,
  getRefreshToken,
  type UserSnapshot,
} from "@/lib/api";
import { type NotificationItem, useNotifications } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";

interface TopBarProps {
  onMenuClick: () => void;
  title?: string;
  variant?: "crm" | "marketplace";
  cooperativeId?: string;
}

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Just now";

  const diffMs = date.getTime() - Date.now();
  const absSeconds = Math.round(Math.abs(diffMs) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absSeconds < 60) return rtf.format(Math.round(diffMs / 1000), "second");
  if (absSeconds < 3600) return rtf.format(Math.round(diffMs / (1000 * 60)), "minute");
  if (absSeconds < 86400) return rtf.format(Math.round(diffMs / (1000 * 60 * 60)), "hour");
  return rtf.format(Math.round(diffMs / (1000 * 60 * 60 * 24)), "day");
}

function notificationAccent(notification: NotificationItem): string {
  if (notification.priority === "CRITICAL" || notification.priority === "HIGH") {
    return "bg-amber-500";
  }
  if (notification.category === "VERIFICATION") {
    return "bg-emerald-500";
  }
  return "bg-[var(--primary)]";
}

function getUserInitials(user: UserSnapshot | null): string {
  const firstName = user?.first_name?.trim() ?? "";
  const lastName = user?.last_name?.trim() ?? "";
  if (firstName || lastName) {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "U";
  }

  const fullName = user?.full_name?.trim() ?? "";
  if (fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    const first = parts[0]?.charAt(0) ?? "";
    const second = parts[1]?.charAt(0) ?? parts[0]?.charAt(1) ?? "";
    return `${first}${second}`.toUpperCase() || "U";
  }

  return user?.email?.charAt(0).toUpperCase() ?? "U";
}

function Avatar({
  src,
  initials,
  className,
  textClassName,
}: {
  src?: string | null;
  initials: string;
  className: string;
  textClassName?: string;
}) {
  if (src) {
    return (
      <div className={cn("overflow-hidden", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Profile" className="h-full w-full object-cover" />
      </div>
    );
  }

  return (
    <div className={cn("bg-[var(--primary)] text-white flex items-center justify-center", className, textClassName)}>
      {initials}
    </div>
  );
}

export function TopBar({ onMenuClick, title, variant = "crm", cooperativeId }: TopBarProps) {
  const router = useRouter();
  const [user, setUser] = useState<UserSnapshot | null>(null);

  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen]  = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const {
    items: notifs,
    unreadCount,
    loading: notificationsLoading,
    refreshing: notificationsRefreshing,
    refresh: refreshNotifications,
    markRead,
    markAllRead,
  } = useNotifications(8);

  const notifRef = useRef<HTMLDivElement>(null);
  const userRef  = useRef<HTMLDivElement>(null);

  // Initialize user data only on client side
  useEffect(() => {
    const syncUser = () => setUser(getUser());
    syncUser();

    window.addEventListener(USER_UPDATED_EVENT, syncUser);
    window.addEventListener("storage", syncUser);

    return () => {
      window.removeEventListener(USER_UPDATED_EVENT, syncUser);
      window.removeEventListener("storage", syncUser);
    };
  }, []);

  useEffect(() => {
    if (notifOpen) {
      void refreshNotifications();
    }
  }, [notifOpen, refreshNotifications]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setUserOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      const refresh = getRefreshToken();
      if (refresh) await authApi.logout(refresh);
    } catch {
      // Ignore errors — clear tokens regardless
    } finally {
      clearTokens();
      router.push("/login");
    }
  };

  const initials = getUserInitials(user);
  const displayName = user?.full_name
    || [user?.first_name, user?.last_name].filter(Boolean).join(" ")
    || user?.email
    || "User";
  const userType    = user?.user_type ?? "CHAIR";
  const avatarUrl   = user?.avatar_url ?? null;

  const profileHref = variant === "crm"
    ? `/crm/${cooperativeId}/profile`
    : "/marketplace/profile";
  const settingsHref = variant === "crm"
    ? `/crm/${cooperativeId}/settings`
    : "/marketplace/settings";
  const notificationSettingsHref = variant === "crm"
    ? `/crm/${cooperativeId}/settings`
    : "/marketplace/settings";

  const handleNotificationClick = async (notification: NotificationItem) => {
    if (!notification.is_read) {
      try {
        await markRead(notification.id, true);
      } catch {
        // Keep navigation working even if the read-state request fails.
      }
    }

    setNotifOpen(false);

    if (notification.action_url) {
      router.push(notification.action_url);
    }
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex items-center h-16 px-4 sm:px-6",
        "bg-[var(--surface)] border-b border-[var(--border)]",
        "shadow-[0_1px_0_0_var(--border)]"
      )}
    >
      {/* Left: hamburger + title */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Mobile hamburger */}
        <button
          onClick={onMenuClick}
          className="lg:hidden flex items-center justify-center w-9 h-9 rounded-lg
                     text-[var(--foreground-muted)] hover:text-[var(--foreground)]
                     hover:bg-[var(--background-muted)] transition-colors"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Page title */}
        {title && (
          <h1 className="text-base font-semibold text-[var(--foreground)] truncate hidden sm:block">
            {title}
          </h1>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Theme toggle — always visible */}
        <ThemeToggle size="md" />

        <MarketplaceChatLauncher
          variant={variant}
          cooperativeId={cooperativeId}
          user={user}
        />

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => { setNotifOpen(!notifOpen); setUserOpen(false); }}
            className="relative flex items-center justify-center w-9 h-9 rounded-lg
                       text-[var(--foreground-muted)] hover:text-[var(--foreground)]
                       hover:bg-[var(--background-muted)] transition-colors"
            aria-label={`Notifications${unreadCount > 0 ? ` — ${unreadCount} unread` : ""}`}
          >
            <Bell className="w-4.5 h-4.5" />
            {unreadCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full
                           bg-[var(--primary)] text-white text-[10px] font-bold
                           flex items-center justify-center"
              >
                {unreadCount}
              </span>
            )}
          </button>

          {/* Notifications dropdown */}
          {notifOpen && (
            <div
              className="absolute right-0 top-11 w-80 sm:w-96 rounded-xl
                         bg-[var(--surface)] border border-[var(--border)]
                         shadow-[var(--shadow-xl)] overflow-hidden z-50"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                <span className="text-sm font-semibold text-[var(--foreground)]">
                  Notifications
                  {unreadCount > 0 && (
                    <span className="ml-2 px-1.5 py-0.5 text-xs bg-[var(--primary)] text-white rounded-full">
                      {unreadCount}
                    </span>
                  )}
                </span>
                {unreadCount > 0 && (
                  <button
                    onClick={() => { void markAllRead(); }}
                    className="text-xs text-[var(--primary)] hover:text-[var(--primary-hover)] transition-colors"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-[var(--border)]">
                {notificationsLoading && notifs.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-[var(--foreground-muted)]">
                    Loading notifications…
                  </div>
                ) : notifs.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-[var(--foreground-muted)]">
                    No notifications yet.
                  </div>
                ) : notifs.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => { void handleNotificationClick(n); }}
                    className={cn(
                      "block w-full px-4 py-3 text-left transition-colors",
                      !n.is_read ? "bg-[var(--primary-light)]/30" : "hover:bg-[var(--background-muted)]"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "w-2 h-2 rounded-full mt-1.5 shrink-0",
                          !n.is_read ? notificationAccent(n) : "bg-transparent"
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--foreground)] leading-tight">
                          {n.title}
                        </p>
                        <p className="text-xs text-[var(--foreground-muted)] mt-0.5 leading-relaxed">
                          {n.message}
                        </p>
                        <p className="text-xs text-[var(--foreground-subtle)] mt-1">
                          {formatRelativeTime(n.created_at)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="px-4 py-2 border-t border-[var(--border)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-[var(--foreground-subtle)]">
                    {notificationsRefreshing ? "Refreshing…" : "Synced with your account activity"}
                  </span>
                  <Link
                    href={notificationSettingsHref}
                    onClick={() => setNotifOpen(false)}
                    className="text-xs text-[var(--primary)] hover:text-[var(--primary-hover)] py-1 transition-colors"
                  >
                    Manage preferences
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* User avatar + dropdown */}
        <div className="relative" ref={userRef}>
          <button
            onClick={() => { setUserOpen(!userOpen); setNotifOpen(false); }}
            className={cn(
              "flex items-center gap-2 pl-2 pr-2.5 h-9 rounded-lg",
              "hover:bg-[var(--background-muted)] transition-colors",
              "border border-transparent hover:border-[var(--border)]"
            )}
            aria-label="User menu"
          >
            {/* Avatar */}
            <Avatar
              src={avatarUrl}
              initials={initials}
              className="w-7 h-7 rounded-full shrink-0"
              textClassName="text-xs font-bold"
            />
            <span className="hidden sm:block text-sm font-medium text-[var(--foreground)] max-w-[120px] truncate">
              {displayName.split(" ")[0]}
            </span>
            <ChevronDown
              className={cn(
                "w-3.5 h-3.5 text-[var(--foreground-subtle)] transition-transform duration-200",
                userOpen && "rotate-180"
              )}
            />
          </button>

          {/* User dropdown */}
          {userOpen && (
            <div
              className="absolute right-0 top-11 w-56 rounded-xl
                         bg-[var(--surface)] border border-[var(--border)]
                         shadow-[var(--shadow-xl)] overflow-hidden z-50"
            >
              {/* User info header */}
              <div className="px-4 py-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-2.5">
                  <Avatar
                    src={avatarUrl}
                    initials={initials}
                    className="w-8 h-8 rounded-full"
                    textClassName="text-sm font-bold"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--foreground)] truncate">{displayName}</p>
                    <p className="text-xs text-[var(--foreground-subtle)] flex items-center gap-1 mt-0.5">
                      {userType === "BUYER" ? (
                        <><Building2 className="w-3 h-3" /> Buyer</>
                      ) : (
                        <><Sprout className="w-3 h-3" /> {userType === "CHAIR" ? "Cooperative Chair" : "Helper"}</>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Menu items */}
              <div className="py-1">
                <Link
                  href={profileHref}
                  onClick={() => setUserOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--foreground-muted)]
                             hover:text-[var(--foreground)] hover:bg-[var(--background-muted)] transition-colors"
                >
                  <User className="w-4 h-4" />
                  My Profile
                </Link>
                <Link
                  href={settingsHref}
                  onClick={() => setUserOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--foreground-muted)]
                             hover:text-[var(--foreground)] hover:bg-[var(--background-muted)] transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Settings
                </Link>
              </div>

              <div className="border-t border-[var(--border)] py-1">
                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-sm
                             text-[var(--destructive)] hover:bg-[var(--destructive-light)]
                             disabled:opacity-50 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  {loggingOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
