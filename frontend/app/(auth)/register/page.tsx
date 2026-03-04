"use client";

/**
 * Registration Page — Cooperative + Buyer
 *
 * KEY FEATURE: Verification method selector
 * When user chooses "Email" → shows email input for verification
 * When user chooses "Phone (SMS)" → shows phone input for OTP verification
 * The input field DYNAMICALLY CHANGES based on the selection.
 *
 * Multi-step wizard for cooperative registration (4 steps).
 * Single-step for buyer registration.
 */

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Eye, EyeOff, Loader2, AlertCircle, ArrowLeft, ArrowRight,
  Mail, Phone, Sprout, Building2, Check,
} from "lucide-react";
import { authApi, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AnimatedAlert } from "@/components/ui/animated-alert";

type AccountType = "cooperative" | "buyer";
type VerifyMethod = "email" | "sms";

// ─── Step indicator ──────────────────────────────────────────────

const COOP_STEPS = ["Cooperative Details", "Chair Details", "Verification", "Confirm"];

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="flex items-center">
          <div
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold",
              "transition-all duration-300",
              i < current
                ? "bg-[var(--primary)] text-[var(--primary-fg)]"
                : i === current
                ? "bg-[var(--primary)] text-[var(--primary-fg)] ring-4 ring-[var(--primary-light)]"
                : "bg-[var(--background-muted)] text-[var(--foreground-subtle)] border border-[var(--border)]"
            )}
          >
            {i < current ? <Check className="w-4 h-4" /> : i + 1}
          </div>
          {i < total - 1 && (
            <div
              className={cn(
                "w-8 sm:w-12 h-px transition-all duration-300",
                i < current ? "bg-[var(--primary)]" : "bg-[var(--border)]"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Verification method selector (the dynamic switcher) ──────────

function VerifyMethodSelector({
  method,
  onChange,
  email,
  phone,
  onEmailChange,
  onPhoneChange,
  emailError,
  phoneError,
}: {
  method: VerifyMethod;
  onChange: (m: VerifyMethod) => void;
  email: string;
  phone: string;
  onEmailChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  emailError?: string;
  phoneError?: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
          Verification method
        </label>
        <p className="text-xs text-[var(--foreground-muted)] mb-3">
          Choose how you&apos;d like to verify your account. The input below will change
          based on your selection.
        </p>

        {/* Toggle pills */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange("email")}
            className={cn(
              "verify-method-tab",
              method === "email" ? "active" : "inactive"
            )}
          >
            <span className="flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" />
              Email Link
            </span>
          </button>
          <button
            type="button"
            onClick={() => onChange("sms")}
            className={cn(
              "verify-method-tab",
              method === "sms" ? "active" : "inactive"
            )}
          >
            <span className="flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" />
              Phone OTP
            </span>
          </button>
        </div>
      </div>

      {/* Dynamic input — changes based on method */}
      <div
        className="transition-all duration-300 overflow-hidden"
        style={{ opacity: 1 }}
        key={method} /* Force re-render on method change for animation */
      >
        {method === "email" ? (
          <div className="space-y-1.5 page-fade-in">
            <label htmlFor="verify-email" className="block text-sm font-medium text-[var(--foreground)]">
              Verification email address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--foreground-subtle)]" />
              <input
                id="verify-email"
                type="email"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className={cn(
                  "w-full h-11 pl-10 pr-4 rounded-xl border text-sm transition-all duration-150",
                  "bg-[var(--input-bg)] text-[var(--input-text)]",
                  "placeholder:text-[var(--input-placeholder)]",
                  "focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]",
                  emailError
                    ? "border-[var(--destructive)]"
                    : "border-[var(--input-border)] focus:border-[var(--input-border-focus)]"
                )}
              />
            </div>
            {emailError && (
              <p className="text-xs text-[var(--destructive)]">{emailError}</p>
            )}
            <p className="text-xs text-[var(--foreground-subtle)]">
              We&apos;ll send a verification link to this address.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5 page-fade-in">
            <label htmlFor="verify-phone" className="block text-sm font-medium text-[var(--foreground)]">
              Phone number for SMS OTP
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--foreground-subtle)]" />
              <input
                id="verify-phone"
                type="tel"
                value={phone}
                onChange={(e) => onPhoneChange(e.target.value)}
                placeholder="+254712345678"
                autoComplete="tel"
                className={cn(
                  "w-full h-11 pl-10 pr-4 rounded-xl border text-sm transition-all duration-150",
                  "bg-[var(--input-bg)] text-[var(--input-text)]",
                  "placeholder:text-[var(--input-placeholder)]",
                  "focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]",
                  phoneError
                    ? "border-[var(--destructive)]"
                    : "border-[var(--input-border)] focus:border-[var(--input-border-focus)]"
                )}
              />
            </div>
            {phoneError && (
              <p className="text-xs text-[var(--destructive)]">{phoneError}</p>
            )}
            <p className="text-xs text-[var(--foreground-subtle)]">
              E.164 format: +254712345678. A 6-digit OTP will be sent via Infobip.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Field component ──────────────────────────────────────────────

function Field({
  label, id, type = "text", value, onChange, placeholder, error,
  autoComplete, hint, children,
}: {
  label: string; id: string; type?: string; value: string;
  onChange: (v: string) => void; placeholder?: string; error?: string;
  autoComplete?: string; hint?: string; children?: React.ReactNode;
}) {
  const [show, setShow] = useState(false);
  const isPassword = type === "password";

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-[var(--foreground)]">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={isPassword ? (show ? "text" : "password") : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={cn(
            "w-full h-11 px-4 rounded-xl border text-sm transition-all duration-150",
            isPassword && "pr-11",
            "bg-[var(--input-bg)] text-[var(--input-text)]",
            "placeholder:text-[var(--input-placeholder)]",
            "focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]",
            error
              ? "border-[var(--destructive)]"
              : "border-[var(--input-border)] focus:border-[var(--input-border-focus)]"
          )}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--foreground-subtle)]
                       hover:text-[var(--foreground-muted)] transition-colors"
            aria-label={show ? "Hide" : "Show"}
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {children}
      {error && <p className="text-xs text-[var(--destructive)]">{error}</p>}
      {hint && !error && <p className="text-xs text-[var(--foreground-subtle)]">{hint}</p>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────

export default function RegisterPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const initialType  = (searchParams.get("type") as AccountType) ?? "cooperative";

  const [accountType, setAccountType] = useState<AccountType>(initialType);
  const [step, setStep]               = useState(0);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Cooperative fields
  const [coopName, setCoopName]     = useState("");
  const [coopRegNo, setCoopRegNo]   = useState("");
  const [coopType, setCoopType]     = useState("CROP");
  const [coopRegion, setCoopRegion] = useState("");

  const [chairFirst, setChairFirst]   = useState("");
  const [chairLast, setChairLast]     = useState("");
  const [chairEmail, setChairEmail]   = useState("");
  const [chairPhone, setChairPhone]   = useState("");
  const [chairPwd, setChairPwd]       = useState("");
  const [chairPwdC, setChairPwdC]     = useState("");

  // Shared verification
  const [verifyMethod, setVerifyMethod] = useState<VerifyMethod>("email");
  const [verifyEmail, setVerifyEmail]   = useState("");
  const [verifyPhone, setVerifyPhone]   = useState("");

  // Buyer fields
  const [bFirst, setBFirst]         = useState("");
  const [bLast, setBLast]           = useState("");
  const [bEmail, setBEmail]         = useState("");
  const [bPhone, setBPhone]         = useState("");
  const [bPwd, setBPwd]             = useState("");
  const [bPwdC, setBPwdC]           = useState("");
  const [bCompany, setBCompany]     = useState("");
  const [bBuyerType, setBBuyerType] = useState("RETAILER");

  // Sync verify email/phone when chair fields change
  useEffect(() => {
    if (accountType === "cooperative") {
      if (verifyMethod === "email" && chairEmail) setVerifyEmail(chairEmail);
      if (verifyMethod === "sms"   && chairPhone) setVerifyPhone(chairPhone);
    } else {
      if (verifyMethod === "email" && bEmail) setVerifyEmail(bEmail);
      if (verifyMethod === "sms"   && bPhone) setVerifyPhone(bPhone);
    }
  }, [chairEmail, chairPhone, bEmail, bPhone, verifyMethod, accountType]);

  const clearErrors = () => { setError(null); setFieldErrors({}); };

  // ── Cooperative step validation ─────────────────────────────

  function validateCoopStep(): boolean {
    const errs: Record<string, string> = {};
    if (step === 0) {
      if (!coopName.trim())   errs.coopName   = "Cooperative name is required.";
      if (!coopRegNo.trim())  errs.coopRegNo  = "Registration number is required.";
      if (!coopRegion.trim()) errs.coopRegion = "Region is required.";
    }
    if (step === 1) {
      if (!chairFirst.trim()) errs.chairFirst = "First name is required.";
      if (!chairLast.trim())  errs.chairLast  = "Last name is required.";
      if (!chairEmail.trim()) errs.chairEmail = "Email is required.";
      if (!chairPhone.trim()) errs.chairPhone = "Phone number is required.";
      if (chairPwd.length < 8) errs.chairPwd = "Password must be at least 8 characters.";
      if (chairPwd !== chairPwdC) errs.chairPwdC = "Passwords do not match.";
    }
    if (step === 2) {
      if (verifyMethod === "email" && !verifyEmail.trim()) {
        errs.verifyEmail = "Verification email is required.";
      }
      if (verifyMethod === "sms" && !verifyPhone.trim()) {
        errs.verifyPhone = "Phone number is required for SMS verification.";
      }
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function nextStep() {
    clearErrors();
    if (validateCoopStep()) setStep((s) => s + 1);
  }

  function prevStep() {
    clearErrors();
    setStep((s) => Math.max(0, s - 1));
  }

  // ── Submit handlers ─────────────────────────────────────────

  const submitCooperative = useCallback(async () => {
    setLoading(true);
    clearErrors();
    try {
      await authApi.registerCooperative({
        cooperative_name:     coopName.trim(),
        registration_number:  coopRegNo.trim(),
        cooperative_type:     coopType,
        region:               coopRegion.trim(),
        chair_first_name:     chairFirst.trim(),
        chair_last_name:      chairLast.trim(),
        chair_email:          chairEmail.trim(),
        chair_phone:          verifyMethod === "sms" ? verifyPhone.trim() : chairPhone.trim(),
        chair_password:       chairPwd,
        chair_password_confirm: chairPwdC,
        verification_method:  verifyMethod,
      });
      router.push(
        verifyMethod === "sms"
          ? `/verify-otp?phone=${encodeURIComponent(verifyPhone)}&purpose=verification`
          : `/verify-email?email=${encodeURIComponent(chairEmail)}&sent=1`
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
        // Go back to the step with the error
        if (err.fieldErrors.cooperative_name || err.fieldErrors.registration_number) setStep(0);
        else if (err.fieldErrors.chair_email) setStep(1);
      } else {
        setError("Registration failed. Please try again.");
      }
      setLoading(false);
    }
  }, [coopName, coopRegNo, coopType, coopRegion, chairFirst, chairLast, chairEmail, chairPhone,
      chairPwd, chairPwdC, verifyMethod, verifyPhone, router]);

  const submitBuyer = useCallback(async () => {
    const errs: Record<string, string> = {};
    if (!bFirst.trim()) errs.bFirst = "First name required.";
    if (!bLast.trim())  errs.bLast  = "Last name required.";
    if (!bEmail.trim()) errs.bEmail = "Email required.";
    if (!bCompany.trim()) errs.bCompany = "Company name required.";
    if (bPwd.length < 8) errs.bPwd = "Password must be at least 8 characters.";
    if (bPwd !== bPwdC) errs.bPwdC = "Passwords do not match.";
    if (verifyMethod === "sms" && !verifyPhone.trim()) errs.verifyPhone = "Phone required for SMS.";

    if (Object.keys(errs).length) { setFieldErrors(errs); return; }

    setLoading(true);
    clearErrors();
    try {
      await authApi.registerBuyer({
        first_name: bFirst.trim(),
        last_name:  bLast.trim(),
        email:      bEmail.trim(),
        phone:      verifyMethod === "sms" ? verifyPhone.trim() : bPhone.trim(),
        password:   bPwd,
        password_confirm: bPwdC,
        company_name: bCompany.trim(),
        buyer_type:   bBuyerType,
        verification_method: verifyMethod,
      });
      router.push(
        verifyMethod === "sms"
          ? `/verify-otp?phone=${encodeURIComponent(verifyPhone)}&purpose=verification`
          : `/verify-email?email=${encodeURIComponent(bEmail)}&sent=1`
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError("Registration failed. Please try again.");
      }
      setLoading(false);
    }
  }, [bFirst, bLast, bEmail, bPhone, bPwd, bPwdC, bCompany, bBuyerType, verifyMethod, verifyPhone, router]);

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="page-fade-in space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)] font-[var(--font-sans)]">
          Create account
        </h1>
        <p className="mt-1.5 text-sm text-[var(--foreground-muted)]">
          Already have an account?{" "}
          <Link href="/login" className="text-[var(--primary)] hover:text-[var(--primary-hover)] font-medium transition-colors">
            Sign in
          </Link>
        </p>
      </div>

      {/* Account type tabs */}
      <div className="flex gap-2 p-1 bg-[var(--background-muted)] rounded-xl">
        {(["cooperative", "buyer"] as AccountType[]).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => { setAccountType(type); setStep(0); clearErrors(); }}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all duration-200",
              accountType === type
                ? "bg-[var(--surface)] text-[var(--foreground)] shadow-[var(--shadow-sm)]"
                : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
            )}
          >
            {type === "cooperative" ? <Sprout className="w-3.5 h-3.5" /> : <Building2 className="w-3.5 h-3.5" />}
            {type === "cooperative" ? "Cooperative" : "Buyer"}
          </button>
        ))}
      </div>

      {/* Error banner */}
      <AnimatedAlert
        show={Boolean(error)}
        motionKey={error ?? "register-error"}
        className="flex items-start gap-3 p-3.5 rounded-lg bg-[var(--destructive-light)] border border-red-200 dark:border-red-900/40"
      >
        <AlertCircle className="w-4 h-4 text-[var(--destructive)] mt-0.5 shrink-0" />
        <p className="text-sm text-[var(--destructive)]">{error ?? ""}</p>
      </AnimatedAlert>

      {/* ── COOPERATIVE FORM ─────────────────────────────────── */}
      {accountType === "cooperative" && (
        <>
          <StepIndicator current={step} total={COOP_STEPS.length} />

          <div className="space-y-4">
            {/* Step label */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-[var(--border)]" />
              <span className="text-xs font-semibold text-[var(--foreground-muted)] uppercase tracking-wider">
                {COOP_STEPS[step]}
              </span>
              <div className="flex-1 h-px bg-[var(--border)]" />
            </div>

            {/* Step 0: Cooperative Details */}
            {step === 0 && (
              <div className="space-y-4 page-fade-in">
                <Field label="Cooperative Name" id="coopName" value={coopName} onChange={setCoopName}
                  placeholder="e.g. Nyahururu Dairy Farmers Coop" error={fieldErrors.coopName} />
                <Field label="Registration Number" id="coopRegNo" value={coopRegNo} onChange={setCoopRegNo}
                  placeholder="e.g. CPR/2019/000456" error={fieldErrors.coopRegNo}
                  hint="As shown on your government registration certificate." />
                <div className="space-y-1.5">
                  <label htmlFor="coopType" className="block text-sm font-medium text-[var(--foreground)]">
                    Cooperative Type
                  </label>
                  <select
                    id="coopType"
                    value={coopType}
                    onChange={(e) => setCoopType(e.target.value)}
                    className="w-full h-11 px-4 rounded-xl border text-sm transition-all duration-150
                               bg-[var(--input-bg)] text-[var(--input-text)]
                               border-[var(--input-border)] focus:border-[var(--input-border-focus)]
                               focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]"
                  >
                    <option value="CROP">Crop Cooperative</option>
                    <option value="LIVESTOCK">Livestock Cooperative</option>
                    <option value="MIXED">Mixed Cooperative</option>
                  </select>
                </div>
                <Field label="Region / County" id="coopRegion" value={coopRegion} onChange={setCoopRegion}
                  placeholder="e.g. Nyandarua County" error={fieldErrors.coopRegion} />
              </div>
            )}

            {/* Step 1: Chair Details */}
            {step === 1 && (
              <div className="space-y-4 page-fade-in">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="First Name" id="chairFirst" value={chairFirst} onChange={setChairFirst}
                    placeholder="Jane" error={fieldErrors.chairFirst} autoComplete="given-name" />
                  <Field label="Last Name" id="chairLast" value={chairLast} onChange={setChairLast}
                    placeholder="Wanjiru" error={fieldErrors.chairLast} autoComplete="family-name" />
                </div>
                <Field label="Email Address" id="chairEmail" type="email" value={chairEmail}
                  onChange={setChairEmail} placeholder="jane@example.com"
                  error={fieldErrors.chairEmail} autoComplete="email" />
                <Field label="Phone Number" id="chairPhone" type="tel" value={chairPhone}
                  onChange={setChairPhone} placeholder="+254712345678"
                  error={fieldErrors.chairPhone} autoComplete="tel"
                  hint="E.164 format. Used for account security alerts." />
                <Field label="Password" id="chairPwd" type="password" value={chairPwd}
                  onChange={setChairPwd} placeholder="Min. 8 characters"
                  error={fieldErrors.chairPwd} autoComplete="new-password" />
                <Field label="Confirm Password" id="chairPwdC" type="password" value={chairPwdC}
                  onChange={setChairPwdC} placeholder="Repeat password"
                  error={fieldErrors.chairPwdC} autoComplete="new-password" />
              </div>
            )}

            {/* Step 2: Verification method (THE DYNAMIC SWITCHER) */}
            {step === 2 && (
              <div className="page-fade-in">
                <VerifyMethodSelector
                  method={verifyMethod}
                  onChange={setVerifyMethod}
                  email={verifyEmail}
                  phone={verifyPhone}
                  onEmailChange={setVerifyEmail}
                  onPhoneChange={setVerifyPhone}
                  emailError={fieldErrors.verifyEmail}
                  phoneError={fieldErrors.verifyPhone}
                />
              </div>
            )}

            {/* Step 3: Confirm */}
            {step === 3 && (
              <div className="space-y-3 page-fade-in">
                <div className="p-4 rounded-xl bg-[var(--background-muted)] border border-[var(--border)] space-y-2">
                  <h3 className="font-semibold text-sm text-[var(--foreground)] font-[var(--font-sans)]">
                    Review your details
                  </h3>
                  {[
                    ["Cooperative", coopName],
                    ["Type", coopType],
                    ["Region", coopRegion],
                    ["Chair", `${chairFirst} ${chairLast}`],
                    ["Email", chairEmail],
                    ["Verification", verifyMethod === "email" ? `Email → ${verifyEmail}` : `SMS → ${verifyPhone}`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-[var(--foreground-muted)]">{k}</span>
                      <span className="text-[var(--foreground)] font-medium">{v}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-[var(--foreground-subtle)] text-center">
                  By registering you agree to our{" "}
                  <Link href="/terms" className="text-[var(--primary)] hover:underline">Terms of Service</Link>
                  {" "}and{" "}
                  <Link href="/privacy" className="text-[var(--primary)] hover:underline">Privacy Policy</Link>.
                </p>
              </div>
            )}
          </div>

          {/* Navigation buttons */}
          <div className="flex gap-3">
            {step > 0 && (
              <button
                type="button"
                onClick={prevStep}
                className="flex items-center gap-2 px-4 h-11 rounded-xl border border-[var(--border)]
                           text-sm font-medium text-[var(--foreground-muted)] hover:text-[var(--foreground)]
                           hover:bg-[var(--background-muted)] transition-all duration-150"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
            )}
            {step < COOP_STEPS.length - 1 ? (
              <button
                type="button"
                onClick={nextStep}
                className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl
                           bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold
                           hover:bg-[var(--primary-hover)] shadow-[var(--shadow-green)]
                           transition-all duration-200"
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submitCooperative}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl
                           bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold
                           hover:bg-[var(--primary-hover)] shadow-[var(--shadow-green)]
                           disabled:opacity-50 disabled:cursor-not-allowed
                           transition-all duration-200"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {loading ? "Registering…" : "Complete Registration"}
              </button>
            )}
          </div>
        </>
      )}

      {/* ── BUYER FORM ────────────────────────────────────────── */}
      {accountType === "buyer" && (
        <form
          onSubmit={(e) => { e.preventDefault(); submitBuyer(); }}
          className="space-y-4"
          noValidate
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="First Name" id="bFirst" value={bFirst} onChange={setBFirst}
              placeholder="John" error={fieldErrors.bFirst} autoComplete="given-name" />
            <Field label="Last Name" id="bLast" value={bLast} onChange={setBLast}
              placeholder="Kamau" error={fieldErrors.bLast} autoComplete="family-name" />
          </div>
          <Field label="Email Address" id="bEmail" type="email" value={bEmail}
            onChange={setBEmail} placeholder="you@company.com"
            error={fieldErrors.bEmail} autoComplete="email" />
          <Field label="Phone Number" id="bPhone" type="tel" value={bPhone}
            onChange={setBPhone} placeholder="+254712345678"
            error={fieldErrors.bPhone} autoComplete="tel" />
          <Field label="Company Name" id="bCompany" value={bCompany} onChange={setBCompany}
            placeholder="e.g. Nairobi Fresh Markets Ltd" error={fieldErrors.bCompany} />
          <div className="space-y-1.5">
            <label htmlFor="bBuyerType" className="block text-sm font-medium text-[var(--foreground)]">
              Buyer Category
            </label>
            <select
              id="bBuyerType"
              value={bBuyerType}
              onChange={(e) => setBBuyerType(e.target.value)}
              className="w-full h-11 px-4 rounded-xl border text-sm
                         bg-[var(--input-bg)] text-[var(--input-text)]
                         border-[var(--input-border)] focus:border-[var(--input-border-focus)]
                         focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]"
            >
              <option value="PROCESSOR">Processor / Manufacturer</option>
              <option value="RETAILER">Retailer / Supermarket</option>
              <option value="EXPORTER">Exporter</option>
              <option value="NGO">NGO / Development Organisation</option>
              <option value="GOVERNMENT">Government Agency</option>
              <option value="TRADER">Commodity Trader</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <Field label="Password" id="bPwd" type="password" value={bPwd}
            onChange={setBPwd} placeholder="Min. 8 characters"
            error={fieldErrors.bPwd} autoComplete="new-password" />
          <Field label="Confirm Password" id="bPwdC" type="password" value={bPwdC}
            onChange={setBPwdC} placeholder="Repeat password"
            error={fieldErrors.bPwdC} autoComplete="new-password" />

          {/* Verification method selector */}
          <VerifyMethodSelector
            method={verifyMethod}
            onChange={setVerifyMethod}
            email={verifyEmail}
            phone={verifyPhone}
            onEmailChange={setVerifyEmail}
            onPhoneChange={setVerifyPhone}
            emailError={fieldErrors.verifyEmail}
            phoneError={fieldErrors.verifyPhone}
          />

          <p className="text-xs text-[var(--foreground-subtle)] text-center">
            By registering you agree to our{" "}
            <Link href="/terms" className="text-[var(--primary)] hover:underline">Terms</Link>
            {" "}&amp;{" "}
            <Link href="/privacy" className="text-[var(--primary)] hover:underline">Privacy Policy</Link>.
          </p>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-xl bg-[var(--primary)] text-[var(--primary-fg)]
                       text-sm font-semibold hover:bg-[var(--primary-hover)]
                       shadow-[var(--shadow-green)] disabled:opacity-50 disabled:cursor-not-allowed
                       flex items-center justify-center gap-2 transition-all duration-200"
          >
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating account…</> : "Create Buyer Account"}
          </button>
        </form>
      )}
    </div>
  );
}
