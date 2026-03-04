"use client";

/**
 * Accept Invitation Page
 * /accept-invitation?token=<token>
 *
 * Used by Cooperative Helpers receiving an invitation from their Chair.
 * They set their permanent password here.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2, CheckCircle, AlertCircle, Users } from "lucide-react";
import { authApi, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AnimatedAlert } from "@/components/ui/animated-alert";

export default function AcceptInvitationPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [newPwd, setNewPwd]   = useState("");
  const [cfmPwd, setCfmPwd]   = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showCfm, setShowCfm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (newPwd.length < 8) errs.newPwd = "Password must be at least 8 characters.";
    if (newPwd !== cfmPwd) errs.cfmPwd = "Passwords do not match.";
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }

    setLoading(true);
    setError(null);
    setFieldErrors({});

    try {
      await authApi.acceptInvitation(token, newPwd, cfmPwd);
      setSuccess(true);
      setTimeout(() => router.push("/login"), 3000);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError("Failed to accept invitation. Please try again.");
      }
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="page-fade-in text-center space-y-5">
        <AlertCircle className="w-12 h-12 text-[var(--destructive)] mx-auto" />
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Invalid invitation</h1>
        <p className="text-sm text-[var(--foreground-muted)]">
          This invitation link is missing or invalid. Please ask your Cooperative Chair to resend your invitation.
        </p>
        <Link href="/login" className="block text-sm text-[var(--primary)] hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="page-fade-in text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-[var(--success-light)] flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-[var(--success)]" />
          </div>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">
            Welcome to ShambaFlow!
          </h1>
          <p className="mt-2 text-sm text-[var(--foreground-muted)]">
            Your account is ready. Redirecting you to sign in…
          </p>
        </div>
        <Loader2 className="w-5 h-5 text-[var(--primary)] animate-spin mx-auto" />
      </div>
    );
  }

  return (
    <div className="page-fade-in space-y-7">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-[var(--primary-light)] flex items-center justify-center">
            <Users className="w-5 h-5 text-[var(--primary)]" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">
            Accept invitation
          </h1>
        </div>
        <p className="text-sm text-[var(--foreground-muted)]">
          You&apos;ve been invited to join a cooperative on ShambaFlow.
          Set your permanent password to activate your account.
        </p>
      </div>

      <div className="p-4 rounded-xl bg-[var(--background-muted)] border border-[var(--border)]">
        <p className="text-xs text-[var(--foreground-muted)]">
          Your email address and role were set by your Cooperative Chair. You are
          creating a password to secure your account — the Chair cannot see this password.
        </p>
      </div>

      <AnimatedAlert
        show={Boolean(error)}
        motionKey={error ?? "accept-invitation-error"}
        className="flex items-start gap-3 p-3.5 rounded-lg bg-[var(--destructive-light)] border border-red-200 dark:border-red-900/40"
      >
        <AlertCircle className="w-4 h-4 text-[var(--destructive)] mt-0.5 shrink-0" />
        <p className="text-sm text-[var(--destructive)]">{error ?? ""}</p>
      </AnimatedAlert>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* New password */}
        <div className="space-y-1.5">
          <label htmlFor="newPwd" className="block text-sm font-medium text-[var(--foreground)]">
            Create password
          </label>
          <div className="relative">
            <input id="newPwd" type={showNew ? "text" : "password"}
              value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
              placeholder="Min. 8 characters" autoComplete="new-password"
              className={cn("w-full h-11 px-4 pr-11 rounded-xl border text-sm transition-all",
                "bg-[var(--input-bg)] text-[var(--input-text)] placeholder:text-[var(--input-placeholder)]",
                "focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]",
                fieldErrors.newPwd ? "border-[var(--destructive)]" : "border-[var(--input-border)] focus:border-[var(--input-border-focus)]")} />
            <button type="button" onClick={() => setShowNew(!showNew)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--foreground-subtle)] hover:text-[var(--foreground-muted)]">
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {fieldErrors.newPwd && <p className="text-xs text-[var(--destructive)]">{fieldErrors.newPwd}</p>}
        </div>

        {/* Confirm password */}
        <div className="space-y-1.5">
          <label htmlFor="cfmPwd" className="block text-sm font-medium text-[var(--foreground)]">
            Confirm password
          </label>
          <div className="relative">
            <input id="cfmPwd" type={showCfm ? "text" : "password"}
              value={cfmPwd} onChange={(e) => setCfmPwd(e.target.value)}
              placeholder="Repeat your password" autoComplete="new-password"
              className={cn("w-full h-11 px-4 pr-11 rounded-xl border text-sm transition-all",
                "bg-[var(--input-bg)] text-[var(--input-text)] placeholder:text-[var(--input-placeholder)]",
                "focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]",
                fieldErrors.cfmPwd ? "border-[var(--destructive)]" : "border-[var(--input-border)] focus:border-[var(--input-border-focus)]")} />
            <button type="button" onClick={() => setShowCfm(!showCfm)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--foreground-subtle)] hover:text-[var(--foreground-muted)]">
              {showCfm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {fieldErrors.cfmPwd && <p className="text-xs text-[var(--destructive)]">{fieldErrors.cfmPwd}</p>}
        </div>

        <button type="submit" disabled={loading}
          className="w-full h-11 rounded-xl bg-[var(--primary)] text-[var(--primary-fg)]
                     text-sm font-semibold hover:bg-[var(--primary-hover)]
                     shadow-[var(--shadow-green)] disabled:opacity-50 disabled:cursor-not-allowed
                     flex items-center justify-center gap-2 transition-all duration-200">
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Activating account…</> : "Activate my account"}
        </button>
      </form>

      <p className="text-center text-xs text-[var(--foreground-subtle)]">
        Already have an account?{" "}
        <Link href="/login" className="text-[var(--primary)] hover:underline font-medium">Sign in</Link>
      </p>
    </div>
  );
}
