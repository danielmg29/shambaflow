"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  MapPin,
  Phone,
  Sparkles,
  UserRound,
} from "lucide-react";

import { AnimatedAlert } from "@/components/ui/animated-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, authApi, saveUser } from "@/lib/api";
import { cn } from "@/lib/utils";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  complete: boolean;
  fields: string[];
}

interface OnboardingPayload {
  is_complete: boolean;
  completion_percent: number;
  completed_steps: number;
  total_steps: number;
  steps: OnboardingStep[];
  missing_fields: string[];
  buyer: {
    company_name: string;
    buyer_type: string;
    buyer_type_display: string;
    company_logo?: string | null;
    region: string;
    registration_number: string;
    physical_address: string;
    website: string;
    description: string;
    interested_categories: string[];
    preferred_regions: string[];
  };
  contact: {
    first_name: string;
    last_name: string;
    email: string;
    phone_number: string;
    is_email_verified: boolean;
    is_phone_verified: boolean;
  };
  category_options: Array<{ value: string; label: string }>;
  suggested_regions: string[];
}

const BUYER_TYPES = [
  { value: "PROCESSOR", label: "Processor / Manufacturer" },
  { value: "RETAILER", label: "Retailer / Supermarket" },
  { value: "EXPORTER", label: "Exporter" },
  { value: "NGO", label: "NGO / Development Organisation" },
  { value: "GOVERNMENT", label: "Government Agency" },
  { value: "TRADER", label: "Commodity Trader" },
  { value: "OTHER", label: "Other" },
];

const buyerOnboardingHeroStyle = {
  background:
    "radial-gradient(circle at top left, color-mix(in oklch, var(--surface) 18%, transparent) 0%, transparent 28%), linear-gradient(135deg, color-mix(in oklch, var(--foreground) 78%, var(--primary) 22%) 0%, color-mix(in oklch, var(--primary) 70%, var(--foreground) 30%) 46%, color-mix(in oklch, var(--secondary) 52%, var(--surface) 48%) 100%)",
};

function Section({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] py-0 shadow-[var(--shadow-sm)]">
      <CardContent className="p-6">
        <div className="mb-5 flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary)]">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">{title}</h2>
            <p className="text-sm text-[var(--foreground-muted)]">{description}</p>
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Label className="text-sm font-medium text-[var(--foreground)]">{children}</Label>;
}

export default function BuyerOnboardingPage() {
  const router = useRouter();

  const [payload, setPayload] = useState<OnboardingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [buyerType, setBuyerType] = useState("RETAILER");
  const [region, setRegion] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [physicalAddress, setPhysicalAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [preferredRegions, setPreferredRegions] = useState("");

  const applyPayload = useCallback((data: OnboardingPayload) => {
    setPayload(data);
    setFirstName(data.contact.first_name ?? "");
    setLastName(data.contact.last_name ?? "");
    setPhoneNumber(data.contact.phone_number ?? "");
    setCompanyName(data.buyer.company_name ?? "");
    setBuyerType(data.buyer.buyer_type ?? "RETAILER");
    setRegion(data.buyer.region ?? "");
    setRegistrationNumber(data.buyer.registration_number ?? "");
    setPhysicalAddress(data.buyer.physical_address ?? "");
    setWebsite(data.buyer.website ?? "");
    setDescription(data.buyer.description ?? "");
    setCategories(data.buyer.interested_categories ?? []);
    setPreferredRegions((data.buyer.preferred_regions ?? []).join(", "));
  }, []);

  const loadOnboarding = useCallback(async () => {
    const data = await apiFetch<OnboardingPayload>("/api/marketplace/onboarding/");
    applyPayload(data);
    return data;
  }, [applyPayload]);

  useEffect(() => {
    loadOnboarding()
      .catch(() => setMessage({ type: "error", text: "Failed to load buyer onboarding details." }))
      .finally(() => setLoading(false));
  }, [loadOnboarding]);

  const toggleCategory = (value: string) => {
    setCategories((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  };

  const completionLabel = useMemo(() => {
    if (!payload) return "Profile setup";
    if (payload.is_complete) return "Buyer onboarding complete";
    const remaining = payload.total_steps - payload.completed_steps;
    return `Complete ${remaining} remaining setup step${remaining === 1 ? "" : "s"}`;
  }, [payload]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await authApi.updateMe({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone_number: phoneNumber.trim(),
        company_name: companyName.trim(),
        buyer_type: buyerType,
        region: region.trim(),
        registration_number: registrationNumber.trim(),
        physical_address: physicalAddress.trim(),
        website: website.trim(),
        description: description.trim(),
        interested_categories: categories,
        preferred_regions: preferredRegions
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      }) as Record<string, unknown>;
      saveUser(response);
      const refreshed = await loadOnboarding();
      if (refreshed.is_complete) {
        router.push("/marketplace/dashboard");
        return;
      }
      setMessage({
        type: "success",
        text: "Progress saved. Finish the remaining items to unlock the buyer dashboard.",
      });
    } catch {
      setMessage({
        type: "error",
        text: "We could not save your onboarding progress. Please review the fields and try again.",
      });
    } finally {
      setSaving(false);
    }
  }, [
    buyerType,
    categories,
    companyName,
    description,
    firstName,
    lastName,
    loadOnboarding,
    phoneNumber,
    physicalAddress,
    preferredRegions,
    region,
    registrationNumber,
    router,
    website,
  ]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm text-[var(--foreground-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Preparing your buyer workspace…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section
        className="overflow-hidden rounded-[28px] border border-[var(--border)] text-white shadow-[var(--shadow-green)]"
        style={buyerOnboardingHeroStyle}
      >
        <div className="grid gap-8 px-6 py-8 lg:grid-cols-[1.35fr_0.85fr] lg:px-8">
          <div className="space-y-5">
            <Badge className="w-fit border-white/14 bg-white/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white shadow-none hover:bg-white/12">
              <ClipboardCheck className="h-3.5 w-3.5" />
              Buyer Onboarding
            </Badge>
            <div className="space-y-3">
              <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
                Build the buyer profile cooperatives need before they bid.
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-white/82 sm:text-base">
                ShambaFlow uses this information to position your company, match sourcing preferences, and route you into a tender-ready buyer workspace.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: "Company", value: companyName || "Unnamed buyer" },
                {
                  label: "Verification",
                  value: payload?.contact.is_email_verified ? "Email ready" : "Email pending",
                },
                { label: "Progress", value: `${payload?.completion_percent ?? 0}% complete` },
              ].map((item) => (
                <div key={item.label} className="sf-hero-panel rounded-2xl px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/65">{item.label}</p>
                  <p className="mt-2 text-sm font-semibold text-white">{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="sf-hero-panel rounded-[26px] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white">{completionLabel}</p>
                <p className="mt-1 text-xs text-white/72">
                  {payload?.completed_steps ?? 0} of {payload?.total_steps ?? 0} sections complete
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold">{payload?.completion_percent ?? 0}%</p>
              </div>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/12">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${payload?.completion_percent ?? 0}%`,
                  background:
                    "linear-gradient(90deg, color-mix(in oklch, var(--surface) 92%, transparent) 0%, color-mix(in oklch, var(--secondary) 72%, var(--surface) 28%) 100%)",
                }}
              />
            </div>
            <div className="mt-5 space-y-3">
              {payload?.steps.map((step) => (
                <div
                  key={step.id}
                  className={cn(
                    "rounded-2xl border px-4 py-3 transition-all",
                    step.complete
                      ? "border-white/28 bg-white/14"
                      : "border-white/12 bg-black/10"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
                        step.complete
                          ? "border-white/32 bg-white/16 text-white"
                          : "border-white/20 bg-white/8 text-white/88"
                      )}
                    >
                      {step.complete ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <ArrowRight className="h-4 w-4" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{step.title}</p>
                      <p className="mt-1 text-xs leading-5 text-white/70">{step.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <AnimatedAlert
        show={Boolean(message)}
        motionKey={message?.text ?? "buyer-onboarding-message"}
        className={cn(
          "flex items-start gap-3 rounded-2xl border px-4 py-4 text-sm",
          message?.type === "success" ? "sf-tone-success" : "sf-tone-danger"
        )}
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{message?.text ?? ""}</p>
      </AnimatedAlert>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <Section
            title="Account contact"
            description="This is the person cooperatives will recognise when they respond to your tenders."
            icon={UserRound}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <FieldLabel>First name</FieldLabel>
                <Input
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
                />
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Last name</FieldLabel>
                <Input
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
                />
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Phone number</FieldLabel>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--foreground-subtle)]" />
                  <Input
                    value={phoneNumber}
                    onChange={(event) => setPhoneNumber(event.target.value)}
                    placeholder="+254712345678"
                    className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] pl-10 pr-4 text-[var(--input-text)]"
                  />
                </div>
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Email address</FieldLabel>
                <Input
                  value={payload?.contact.email ?? ""}
                  disabled
                  className="h-11 rounded-2xl border-[var(--border)] bg-[var(--background-muted)] px-4 text-[var(--foreground-muted)]"
                />
              </label>
            </div>
          </Section>

          <Section
            title="Company identity"
            description="Anchor your buyer profile with the operational details cooperatives expect to see."
            icon={Building2}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <FieldLabel>Company name</FieldLabel>
                <Input
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
                />
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Buyer category</FieldLabel>
                <Select value={buyerType} onValueChange={setBuyerType}>
                  <SelectTrigger className="h-11 w-full rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-sm text-[var(--input-text)]">
                    <SelectValue placeholder="Select buyer category" />
                  </SelectTrigger>
                  <SelectContent>
                    {BUYER_TYPES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Region</FieldLabel>
                <Input
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                  placeholder="Nairobi County"
                  className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
                />
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Registration number</FieldLabel>
                <Input
                  value={registrationNumber}
                  onChange={(event) => setRegistrationNumber(event.target.value)}
                  placeholder="Optional"
                  className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
                />
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <FieldLabel>Physical address</FieldLabel>
                <Input
                  value={physicalAddress}
                  onChange={(event) => setPhysicalAddress(event.target.value)}
                  placeholder="Warehouse, street, or receiving location"
                  className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
                />
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <FieldLabel>Website</FieldLabel>
                <Input
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                  placeholder="https://yourcompany.com"
                  className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
                />
              </label>
            </div>
          </Section>
        </div>

        <div className="space-y-6">
          <Section
            title="Sourcing preferences"
            description="Choose the categories and sourcing zones that define your tender footprint."
            icon={MapPin}
          >
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-sm font-medium text-[var(--foreground)]">Product categories</p>
                <div className="flex flex-wrap gap-2">
                  {payload?.category_options.map((option) => {
                    const selected = categories.includes(option.value);
                    return (
                      <Button
                        key={option.value}
                        type="button"
                        size="sm"
                        variant={selected ? "default" : "outline"}
                        onClick={() => toggleCategory(option.value)}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-xs font-semibold",
                          !selected && "border-[var(--border)] bg-[var(--background)] text-[var(--foreground-muted)]"
                        )}
                      >
                        {option.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <label className="space-y-1.5">
                <FieldLabel>Preferred sourcing regions</FieldLabel>
                <Textarea
                  rows={4}
                  value={preferredRegions}
                  onChange={(event) => setPreferredRegions(event.target.value)}
                  placeholder="Rift Valley, Central, Western"
                  className="rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3 text-[var(--input-text)]"
                />
              </label>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">
                  Suggested regions
                </p>
                <div className="flex flex-wrap gap-2">
                  {payload?.suggested_regions.map((item) => (
                    <Button
                      key={item}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (preferredRegions.includes(item)) return;
                        setPreferredRegions((current) => (current ? `${current}, ${item}` : item));
                      }}
                      className="rounded-full border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium text-[var(--foreground-muted)]"
                    >
                      {item}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <Section
            title="Buyer story"
            description="Add a concise sourcing brief so cooperatives understand your standards and delivery context."
            icon={Sparkles}
          >
            <Textarea
              rows={6}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe your sourcing volumes, quality standards, seasonality, and the kind of cooperative you prefer to work with."
              className="rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3 leading-6 text-[var(--input-text)]"
            />
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="h-11 rounded-2xl px-5"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Save and continue
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-2xl px-5">
                <Link href="/marketplace/profile">Review full profile</Link>
              </Button>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
