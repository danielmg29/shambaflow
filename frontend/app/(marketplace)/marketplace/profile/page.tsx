"use client";

/**
 * Marketplace Profile Page — Buyer
 *
 * Sections:
 * 1. Company info + logo upload
 * 2. Business details (type, registration, tax pin)
 * 3. Sourcing preferences (categories, regions)
 * 4. Notification preferences
 * 5. Security (change password)
 *
 * Responsive: single-column on mobile, two-column on desktop.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Building2, Mail, Phone, Globe, FileText, MapPin,
  Bell, Shield, Camera, Loader2, CheckCircle, AlertCircle,
  Eye, EyeOff, Tag, User,
} from "lucide-react";
import { authApi, getUser } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AnimatedAlert } from "@/components/ui/animated-alert";

/* ─── Types ───────────────────────────────────────────────────────── */

interface BuyerProfile {
  id:               string;
  email:            string;
  full_name:        string;
  user_type:        string;
  is_email_verified:boolean;
  profile?: {
    company_name:        string;
    buyer_type:          string;
    registration_number: string;
    tax_pin:             string;
    country:             string;
    region:              string;
    website:             string;
    description:         string;
    is_verified:         boolean;
    interested_categories: string[];
    preferred_regions:   string[];
    average_rating:      string;
    total_tenders:       number;
    email_notifications: boolean;
    sms_notifications:   boolean;
    company_logo?:       string | null;
  };
}

const BUYER_TYPES = [
  { value: "PROCESSOR",  label: "Processor / Manufacturer" },
  { value: "RETAILER",   label: "Retailer / Supermarket" },
  { value: "EXPORTER",   label: "Exporter" },
  { value: "NGO",        label: "NGO / Development Organisation" },
  { value: "GOVERNMENT", label: "Government Agency" },
  { value: "TRADER",     label: "Commodity Trader" },
  { value: "OTHER",      label: "Other" },
];

const CATEGORIES = [
  "Maize", "Wheat", "Rice", "Beans", "Potatoes", "Tomatoes", "Onions",
  "Dairy", "Beef", "Poultry", "Fish", "Honey", "Coffee", "Tea", "Other",
];

/* ─── Sub-components ──────────────────────────────────────────────── */

function Section({ title, description, icon: Icon, children }: {
  title: string; description?: string; icon?: React.ElementType; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className="px-6 py-5 border-b border-[var(--border)] flex items-start gap-3">
        {Icon && (
          <div className="w-9 h-9 rounded-xl bg-[var(--primary-light)] flex items-center justify-center shrink-0 mt-0.5">
            <Icon className="w-4.5 h-4.5 text-[var(--primary)]" />
          </div>
        )}
        <div>
          <h3 className="text-base font-semibold text-[var(--foreground)]">{title}</h3>
          {description && <p className="text-xs text-[var(--foreground-muted)] mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function FormField({
  label, id, type = "text", value, onChange, placeholder, disabled, hint,
}: {
  label: string; id: string; type?: string; value: string;
  onChange?: (v: string) => void; placeholder?: string; disabled?: boolean; hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-[var(--foreground)]">{label}</label>
      <input
        id={id} type={type} value={value} onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder} disabled={disabled}
        className={cn(
          "w-full h-11 px-4 rounded-xl border text-sm transition-all duration-150",
          disabled
            ? "bg-[var(--background-muted)] text-[var(--foreground-muted)] cursor-default border-[var(--border)]"
            : "bg-[var(--input-bg)] text-[var(--input-text)] border-[var(--input-border)] focus:border-[var(--input-border-focus)] focus:ring-2 focus:ring-[var(--border-focus)] focus:outline-none"
        )}
      />
      {hint && <p className="text-xs text-[var(--foreground-subtle)]">{hint}</p>}
    </div>
  );
}

function Toast({
  toast,
  onClose,
}: {
  toast: { message: string; type: "success" | "error" } | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [toast, onClose]);

  return (
    <AnimatedAlert
      show={Boolean(toast)}
      motionKey={toast?.message ?? "toast"}
      offsetY={8}
      className={cn(
        "fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-[var(--shadow-xl)] border max-w-sm",
        toast?.type === "success"
          ? "bg-[var(--success-light)] border-green-200 text-[var(--success)] dark:border-green-900/40"
          : "bg-[var(--destructive-light)] border-red-200 text-[var(--destructive)] dark:border-red-900/40"
      )}
    >
      {toast?.type === "success" ? (
        <CheckCircle className="w-4 h-4 shrink-0" />
      ) : (
        <AlertCircle className="w-4 h-4 shrink-0" />
      )}
      <p className="text-sm font-medium">{toast?.message ?? ""}</p>
    </AnimatedAlert>
  );
}

/* ─── Main Page ───────────────────────────────────────────────────── */

export default function MarketplaceProfilePage() {
  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState<{ message: string; type: "success"|"error" } | null>(null);
  const closeToast = useCallback(() => setToast(null), []);

  // Company info
  const [companyName,  setCompanyName]  = useState("");
  const [buyerType,    setBuyerType]    = useState("RETAILER");
  const [regNumber,    setRegNumber]    = useState("");
  const [taxPin,       setTaxPin]       = useState("");
  const [country,      setCountry]      = useState("Kenya");
  const [region,       setRegion]       = useState("");
  const [website,      setWebsite]      = useState("");
  const [description,  setDescription]  = useState("");

  // Sourcing prefs
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [preferredRegions,   setPreferredRegions]   = useState("");

  // Notifications
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [smsNotifs,   setSmsNotifs]   = useState(true);

  // Password
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd,     setNewPwd]     = useState("");
  const [cfmPwd,     setCfmPwd]     = useState("");
  const [showPwd,    setShowPwd]    = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError,   setPwdError]   = useState<string | null>(null);

  useEffect(() => {
    authApi.me()
      .then((data: BuyerProfile) => {
        setProfile(data);
        const p = data.profile;
        if (p) {
          setCompanyName(p.company_name ?? "");
          setBuyerType(p.buyer_type ?? "RETAILER");
          setRegNumber(p.registration_number ?? "");
          setTaxPin(p.tax_pin ?? "");
          setCountry(p.country ?? "Kenya");
          setRegion(p.region ?? "");
          setWebsite(p.website ?? "");
          setDescription(p.description ?? "");
          setSelectedCategories(p.interested_categories ?? []);
          setPreferredRegions((p.preferred_regions ?? []).join(", "));
          setEmailNotifs(p.email_notifications ?? true);
          setSmsNotifs(p.sms_notifications ?? true);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSaveProfile = useCallback(async () => {
    setSaving(true);
    try {
      await authApi.updateMe({
        company_name:        companyName.trim(),
        buyer_type:          buyerType,
        registration_number: regNumber.trim(),
        tax_pin:             taxPin.trim(),
        country:             country.trim(),
        region:              region.trim(),
        website:             website.trim(),
        description:         description.trim(),
        interested_categories: selectedCategories,
        preferred_regions:   preferredRegions.split(",").map((r) => r.trim()).filter(Boolean),
      });
      setToast({ message: "Profile updated successfully.", type: "success" });
    } catch {
      setToast({ message: "Failed to update profile.", type: "error" });
    } finally {
      setSaving(false);
    }
  }, [companyName, buyerType, regNumber, taxPin, country, region, website, description, selectedCategories, preferredRegions]);

  const handleSaveNotifs = useCallback(async () => {
    setSaving(true);
    try {
      await authApi.updateMe({ email_notifications: emailNotifs, sms_notifications: smsNotifs });
      setToast({ message: "Notification preferences saved.", type: "success" });
    } catch {
      setToast({ message: "Failed to save preferences.", type: "error" });
    } finally {
      setSaving(false);
    }
  }, [emailNotifs, smsNotifs]);

  const handleChangePassword = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPwd !== cfmPwd) { setPwdError("Passwords do not match."); return; }
    if (newPwd.length < 8) { setPwdError("Password must be at least 8 characters."); return; }
    setPwdError(null);
    setPwdLoading(true);
    try {
      await authApi.changePassword(currentPwd, newPwd, cfmPwd);
      setCurrentPwd(""); setNewPwd(""); setCfmPwd("");
      setToast({ message: "Password changed successfully.", type: "success" });
    } catch (err: any) {
      setPwdError(err?.message ?? "Failed to change password.");
    } finally {
      setPwdLoading(false);
    }
  }, [currentPwd, newPwd, cfmPwd]);

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  if (loading) {
    return (
      <div className="max-w-3xl space-y-5">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 animate-pulse">
            <div className="h-5 w-40 bg-[var(--background-muted)] rounded mb-5" />
            <div className="grid grid-cols-2 gap-4">
              {Array.from({ length: 4 }, (_, j) => (
                <div key={j} className="space-y-2">
                  <div className="h-3 w-20 bg-[var(--background-muted)] rounded" />
                  <div className="h-10 bg-[var(--background-muted)] rounded-xl" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const initials = profile?.full_name
    ? profile.full_name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : (companyName?.[0]?.toUpperCase() ?? "B");

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">Buyer Profile</h2>
        <p className="text-sm text-[var(--foreground-muted)] mt-0.5">
          Manage your company information and sourcing preferences.
        </p>
      </div>

      {/* Company header card */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
          {/* Logo / Avatar */}
          <div className="relative group shrink-0">
            <div
              className="w-20 h-20 rounded-2xl bg-[var(--primary)] text-white
                         flex items-center justify-center text-2xl font-bold shadow-[var(--shadow-md)]"
            >
              {profile?.profile?.company_logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.profile.company_logo} alt="Logo" className="w-full h-full rounded-2xl object-cover" />
              ) : initials}
            </div>
            <button
              className="absolute inset-0 rounded-2xl bg-black/40 text-white flex items-center justify-center
                         opacity-0 group-hover:opacity-100 transition-opacity"
              title="Upload company logo"
            >
              <Camera className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 text-center sm:text-left">
            <h3 className="text-xl font-bold text-[var(--foreground)]">{companyName || profile?.full_name}</h3>
            <p className="text-sm text-[var(--foreground-muted)] mt-0.5">
              {BUYER_TYPES.find((t) => t.value === buyerType)?.label ?? buyerType}
            </p>
            <p className="text-sm text-[var(--foreground-muted)] mt-1 flex items-center justify-center sm:justify-start gap-1.5">
              <Mail className="w-3.5 h-3.5" />
              {profile?.email}
              {profile?.is_email_verified && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--success-light)] text-[var(--success)]">
                  Verified
                </span>
              )}
            </p>
          </div>

          {/* Stats */}
          <div className="flex gap-4 sm:flex-col sm:gap-2 text-center sm:text-right">
            <div>
              <p className="text-xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">
                {profile?.profile?.total_tenders ?? 0}
              </p>
              <p className="text-xs text-[var(--foreground-muted)]">Tenders</p>
            </div>
            <div>
              <p className="text-xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">
                {profile?.profile?.average_rating ?? "—"}
              </p>
              <p className="text-xs text-[var(--foreground-muted)]">Avg. Rating</p>
            </div>
          </div>
        </div>
      </div>

      {/* Company Info */}
      <Section title="Company Information" description="Update your business registration details." icon={Building2}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Company Name" id="companyName" value={companyName} onChange={setCompanyName} placeholder="Nairobi Fresh Markets Ltd" />
            <div className="space-y-1.5">
              <label htmlFor="buyerType" className="block text-sm font-medium text-[var(--foreground)]">Buyer Category</label>
              <select
                id="buyerType"
                value={buyerType}
                onChange={(e) => setBuyerType(e.target.value)}
                className="w-full h-11 px-4 rounded-xl border text-sm bg-[var(--input-bg)] text-[var(--input-text)]
                           border-[var(--input-border)] focus:border-[var(--input-border-focus)]
                           focus:ring-2 focus:ring-[var(--border-focus)] focus:outline-none"
              >
                {BUYER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Email Address" id="bEmail" type="email" value={profile?.email ?? ""} disabled hint="Cannot be changed" />
            <FormField label="Registration Number" id="regNum" value={regNumber} onChange={setRegNumber} placeholder="e.g. CPR/2019/000456" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="KRA PIN / Tax ID" id="taxPin" value={taxPin} onChange={setTaxPin} placeholder="e.g. A001234567Z" />
            <FormField label="Country" id="country" value={country} onChange={setCountry} placeholder="Kenya" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Region" id="region" value={region} onChange={setRegion} placeholder="e.g. Nairobi County" />
            <FormField label="Website" id="website" type="url" value={website} onChange={setWebsite} placeholder="https://yourcompany.co.ke" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="description" className="block text-sm font-medium text-[var(--foreground)]">Company Description</label>
            <textarea
              id="description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Briefly describe your company and sourcing needs…"
              className="w-full px-4 py-3 rounded-xl border text-sm resize-none
                         bg-[var(--input-bg)] text-[var(--input-text)] border-[var(--input-border)]
                         focus:border-[var(--input-border-focus)] focus:ring-2 focus:ring-[var(--border-focus)]
                         focus:outline-none placeholder:text-[var(--input-placeholder)]"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleSaveProfile} disabled={saving}
              className="flex items-center gap-2 px-5 h-10 rounded-xl text-sm font-semibold
                         bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)]
                         shadow-[var(--shadow-green)] disabled:opacity-50 transition-all duration-200"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Save changes
            </button>
          </div>
        </div>
      </Section>

      {/* Sourcing Preferences */}
      <Section title="Sourcing Preferences" description="Tell cooperatives what you're looking to source." icon={Tag}>
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-[var(--foreground)] mb-2">Interested categories</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150",
                    selectedCategories.includes(cat)
                      ? "bg-[var(--primary)] text-[var(--primary-fg)] border-[var(--primary)]"
                      : "bg-[var(--surface)] text-[var(--foreground-muted)] border-[var(--border)] hover:border-[var(--border-strong)]"
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
          <FormField
            label="Preferred Sourcing Regions"
            id="prefRegions"
            value={preferredRegions}
            onChange={setPreferredRegions}
            placeholder="e.g. Rift Valley, Central, Western"
            hint="Comma-separated list of regions where you prefer to source from."
          />
          <div className="flex justify-end">
            <button
              onClick={handleSaveProfile} disabled={saving}
              className="flex items-center gap-2 px-5 h-10 rounded-xl text-sm font-semibold
                         bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)]
                         shadow-[var(--shadow-green)] disabled:opacity-50 transition-all duration-200"
            >
              Save preferences
            </button>
          </div>
        </div>
      </Section>

      {/* Notifications */}
      <Section title="Notifications" description="Manage how ShambaFlow contacts you." icon={Bell}>
        <div className="space-y-4">
          {[
            { id: "emailNotifs", label: "Email Notifications (Brevo)", desc: "Tender updates, bid alerts, and system messages", value: emailNotifs, onChange: setEmailNotifs },
            { id: "smsNotifs",   label: "SMS Notifications (Infobip)", desc: "Critical alerts and OTP codes via SMS", value: smsNotifs, onChange: setSmsNotifs },
          ].map((pref) => (
            <div key={pref.id} className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">{pref.label}</p>
                <p className="text-xs text-[var(--foreground-muted)] mt-0.5">{pref.desc}</p>
              </div>
              <button
                onClick={() => pref.onChange(!pref.value)}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200",
                  pref.value ? "bg-[var(--primary)]" : "bg-[var(--border-strong)]"
                )}
                role="switch" aria-checked={pref.value}
              >
                <span className={cn(
                  "inline-block w-4 h-4 transform rounded-full bg-white shadow-sm transition-transform duration-200",
                  pref.value ? "translate-x-6" : "translate-x-1"
                )} />
              </button>
            </div>
          ))}
          <div className="flex justify-end">
            <button
              onClick={handleSaveNotifs} disabled={saving}
              className="flex items-center gap-2 px-5 h-10 rounded-xl text-sm font-semibold
                         bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)]
                         shadow-[var(--shadow-green)] disabled:opacity-50 transition-all duration-200"
            >
              Save preferences
            </button>
          </div>
        </div>
      </Section>

      {/* Change Password */}
      <Section title="Change Password" description="Keep your account secure with a strong password." icon={Shield}>
        <form onSubmit={handleChangePassword} className="space-y-4" noValidate>
          <AnimatedAlert
            show={Boolean(pwdError)}
            motionKey={pwdError ?? "pwd-error"}
            className="flex items-center gap-2 p-3 rounded-lg bg-[var(--destructive-light)] border border-red-200 dark:border-red-900/40 text-sm text-[var(--destructive)]"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            {pwdError ?? ""}
          </AnimatedAlert>
          {[
            { id: "curPwd", label: "Current Password",     value: currentPwd, onChange: setCurrentPwd, autoComplete: "current-password" },
            { id: "newPwd", label: "New Password",          value: newPwd,     onChange: setNewPwd,     autoComplete: "new-password" },
            { id: "cfmPwd", label: "Confirm New Password",  value: cfmPwd,     onChange: setCfmPwd,     autoComplete: "new-password" },
          ].map((f) => (
            <div key={f.id} className="space-y-1.5">
              <label htmlFor={f.id} className="block text-sm font-medium text-[var(--foreground)]">{f.label}</label>
              <div className="relative">
                <input
                  id={f.id} type={showPwd ? "text" : "password"} value={f.value}
                  onChange={(e) => f.onChange(e.target.value)} autoComplete={f.autoComplete} placeholder="••••••••"
                  className="w-full h-11 px-4 pr-11 rounded-xl border text-sm bg-[var(--input-bg)] text-[var(--input-text)]
                             border-[var(--input-border)] focus:border-[var(--input-border-focus)]
                             focus:ring-2 focus:ring-[var(--border-focus)] focus:outline-none"
                />
                <button type="button" onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--foreground-subtle)] hover:text-[var(--foreground-muted)] transition-colors">
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
          <div className="flex justify-end">
            <button type="submit" disabled={pwdLoading || !currentPwd || !newPwd || !cfmPwd}
              className="flex items-center gap-2 px-5 h-10 rounded-xl text-sm font-semibold
                         bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)]
                         shadow-[var(--shadow-green)] disabled:opacity-50 transition-all duration-200">
              {pwdLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Update password
            </button>
          </div>
        </form>
      </Section>

      <Toast toast={toast} onClose={closeToast} />
    </div>
  );
}
