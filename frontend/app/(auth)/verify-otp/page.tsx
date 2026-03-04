"use client";

/**
 * Verify OTP Page — SMS code verification
 * /verify-otp?phone=<phone>&purpose=<purpose>
 */

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle, Phone, AlertCircle } from "lucide-react";
import { authApi, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AnimatedAlert } from "@/components/ui/animated-alert";

export default function VerifyOTPPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const phone   = searchParams.get("phone") ?? "";
  const purpose = (searchParams.get("purpose") ?? "verification") as string;

  const [otp, setOtp]         = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent]   = useState(false);
  const [countdown, setCountdown] = useState(60);
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null),
                useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null),
                useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [countdown]);

  const handleChange = (i: number, val: string) => {
    const clean = val.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[i] = clean;
    setOtp(next);
    if (clean && i < 5) refs[i + 1].current?.focus();
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[i] && i > 0) {
      refs[i - 1].current?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (digits.length === 6) {
      setOtp(digits.split(""));
      refs[5].current?.focus();
    }
    e.preventDefault();
  };

  const handleVerify = useCallback(async () => {
    const code = otp.join("");
    if (code.length < 6) { setError("Please enter all 6 digits."); return; }

    setLoading(true);
    setError(null);
    try {
      const res = await authApi.verifyOtp(phone, code, purpose) as { success: boolean; message: string };
      if (res.success) {
        setSuccess(true);
        setTimeout(() => {
          if (purpose === "verification") router.push("/login?verified=1");
          else router.push("/login");
        }, 2000);
      } else {
        setError(res.message ?? "Invalid code. Please try again.");
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed.");
      setLoading(false);
    }
  }, [otp, phone, purpose, router]);

  const handleResend = async () => {
    setResending(true);
    setError(null);
    try {
      await authApi.resendOtp(phone, purpose);
      setResent(true);
      setCountdown(60);
    } catch {
      setError("Failed to resend. Please wait and try again.");
    } finally {
      setResending(false);
    }
  };

  if (success) {
    return (
      <div className="page-fade-in text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-[var(--success-light)] flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-[var(--success)]" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">Phone verified!</h1>
        <p className="text-sm text-[var(--foreground-muted)]">Redirecting you to sign in…</p>
        <Loader2 className="w-5 h-5 text-[var(--primary)] animate-spin mx-auto" />
      </div>
    );
  }

  return (
    <div className="page-fade-in space-y-7">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-[var(--primary-light)] flex items-center justify-center">
            <Phone className="w-5 h-5 text-[var(--primary)]" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">
            Enter verification code
          </h1>
        </div>
        <p className="text-sm text-[var(--foreground-muted)]">
          We sent a 6-digit code via Infobip SMS to{" "}
          <strong className="text-[var(--foreground)]">{phone}</strong>
        </p>
      </div>

      <AnimatedAlert
        show={Boolean(error)}
        motionKey={error ?? "verify-otp-error"}
        className="flex items-start gap-3 p-3.5 rounded-lg bg-[var(--destructive-light)] border border-red-200 dark:border-red-900/40"
      >
        <AlertCircle className="w-4 h-4 text-[var(--destructive)] mt-0.5 shrink-0" />
        <p className="text-sm text-[var(--destructive)]">{error ?? ""}</p>
      </AnimatedAlert>

      {/* OTP digit inputs */}
      <div className="flex gap-3 justify-center" onPaste={handlePaste}>
        {otp.map((digit, i) => (
          <input
            key={i}
            ref={refs[i]}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className={cn(
              "w-12 h-14 sm:w-14 sm:h-16 rounded-xl border-2 text-center text-2xl font-bold font-mono",
              "bg-[var(--input-bg)] text-[var(--input-text)]",
              "focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--border-focus)]/20",
              "transition-all duration-150",
              digit
                ? "border-[var(--border-focus)] bg-[var(--primary-light)] text-[var(--primary)]"
                : "border-[var(--input-border)]"
            )}
          />
        ))}
      </div>

      <button
        onClick={handleVerify}
        disabled={loading || otp.join("").length < 6}
        className="w-full h-11 rounded-xl bg-[var(--primary)] text-[var(--primary-fg)]
                   text-sm font-semibold hover:bg-[var(--primary-hover)]
                   shadow-[var(--shadow-green)] disabled:opacity-50 disabled:cursor-not-allowed
                   flex items-center justify-center gap-2 transition-all duration-200"
      >
        {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</> : "Verify"}
      </button>

      <div className="text-center space-y-2">
        {countdown > 0 ? (
          <p className="text-sm text-[var(--foreground-subtle)]">
            Resend code in <strong className="text-[var(--foreground-muted)]">{countdown}s</strong>
          </p>
        ) : (
          <button
            onClick={handleResend}
            disabled={resending}
            className="text-sm text-[var(--primary)] hover:text-[var(--primary-hover)] font-medium
                       disabled:opacity-50 transition-colors"
          >
            {resending ? "Sending…" : resent ? "✓ New code sent" : "Resend code"}
          </button>
        )}
        <p className="text-xs text-[var(--foreground-subtle)]">
          Wrong number?{" "}
          <Link href="/register" className="text-[var(--primary)] hover:underline">
            Go back
          </Link>
        </p>
      </div>
    </div>
  );
}
