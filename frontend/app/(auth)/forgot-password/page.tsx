"use client";

/**
 * Forgot Password Page
 *
 * Dynamic verification method selector:
 * - Email → input changes to email field, receives password reset link
 * - Phone (SMS) → input changes to phone field, receives OTP via Infobip
 */

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, Phone, Loader2, CheckCircle, ArrowLeft } from "lucide-react";
import { authApi, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AnimatedAlert } from "@/components/ui/animated-alert";

type VerifyMethod = "email" | "sms";

export default function ForgotPasswordPage() {
  const router = useRouter();

  const [method, setMethod]         = useState<VerifyMethod>("email");
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading]       = useState(false);
  const [sent, setSent]             = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const handleMethodChange = (m: VerifyMethod) => {
    setMethod(m);
    setIdentifier(""); // Clear input when method changes
    setError(null);
  };

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!identifier.trim()) {
        setError(
          method === "email"
            ? "Please enter your email address."
            : "Please enter your phone number."
        );
        return;
      }
      setLoading(true);
      setError(null);
      try {
        await authApi.forgotPassword(identifier.trim(), method);
        setSent(true);
      } catch (err) {
        if (err instanceof ApiError) setError(err.message);
        else setError("Something went wrong. Please try again.");
        setLoading(false);
      }
    },
    [identifier, method]
  );

  if (sent) {
    return (
      <div className="page-fade-in text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-[var(--success-light)] flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-[var(--success)]" />
          </div>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">
            {method === "email" ? "Check your inbox" : "Check your phone"}
          </h1>
          <p className="mt-2 text-sm text-[var(--foreground-muted)]">
            {method === "email"
              ? `If an account exists for ${identifier}, we've sent a password reset link.`
              : `If an account exists with ${identifier}, we've sent a 6-digit reset code via SMS.`}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-[var(--background-muted)] border border-[var(--border)] text-sm text-[var(--foreground-muted)]">
          {method === "email" ? (
            <p>The link expires in <strong className="text-[var(--foreground)]">1 hour</strong>. Check your spam folder if you don&apos;t see it.</p>
          ) : (
            <p>The code expires in <strong className="text-[var(--foreground)]">10 minutes</strong>. Click below when you have it.</p>
          )}
        </div>
        {method === "sms" ? (
          <button
            onClick={() =>
              router.push(
                `/reset-password?method=sms&phone=${encodeURIComponent(identifier)}`
              )
            }
            className="w-full h-11 rounded-xl bg-[var(--primary)] text-[var(--primary-fg)]
                       text-sm font-semibold hover:bg-[var(--primary-hover)]
                       shadow-[var(--shadow-green)] transition-all duration-200"
          >
            Enter reset code
          </button>
        ) : (
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-sm text-[var(--primary)]
                       hover:text-[var(--primary-hover)] font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to sign in
          </Link>
        )}
        <button
          onClick={() => { setSent(false); setIdentifier(""); }}
          className="block w-full text-xs text-[var(--foreground-subtle)] hover:text-[var(--foreground-muted)] transition-colors"
        >
          Try a different {method === "email" ? "email" : "phone number"}
        </button>
      </div>
    );
  }

  return (
    <div className="page-fade-in space-y-7">
      {/* Header */}
      <div>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--foreground-muted)]
                     hover:text-[var(--foreground)] mb-5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to sign in
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">
          Reset your password
        </h1>
        <p className="mt-1.5 text-sm text-[var(--foreground-muted)]">
          Choose how you&apos;d like to receive your reset instructions.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        {/* Method selector */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-[var(--foreground)]">
            Reset method
          </label>

          {/* Toggle pills */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleMethodChange("email")}
              className={cn("verify-method-tab", method === "email" ? "active" : "inactive")}
            >
              <span className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" />
                Email link
              </span>
            </button>
            <button
              type="button"
              onClick={() => handleMethodChange("sms")}
              className={cn("verify-method-tab", method === "sms" ? "active" : "inactive")}
            >
              <span className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" />
                SMS code
              </span>
            </button>
          </div>

          {/* Dynamic input — changes based on method */}
          <div key={method} className="page-fade-in">
            {method === "email" ? (
              <div className="space-y-1.5">
                <label htmlFor="reset-identifier" className="block text-sm font-medium text-[var(--foreground)]">
                  Email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--foreground-subtle)]" />
                  <input
                    id="reset-identifier"
                    type="email"
                    value={identifier}
                    onChange={(e) => { setIdentifier(e.target.value); setError(null); }}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className={cn(
                      "w-full h-11 pl-10 pr-4 rounded-xl border text-sm transition-all duration-150",
                      "bg-[var(--input-bg)] text-[var(--input-text)]",
                      "placeholder:text-[var(--input-placeholder)]",
                      "focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]",
                      error
                        ? "border-[var(--destructive)]"
                        : "border-[var(--input-border)] focus:border-[var(--input-border-focus)]"
                    )}
                  />
                </div>
                <p className="text-xs text-[var(--foreground-subtle)]">
                  Enter the email address linked to your account. We&apos;ll send a reset link.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <label htmlFor="reset-identifier" className="block text-sm font-medium text-[var(--foreground)]">
                  Phone number
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--foreground-subtle)]" />
                  <input
                    id="reset-identifier"
                    type="tel"
                    value={identifier}
                    onChange={(e) => { setIdentifier(e.target.value); setError(null); }}
                    placeholder="+254712345678"
                    autoComplete="tel"
                    className={cn(
                      "w-full h-11 pl-10 pr-4 rounded-xl border text-sm transition-all duration-150",
                      "bg-[var(--input-bg)] text-[var(--input-text)]",
                      "placeholder:text-[var(--input-placeholder)]",
                      "focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]",
                      error
                        ? "border-[var(--destructive)]"
                        : "border-[var(--input-border)] focus:border-[var(--input-border-focus)]"
                    )}
                  />
                </div>
                <p className="text-xs text-[var(--foreground-subtle)]">
                  Enter the phone number linked to your account. A 6-digit code will be sent via Infobip SMS.
                </p>
              </div>
            )}
          </div>

          <AnimatedAlert
            show={Boolean(error)}
            motionKey={error ?? "forgot-password-error"}
            className="text-sm text-[var(--destructive)] font-medium"
          >
            {error ?? ""}
          </AnimatedAlert>
        </div>

        <button
          type="submit"
          disabled={loading || !identifier.trim()}
          className="w-full h-11 rounded-xl bg-[var(--primary)] text-[var(--primary-fg)]
                     text-sm font-semibold hover:bg-[var(--primary-hover)]
                     shadow-[var(--shadow-green)] disabled:opacity-50 disabled:cursor-not-allowed
                     flex items-center justify-center gap-2 transition-all duration-200"
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
          ) : method === "email" ? (
            "Send reset link"
          ) : (
            "Send SMS code"
          )}
        </button>
      </form>
    </div>
  );
}
