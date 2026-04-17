"use client";

/**
 * CRM Profile Page — Cooperative Team
 *
 * Sections:
 * 1. Personal info (name, email, phone, bio, title, region)
 * 2. Cooperative info (read-only cooperative details)
 * 3. Notification preferences (email/SMS toggles)
 * 4. Security (change password)
 * 5. Profile photo upload
 *
 * Responsive: single-column on mobile, two-column on desktop.
 * All edits go to PATCH /api/auth/me/ via the authApi.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import {
  User, Mail, Phone, MapPin, Briefcase,
  Bell, Shield, Camera, Loader2, CheckCircle, AlertCircle,
  Eye, EyeOff, Building2,
} from "lucide-react";
import { authApi, saveUser } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AnimatedAlert } from "@/components/ui/animated-alert";

/* ─── Types ───────────────────────────────────────────────────────── */

interface UserProfile {
  id:               string;
  email:            string;
  first_name:       string;
  last_name:        string;
  full_name:        string;
  phone_number:     string;
  user_type:        string;
  helper_role?:     string | null;
  is_email_verified:boolean;
  is_phone_verified:boolean;
  profile?: {
    national_id?:         string;
    date_of_birth?:       string;
    gender?:              string;
    title?:               string;
    years_in_role?:       number;
    bio?:                 string;
    region?:              string;
    physical_address?:    string;
    alt_phone?:           string;
    email_notifications:  boolean;
    sms_notifications:    boolean;
    tender_alerts:        boolean;
    profile_photo?:       string | null;
  };
  cooperative?: {
    id?:                string;
    name:               string;
    registration_number:string;
    cooperative_type:   string;
    region:             string;
    is_verified:        boolean;
  };
}

function formatRoleLabel(role?: string | null) {
  if (!role) return "";
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getSystemRoleTitle(profile: UserProfile | null) {
  if (!profile) return "Team Member";
  if (profile.user_type === "CHAIR") return "Cooperative Chair";
  if (profile.user_type === "HELPER") {
    return formatRoleLabel(profile.helper_role) || "Cooperative Helper";
  }
  if (profile.user_type === "BUYER") return "Buyer";
  return "Team Member";
}

/* ─── Helper: Field Input ─────────────────────────────────────────── */

function FormField({
  label, id, type = "text", value, onChange, placeholder, disabled, hint, icon: Icon,
}: {
  label: string; id: string; type?: string; value: string;
  onChange?: (v: string) => void; placeholder?: string; disabled?: boolean;
  hint?: string; icon?: React.ElementType;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-[var(--foreground)]">
        {label}
      </label>
      <div className="relative">
        {Icon && (
          <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--foreground-subtle)]" />
        )}
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "w-full h-11 px-4 rounded-xl border text-sm transition-all duration-150",
            Icon && "pl-10",
            disabled
              ? "bg-[var(--background-muted)] text-[var(--foreground-muted)] cursor-default border-[var(--border)]"
              : "bg-[var(--input-bg)] text-[var(--input-text)] border-[var(--input-border)] focus:border-[var(--input-border-focus)] focus:ring-2 focus:ring-[var(--border-focus)] focus:outline-none",
          )}
        />
      </div>
      {hint && <p className="text-xs text-[var(--foreground-subtle)]">{hint}</p>}
    </div>
  );
}

/* ─── Section Card ────────────────────────────────────────────────── */

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

/* ─── Toast helper ────────────────────────────────────────────────── */

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
        "fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-[var(--shadow-xl)]",
        "border max-w-sm",
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

/* ─── Main Component ──────────────────────────────────────────────── */

export default function CRMProfilePage() {
  const params = useParams();
  const cooperativeId = params?.cooperative_id as string;

  const [profile, setProfile]   = useState<UserProfile | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);
  const [toast,   setToast]     = useState<{ message: string; type: "success"|"error" } | null>(null);
  const closeToast = useCallback(() => setToast(null), []);

  // Personal info fields
  const [firstName,  setFirstName]  = useState("");
  const [lastName,   setLastName]   = useState("");
  const [bio,        setBio]        = useState("");
  const [region,     setRegion]     = useState("");
  const [altPhone,   setAltPhone]   = useState("");

  // Notification prefs
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [smsNotifs,   setSmsNotifs]   = useState(true);
  const [tenderAlerts, setTenderAlerts] = useState(true);

  // Password change
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd,     setNewPwd]     = useState("");
  const [cfmPwd,     setCfmPwd]     = useState("");
  const [showPwd,    setShowPwd]    = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError,   setPwdError]   = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const applyProfileData = useCallback((data: UserProfile) => {
    setProfile(data);
    const [fn, ...rest] = (data.full_name ?? "").split(" ");
    setFirstName(data.first_name ?? fn ?? "");
    setLastName(data.last_name ?? rest.join(" ") ?? "");
    setBio(data.profile?.bio ?? "");
    setRegion(data.profile?.region?.trim() || data.cooperative?.region || "");
    setAltPhone(data.profile?.alt_phone ?? "");
    setEmailNotifs(data.profile?.email_notifications ?? true);
    setSmsNotifs(data.profile?.sms_notifications ?? true);
    setTenderAlerts(data.profile?.tender_alerts ?? true);
  }, []);

  const loadProfile = useCallback(async () => {
    const data = await authApi.me() as UserProfile;
    saveUser(data);
    applyProfileData(data);
  }, [applyProfileData]);

  // Load profile
  useEffect(() => {
    loadProfile()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [loadProfile]);

  // Save personal info
  const handleSaveProfile = useCallback(async () => {
    setSaving(true);
    try {
      await authApi.updateMe({
        first_name: firstName.trim(),
        last_name:  lastName.trim(),
        bio:        bio.trim(),
        region:     region.trim(),
        alt_phone:  altPhone.trim(),
      });
      await loadProfile();
      setToast({ message: "Profile updated successfully.", type: "success" });
    } catch {
      setToast({ message: "Failed to update profile. Please try again.", type: "error" });
    } finally {
      setSaving(false);
    }
  }, [firstName, lastName, bio, region, altPhone, loadProfile]);

  // Save notification prefs
  const handleSaveNotifs = useCallback(async () => {
    setSaving(true);
    try {
      await authApi.updateMe({
        email_notifications: emailNotifs,
        sms_notifications:   smsNotifs,
        tender_alerts:       tenderAlerts,
      });
      await loadProfile();
      setToast({ message: "Notification preferences saved.", type: "success" });
    } catch {
      setToast({ message: "Failed to save preferences.", type: "error" });
    } finally {
      setSaving(false);
    }
  }, [emailNotifs, smsNotifs, tenderAlerts, loadProfile]);

  const handlePhotoUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("profile_photo", file);

    setPhotoUploading(true);
    try {
      await authApi.updateMe(formData);
      await loadProfile();
      setToast({ message: "Profile photo updated successfully.", type: "success" });
    } catch {
      setToast({ message: "Failed to upload profile photo.", type: "error" });
    } finally {
      setPhotoUploading(false);
      event.target.value = "";
    }
  }, [loadProfile]);

  // Change password
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

  if (loading) {
    return (
      <div className="space-y-5">
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

  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "U";
  const roleTitle = getSystemRoleTitle(profile);

  return (
    <div className="max-w-3xl space-y-6">
      {/* ── Page header ──────────────────────────────── */}
      <div>
        <h2 className="text-2xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">My Profile</h2>
        <p className="text-sm text-[var(--foreground-muted)] mt-0.5">
          Manage your account details and preferences.
        </p>
      </div>

      {/* ── Avatar + name card ───────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
          {/* Avatar */}
          <div className="relative group shrink-0">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoUpload}
            />
            <div
              className="w-20 h-20 rounded-2xl bg-[var(--primary)] text-white
                         flex items-center justify-center text-2xl font-bold
                         shadow-[var(--shadow-md)]"
            >
              {profile?.profile?.profile_photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.profile.profile_photo}
                  alt="Profile"
                  className="w-full h-full rounded-2xl object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              disabled={photoUploading}
              className="absolute inset-0 rounded-2xl bg-black/40 text-white
                         flex items-center justify-center opacity-0 group-hover:opacity-100
                         transition-opacity cursor-pointer disabled:cursor-not-allowed"
              title="Change photo"
            >
              {photoUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
            </button>
          </div>

          {/* Info */}
          <div className="flex-1 text-center sm:text-left">
            <h3 className="text-xl font-bold text-[var(--foreground)]">
              {firstName} {lastName}
            </h3>
            <p className="text-sm text-[var(--foreground-muted)] mt-0.5 flex items-center justify-center sm:justify-start gap-1.5">
              <Briefcase className="w-3.5 h-3.5" />
              {roleTitle} · {profile?.cooperative?.name}
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

          {/* Cooperative badge */}
          {profile?.cooperative?.is_verified && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--success-light)] border border-green-200 dark:border-green-900/40">
              <CheckCircle className="w-3.5 h-3.5 text-[var(--success)]" />
              <span className="text-xs font-semibold text-[var(--success)]">Verified</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Personal Information ─────────────────────── */}
      <Section title="Personal Information" description="Update your name, bio, and contact details." icon={User}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="First Name" id="firstName" value={firstName} onChange={setFirstName} placeholder="Jane" />
            <FormField label="Last Name" id="lastName" value={lastName} onChange={setLastName} placeholder="Wanjiru" />
          </div>
          <FormField
            label="Email Address" id="email" type="email"
            value={profile?.email ?? ""} disabled
            hint="Email address cannot be changed. Contact support if needed."
            icon={Mail}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              label="Role / Title"
              id="title"
              value={roleTitle}
              disabled
              hint="This is set automatically from your account role."
              icon={Briefcase}
            />
            <FormField label="Region" id="region" value={region} onChange={setRegion} placeholder="e.g. Nyandarua County" icon={MapPin} />
          </div>
          <FormField label="Alternate Phone" id="altPhone" value={altPhone} onChange={setAltPhone} placeholder="+254712345678" type="tel" icon={Phone} />
          <div className="space-y-1.5">
            <label htmlFor="bio" className="block text-sm font-medium text-[var(--foreground)]">
              Bio
            </label>
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Brief description of your role and experience…"
              rows={3}
              className="w-full px-4 py-3 rounded-xl border text-sm resize-none
                         bg-[var(--input-bg)] text-[var(--input-text)]
                         border-[var(--input-border)] focus:border-[var(--input-border-focus)]
                         focus:ring-2 focus:ring-[var(--border-focus)] focus:outline-none
                         placeholder:text-[var(--input-placeholder)]"
            />
          </div>
          <div className="flex justify-end pt-2">
            <button
              onClick={handleSaveProfile}
              disabled={saving}
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

      {/* ── Cooperative Details (read-only) ──────────── */}
      {profile?.cooperative && (
        <Section title="Cooperative Details" description="Your cooperative registration information." icon={Building2}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Cooperative Name"    id="coopName"   value={profile.cooperative.name}                disabled />
            <FormField label="Registration Number" id="regNo"      value={profile.cooperative.registration_number} disabled />
            <FormField label="Type"                id="coopType"   value={profile.cooperative.cooperative_type}     disabled />
            <FormField label="Region"              id="coopRegion" value={profile.cooperative.region}               disabled />
          </div>
          <p className="text-xs text-[var(--foreground-subtle)] mt-3">
            To update cooperative details, go to{" "}
            <a href={`/crm/${cooperativeId}/settings`} className="text-[var(--primary)] hover:underline">
              Cooperative Settings
            </a>.
          </p>
        </Section>
      )}

      {/* ── Notification Preferences ─────────────────── */}
      <Section title="Notifications" description="Choose how you'd like to be notified." icon={Bell}>
        <div className="space-y-4">
          {[
            { id: "emailNotifs", label: "Email Notifications", desc: "Receive updates via email (Brevo)", value: emailNotifs, onChange: setEmailNotifs },
            { id: "smsNotifs",   label: "SMS Notifications",   desc: "Receive critical alerts via SMS (Infobip)", value: smsNotifs, onChange: setSmsNotifs },
            { id: "tenderAlerts", label: "Tender Alerts",      desc: "Get notified when new matching tenders are posted", value: tenderAlerts, onChange: setTenderAlerts },
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
                role="switch"
                aria-checked={pref.value}
              >
                <span
                  className={cn(
                    "inline-block w-4 h-4 transform rounded-full bg-white shadow-sm transition-transform duration-200",
                    pref.value ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button>
            </div>
          ))}
          <div className="flex justify-end pt-2">
            <button
              onClick={handleSaveNotifs}
              disabled={saving}
              className="flex items-center gap-2 px-5 h-10 rounded-xl text-sm font-semibold
                         bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)]
                         shadow-[var(--shadow-green)] disabled:opacity-50 transition-all duration-200"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save preferences
            </button>
          </div>
        </div>
      </Section>

      {/* ── Change Password ───────────────────────────── */}
      <Section title="Change Password" description="Use a strong password to keep your account secure." icon={Shield}>
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
            { id: "curPwd", label: "Current Password",  value: currentPwd, onChange: setCurrentPwd, autoComplete: "current-password" },
            { id: "newPwd", label: "New Password",       value: newPwd,     onChange: setNewPwd,     autoComplete: "new-password" },
            { id: "cfmPwd", label: "Confirm New Password", value: cfmPwd,   onChange: setCfmPwd,     autoComplete: "new-password" },
          ].map((f) => (
            <div key={f.id} className="space-y-1.5">
              <label htmlFor={f.id} className="block text-sm font-medium text-[var(--foreground)]">
                {f.label}
              </label>
              <div className="relative">
                <input
                  id={f.id}
                  type={showPwd ? "text" : "password"}
                  value={f.value}
                  onChange={(e) => f.onChange(e.target.value)}
                  autoComplete={f.autoComplete}
                  placeholder="••••••••"
                  className="w-full h-11 px-4 pr-11 rounded-xl border text-sm
                             bg-[var(--input-bg)] text-[var(--input-text)]
                             border-[var(--input-border)] focus:border-[var(--input-border-focus)]
                             focus:ring-2 focus:ring-[var(--border-focus)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--foreground-subtle)] hover:text-[var(--foreground-muted)] transition-colors"
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={pwdLoading || !currentPwd || !newPwd || !cfmPwd}
              className="flex items-center gap-2 px-5 h-10 rounded-xl text-sm font-semibold
                         bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)]
                         shadow-[var(--shadow-green)] disabled:opacity-50 transition-all duration-200"
            >
              {pwdLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Update password
            </button>
          </div>
        </form>
      </Section>

      {/* Toast */}
      <Toast toast={toast} onClose={closeToast} />
    </div>
  );
}
