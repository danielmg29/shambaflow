"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import MarketplaceChatLauncher from "@/components/marketplace/MarketplaceChatLauncher";
import { ThemeToggle } from "@/components/providers/ThemeToggle";
import ShambaLogo from "@/components/shambaflow/ShambaLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Compass,
  CreditCard,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  Phone,
  Receipt,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

const tenderMarketplaceAura = {
  background:
    "radial-gradient(circle at top left, color-mix(in oklch, var(--secondary) 18%, transparent) 0%, transparent 34%), radial-gradient(circle at top right, color-mix(in oklch, var(--primary) 16%, transparent) 0%, transparent 32%), linear-gradient(180deg, color-mix(in oklch, var(--background) 98%, transparent), color-mix(in oklch, var(--background) 82%, transparent) 72%, color-mix(in oklch, var(--background) 0%, transparent))",
};

const tenderMarketplaceHero = {
  background:
    "linear-gradient(132deg, color-mix(in oklch, var(--foreground) 86%, var(--primary) 14%) 0%, color-mix(in oklch, var(--primary) 78%, var(--foreground) 22%) 42%, color-mix(in oklch, var(--secondary) 50%, var(--primary) 50%) 100%)",
};

function crmHrefFor(user: UserSnapshot | null): string {
  return user?.cooperative_id ? `/crm/${user.cooperative_id}/dashboard` : "/crm/dashboard";
}

interface MarketplaceAccessPayment {
  id: string;
  status: string;
  reference: string;
  amount_kes: number;
  phone_number: string;
  provider_transaction_id: string;
  provider_message: string;
  created_at: string;
  activated_at: string | null;
  access_expires_at: string | null;
}

interface MarketplaceAccessSnapshot {
  has_access: boolean;
  requires_payment: boolean;
  subscription_tier: string;
  access_expires_at: string | null;
  amount_kes: number;
  access_window_days: number;
  billing_phone_number: string;
  billing_phone_local: string | null;
  latest_payment: MarketplaceAccessPayment | null;
}

interface MarketplaceAccessPayload {
  cooperative: {
    id: string;
    name: string;
  };
  access: MarketplaceAccessSnapshot;
}

function formatKesAmount(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

function formatAccessDate(value: string | null | undefined): string {
  if (!value) return "Not activated yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not activated yet";
  return parsed.toLocaleString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function TenderMarketplaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [loadingShell, setLoadingShell] = useState(true);
  const [userContext, setUserContext] = useState<UserSnapshot | null>(null);
  const [accessContext, setAccessContext] = useState<MarketplaceAccessPayload | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const refreshAccess = async (): Promise<MarketplaceAccessPayload> => {
    const payload = await apiFetch<MarketplaceAccessPayload>("/api/marketplace/cooperative/access/");
    setAccessContext(payload);
    setReady(payload.access.has_access);
    setAccessError(null);
    return payload;
  };

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

      if (snapshot.user_type === "BUYER") {
        router.replace("/marketplace/dashboard");
        return;
      }

      if (snapshot.user_type !== "CHAIR" || !snapshot.cooperative_id) {
        router.replace(crmHrefFor(snapshot));
        return;
      }

      try {
        const accessPayload = await apiFetch<MarketplaceAccessPayload>("/api/marketplace/cooperative/access/");
        if (cancelled) return;
        setAccessContext(accessPayload);
        setReady(accessPayload.access.has_access);
      } catch (error) {
        if (cancelled) return;

        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }

        setAccessError(
          error instanceof Error ? error.message : "Unable to load marketplace access right now."
        );
        setReady(false);
      } finally {
        if (!cancelled) {
          setLoadingShell(false);
        }
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const cooperativeName = useMemo(
    () => accessContext?.cooperative.name ?? userContext?.cooperative_name ?? "Your Cooperative",
    [accessContext, userContext]
  );

  const accessSnapshot = accessContext?.access ?? null;
  const latestPayment = accessSnapshot?.latest_payment ?? null;
  const paymentPending = latestPayment?.status === "PENDING";

  async function handleStartPayment() {
    if (!accessSnapshot?.billing_phone_number) {
      setAccessError("Add a registered chair phone number in the CRM before starting the marketplace payment.");
      return;
    }

    setPaying(true);
    setAccessError(null);
    setAccessMessage(null);

    try {
      const response = await apiFetch<{ message: string }>("/api/marketplace/cooperative/access/pay/", {
        method: "POST",
        body: {
          phone_number: accessSnapshot.billing_phone_number,
        },
      });
      await refreshAccess();
      setAccessMessage(response.message);
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "Unable to start the M-Pesa prompt.");
    } finally {
      setPaying(false);
    }
  }

  async function handleConfirmPayment() {
    if (!latestPayment?.reference) {
      setAccessError("Start the M-Pesa prompt first before confirming payment.");
      return;
    }

    setConfirming(true);
    setAccessError(null);
    setAccessMessage(null);

    try {
      const response = await apiFetch<{ message: string }>("/api/marketplace/cooperative/access/confirm/", {
        method: "POST",
        body: {
          reference: latestPayment.reference,
        },
      });
      await refreshAccess();
      setAccessMessage(response.message);
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "Unable to confirm the marketplace payment yet.");
    } finally {
      setConfirming(false);
    }
  }

  if (loadingShell) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
        <div className="flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm text-[var(--foreground-muted)] shadow-[var(--shadow-sm)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--primary)]" />
          Loading tender marketplace…
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--background)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[360px]" style={tenderMarketplaceAura} />

      <div className="relative z-10">
        <header
          className="sticky top-0 z-30 border-b border-[var(--border)] backdrop-blur-xl"
          style={{ backgroundColor: "color-mix(in oklch, var(--background) 88%, transparent)" }}
        >
          <div className="mx-auto w-full max-w-[1440px] px-4 py-4 sm:px-6 lg:px-8">
            <div className="rounded-[28px] border border-[var(--border)] bg-[color:color-mix(in_oklch,var(--surface)_92%,transparent)] px-4 py-4 shadow-[var(--shadow-sm)] sm:px-5">
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <Link href="/marketplace/discover" className="flex items-center gap-3">
                      <ShambaLogo
                        size="md"
                        mode="full"
                        fullSrc="/logo-full.svg"
                        className="hidden min-[440px]:flex"
                      />
                      <ShambaLogo
                        size="md"
                        mode="icon"
                        iconSrc="/logo-icon.svg"
                        className="min-[440px]:hidden"
                      />
                    </Link>

                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--foreground-subtle)]">
                        Tender Marketplace
                      </p>
                      <p className="max-w-xl text-sm text-[var(--foreground-muted)]">
                        A professional bidding surface for cooperative chairs to discover buyer demand, qualify faster, and negotiate with less CRM clutter.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <ThemeToggle size="md" />
                    {ready ? (
                      <MarketplaceChatLauncher
                        variant="marketplace"
                        cooperativeId={userContext?.cooperative_id ?? undefined}
                        user={userContext}
                      />
                    ) : null}
                    <Button asChild className="rounded-full px-4">
                      <Link href={crmHrefFor(userContext)}>
                        <ArrowLeft className="h-4 w-4" />
                        Go back to CRM
                      </Link>
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <nav className="flex flex-wrap gap-2">
                    {ready ? (
                      <Button
                        asChild
                        variant={pathname.startsWith("/marketplace/discover/") ? "outline" : "default"}
                        className="rounded-full px-4"
                      >
                        <Link href="/marketplace/discover">
                          <Compass className="h-4 w-4" />
                          Discover briefs
                        </Link>
                      </Button>
                    ) : (
                      <Button asChild className="rounded-full px-4">
                        <Link href={crmHrefFor(userContext)}>
                          <LockKeyhole className="h-4 w-4" />
                          Marketplace access
                        </Link>
                      </Button>
                    )}
                    {ready && pathname.startsWith("/marketplace/discover/") && (
                      <Button asChild className="rounded-full px-4">
                        <Link href={pathname}>
                          Tender workspace
                          <ArrowUpRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    )}
                  </nav>

                  <div className="flex flex-wrap gap-2">
                    <Badge className="rounded-full border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-muted)] shadow-none">
                      <Sparkles className="h-3.5 w-3.5 text-[var(--primary)]" />
                      Buyer-brief marketplace
                    </Badge>
                    <Badge className="rounded-full border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-muted)] shadow-none">
                      <ShieldCheck className="h-3.5 w-3.5 text-[var(--primary)]" />
                      CRM-backed qualification
                    </Badge>
                    <Badge className="rounded-full border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-muted)] shadow-none">
                      <MessageSquareText className="h-3.5 w-3.5 text-[var(--primary)]" />
                      Direct negotiation
                    </Badge>
                    <Badge className="rounded-full border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-muted)] shadow-none">
                      {ready ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-[var(--primary)]" />
                      ) : (
                        <CreditCard className="h-3.5 w-3.5 text-[var(--warning)]" />
                      )}
                      {ready ? "Access active" : "Payment required"}
                    </Badge>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_repeat(3,minmax(0,0.8fr))]">
                  <div
                    className="overflow-hidden rounded-[24px] border border-transparent px-5 py-4 text-white"
                    style={tenderMarketplaceHero}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/68">
                      Tender Access
                    </p>
                    <p className="mt-2 text-base font-semibold tracking-tight text-white">
                      Browse agricultural supply opportunities with a bidding-marketplace feel, then move into live tender workspaces once your cooperative is unlocked and ready.
                    </p>
                  </div>
                  <div className="rounded-[24px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">
                      Access
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">
                      {ready
                        ? accessSnapshot?.access_expires_at
                          ? `Active until ${formatAccessDate(accessSnapshot.access_expires_at)}`
                          : "Marketplace access active"
                        : "Payment required before entry"}
                    </p>
                  </div>
                  <div className="rounded-[24px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">
                      Cooperative
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">
                      {cooperativeName}
                    </p>
                  </div>
                  <div className="rounded-[24px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">
                      Billing Phone
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">
                      {accessSnapshot?.billing_phone_number || "Update in CRM first"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="pb-10">
          <div className={cn("mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8")}>
            {ready ? (
              children
            ) : (
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_380px]">
                <section
                  className="overflow-hidden rounded-[32px] border border-[var(--border)] px-6 py-7 text-white shadow-[var(--shadow-sm)] sm:px-8"
                  style={tenderMarketplaceHero}
                >
                  <div className="max-w-3xl space-y-5">
                    <Badge className="w-fit border-white/14 bg-white/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-none hover:bg-white/12">
                      <LockKeyhole className="h-3.5 w-3.5" />
                      Marketplace Access
                    </Badge>
                    <div className="space-y-3">
                      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                        Unlock tender marketplace access for {cooperativeName}.
                      </h1>
                      <p className="max-w-2xl text-sm leading-7 text-white/82">
                        Complete the access payment on the registered cooperative-chair phone number to open buyer briefs, bid workspaces, and live tender negotiations.
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="sf-hero-panel rounded-[22px] px-4 py-4">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-white/62">Access fee</p>
                        <p className="mt-2 text-lg font-semibold text-white">
                          {formatKesAmount(accessSnapshot?.amount_kes)}
                        </p>
                      </div>
                      <div className="sf-hero-panel rounded-[22px] px-4 py-4">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-white/62">Access window</p>
                        <p className="mt-2 text-lg font-semibold text-white">
                          {accessSnapshot?.access_window_days ?? 0} days
                        </p>
                      </div>
                      <div className="sf-hero-panel rounded-[22px] px-4 py-4">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-white/62">Registered phone</p>
                        <p className="mt-2 text-lg font-semibold text-white">
                          {accessSnapshot?.billing_phone_number || "Missing phone number"}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Button
                        type="button"
                        onClick={() => void handleStartPayment()}
                        disabled={paying || !accessSnapshot?.billing_phone_number}
                        className="h-11 rounded-2xl bg-white px-5 shadow-[0_16px_40px_rgba(0,0,0,0.16)] hover:bg-white/92"
                        style={{ color: "color-mix(in oklch, var(--foreground) 18%, black)" }}
                      >
                        {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                        Send M-Pesa prompt
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleConfirmPayment()}
                        disabled={confirming || !paymentPending}
                        className="h-11 rounded-2xl border-white/18 bg-black/12 px-5 text-white backdrop-blur-sm hover:bg-black/18"
                      >
                        {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        I have completed payment
                      </Button>
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  {(accessError || accessMessage) && (
                    <div
                      className={cn(
                        "rounded-[24px] border px-4 py-4 text-sm shadow-[var(--shadow-sm)]",
                        accessError ? "sf-tone-danger" : "sf-tone-success"
                      )}
                    >
                      {accessError || accessMessage}
                    </div>
                  )}

                  <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
                    <div className="flex items-center gap-2 text-[var(--foreground)]">
                      <Receipt className="h-4 w-4 text-[var(--primary)]" />
                      <p className="text-sm font-semibold">Payment summary</p>
                    </div>
                    <div className="mt-5 space-y-4 text-sm">
                      <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">
                          Billing phone
                        </p>
                        <p className="mt-2 font-semibold text-[var(--foreground)]">
                          {accessSnapshot?.billing_phone_number || "Not available"}
                        </p>
                        <p className="mt-2 text-[var(--foreground-muted)]">
                          The M-Pesa prompt is sent using the registered cooperative-chair number.
                        </p>
                      </div>

                      <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">
                          Latest payment
                        </p>
                        <p className="mt-2 font-semibold text-[var(--foreground)]">
                          {latestPayment ? latestPayment.status.replaceAll("_", " ") : "No payment started yet"}
                        </p>
                        <p className="mt-2 text-[var(--foreground-muted)]">
                          {latestPayment
                            ? `Reference ${latestPayment.reference} · ${formatKesAmount(latestPayment.amount_kes)}`
                            : `Access fee ${formatKesAmount(accessSnapshot?.amount_kes)} for ${accessSnapshot?.access_window_days ?? 0} days.`}
                        </p>
                      </div>

                      <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-4 py-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">
                          Activation workflow
                        </p>
                        <div className="mt-3 space-y-3 text-[var(--foreground-muted)]">
                          <p className="flex items-start gap-2">
                            <Phone className="mt-0.5 h-4 w-4 text-[var(--primary)]" />
                            Approve the M-Pesa prompt on the registered phone.
                          </p>
                          <p className="flex items-start gap-2">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 text-[var(--primary)]" />
                            Confirm the payment here to unlock the marketplace.
                          </p>
                          <p className="flex items-start gap-2">
                            <ShieldCheck className="mt-0.5 h-4 w-4 text-[var(--primary)]" />
                            Access stays active until {accessSnapshot?.access_expires_at ? formatAccessDate(accessSnapshot.access_expires_at) : "the new subscription is applied"}.
                          </p>
                        </div>
                      </div>

                      {!accessSnapshot?.billing_phone_number && (
                        <Button asChild className="h-11 w-full rounded-2xl">
                          <Link href={crmHrefFor(userContext)}>
                            Update registered phone in CRM
                            <ArrowUpRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
