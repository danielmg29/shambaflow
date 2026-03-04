"use client";

/**
 * Reset Password Page
 *
 * Supports two flows:
 * - Email link: /reset-password?token=<token>
 * - SMS OTP:    /reset-password?method=sms&phone=<phone>
 *
 * The UI adapts based on the query params.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Eye, EyeOff, Loader2, CheckCircle, AlertCircle, Key, ArrowLeft,
} from "lucide-react";
import { authApi, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AnimatedAlert } from "@/components/ui/animated-alert";

function PasswordField({
  id, label, value, onChange, placeholder, error, autoComplete,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; error?: string; autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-[var(--foreground)]">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={cn(
            "w-full h-11 px-4 pr-11 rounded-xl border text-sm transition-all duration-150",
            "bg-[var(--input-bg)] text-[var(--input-text)]",
            "placeholder:text-[var(--input-placeholder)]",
            "focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]",
            error
              ? "border-[var(--destructive)]"
              : "border-[var(--input-border)] focus:border-[var(--input-border-focus)]"
          )}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--foreground-subtle)]
                     hover:text-[var(--foreground-muted)] transition-colors"
          aria-label={show ? "Hide" : "Show"}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {error && <p className="text-xs text-[var(--destructive)]">{error}</p>}
    </div>
  );
}

export default function ResetPasswordPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const token   = searchParams.get("token") ?? "";
  const method  = searchParams.get("method") ?? "email"; // "email" | "sms"
  const phone   = searchParams.get("phone") ?? "";

  const [otp, setOtp]         = useState("");
  const [newPwd, setNewPwd]   = useState("");
  const [cfmPwd, setCfmPwd]   = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Validate: need either token (email) or phone (sms)
  const isSms   = method === "sms";
  const hasToken = Boolean(token);

  useEffect(() => {
    if (!isSms && !hasToken) {
      // No token in URL — redirect to forgot password
      router.replace("/forgot-password");
    }
  }, [isSms, hasToken, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};

    if (isSms && !otp.trim()) errs.otp = "Please enter the 6-digit code.";
    if (newPwd.length < 8)    errs.newPwd = "Password must be at least 8 characters.";
    if (newPwd !== cfmPwd)    errs.cfmPwd = "Passwords do not match.";

    if (Object.keys(errs).length) { setFieldErrors(errs); return; }

    setLoading(true);
    setError(null);
    setFieldErrors({});

    try {
      if (isSms) {
        await authApi.resetPasswordOtp(phone, otp.trim(), newPwd);
      } else {
        await authApi.resetPassword(token, newPwd, cfmPwd);
      }
      setSuccess(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError("Reset failed. Please try again or request a new link.");
      }
      setLoading(false);
    }
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
            Password reset!
          </h1>
          <p className="mt-2 text-sm text-[var(--foreground-muted)]">
            Your password has been updated. You can now sign in with your new credentials.
          </p>
        </div>
        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center h-11 rounded-xl
                     bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold
                     hover:bg-[var(--primary-hover)] shadow-[var(--shadow-green)]
                     transition-all duration-200"
        >
          Sign in to ShambaFlow
        </Link>
      </div>
    );
  }

  return (
    <div className="page-fade-in space-y-7">
      <div>
        <Link
          href="/forgot-password"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--foreground-muted)]
                     hover:text-[var(--foreground)] mb-5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-[var(--primary-light)] flex items-center justify-center">
            <Key className="w-5 h-5 text-[var(--primary)]" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">
            Set new password
          </h1>
        </div>
        <p className="text-sm text-[var(--foreground-muted)]">
          {isSms
            ? `Enter the 6-digit code sent to ${phone} and your new password.`
            : "Enter a strong new password for your account."}
        </p>
      </div>

      <AnimatedAlert
        show={Boolean(error)}
        motionKey={error ?? "reset-password-error"}
        className="flex items-start gap-3 p-3.5 rounded-lg bg-[var(--destructive-light)] border border-red-200 dark:border-red-900/40"
      >
        <AlertCircle className="w-4 h-4 text-[var(--destructive)] mt-0.5 shrink-0" />
        <p className="text-sm text-[var(--destructive)]">{error ?? ""}</p>
      </AnimatedAlert>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* SMS OTP input */}
        {isSms && (
          <div className="space-y-1.5">
            <label htmlFor="otp" className="block text-sm font-medium text-[var(--foreground)]">
              SMS verification code
            </label>
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              autoComplete="one-time-code"
              className={cn(
                "w-full h-12 px-4 rounded-xl border text-center text-xl font-mono tracking-[0.5em]",
                "bg-[var(--input-bg)] text-[var(--input-text)]",
                "placeholder:text-[var(--input-placeholder)] placeholder:tracking-normal",
                "focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]",
                fieldErrors.otp
                  ? "border-[var(--destructive)]"
                  : "border-[var(--input-border)] focus:border-[var(--input-border-focus)]"
              )}
            />
            {fieldErrors.otp && (
              <p className="text-xs text-[var(--destructive)]">{fieldErrors.otp}</p>
            )}
          </div>
        )}

        <PasswordField
          id="newPwd" label="New password" value={newPwd} onChange={setNewPwd}
          placeholder="Min. 8 characters" error={fieldErrors.newPwd}
          autoComplete="new-password"
        />

        {/* Password strength indicator */}
        {newPwd.length > 0 && (
          <div className="space-y-1">
            <div className="flex gap-1">
              {[1, 2, 3, 4].map((level) => (
                <div
                  key={level}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-all duration-300",
                    newPwd.length >= level * 2
                      ? level <= 1 ? "bg-red-500"
                        : level <= 2 ? "bg-amber-500"
                        : level <= 3 ? "bg-yellow-400"
                        : "bg-green-500"
                      : "bg-[var(--border)]"
                  )}
                />
              ))}
            </div>
            <p className="text-xs text-[var(--foreground-subtle)]">
              {newPwd.length < 8 ? "Too short" :
               newPwd.length < 12 ? "Fair — consider adding more characters" :
               "Strong password"}
            </p>
          </div>
        )}

        <PasswordField
          id="cfmPwd" label="Confirm new password" value={cfmPwd} onChange={setCfmPwd}
          placeholder="Repeat your new password" error={fieldErrors.cfmPwd}
          autoComplete="new-password"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 rounded-xl bg-[var(--primary)] text-[var(--primary-fg)]
                     text-sm font-semibold hover:bg-[var(--primary-hover)]
                     shadow-[var(--shadow-green)] disabled:opacity-50 disabled:cursor-not-allowed
                     flex items-center justify-center gap-2 transition-all duration-200"
        >
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Resetting…</> : "Reset password"}
        </button>
      </form>

      {/* Resend OTP for SMS flow */}
      {isSms && (
        <p className="text-center text-xs text-[var(--foreground-subtle)]">
          Didn&apos;t receive the code?{" "}
          <button
            type="button"
            onClick={() => authApi.resendOtp(phone, "password_reset")}
            className="text-[var(--primary)] hover:text-[var(--primary-hover)] font-medium transition-colors"
          >
            Resend
          </button>
        </p>
      )}
    </div>
  );
}
