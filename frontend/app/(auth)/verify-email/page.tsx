"use client";

/**
 * Verify Email Page
 * Handles /verify-email?token=<token>  — auto-verifies when token is present
 * Handles /verify-email?email=<email>&sent=1 — shows confirmation message
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle, AlertCircle, Loader2, Mail } from "lucide-react";
import { authApi, ApiError } from "@/lib/api";

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const email = searchParams.get("email");
  const sent  = searchParams.get("sent") === "1";

  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    token ? "loading" : "idle"
  );
  const [message, setMessage] = useState<string>("");
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await authApi.verifyEmail(token) as { success: boolean; message: string };
        if (res.success) {
          setStatus("success");
          setMessage(res.message ?? "Email verified successfully!");
        } else {
          setStatus("error");
          setMessage(res.message ?? "Verification failed.");
        }
      } catch (err) {
        setStatus("error");
        setMessage(err instanceof ApiError ? err.message : "Verification failed. Please try again.");
      }
    })();
  }, [token]);

  async function handleResend() {
    if (!email || resending) return;
    setResending(true);
    try {
      await authApi.resendVerification(email);
      setResent(true);
    } finally {
      setResending(false);
    }
  }

  // Auto-verify loading state
  if (status === "loading") {
    return (
      <div className="page-fade-in flex flex-col items-center text-center gap-5 py-8">
        <Loader2 className="w-12 h-12 text-[var(--primary)] animate-spin" />
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">
            Verifying your email…
          </h1>
          <p className="mt-1.5 text-sm text-[var(--foreground-muted)]">
            Just a moment while we verify your account.
          </p>
        </div>
      </div>
    );
  }

  // Success state
  if (status === "success") {
    return (
      <div className="page-fade-in text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-[var(--success-light)] flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-[var(--success)]" />
          </div>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">
            Email verified!
          </h1>
          <p className="mt-2 text-sm text-[var(--foreground-muted)]">{message}</p>
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

  // Error state
  if (status === "error") {
    return (
      <div className="page-fade-in text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-[var(--destructive-light)] flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-[var(--destructive)]" />
          </div>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">
            Verification failed
          </h1>
          <p className="mt-2 text-sm text-[var(--foreground-muted)]">{message}</p>
        </div>
        {email && (
          <button
            onClick={handleResend}
            disabled={resending || resent}
            className="w-full h-11 rounded-xl bg-[var(--primary)] text-[var(--primary-fg)]
                       text-sm font-semibold hover:bg-[var(--primary-hover)]
                       disabled:opacity-50 disabled:cursor-not-allowed
                       flex items-center justify-center gap-2 transition-all duration-200"
          >
            {resending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> :
             resent ? "New link sent!" : "Request new verification link"}
          </button>
        )}
        <Link href="/login" className="block text-sm text-[var(--foreground-muted)] hover:text-[var(--foreground)] transition-colors">
          Back to sign in
        </Link>
      </div>
    );
  }

  // "sent=1" confirmation state — no token yet, just confirmation message
  return (
    <div className="page-fade-in text-center space-y-6">
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-full bg-[var(--primary-light)] flex items-center justify-center">
          <Mail className="w-8 h-8 text-[var(--primary)]" />
        </div>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">
          Check your inbox
        </h1>
        <p className="mt-2 text-sm text-[var(--foreground-muted)]">
          {sent
            ? `We've sent a verification link to ${email ?? "your email address"}.`
            : "Please check your email for the verification link."}
        </p>
      </div>
      <div className="p-4 rounded-xl bg-[var(--background-muted)] border border-[var(--border)] text-sm text-[var(--foreground-muted)] text-left space-y-1">
        <p>✓ Check your <strong className="text-[var(--foreground)]">inbox</strong> and spam folder</p>
        <p>✓ The link expires in <strong className="text-[var(--foreground)]">72 hours</strong></p>
        <p>✓ Click the link to activate your ShambaFlow account</p>
      </div>
      {email && (
        <div className="space-y-2">
          {!resent ? (
            <button
              onClick={handleResend}
              disabled={resending}
              className="w-full h-10 rounded-xl border border-[var(--border)] text-sm
                         text-[var(--foreground-muted)] hover:text-[var(--foreground)]
                         hover:bg-[var(--background-muted)] disabled:opacity-50
                         flex items-center justify-center gap-2 transition-all duration-150"
            >
              {resending ? <><Loader2 className="w-4 h-4 animate-spin" /> Resending…</> : "Resend verification email"}
            </button>
          ) : (
            <p className="text-sm text-[var(--success)] font-medium">✓ New verification link sent!</p>
          )}
        </div>
      )}
      <Link href="/login" className="block text-sm text-[var(--foreground-muted)] hover:text-[var(--foreground)] transition-colors">
        Back to sign in
      </Link>
    </div>
  );
}