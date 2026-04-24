"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

import { TopBar } from "@/components/dashboard/TopBar";
import { ShambaSidebar, type SidebarItem } from "@/components/shambaflow/ShambaSidebar";
import {
  ApiError,
  apiFetch,
  authApi,
  clearTokens,
  getAccessToken,
  getUser,
  saveUser,
  type UserSnapshot,
} from "@/lib/api";

import {
  BriefcaseBusiness,
  ClipboardCheck,
  LayoutDashboard,
  Settings,
  UserRound,
} from "lucide-react";

const BUYER_INCOMPLETE_ALLOWED_PREFIXES = [
  "/marketplace/onboarding",
  "/marketplace/profile",
  "/marketplace/settings",
];

function activeBuyerNavId(pathname: string): string {
  if (pathname.startsWith("/marketplace/onboarding")) return "onboarding";
  if (pathname.startsWith("/marketplace/tenders")) return "tenders";
  if (pathname.startsWith("/marketplace/profile")) return "profile";
  if (pathname.startsWith("/marketplace/settings")) return "settings";
  return "dashboard";
}

function crmHrefFor(user: UserSnapshot | null): string {
  return user?.cooperative_id ? `/crm/${user.cooperative_id}/dashboard` : "/crm/dashboard";
}

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [userContext, setUserContext] = useState<UserSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    const redirectToLogin = () => {
      clearTokens();
      router.replace("/login");
    };

    async function hydrate() {
      const token = getAccessToken();
      const storedUser = getUser();

      if (!token) {
        redirectToLogin();
        return;
      }

      if (storedUser) {
        setUserContext(storedUser);
      }

      let snapshot = storedUser;

      try {
        snapshot = (await authApi.me()) as UserSnapshot;
        if (cancelled) return;
        saveUser(snapshot);
        setUserContext(snapshot);
      } catch (error) {
        if (cancelled) return;

        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }

        if (!snapshot) {
          redirectToLogin();
          return;
        }
      }

      if (!snapshot) {
        redirectToLogin();
        return;
      }

      if (snapshot.user_type !== "BUYER") {
        if (snapshot.user_type === "CHAIR" && snapshot.cooperative_id) {
          router.replace("/marketplace/discover");
          return;
        }

        router.replace(crmHrefFor(snapshot));
        return;
      }

      let onboardingComplete = true;
      try {
        const onboarding = await apiFetch<{ is_complete: boolean }>("/api/marketplace/onboarding/");
        if (cancelled) return;
        onboardingComplete = onboarding.is_complete;
      } catch (error) {
        if (cancelled) return;

        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
      }

      if (pathname === "/marketplace") {
        router.replace(onboardingComplete ? "/marketplace/dashboard" : "/marketplace/onboarding");
        return;
      }

      const allowIncompleteAccess = BUYER_INCOMPLETE_ALLOWED_PREFIXES.some((prefix) =>
        pathname.startsWith(prefix)
      );

      if (!onboardingComplete && !allowIncompleteAccess) {
        router.replace("/marketplace/onboarding");
        return;
      }

      setReady(true);
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const buyerItems = useMemo<SidebarItem[]>(
    () => [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: "/marketplace/dashboard" },
      { id: "onboarding", label: "Onboarding", icon: ClipboardCheck, href: "/marketplace/onboarding" },
      { id: "tenders", label: "Tenders", icon: BriefcaseBusiness, href: "/marketplace/tenders" },
      { id: "profile", label: "Buyer Profile", icon: UserRound, href: "/marketplace/profile" },
      { id: "settings", label: "Settings", icon: Settings, href: "/marketplace/settings" },
    ],
    []
  );

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
        <div className="flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm text-[var(--foreground-muted)] shadow-[var(--shadow-sm)]">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
          Loading buyer workspace…
        </div>
      </div>
    );
  }

  const activeId = activeBuyerNavId(pathname);
  const buyerCompanyName =
    userContext?.company_name ?? userContext?.full_name ?? "Your Company";

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)]">
      <div className="relative z-30 hidden overflow-visible lg:flex lg:flex-shrink-0">
        <ShambaSidebar
          variant="tender"
          items={buyerItems}
          activeId={activeId}
          buyerCompanyName={buyerCompanyName}
          onNavigate={(_, href) => {
            router.push(href);
          }}
        />
      </div>

      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/60 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed left-0 top-0 z-50 h-full lg:hidden"
            >
              <ShambaSidebar
                variant="tender"
                items={buyerItems}
                activeId={activeId}
                buyerCompanyName={buyerCompanyName}
                isOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
                onNavigate={(_, href) => {
                  router.push(href);
                  setSidebarOpen(false);
                }}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div className="relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          variant="marketplace"
        />

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
