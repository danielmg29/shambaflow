"use client";

/**
 * ShambaFlow – CRM Settings Page  (fixed)
 * =========================================
 * Route: /crm/[cooperative_id]/settings
 *
 * Bugs fixed:
 *   BUG-7  All apiFetch() calls were missing the /api/ prefix.
 *          e.g. /settings/... → /api/settings/...
 *
 *   BUG-8  isChair check used r.cooperative_id (flat field) but the
 *          /api/auth/me/ response returns { cooperative: { id: … } }.
 *          Fixed to r.cooperative?.id === cooperativeId.
 *
 *   BUG-9  Tabs 2, 3, 4 contained only placeholder comments.
 *          Full implementations written for:
 *            VerificationDocumentsTab
 *            NotificationsTab
 *            RoleManagementTab
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, FileCheck, Bell, Users, ShieldCheck,
  Upload, Trash2, Plus, ChevronDown, Check, X,
  AlertCircle, Send, Eye, Save, Loader2,
  BadgeCheck, Clock, FileText,
} from "lucide-react";
import { apiFetch, authApi } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CooperativeProfile {
  id: string;
  name: string;
  registration_number: string;
  type: string;
  type_display: string;
  region: string;
  county: string;
  description: string;
  website: string;
  physical_address: string;
  verification_status: string;
  verification_status_display: string;
  created_at: string;
  updated_at: string;
  chair: { id: string; name: string; email: string } | null;
  total_members: number;
}

interface NotificationPreferences {
  email_invitations: boolean;
  email_tender_updates: boolean;
  email_verification_alerts: boolean;
  email_system_announcements: boolean;
  sms_invitations: boolean;
  sms_otp: boolean;
  sms_tender_updates: boolean;
  sms_critical_alerts: boolean;
}

interface ModulePermission {
  module: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_edit_templates: boolean;
}

interface HelperAccount {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  role: string;
  user_type: string;
  is_active: boolean;
  date_joined: string;
  last_login: string | null;
  permissions: ModulePermission[];
}

interface VerificationDocument {
  id: string;
  document_type: string;
  document_type_display: string;
  file_url: string | null;
  file_name: string;
  uploaded_at: string;
  status: string;
  status_display: string;
  notes: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TABS = [
  { id: "profile",       label: "Cooperative Profile",    icon: Building2   },
  { id: "verification",  label: "Verification Docs",      icon: FileCheck   },
  { id: "notifications", label: "Notifications",          icon: Bell        },
  { id: "roles",         label: "Role Management",        icon: Users       },
  { id: "templates",     label: "Template Permissions",   icon: ShieldCheck },
] as const;
type TabId = (typeof TABS)[number]["id"];

const ROLES = [
  { value: "MANAGER",           label: "Manager"           },
  { value: "TREASURER",         label: "Treasurer"         },
  { value: "CLERK",             label: "Clerk"             },
  { value: "DATA_OFFICER",      label: "Data Officer"      },
  { value: "EXTENSION_OFFICER", label: "Extension Officer" },
];

const MODULES = [
  { value: "MEMBERS",      label: "Members"      },
  { value: "PRODUCTION",   label: "Production"   },
  { value: "LIVESTOCK",    label: "Livestock"    },
  { value: "GOVERNANCE",   label: "Governance"   },
  { value: "FINANCE",      label: "Finance"      },
  { value: "FORM_BUILDER", label: "Form Builder" },
];

const DOCUMENT_TYPES = [
  { value: "REGISTRATION_CERTIFICATE", label: "Registration Certificate" },
  { value: "TAX_COMPLIANCE",           label: "Tax Compliance Certificate" },
  { value: "AUDITED_ACCOUNTS",         label: "Audited Accounts" },
  { value: "CONSTITUTION",             label: "Cooperative Constitution" },
  { value: "MINUTES_AGM",              label: "AGM Minutes" },
  { value: "OTHER",                    label: "Other Document" },
];

const STATUS_STYLES: Record<string, string> = {
  PENDING:  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  VERIFIED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  APPROVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed";
const INPUT_TEXTAREA_CLASS = `${INPUT_CLASS} resize-none`;
const DISABLED_INPUT_CLASS =
  "w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground cursor-not-allowed";
const SECONDARY_PANEL_CLASS = "rounded-xl border border-border bg-muted/30 px-5 py-4";
const READONLY_PANEL_CLASS = "rounded-xl border border-dashed border-border bg-muted/20 p-5 space-y-4";
const CARD_CLASS = "rounded-xl border border-border bg-card";
const ROW_CLASS =
  "flex items-center justify-between rounded-xl border border-border bg-card px-5 py-4 transition hover:border-primary/30";
const BUTTON_PRIMARY_CLASS =
  "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60";
const BUTTON_SECONDARY_CLASS =
  "inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted";
const BUTTON_GHOST_CLASS =
  "rounded-lg px-4 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground";
const ICON_TILE_CLASS =
  "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground";
const AVATAR_TILE_CLASS =
  "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground";
const BADGE_CLASS = "rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground";
const SECTION_PANEL_CLASS = "rounded-xl border border-border bg-card p-5 space-y-4";
const EMPTY_STATE_CLASS =
  "flex flex-col items-center justify-center py-16 text-center text-muted-foreground";

// ── Shared sub-components ──────────────────────────────────────────────────────

function Toast({
  message, type, onClose,
}: { message: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-5 py-4 shadow-2xl
        ${type === "success" ? "bg-emerald-600" : "bg-red-600"} text-white`}
    >
      {type === "success" ? <Check size={18} /> : <AlertCircle size={18} />}
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100"><X size={16} /></button>
    </motion.div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function SettingsFormField({
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: "text" | "url" | "textarea";
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-foreground">{label}</label>
      {type === "textarea" ? (
        <textarea
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className={INPUT_TEXTAREA_CLASS}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className={INPUT_CLASS}
        />
      )}
    </div>
  );
}

function Toggle({ checked, onChange, disabled = false }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200
        ${checked ? "bg-primary" : "bg-border"}
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-background shadow-sm transition-transform duration-200
        ${checked ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const style = STATUS_STYLES[status] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${style}`}>
      {(status === "VERIFIED" || status === "APPROVED") && <BadgeCheck size={12} />}
      {status === "PENDING" && <Clock size={12} />}
      {status === "REJECTED" && <X size={12} />}
      {label}
    </span>
  );
}

function SaveButton({ saving, onClick, label = "Save Changes" }: {
  saving: boolean; onClick: () => void; label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
    >
      {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
      {saving ? "Saving…" : label}
    </button>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="animate-spin text-primary" size={32} />
    </div>
  );
}

// ── Tab 1: Cooperative Profile ─────────────────────────────────────────────────

function CooperativeProfileTab({ cooperativeId, isChair, onToast }: {
  cooperativeId: string; isChair: boolean;
  onToast: (msg: string, type: "success" | "error") => void;
}) {
  const [profile, setProfile] = useState<CooperativeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<CooperativeProfile>>({});

  useEffect(() => {
    // BUG-7 FIX: /api/settings/… not /settings/…
    apiFetch<CooperativeProfile>(`/api/settings/cooperative/${cooperativeId}/`)
      .then((r) => {
        setProfile(r);
        setForm({
          name: r.name, region: r.region, county: r.county,
          description: r.description, website: r.website,
          physical_address: r.physical_address,
        });
      })
      .catch(() => onToast("Failed to load cooperative profile.", "error"))
      .finally(() => setLoading(false));
  }, [cooperativeId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // BUG-7 FIX
      await apiFetch(`/api/settings/cooperative/${cooperativeId}/`, { method: "PUT", body: form });
      onToast("Cooperative profile updated.", "success");
      setProfile((p) => (p ? { ...p, ...form } : p));
    } catch (e: any) {
      onToast(e?.message ?? "Failed to save.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-8">
      <SectionHeader title="Cooperative Profile" subtitle="Manage your cooperative's identity and operational details." />

      <div className={SECONDARY_PANEL_CLASS}>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Verification Status</p>
          <StatusBadge
            status={profile?.verification_status ?? "PENDING"}
            label={profile?.verification_status_display ?? "Pending"}
          />
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Members</p>
          <p className="text-2xl font-bold text-foreground">{profile?.total_members ?? 0}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <SettingsFormField
          label="Cooperative Name"
          value={(form.name as string) ?? ""}
          onChange={(value) => setForm((f) => ({ ...f, name: value }))}
          disabled={!isChair}
          placeholder="e.g. Meru Coffee Farmers Cooperative"
        />
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-foreground">Type</label>
          <input
            value={profile?.type_display ?? ""}
            disabled
            className={DISABLED_INPUT_CLASS}
          />
          <p className="text-xs text-muted-foreground">Cooperative type cannot be changed after registration.</p>
        </div>
        <SettingsFormField
          label="Region"
          value={(form.region as string) ?? ""}
          onChange={(value) => setForm((f) => ({ ...f, region: value }))}
          disabled={!isChair}
          placeholder="e.g. Central"
        />
        <SettingsFormField
          label="County"
          value={(form.county as string) ?? ""}
          onChange={(value) => setForm((f) => ({ ...f, county: value }))}
          disabled={!isChair}
          placeholder="e.g. Kirinyaga"
        />
        <SettingsFormField
          label="Physical Address"
          value={(form.physical_address as string) ?? ""}
          onChange={(value) => setForm((f) => ({ ...f, physical_address: value }))}
          disabled={!isChair}
          placeholder="e.g. Kerugoya Town"
        />
        <SettingsFormField
          label="Website"
          type="url"
          value={(form.website as string) ?? ""}
          onChange={(value) => setForm((f) => ({ ...f, website: value }))}
          disabled={!isChair}
          placeholder="https://yourcooperative.co.ke"
        />
      </div>

      <SettingsFormField
        label="Description"
        type="textarea"
        value={(form.description as string) ?? ""}
        onChange={(value) => setForm((f) => ({ ...f, description: value }))}
        disabled={!isChair}
        placeholder="Brief description of your cooperative and activities."
      />

      <div className={READONLY_PANEL_CLASS}>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Registration Details (Read-only)</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Registration Number</p>
            <p className="text-sm font-medium text-foreground">{profile?.registration_number ?? "—"}</p>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Chair</p>
            <p className="text-sm font-medium text-foreground">
              {profile?.chair ? `${profile.chair.name} (${profile.chair.email})` : "—"}
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Registered</p>
            <p className="text-sm font-medium text-foreground">
              {profile?.created_at
                ? new Date(profile.created_at).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })
                : "—"}
            </p>
          </div>
        </div>
      </div>

      {isChair && (
        <div className="flex justify-end">
          <SaveButton saving={saving} onClick={handleSave} />
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Verification Documents ─────────────────────────────────────────────

function VerificationDocumentsTab({ cooperativeId, isChair, onToast }: {
  cooperativeId: string; isChair: boolean;
  onToast: (msg: string, type: "success" | "error") => void;
}) {
  const [docs, setDocs] = useState<VerificationDocument[]>([]);
  const [verifStatus, setVerifStatus] = useState("PENDING");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    document_type: "REGISTRATION_CERTIFICATE", notes: "", file: null as File | null,
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchDocs = useCallback(() => {
    // BUG-7 FIX: /api/settings/…
    apiFetch<{ documents: VerificationDocument[]; verification_status: string }>(
      `/api/settings/cooperative/${cooperativeId}/verification/`
    )
      .then((r) => { setDocs(r.documents); setVerifStatus(r.verification_status); })
      .catch(() => onToast("Failed to load verification documents.", "error"))
      .finally(() => setLoading(false));
  }, [cooperativeId]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const handleUpload = async () => {
    if (!uploadForm.file) { onToast("Please select a file.", "error"); return; }
    setUploading(true);
    const fd = new FormData();
    fd.append("file", uploadForm.file);
    fd.append("document_type", uploadForm.document_type);
    fd.append("notes", uploadForm.notes);
    try {
      // BUG-7 FIX: /api/settings/…
      await apiFetch(`/api/settings/cooperative/${cooperativeId}/verification/`, { method: "POST", body: fd });
      onToast("Document uploaded successfully.", "success");
      setShowUpload(false);
      setUploadForm({ document_type: "REGISTRATION_CERTIFICATE", notes: "", file: null });
      fetchDocs();
    } catch (e: any) {
      onToast(e?.message ?? "Upload failed.", "error");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm("Delete this document?")) return;
    try {
      // BUG-7 FIX: /api/settings/…
      await apiFetch(`/api/settings/cooperative/${cooperativeId}/verification/${docId}/`, { method: "DELETE" });
      onToast("Document deleted.", "success");
      setDocs((d) => d.filter((doc) => doc.id !== docId));
    } catch { onToast("Failed to delete document.", "error"); }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionHeader title="Verification Documents" subtitle="Upload documents required for cooperative verification." />
        {isChair && (
          <button
            onClick={() => setShowUpload(!showUpload)}
            className={BUTTON_SECONDARY_CLASS}
          >
            <Upload size={16} /> Upload Document
          </button>
        )}
      </div>

      <div className={SECONDARY_PANEL_CLASS}>
        <StatusBadge status={verifStatus} label={verifStatus} />
        <p className="text-sm text-muted-foreground">
          {verifStatus === "VERIFIED"
            ? "Your cooperative is verified and eligible for premium tenders."
            : verifStatus === "PENDING"
            ? "Documents under review. Verification typically takes 2–5 business days."
            : "Some documents were rejected. Please re-upload the required files."}
        </p>
      </div>

      <AnimatePresence>
        {showUpload && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className={SECTION_PANEL_CLASS}>
              <p className="text-sm font-semibold text-foreground">Upload New Document</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-foreground">Document Type</label>
                  <select
                    value={uploadForm.document_type}
                    onChange={(e) => setUploadForm((f) => ({ ...f, document_type: e.target.value }))}
                    className={INPUT_CLASS}
                  >
                    {DOCUMENT_TYPES.map((dt) => (
                      <option key={dt.value} value={dt.value}>{dt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-foreground">File</label>
                  <div
                    onClick={() => fileRef.current?.click()}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border bg-background px-4 py-3 transition hover:border-primary/40 hover:bg-muted/40"
                  >
                    <FileText size={20} className="flex-shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm text-muted-foreground">
                      {uploadForm.file ? uploadForm.file.name : "Click to select (PDF, DOC, JPG, PNG — max 10MB)"}
                    </span>
                    <input
                      ref={fileRef} type="file" className="hidden"
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                      onChange={(e) => setUploadForm((f) => ({ ...f, file: e.target.files?.[0] ?? null }))}
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">Notes (optional)</label>
                <input
                  type="text"
                  value={uploadForm.notes}
                  onChange={(e) => setUploadForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Any context for reviewers"
                  className={INPUT_CLASS}
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleUpload} disabled={uploading}
                  className={BUTTON_PRIMARY_CLASS}
                >
                  {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                  {uploading ? "Uploading…" : "Upload"}
                </button>
                <button
                  onClick={() => setShowUpload(false)}
                  className={BUTTON_GHOST_CLASS}
                >Cancel</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {docs.length === 0 ? (
        <div className={EMPTY_STATE_CLASS}>
          <FileCheck size={40} className="mb-3" />
          <p className="font-medium">No documents uploaded yet.</p>
          <p className="text-sm mt-1">Upload registration documents to start the verification process.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {docs.map((doc) => (
            <motion.div key={doc.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className={`${ROW_CLASS} group`}
            >
              <div className="flex items-center gap-4">
                <div className={ICON_TILE_CLASS}>
                  <FileText size={20} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{doc.document_type_display}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{doc.file_name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(doc.uploaded_at).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={doc.status} label={doc.status_display} />
                {doc.file_url && (
                  <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                    className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  ><Eye size={16} /></a>
                )}
                {isChair && doc.status !== "VERIFIED" && (
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="rounded-lg p-2 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-muted hover:text-destructive"
                  ><Trash2 size={16} /></button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab 3: Notifications ───────────────────────────────────────────────────────

function NotificationsTab({ cooperativeId, onToast }: {
  cooperativeId: string; onToast: (msg: string, type: "success" | "error") => void;
}) {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // BUG-7 FIX: /api/settings/…
    apiFetch<NotificationPreferences>(`/api/settings/cooperative/${cooperativeId}/notifications/`)
      .then(setPrefs)
      .catch(() => onToast("Failed to load notification preferences.", "error"))
      .finally(() => setLoading(false));
  }, [cooperativeId]);

  const handleToggle = (key: keyof NotificationPreferences) =>
    setPrefs((p) => (p ? { ...p, [key]: !p[key] } : p));

  const handleSave = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      // BUG-7 FIX: /api/settings/…
      await apiFetch(`/api/settings/cooperative/${cooperativeId}/notifications/`, { method: "PUT", body: prefs });
      onToast("Notification preferences saved.", "success");
    } catch { onToast("Failed to save preferences.", "error"); }
    finally { setSaving(false); }
  };

  if (loading || !prefs) return <Spinner />;

  const groups = [
    {
      label: "Email Notifications", icon: "📧",
      items: [
        { key: "email_invitations" as const,           label: "Team Invitations",      desc: "When someone is invited to your cooperative" },
        { key: "email_tender_updates" as const,         label: "Tender Updates",         desc: "Bid responses, tender closures, and awards" },
        { key: "email_verification_alerts" as const,    label: "Verification Alerts",    desc: "Status changes on your verification documents" },
        { key: "email_system_announcements" as const,   label: "System Announcements",   desc: "Platform updates and important notices" },
      ],
    },
    {
      label: "SMS Notifications", icon: "💬",
      items: [
        { key: "sms_invitations" as const,   label: "Team Invitations", desc: "SMS link for team account invitations" },
        { key: "sms_otp" as const,           label: "OTP / Auth",       desc: "One-time passwords for login verification" },
        { key: "sms_tender_updates" as const, label: "Tender Updates",  desc: "Critical tender alerts via SMS" },
        { key: "sms_critical_alerts" as const, label: "Critical Alerts", desc: "Urgent system or account alerts" },
      ],
    },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader title="Notification Preferences" subtitle="Control how ShambaFlow communicates with you. These settings apply to your account." />
      {groups.map((group) => (
        <div key={group.label} className="space-y-3">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">{group.icon}</span>
            <h3 className="text-base font-semibold text-foreground">{group.label}</h3>
          </div>
          <div className="space-y-2">
            {group.items.map(({ key, label, desc }) => (
              <div
                key={`${group.label}-${key}`}
                className={ROW_CLASS}
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
                </div>
                <Toggle checked={prefs[key]} onChange={() => handleToggle(key)} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="flex justify-end">
        <SaveButton saving={saving} onClick={handleSave} label="Save Preferences" />
      </div>
    </div>
  );
}

// ── Tab 4: Role Management ─────────────────────────────────────────────────────

function RoleManagementTab({ cooperativeId, isChair, onToast }: {
  cooperativeId: string; isChair: boolean;
  onToast: (msg: string, type: "success" | "error") => void;
}) {
  const [helpers, setHelpers] = useState<HelperAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [inviteForm, setInviteForm] = useState({ first_name: "", last_name: "", email: "", phone_number: "", role: "CLERK" });
  const [inviting, setInviting] = useState(false);
  const [savingPerms, setSavingPerms] = useState<string | null>(null);
  const [pendingPerms, setPendingPerms] = useState<Record<string, HelperAccount>>({});

  const fetchHelpers = useCallback(() => {
    // BUG-7 FIX: /api/settings/…
    apiFetch<{ helpers: HelperAccount[] }>(`/api/settings/cooperative/${cooperativeId}/roles/`)
      .then((r) => setHelpers(r.helpers))
      .catch(() => onToast("Failed to load team members.", "error"))
      .finally(() => setLoading(false));
  }, [cooperativeId]);

  useEffect(() => { fetchHelpers(); }, [fetchHelpers]);

  const handleInvite = async () => {
    const missing = (["first_name", "last_name", "email", "role"] as const).filter((k) => !inviteForm[k]);
    if (missing.length) { onToast(`Please fill: ${missing.join(", ")}`, "error"); return; }
    setInviting(true);
    try {
      // BUG-7 FIX: /api/settings/…
      await apiFetch(`/api/settings/cooperative/${cooperativeId}/roles/`, { method: "POST", body: inviteForm });
      onToast("Invitation sent successfully.", "success");
      setShowInvite(false);
      setInviteForm({ first_name: "", last_name: "", email: "", phone_number: "", role: "CLERK" });
      fetchHelpers();
    } catch (e: any) { onToast(e?.message ?? "Failed to send invitation.", "error"); }
    finally { setInviting(false); }
  };

  const handleRemove = async (userId: string, name: string) => {
    if (!confirm(`Remove ${name} from this cooperative?`)) return;
    try {
      // BUG-7 FIX: /api/settings/…
      await apiFetch(`/api/settings/cooperative/${cooperativeId}/roles/${userId}/`, { method: "DELETE" });
      onToast(`${name} removed.`, "success");
      setHelpers((h) => h.filter((u) => u.id !== userId));
    } catch { onToast("Failed to remove team member.", "error"); }
  };

  const handlePermChange = (userId: string, module: string, field: string, value: boolean) => {
    setPendingPerms((prev) => {
      const user = prev[userId] ?? helpers.find((h) => h.id === userId)!;
      const perms = user.permissions.map((p) => p.module === module ? { ...p, [field]: value } : p);
      return { ...prev, [userId]: { ...user, permissions: perms } };
    });
  };

  const getPermissions = (userId: string) =>
    pendingPerms[userId]?.permissions ?? helpers.find((h) => h.id === userId)?.permissions ?? [];

  const handleSavePerms = async (userId: string) => {
    const user = pendingPerms[userId];
    if (!user) return;
    setSavingPerms(userId);
    try {
      const permMap: Record<string, object> = {};
      user.permissions.forEach((p) => { permMap[p.module] = p; });
      // BUG-7 FIX: /api/settings/…
      await apiFetch(`/api/settings/cooperative/${cooperativeId}/roles/${userId}/`, {
        method: "PUT", body: { permissions: permMap },
      });
      onToast("Permissions updated.", "success");
      setHelpers((h) => h.map((u) => (u.id === userId ? user : u)));
      setPendingPerms((prev) => { const n = { ...prev }; delete n[userId]; return n; });
    } catch { onToast("Failed to save permissions.", "error"); }
    finally { setSavingPerms(null); }
  };

  if (loading) return <Spinner />;

  const PERM_FIELDS = [
    { key: "can_view",   label: "View"   },
    { key: "can_create", label: "Create" },
    { key: "can_edit",   label: "Edit"   },
    { key: "can_delete", label: "Delete" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionHeader title="Role Management" subtitle="Manage your cooperative team accounts and module access." />
        {isChair && (
          <button
            onClick={() => setShowInvite(!showInvite)}
            className={BUTTON_PRIMARY_CLASS}
          >
            <Plus size={16} /> Invite Member
          </button>
        )}
      </div>

      <AnimatePresence>
        {showInvite && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className={SECTION_PANEL_CLASS}>
              <p className="text-sm font-semibold text-foreground">Invite Team Member</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(["first_name", "last_name", "email", "phone_number"] as const).map((key) => (
                  <div key={key} className="space-y-1.5">
                    <label className="block text-sm font-medium text-foreground">
                      {key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                      {key === "phone_number" && " (optional)"}
                    </label>
                    <input
                      type={key === "email" ? "email" : "text"}
                      value={inviteForm[key]}
                      onChange={(e) => setInviteForm((f) => ({ ...f, [key]: e.target.value }))}
                      className={INPUT_CLASS}
                    />
                  </div>
                ))}
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-foreground">Role</label>
                  <select
                    value={inviteForm.role}
                    onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value }))}
                    className={INPUT_CLASS}
                  >
                    {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleInvite} disabled={inviting}
                  className={BUTTON_PRIMARY_CLASS}
                >
                  {inviting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  {inviting ? "Sending…" : "Send Invitation"}
                </button>
                <button onClick={() => setShowInvite(false)}
                  className={BUTTON_GHOST_CLASS}>
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {helpers.length === 0 ? (
        <div className={EMPTY_STATE_CLASS}>
          <Users size={40} className="mb-3" />
          <p className="font-medium">No team members yet.</p>
          <p className="text-sm mt-1">Invite a Manager, Treasurer, or other role to collaborate.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {helpers.map((helper) => {
            const name = `${helper.first_name} ${helper.last_name}`.trim();
            const isExpanded = expandedUser === helper.id;
            const hasPending = !!pendingPerms[helper.id];
            return (
              <div key={helper.id} className={`${CARD_CLASS} overflow-hidden`}>
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-4">
                    <div className={AVATAR_TILE_CLASS}>
                      <span className="text-sm font-bold">
                        {(helper.first_name[0] ?? "") + (helper.last_name[0] ?? "")}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{name}</p>
                      <p className="text-xs text-muted-foreground">{helper.email}</p>
                    </div>
                    <span className={BADGE_CLASS}>
                      {ROLES.find((r) => r.value === helper.role)?.label ?? helper.role}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasPending && (
                      <button
                        onClick={() => handleSavePerms(helper.id)}
                        disabled={savingPerms === helper.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
                      >
                        {savingPerms === helper.id ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                        Save
                      </button>
                    )}
                    {isChair && (
                      <button onClick={() => handleRemove(helper.id, name)}
                        className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-destructive">
                        <Trash2 size={15} />
                      </button>
                    )}
                    <button onClick={() => setExpandedUser(isExpanded ? null : helper.id)}
                      className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground">
                      <ChevronDown size={16} className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden border-t border-border"
                    >
                      <div className="px-5 py-4 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr>
                              <th className="py-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Module</th>
                              {PERM_FIELDS.map((f) => (
                                <th key={f.key} className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">{f.label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {MODULES.map((mod) => {
                              const perm = getPermissions(helper.id).find((p) => p.module === mod.value);
                              return (
                                <tr key={mod.value}>
                                  <td className="py-2.5 pr-4 font-medium text-foreground">{mod.label}</td>
                                  {PERM_FIELDS.map((f) => (
                                    <td key={f.key} className="py-2.5 px-3 text-center">
                                      <Toggle
                                        checked={!!(perm as any)?.[f.key]}
                                        onChange={(v) => handlePermChange(helper.id, mod.value, f.key, v)}
                                        disabled={!isChair}
                                      />
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Tab 5: Template Permissions ────────────────────────────────────────────────

function TemplatePermissionsTab({ cooperativeId, isChair, onToast }: {
  cooperativeId: string; isChair: boolean;
  onToast: (msg: string, type: "success" | "error") => void;
}) {
  const [helpers, setHelpers] = useState<{ user_id: string; name: string; email: string; role: string; can_edit_templates: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // BUG-7 FIX: /api/settings/…
    apiFetch<{ all_helpers: typeof helpers }>(`/api/settings/cooperative/${cooperativeId}/template-permissions/`)
      .then((r) => setHelpers(r.all_helpers))
      .catch(() => onToast("Failed to load template permissions.", "error"))
      .finally(() => setLoading(false));
  }, [cooperativeId]);

  const getCanEdit = (userId: string, def: boolean) => (userId in pending ? pending[userId] : def);

  const handleSave = async () => {
    setSaving(true);
    const userPermissions = helpers.map((h) => ({
      user_id: h.user_id,
      can_edit_templates: getCanEdit(h.user_id, h.can_edit_templates),
    }));
    try {
      // BUG-7 FIX: /api/settings/…
      await apiFetch(`/api/settings/cooperative/${cooperativeId}/template-permissions/`, {
        method: "PUT", body: { user_permissions: userPermissions },
      });
      setHelpers((h) => h.map((u) => ({ ...u, can_edit_templates: getCanEdit(u.user_id, u.can_edit_templates) })));
      setPending({});
      onToast("Template permissions updated.", "success");
    } catch { onToast("Failed to save template permissions.", "error"); }
    finally { setSaving(false); }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <SectionHeader title="Template Editing Permissions" subtitle="Control which team members can create and edit form templates. The Chair always has full access." />

      <div className={SECONDARY_PANEL_CLASS}>
        <p className="text-sm text-muted-foreground">
          <strong>⚠ Note:</strong> Template editing changes the data your cooperative collects. Grant this permission carefully.
        </p>
      </div>

      {helpers.length === 0 ? (
        <div className={EMPTY_STATE_CLASS}>
          <ShieldCheck size={40} className="mb-3" />
          <p className="font-medium">No team members to configure.</p>
          <p className="text-sm mt-1">Add team members in Role Management first.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {helpers.map((helper) => {
            const canEdit = getCanEdit(helper.user_id, helper.can_edit_templates);
            const changed = helper.user_id in pending;
            return (
              <div key={helper.user_id}
                className={`flex items-center justify-between rounded-xl border px-5 py-4 transition
                  ${changed
                    ? "border-primary/30 bg-primary/5"
                    : "border-border bg-card"}`}
              >
                <div className="flex items-center gap-4">
                  <div className={AVATAR_TILE_CLASS}>
                    <span className="text-sm font-bold">
                      {helper.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{helper.name}</p>
                    <p className="text-xs text-muted-foreground">{helper.email}</p>
                  </div>
                  <span className={BADGE_CLASS}>
                    {ROLES.find((r) => r.value === helper.role)?.label ?? helper.role}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-medium ${canEdit ? "text-primary" : "text-muted-foreground"}`}>
                    {canEdit ? "Can edit templates" : "View only"}
                  </span>
                  <Toggle
                    checked={canEdit}
                    onChange={() => setPending((p) => ({ ...p, [helper.user_id]: !canEdit }))}
                    disabled={!isChair}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isChair && Object.keys(pending).length > 0 && (
        <div className="flex justify-end">
          <SaveButton saving={saving} onClick={handleSave} label={`Save Changes (${Object.keys(pending).length})`} />
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const params = useParams<{ cooperative_id: string }>();
  const cooperativeId = params.cooperative_id;

  const [activeTab, setActiveTab] = useState<TabId>("profile");
  const [isChair, setIsChair] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    authApi.me()
      .then((r: any) => {
        // BUG-8 FIX: me() returns { cooperative: { id: … } }, not { cooperative_id: … }
        const coopId = r.cooperative?.id ?? null;
        setIsChair(r.user_type === "CHAIR" && coopId === cooperativeId);
      })
      .catch(() => {});
  }, [cooperativeId]);

  const showToast = useCallback(
    (message: string, type: "success" | "error") => setToast({ message, type }),
    [],
  );

  const tabContent: Record<TabId, React.ReactNode> = {
    profile: <CooperativeProfileTab cooperativeId={cooperativeId} isChair={isChair} onToast={showToast} />,
    verification: <VerificationDocumentsTab cooperativeId={cooperativeId} isChair={isChair} onToast={showToast} />,
    notifications: <NotificationsTab cooperativeId={cooperativeId} onToast={showToast} />,
    roles: <RoleManagementTab cooperativeId={cooperativeId} isChair={isChair} onToast={showToast} />,
    templates: <TemplatePermissionsTab cooperativeId={cooperativeId} isChair={isChair} onToast={showToast} />,
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card px-6 py-6">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your cooperative configuration, team, and preferences.
          </p>
          {!isChair && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2">
              <Eye size={14} className="text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                You have view-only access. Contact your Cooperative Chair to make changes.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          <nav className="lg:w-56 flex-shrink-0">
            <ul className="space-y-1">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <li key={tab.id}>
                    <button
                      onClick={() => setActiveTab(tab.id)}
                      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition text-left
                        ${active
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                    >
                      <Icon size={18} className={active ? "text-primary" : "text-muted-foreground"} />
                      {tab.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex-1 min-w-0">
            <div className="rounded-2xl border border-border bg-card p-6 lg:p-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18 }}
                >
                  {tabContent[activeTab]}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AnimatePresence>
    </div>
  );
}
