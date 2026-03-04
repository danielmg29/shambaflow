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

import { useState, useEffect } from "react";
import { usePathname, useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ShambaSidebar } from "@/components/shambaflow/ShambaSidebar";
import { TopBar } from "@/components/dashboard/TopBar";
import { getAccessToken, getUser } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  const pathname     = usePathname();
  const params       = useParams();
  const router       = useRouter();
  const cooperativeId = params?.cooperative_id as string | undefined;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mounted,     setMounted]     = useState(false);

  // Auth guard
  useEffect(() => {
    const token = getAccessToken();
    const user  = getUser() as Record<string, string> | null;
    if (!token) {
      router.replace("/login");
      return;
    }
    if (user?.user_type === "BUYER") {
      router.replace("/marketplace/dashboard");
    }
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
    if (pathname.includes("/forms"))        return "forms";
    if (pathname.includes("/analytics"))    return "analytics";
    if (pathname.includes("/certification")) return "certification";
    if (pathname.includes("/settings"))     return "settings";
    return "dashboard";
  })();

  const user = mounted ? (getUser() as Record<string, string> | null) : null;
  const coopName = user?.cooperative_name ?? "Your Cooperative";

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="w-8 h-8 rounded-full border-2 border-[var(--primary)] border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)]">
      {/* ── Desktop Sidebar ──────────────────────────────────── */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <ShambaSidebar
          variant="crm"
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
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
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
