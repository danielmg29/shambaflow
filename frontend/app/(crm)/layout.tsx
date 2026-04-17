"use client";

/**
 * CRM Layout — Cooperative Platform
 *
 * Provides the sidebar + topbar shell for all CRM routes.
 * Uses ShambaSidebar (variant="crm") + TopBar.
 *
 * Mobile: sidebar slides in as overlay via AnimatePresence.
 * Desktop: sidebar is always visible, content shifts right.
 *
 * Route protection: redirects to /login if no access token.
 */

import { useMemo, useState, useEffect } from "react";
import { usePathname, useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ShambaSidebar, type SidebarItem } from "@/components/shambaflow/ShambaSidebar";
import { TopBar } from "@/components/dashboard/TopBar";
import { authApi, getAccessToken, getUser, hasPermission, saveUser, type UserSnapshot } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  ClipboardList,
  Heart,
  LayoutDashboard,
  Settings,
  Users,
  Wallet,
  Gavel,
  Leaf,
} from "lucide-react";

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  const pathname     = usePathname();
  const params       = useParams();
  const router       = useRouter();
  const cooperativeId = params?.cooperative_id as string | undefined;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mounted,     setMounted]     = useState(false);
  const [userContext, setUserContext] = useState<UserSnapshot | null>(null);

  // Auth guard
  useEffect(() => {
    const token = getAccessToken();
    const user  = getUser();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (user?.user_type === "BUYER") {
      router.replace("/marketplace/dashboard");
      return;
    }
    setUserContext(user);
    authApi.me()
      .then((snapshot) => {
        const nextUser = snapshot as UserSnapshot;
        saveUser(nextUser);
        setUserContext(nextUser);
      })
      .catch(() => {});
    setMounted(true);
  }, [router]);

  // Close mobile sidebar on route change
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  // Derive active nav item from pathname
  const activeId = (() => {
    if (pathname.includes("/members"))      return "members";
    if (pathname.includes("/production"))   return "production";
    if (pathname.includes("/livestock"))    return "livestock";
    if (pathname.includes("/governance"))   return "governance";
    if (pathname.includes("/finance"))      return "finance";
    if (pathname.includes("/form-builder")) return "form-builder";
    if (pathname.includes("/certification")) return "certification";
    if (pathname.includes("/settings"))     return "settings";
    return "dashboard";
  })();

  const user = mounted ? userContext : null;
  const coopName = user?.cooperative_name ?? "Your Cooperative";

  const crmItems = useMemo<SidebarItem[]>(() => {
    const items: SidebarItem[] = [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: "/crm/dashboard" },
      { id: "members", label: "Members", icon: Users, href: "/crm/members" },
      { id: "production", label: "Production", icon: Leaf, href: "/crm/production" },
      { id: "livestock", label: "Livestock", icon: Heart, href: "/crm/livestock" },
      { id: "governance", label: "Governance", icon: Gavel, href: "/crm/governance" },
      { id: "finance", label: "Finance", icon: Wallet, href: "/crm/finance" },
      { id: "form-builder", label: "Form Builder", icon: ClipboardList, href: "/crm/form-builder" },
    ];

    if (!user || user.user_type === "CHAIR") {
      items.push({ id: "settings", label: "Settings", icon: Settings, href: "/crm/settings" });
      return items;
    }

    return items
      .filter((item) => {
        if (item.id === "dashboard") return true;
        if (item.id === "members") return hasPermission("MEMBERS", "can_view", user);
        if (item.id === "production") return hasPermission("PRODUCTION", "can_view", user);
        if (item.id === "livestock") return hasPermission("LIVESTOCK", "can_view", user);
        if (item.id === "governance") return hasPermission("GOVERNANCE", "can_view", user);
        if (item.id === "finance") return hasPermission("FINANCE", "can_view", user);
        if (item.id === "form-builder") return hasPermission("FORM_BUILDER", "can_view", user);
        return false;
      });
  }, [user]);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)]">
      {/* ── Desktop Sidebar ──────────────────────────────────── */}
      <div className="relative z-30 hidden overflow-visible lg:flex lg:flex-shrink-0">
        <ShambaSidebar
          variant="crm"
          items={crmItems}
          activeId={activeId}
          cooperativeName={coopName}
          onNavigate={(id, href) => {
            const resolvedHref = cooperativeId
              ? href.replace("/crm", `/crm/${cooperativeId}`)
              : href;
            router.push(resolvedHref);
          }}
        />
      </div>

      {/* ── Mobile Sidebar (overlay) ─────────────────────────── */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/60 z-40 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            {/* Sidebar panel */}
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed left-0 top-0 h-full z-50 lg:hidden"
            >
              <ShambaSidebar
                variant="crm"
                items={crmItems}
                activeId={activeId}
                cooperativeName={coopName}
                isOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
                onNavigate={(id, href) => {
                  const resolvedHref = cooperativeId
                    ? href.replace("/crm", `/crm/${cooperativeId}`)
                    : href;
                  router.push(resolvedHref);
                  setSidebarOpen(false);
                }}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Main content area ────────────────────────────────── */}
      <div className="relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          variant="crm"
          cooperativeId={cooperativeId}
        />

        {/* Scrollable page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
