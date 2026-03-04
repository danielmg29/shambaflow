"use client";

/**
 * Marketplace Layout — Buyer Platform
 *
 * Provides the sidebar + topbar shell for all Marketplace routes.
 * Uses ShambaSidebar (variant="tender") + TopBar.
 *
 * Route protection: redirects non-buyers to /crm or /login.
 */

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ShambaSidebar } from "@/components/shambaflow/ShambaSidebar";
import { TopBar } from "@/components/dashboard/TopBar";
import { getAccessToken, getUser } from "@/lib/api";

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mounted,     setMounted]     = useState(false);

  // Auth guard — buyers only
  useEffect(() => {
    const token = getAccessToken();
    const user  = getUser() as Record<string, string> | null;
    if (!token) { router.replace("/login"); return; }
    if (user?.user_type !== "BUYER") {
      const coopId = user?.cooperative_id;
      router.replace(coopId ? `/crm/${coopId}/dashboard` : "/crm/dashboard");
      return;
    }
    setMounted(true);
  }, [router]);

  // Close mobile sidebar on route change
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  const activeId = (() => {
    if (pathname.includes("/create"))        return "create-tender";
    if (pathname.includes("/my-tenders"))    return "my-tenders";
    if (pathname.includes("/cooperatives"))  return "browse";
    if (pathname.includes("/bids"))          return "bids";
    if (pathname.includes("/shortlisted"))   return "shortlisted";
    if (pathname.includes("/history"))       return "history";
    if (pathname.includes("/profile"))       return "profile";
    if (pathname.includes("/billing"))       return "billing";
    if (pathname.includes("/settings"))      return "settings";
    return "dashboard";
  })();

  const user        = mounted ? (getUser() as Record<string, string> | null) : null;
  const companyName = user?.company_name ?? "Your Company";

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="w-8 h-8 rounded-full border-2 border-[var(--primary)] border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)]">
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <ShambaSidebar
          variant="tender"
          activeId={activeId}
          buyerCompanyName={companyName}
          onNavigate={(_, href) => router.push(href)}
        />
      </div>

      {/* Mobile Sidebar overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/60 z-40 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.div
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed left-0 top-0 h-full z-50 lg:hidden"
            >
              <ShambaSidebar
                variant="tender"
                activeId={activeId}
                buyerCompanyName={companyName}
                isOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
                onNavigate={(_, href) => { router.push(href); setSidebarOpen(false); }}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          variant="marketplace"
        />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
