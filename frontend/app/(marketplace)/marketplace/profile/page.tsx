"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Camera,
  CheckCircle2,
  Globe,
  Loader2,
  Mail,
  MapPin,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
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
import { authApi, saveUser } from "@/lib/api";
import { formatDecimal } from "@/lib/marketplace";
import { cn } from "@/lib/utils";

interface BuyerProfileResponse {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  is_email_verified: boolean;
  phone_number: string;
  profile?: {
    company_name: string;
    buyer_type: string;
    registration_number: string;
    tax_pin: string;
    country: string;
    region: string;
    physical_address: string;
    website: string;
    description: string;
    company_logo?: string | null;
    interested_categories: string[];
    preferred_regions: string[];
    average_rating: string;
    total_tenders: number;
    is_verified: boolean;
  };
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

const CATEGORY_OPTIONS = [
  { value: "CEREALS", label: "Cereals & Grains" },
  { value: "VEGETABLES", label: "Vegetables" },
  { value: "FRUITS", label: "Fruits" },
  { value: "DAIRY", label: "Dairy Products" },
  { value: "MEAT", label: "Meat & Poultry" },
  { value: "PULSES", label: "Pulses & Legumes" },
  { value: "CASH_CROPS", label: "Cash Crops" },
  { value: "HORTICULTURE", label: "Horticulture" },
  { value: "OTHER", label: "Other" },
];

const buyerProfileHeroStyle = {
  background:
    "radial-gradient(circle at top left, color-mix(in oklch, var(--surface) 18%, transparent) 0%, transparent 28%), linear-gradient(135deg, color-mix(in oklch, var(--foreground) 76%, var(--primary) 24%) 0%, color-mix(in oklch, var(--primary) 70%, var(--foreground) 30%) 44%, color-mix(in oklch, var(--primary-light) 78%, var(--surface) 22%) 100%)",
  boxShadow: "0 24px 60px color-mix(in oklch, var(--foreground) 16%, transparent)",
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

export default function MarketplaceProfilePage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [profile, setProfile] = useState<BuyerProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoSaving, setLogoSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [buyerType, setBuyerType] = useState("RETAILER");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [taxPin, setTaxPin] = useState("");
  const [country, setCountry] = useState("Kenya");
  const [region, setRegion] = useState("");
  const [physicalAddress, setPhysicalAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [preferredRegions, setPreferredRegions] = useState("");

  const applyProfile = useCallback((data: BuyerProfileResponse) => {
    setProfile(data);
    setCompanyName(data.profile?.company_name ?? "");
    setBuyerType(data.profile?.buyer_type ?? "RETAILER");
    setRegistrationNumber(data.profile?.registration_number ?? "");
    setTaxPin(data.profile?.tax_pin ?? "");
    setCountry(data.profile?.country ?? "Kenya");
    setRegion(data.profile?.region ?? "");
    setPhysicalAddress(data.profile?.physical_address ?? "");
    setWebsite(data.profile?.website ?? "");
    setDescription(data.profile?.description ?? "");
    setCategories(data.profile?.interested_categories ?? []);
    setPreferredRegions((data.profile?.preferred_regions ?? []).join(", "));
  }, []);

  const loadProfile = useCallback(async () => {
    const data = await authApi.me() as BuyerProfileResponse;
    saveUser(data);
    applyProfile(data);
    return data;
  }, [applyProfile]);

  useEffect(() => {
    loadProfile()
      .catch(() => setMessage({ type: "error", text: "Unable to load the buyer profile right now." }))
      .finally(() => setLoading(false));
  }, [loadProfile]);

  const initials = useMemo(() => {
    const source = companyName || profile?.full_name || profile?.email || "B";
    return source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((item) => item.charAt(0))
      .join("")
      .toUpperCase();
  }, [companyName, profile?.email, profile?.full_name]);

  const toggleCategory = (value: string) => {
    setCategories((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  };

  const handleSaveProfile = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await authApi.updateMe({
        company_name: companyName.trim(),
        buyer_type: buyerType,
        registration_number: registrationNumber.trim(),
        tax_pin: taxPin.trim(),
        country: country.trim(),
        region: region.trim(),
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
      await loadProfile();
      setMessage({ type: "success", text: "Buyer profile updated successfully." });
    } catch {
      setMessage({ type: "error", text: "We could not save the buyer profile. Please try again." });
    } finally {
      setSaving(false);
    }
  }, [
    buyerType,
    categories,
    companyName,
    country,
    description,
    loadProfile,
    physicalAddress,
    preferredRegions,
    region,
    registrationNumber,
    taxPin,
    website,
  ]);

  const handleLogoSelected = useCallback(async (file: File | null) => {
    if (!file) return;
    setLogoSaving(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("company_logo", file);
      const response = await authApi.updateMe(formData) as Record<string, unknown>;
      saveUser(response);
      await loadProfile();
      setMessage({ type: "success", text: "Company logo updated." });
    } catch {
      setMessage({ type: "error", text: "Company logo upload failed. Please try another file." });
    } finally {
      setLogoSaving(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [loadProfile]);

  const handleRemoveLogo = useCallback(async () => {
    setLogoSaving(true);
    setMessage(null);
    try {
      const response = await authApi.updateMe({ remove_company_logo: true }) as Record<string, unknown>;
      saveUser(response);
      await loadProfile();
      setMessage({ type: "success", text: "Company logo removed." });
    } catch {
      setMessage({ type: "error", text: "We could not remove the company logo." });
    } finally {
      setLogoSaving(false);
    }
  }, [loadProfile]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm text-[var(--foreground-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading buyer profile…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section
        className="overflow-hidden rounded-[28px] border border-[var(--border)] p-6 sm:p-8"
        style={buyerProfileHeroStyle}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="relative shrink-0">
              <div className="sf-hero-panel flex h-24 w-24 items-center justify-center overflow-hidden rounded-[24px] text-2xl font-bold text-white shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
                {profile?.profile?.company_logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.profile.company_logo} alt="Company logo" className="h-full w-full object-cover" />
                ) : (
                  initials
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => void handleLogoSelected(event.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-3">
              <div className="sf-hero-panel inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/92">
                <Building2 className="h-3.5 w-3.5" />
                Buyer Profile
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-white">
                  {companyName || profile?.full_name || "Buyer account"}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-white/82">
                  Keep your company story, sourcing preferences, and buyer identity current so cooperatives can trust the tenders you publish.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold",
                    profile?.is_email_verified ? "sf-tone-success" : "sf-tone-warning"
                  )}
                >
                  {profile?.is_email_verified ? "Email verified" : "Email pending"}
                </Badge>
                <Badge
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold",
                    profile?.profile?.is_verified ? "sf-tone-info" : "sf-tone-warning"
                  )}
                >
                  {profile?.profile?.is_verified ? "Buyer verified" : "Buyer review pending"}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={logoSaving}
                  className="rounded-2xl bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--background-muted)]"
                >
                  {logoSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                  Upload logo
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRemoveLogo}
                  disabled={logoSaving || !profile?.profile?.company_logo}
                  className="rounded-2xl border-white/25 bg-transparent text-white hover:bg-white/10"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove logo
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="rounded-2xl border-white/25 bg-transparent text-white hover:bg-white/10"
                >
                  <Link href="/marketplace/settings">
                    <ShieldCheck className="h-4 w-4" />
                    Open settings
                  </Link>
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[360px]">
            {[
              { label: "Active tenders", value: String(profile?.profile?.total_tenders ?? 0) },
              { label: "Average rating", value: formatDecimal(Number(profile?.profile?.average_rating ?? 0)) },
              { label: "Primary region", value: profile?.profile?.region || "Not set" },
            ].map((item) => (
              <div key={item.label} className="sf-hero-panel rounded-2xl px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/65">{item.label}</p>
                <p className="mt-2 text-lg font-semibold text-white">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <AnimatedAlert
        show={Boolean(message)}
        motionKey={message?.text ?? "buyer-profile-message"}
        className={cn(
          "flex items-start gap-3 rounded-2xl border px-4 py-4 text-sm",
          message?.type === "success" ? "sf-tone-success" : "sf-tone-danger"
        )}
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{message?.text ?? ""}</p>
      </AnimatedAlert>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <Section
            title="Company identity"
            description="Keep the operational and registration details cooperatives depend on before responding."
            icon={Building2}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <FieldLabel>Company name</FieldLabel>
                <Input
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  className="h-11 rounded-2xl"
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
                <FieldLabel>Email address</FieldLabel>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--foreground-subtle)]" />
                  <Input
                    disabled
                    value={profile?.email ?? ""}
                    className="h-11 rounded-2xl bg-[var(--background-muted)] pl-10 text-[var(--foreground-muted)]"
                  />
                </div>
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Country</FieldLabel>
                <Input
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                  className="h-11 rounded-2xl"
                />
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Registration number</FieldLabel>
                <Input
                  value={registrationNumber}
                  onChange={(event) => setRegistrationNumber(event.target.value)}
                  className="h-11 rounded-2xl"
                />
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Tax ID / PIN</FieldLabel>
                <Input
                  value={taxPin}
                  onChange={(event) => setTaxPin(event.target.value)}
                  className="h-11 rounded-2xl"
                />
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Region</FieldLabel>
                <div className="relative">
                  <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--foreground-subtle)]" />
                  <Input
                    value={region}
                    onChange={(event) => setRegion(event.target.value)}
                    className="h-11 rounded-2xl pl-10"
                  />
                </div>
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Website</FieldLabel>
                <div className="relative">
                  <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--foreground-subtle)]" />
                  <Input
                    value={website}
                    onChange={(event) => setWebsite(event.target.value)}
                    className="h-11 rounded-2xl pl-10"
                  />
                </div>
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <FieldLabel>Physical address</FieldLabel>
                <Input
                  value={physicalAddress}
                  onChange={(event) => setPhysicalAddress(event.target.value)}
                  className="h-11 rounded-2xl"
                />
              </label>
            </div>
          </Section>

          <Section
            title="Buyer story"
            description="Give cooperatives the sourcing context that sits behind the tenders you publish."
            icon={Sparkles}
          >
            <Textarea
              rows={7}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Explain your sourcing model, quality standards, turnaround expectations, and the kind of cooperative capacity you are looking for."
              className="rounded-2xl px-4 py-3 text-sm leading-6"
            />
          </Section>
        </div>

        <div className="space-y-6">
          <Section
            title="Sourcing preferences"
            description="Tune the categories and regions that shape what you see and how cooperatives interpret your tenders."
            icon={Tag}
          >
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-sm font-medium text-[var(--foreground)]">Interested categories</p>
                <div className="flex flex-wrap gap-2">
                  {CATEGORY_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      size="sm"
                      variant={categories.includes(option.value) ? "default" : "outline"}
                      onClick={() => toggleCategory(option.value)}
                      className="rounded-full"
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
              <label className="space-y-1.5">
                <FieldLabel>Preferred regions</FieldLabel>
                <Textarea
                  rows={4}
                  value={preferredRegions}
                  onChange={(event) => setPreferredRegions(event.target.value)}
                  placeholder="Nairobi County, Nakuru County, Uasin Gishu County"
                  className="rounded-2xl px-4 py-3 text-sm"
                />
              </label>
            </div>
          </Section>

          <Card className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] py-0 shadow-[var(--shadow-sm)]">
            <CardContent className="p-6">
              <h2 className="text-lg font-semibold text-[var(--foreground)]">Profile actions</h2>
              <p className="mt-2 text-sm text-[var(--foreground-muted)]">
                Changes here update the buyer-facing identity used across your marketplace workspace.
              </p>
              <div className="mt-6 flex flex-col gap-3">
                <Button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="h-11 rounded-2xl"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Save buyer profile
                </Button>
                <Button
                  asChild
                  type="button"
                  variant="outline"
                  className="h-11 rounded-2xl"
                >
                  <Link href="/marketplace/onboarding">
                    Review onboarding checklist
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
