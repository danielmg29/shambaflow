"use client";

/**
 * Login Page
 *
 * - Email + Password form
 * - Error display with field-level messages
 * - "Forgot password" link
 * - Links to cooperative and buyer registration
 * - Theme-aware styling
 */

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, AlertCircle, Sprout, Building2 } from "lucide-react";
import { authApi, saveTokens, saveUser, apiFetch, ApiError, type UserSnapshot } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AnimatedAlert } from "@/components/ui/animated-alert";

type AccountType = "cooperative" | "buyer";

export default function LoginPage() {
  const router = useRouter();

  const [accountType, setAccountType] = useState<AccountType>("cooperative");
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [showPwd, setShowPwd]       = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const resolvePostLoginDestination = useCallback(async (user: UserSnapshot) => {
    const { user_type, must_change_password, cooperative_id } = user;

    if (must_change_password) {
      return "/change-password?required=1";
    }

    if (user_type === "CHAIR" || user_type === "HELPER") {
      return cooperative_id ? `/crm/${cooperative_id}/dashboard` : "/crm/dashboard";
    }

    if (user_type === "BUYER") {
      try {
        const onboarding = await apiFetch<{ is_complete: boolean }>("/api/marketplace/onboarding/");
        return onboarding.is_complete ? "/marketplace/dashboard" : "/marketplace/onboarding";
      } catch {
        return "/marketplace/dashboard";
      }
    }

    return "/";
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setFieldErrors({});
      setLoading(true);

      try {
        const data = await authApi.login(email.trim(), password);
        saveTokens(data.access, data.refresh);
        saveUser(data.user);
        const destination = await resolvePostLoginDestination(data.user);
        router.replace(destination);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
          setFieldErrors(err.fieldErrors);
        } else {
          setError("Login failed. Please check your connection and try again.");
        }
      } finally {
        setLoading(false);
      }
    },
    [email, password, resolvePostLoginDestination, router]
  );

  return (
    <div className="page-fade-in space-y-7">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">
          Welcome back
        </h1>
        <p className="mt-1.5 text-[var(--foreground-muted)] text-sm">
          Sign in to your ShambaFlow account
        </p>
      </div>

      {/* Account type toggle */}
      <div className="flex gap-2 p-1 bg-[var(--background-muted)] rounded-xl">
        {(["cooperative", "buyer"] as AccountType[]).map((type) => (
          <button
            key={type}
            onClick={() => setAccountType(type)}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all duration-200",
              accountType === type
                ? "bg-[var(--surface)] text-[var(--foreground)] shadow-[var(--shadow-sm)]"
                : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
            )}
          >
            {type === "cooperative" ? (
              <Sprout className="w-3.5 h-3.5" />
            ) : (
              <Building2 className="w-3.5 h-3.5" />
            )}
            {type === "cooperative" ? "Cooperative" : "Buyer"}
          </button>
        ))}
      </div>

      {/* Error banner */}
      <AnimatedAlert
        show={Boolean(error)}
        motionKey={error ?? "login-error"}
        className="flex items-start gap-3 p-3.5 rounded-lg bg-[var(--destructive-light)] border border-red-200 dark:border-red-900/40"
      >
        <AlertCircle className="w-4 h-4 text-[var(--destructive)] mt-0.5 shrink-0" />
        <p className="text-sm text-[var(--destructive)] font-medium">{error ?? ""}</p>
      </AnimatedAlert>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Email */}
        <div className="space-y-1.5">
          <label
            htmlFor="email"
            className="block text-sm font-medium text-[var(--foreground)]"
          >
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className={cn(
              "w-full h-11 px-4 rounded-xl border text-sm transition-all duration-150",
              "bg-[var(--input-bg)] text-[var(--input-text)]",
              "placeholder:text-[var(--input-placeholder)]",
              "focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)] focus:ring-offset-0",
              fieldErrors.email
                ? "border-[var(--destructive)]"
                : "border-[var(--input-border)] focus:border-[var(--input-border-focus)]"
            )}
          />
          {fieldErrors.email && (
            <p className="text-xs text-[var(--destructive)]">{fieldErrors.email}</p>
          )}
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-[var(--foreground)]"
            >
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-xs text-[var(--primary)] hover:text-[var(--primary-hover)] font-medium transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              id="password"
              type={showPwd ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              className={cn(
                "w-full h-11 px-4 pr-11 rounded-xl border text-sm transition-all duration-150",
                "bg-[var(--input-bg)] text-[var(--input-text)]",
                "placeholder:text-[var(--input-placeholder)]",
                "focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)] focus:ring-offset-0",
                fieldErrors.password
                  ? "border-[var(--destructive)]"
                  : "border-[var(--input-border)] focus:border-[var(--input-border-focus)]"
              )}
            />
            <button
              type="button"
              onClick={() => setShowPwd(!showPwd)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--foreground-subtle)]
                         hover:text-[var(--foreground-muted)] transition-colors"
              aria-label={showPwd ? "Hide password" : "Show password"}
            >
              {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {fieldErrors.password && (
            <p className="text-xs text-[var(--destructive)]">{fieldErrors.password}</p>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || !email || !password}
          className={cn(
            "w-full h-11 rounded-xl font-semibold text-sm transition-all duration-200",
            "bg-[var(--primary)] text-[var(--primary-fg)]",
            "hover:bg-[var(--primary-hover)] shadow-[var(--shadow-green)]",
            "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
            "flex items-center justify-center gap-2"
          )}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </button>
      </form>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-[var(--border)]" />
        <span className="text-xs text-[var(--foreground-subtle)]">
          Don&apos;t have an account?
        </span>
        <div className="flex-1 h-px bg-[var(--border)]" />
      </div>

      {/* Registration links */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/register?type=cooperative"
          className={cn(
            "flex flex-col items-center gap-1.5 p-3.5 rounded-xl border-2 text-center",
            "border-[var(--border)] hover:border-[var(--primary)] transition-all duration-200",
            "text-[var(--foreground-muted)] hover:text-[var(--primary)] group"
          )}
        >
          <Sprout className="w-5 h-5 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-medium">Register Cooperative</span>
        </Link>
        <Link
          href="/register?type=buyer"
          className={cn(
            "flex flex-col items-center gap-1.5 p-3.5 rounded-xl border-2 text-center",
            "border-[var(--border)] hover:border-[var(--primary)] transition-all duration-200",
            "text-[var(--foreground-muted)] hover:text-[var(--primary)] group"
          )}
        >
          <Building2 className="w-5 h-5 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-medium">Register as Buyer</span>
        </Link>
      </div>

      {/* Accept invitation */}
      <p className="text-center text-xs text-[var(--foreground-subtle)]">
        Have an invitation?{" "}
        <Link
          href="/accept-invitation"
          className="text-[var(--primary)] hover:text-[var(--primary-hover)] font-medium transition-colors"
        >
          Accept here
        </Link>
      </p>
    </div>
  );
}
