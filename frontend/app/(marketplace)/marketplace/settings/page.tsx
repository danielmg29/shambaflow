"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  CheckCircle2,
  KeyRound,
  Loader2,
  Mail,
  Shield,
  UserRound,
} from "lucide-react";

import { AnimatedAlert } from "@/components/ui/animated-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiFetch, authApi, saveUser } from "@/lib/api";
import { cn } from "@/lib/utils";

interface BuyerSettingsProfile {
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  is_email_verified: boolean;
  is_phone_verified: boolean;
  profile?: {
    email_notifications: boolean;
    sms_notifications: boolean;
  };
}

interface OnboardingStatus {
  is_complete: boolean;
  completion_percent: number;
  completed_steps: number;
  total_steps: number;
  missing_fields: string[];
}

const buyerSettingsHeroStyle = {
  background:
    "radial-gradient(circle at top left, color-mix(in oklch, var(--surface) 16%, transparent) 0%, transparent 26%), linear-gradient(135deg, color-mix(in oklch, var(--foreground) 78%, var(--info) 22%) 0%, color-mix(in oklch, var(--info) 64%, var(--foreground) 36%) 46%, color-mix(in oklch, var(--secondary) 44%, var(--surface) 56%) 100%)",
  boxShadow: "0 24px 80px color-mix(in oklch, var(--info) 24%, transparent)",
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

export default function MarketplaceSettingsPage() {
  const [profile, setProfile] = useState<BuyerSettingsProfile | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(true);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const applyProfile = useCallback((data: BuyerSettingsProfile) => {
    setProfile(data);
    setFirstName(data.first_name ?? "");
    setLastName(data.last_name ?? "");
    setPhoneNumber(data.phone_number ?? "");
    setEmailNotifications(data.profile?.email_notifications ?? true);
    setSmsNotifications(data.profile?.sms_notifications ?? true);
  }, []);

  const loadData = useCallback(async () => {
    const [profileResponse, onboardingResponse] = await Promise.all([
      authApi.me() as Promise<BuyerSettingsProfile>,
      apiFetch<OnboardingStatus>("/api/marketplace/onboarding/"),
    ]);
    saveUser(profileResponse);
    applyProfile(profileResponse);
    setOnboarding(onboardingResponse);
  }, [applyProfile]);

  useEffect(() => {
    loadData()
      .catch(() => setMessage({ type: "error", text: "Unable to load buyer settings right now." }))
      .finally(() => setLoading(false));
  }, [loadData]);

  const handleSaveAccount = useCallback(async () => {
    setSavingAccount(true);
    setMessage(null);
    try {
      const response = await authApi.updateMe({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone_number: phoneNumber.trim(),
      }) as Record<string, unknown>;
      saveUser(response);
      await loadData();
      setMessage({ type: "success", text: "Account settings saved." });
    } catch {
      setMessage({ type: "error", text: "We could not save the account settings." });
    } finally {
      setSavingAccount(false);
    }
  }, [firstName, lastName, loadData, phoneNumber]);

  const handleSaveNotifications = useCallback(async () => {
    setSavingNotifications(true);
    setMessage(null);
    try {
      const response = await authApi.updateMe({
        email_notifications: emailNotifications,
        sms_notifications: smsNotifications,
      }) as Record<string, unknown>;
      saveUser(response);
      await loadData();
      setMessage({ type: "success", text: "Notification preferences saved." });
    } catch {
      setMessage({ type: "error", text: "Notification preferences could not be saved." });
    } finally {
      setSavingNotifications(false);
    }
  }, [emailNotifications, loadData, smsNotifications]);

  const handleChangePassword = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "The new passwords do not match." });
      return;
    }
    if (newPassword.length < 8) {
      setMessage({ type: "error", text: "Use at least 8 characters for the new password." });
      return;
    }

    setSavingPassword(true);
    try {
      await authApi.changePassword(currentPassword, newPassword, confirmPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage({ type: "success", text: "Password changed successfully." });
    } catch {
      setMessage({
        type: "error",
        text: "Password change failed. Please confirm the current password and try again.",
      });
    } finally {
      setSavingPassword(false);
    }
  }, [confirmPassword, currentPassword, newPassword]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm text-[var(--foreground-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading buyer settings…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section
        className="overflow-hidden rounded-[28px] border border-[var(--border)] p-6 text-white sm:p-8"
        style={buyerSettingsHeroStyle}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <Badge className="w-fit border-white/14 bg-white/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-none hover:bg-white/12">
              <Shield className="h-3.5 w-3.5" />
              Buyer Settings
            </Badge>
            <div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Account, notifications, and buyer readiness.
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/80">
                Manage the secure parts of your buyer workspace without mixing them into company profile editing.
              </p>
            </div>
          </div>
          <div className="sf-hero-panel rounded-[24px] px-5 py-4">
            <p className="text-[11px] uppercase tracking-[0.2em] text-white/65">Onboarding status</p>
            <p className="mt-2 text-3xl font-bold">{onboarding?.completion_percent ?? 0}%</p>
            <p className="mt-1 text-sm text-white/76">
              {onboarding?.is_complete
                ? "Buyer setup complete"
                : `${onboarding?.missing_fields.length ?? 0} items still need attention`}
            </p>
          </div>
        </div>
      </section>

      <AnimatedAlert
        show={Boolean(message)}
        motionKey={message?.text ?? "buyer-settings-message"}
        className={cn(
          "flex items-start gap-3 rounded-2xl border px-4 py-4 text-sm",
          message?.type === "success" ? "sf-tone-success" : "sf-tone-danger"
        )}
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{message?.text ?? ""}</p>
      </AnimatedAlert>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <Section
            title="Account owner"
            description="Update the person responsible for the buyer account and keep contact details current."
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
                <Input
                  value={phoneNumber}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  placeholder="+254712345678"
                  className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
                />
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Email address</FieldLabel>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--foreground-subtle)]" />
                  <Input
                    disabled
                    value={profile?.email ?? ""}
                    className="h-11 rounded-2xl border-[var(--border)] bg-[var(--background-muted)] pl-10 pr-4 text-[var(--foreground-muted)]"
                  />
                </div>
              </label>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Badge className={cn("px-3 py-1 text-xs font-semibold", profile?.is_email_verified ? "sf-tone-success" : "sf-tone-warning")}>
                {profile?.is_email_verified ? "Email verified" : "Email pending"}
              </Badge>
              <Badge className={cn("px-3 py-1 text-xs font-semibold", profile?.is_phone_verified ? "sf-tone-info" : "sf-tone-neutral")}>
                {profile?.is_phone_verified ? "Phone verified" : "Phone verification pending"}
              </Badge>
            </div>
            <div className="mt-6">
              <Button
                type="button"
                onClick={handleSaveAccount}
                disabled={savingAccount}
                className="h-11 rounded-2xl px-5"
              >
                {savingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Save account details
              </Button>
            </div>
          </Section>

          <Section
            title="Notification preferences"
            description="Choose how the marketplace reaches you for tender updates and critical account events."
            icon={Bell}
          >
            <div className="space-y-4">
              {[
                {
                  label: "Email notifications",
                  description: "Tender activity, bid changes, and buyer system updates delivered to your inbox.",
                  value: emailNotifications,
                  onChange: setEmailNotifications,
                },
                {
                  label: "SMS notifications",
                  description: "Critical alerts and SMS-based security prompts for your buyer account.",
                  value: smsNotifications,
                  onChange: setSmsNotifications,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-start justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">{item.label}</p>
                    <p className="mt-1 text-sm text-[var(--foreground-muted)]">{item.description}</p>
                  </div>
                  <Switch checked={item.value} onCheckedChange={item.onChange} />
                </div>
              ))}
            </div>
            <div className="mt-6">
              <Button
                type="button"
                onClick={handleSaveNotifications}
                disabled={savingNotifications}
                className="h-11 rounded-2xl px-5"
              >
                {savingNotifications ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Save notification preferences
              </Button>
            </div>
          </Section>
        </div>

        <div className="space-y-6">
          <Section
            title="Password & security"
            description="Change the buyer account password without leaving the marketplace."
            icon={KeyRound}
          >
            <form className="space-y-4" onSubmit={handleChangePassword}>
              {[
                {
                  label: "Current password",
                  value: currentPassword,
                  setter: setCurrentPassword,
                  autoComplete: "current-password",
                },
                {
                  label: "New password",
                  value: newPassword,
                  setter: setNewPassword,
                  autoComplete: "new-password",
                },
                {
                  label: "Confirm new password",
                  value: confirmPassword,
                  setter: setConfirmPassword,
                  autoComplete: "new-password",
                },
              ].map((field) => (
                <label key={field.label} className="space-y-1.5">
                  <FieldLabel>{field.label}</FieldLabel>
                  <Input
                    type="password"
                    value={field.value}
                    onChange={(event) => field.setter(event.target.value)}
                    autoComplete={field.autoComplete}
                    className="h-11 rounded-2xl border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-[var(--input-text)]"
                  />
                </label>
              ))}
              <Button type="submit" disabled={savingPassword} className="h-11 rounded-2xl px-5">
                {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Update password
              </Button>
            </form>
          </Section>

          <Card className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] py-0 shadow-[var(--shadow-sm)]">
            <CardContent className="p-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">
                Buyer readiness
              </p>
              <h2 className="mt-2 text-lg font-semibold text-[var(--foreground)]">
                {onboarding?.is_complete
                  ? "Your buyer onboarding is complete."
                  : "A few buyer setup items still need attention."}
              </h2>
              <p className="mt-2 text-sm text-[var(--foreground-muted)]">
                Completion is currently at <strong>{onboarding?.completion_percent ?? 0}%</strong>.
                {onboarding?.missing_fields.length
                  ? ` Remaining focus areas: ${onboarding.missing_fields.join(", ")}.`
                  : " You can jump straight into the tender workspace."}
              </p>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-[var(--background-muted)]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${onboarding?.completion_percent ?? 0}%`,
                    background:
                      "linear-gradient(90deg, color-mix(in oklch, var(--primary) 84%, var(--surface) 16%) 0%, color-mix(in oklch, var(--info) 74%, var(--surface) 26%) 100%)",
                  }}
                />
              </div>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Button asChild className="h-11 rounded-2xl px-5">
                  <Link href="/marketplace/onboarding">Review onboarding</Link>
                </Button>
                <Button asChild variant="outline" className="h-11 rounded-2xl px-5">
                  <Link href="/marketplace/profile">Open buyer profile</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
