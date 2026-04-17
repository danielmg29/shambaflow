"use client";

/**
 * ShambaFlow – Accept Invitation Page
 * =====================================
 * Route: /accept-invitation?token=<invite_token>
 *
 * Flow:
 *  1. Token read from URL search params on mount
 *  2. User sets a permanent password
 *  3. POST /api/auth/accept-invitation/ { token, new_password, confirm_password }
 *  4. On success: store JWT + user, redirect to /crm/<cooperative_id>/dashboard
 *
 * Design: refined agricultural — deep green, warm cream, grounded typography.
 * The invite page is the first impression for every helper — it must feel
 * trustworthy, calm, and welcoming, not corporate.
 */

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Eye, EyeOff, CheckCircle2, XCircle, Loader2,
  Leaf, ShieldCheck, ArrowRight,
} from "lucide-react";
import { apiFetch, saveTokens, saveUser } from "@/lib/api";

// ── Password strength ──────────────────────────────────────────────────────────

function getStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8)    score++;
  if (pw.length >= 12)   score++;
  if (/[A-Z]/.test(pw))  score++;
  if (/[0-9]/.test(pw))  score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { score, label: "Weak",   color: "#ef4444" };
  if (score <= 2) return { score, label: "Fair",   color: "#f59e0b" };
  if (score <= 3) return { score, label: "Good",   color: "#3b82f6" };
  return              { score, label: "Strong", color: "#16a34a" };
}

// ── Rule checks ────────────────────────────────────────────────────────────────

const RULES = [
  { test: (p: string) => p.length >= 8,          label: "At least 8 characters"         },
  { test: (p: string) => /[A-Z]/.test(p),         label: "One uppercase letter"           },
  { test: (p: string) => /[0-9]/.test(p),         label: "One number"                    },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), label: "One special character"          },
];

// ── Main component ─────────────────────────────────────────────────────────────

function AcceptInvitationContent() {
  const searchParams = useSearchParams();
  const router       = useRouter();

  const token = searchParams.get("token") ?? "";

  const [step, setStep] = useState<"form" | "success" | "error">("form");
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [showPw,    setShowPw]    = useState(false);
  const [showCfm,   setShowCfm]   = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [errorMsg,  setErrorMsg]  = useState("");
  const [coopName,  setCoopName]  = useState("");
  const [userName,  setUserName]  = useState("");

  // Validate token is present
  useEffect(() => {
    if (!token) {
      setStep("error");
      setErrorMsg("No invitation token found in this link. Please use the link from your invitation email.");
    }
  }, [token]);

  const strength = getStrength(password);
  const mismatch = confirm.length > 0 && password !== confirm;

  const handleSubmit = async () => {
    setErrorMsg("");

    if (!password || !confirm) {
      setErrorMsg("Please fill in both password fields.");
      return;
    }
    if (password.length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const data = await apiFetch<{
        access: string;
        refresh: string;
        user: { id: string; email: string; first_name: string; last_name: string; user_type: string; helper_role: string; cooperative_id: string };
        cooperative: { id: string; name: string };
        message: string;
      }>("/api/auth/accept-invitation/", {
        method: "POST",
        body: { token, new_password: password, confirm_password: confirm },
        skipAuth: true,
      });

      // Persist session
      saveTokens(data.access, data.refresh);
      saveUser(data.user);

      setCoopName(data.cooperative.name);
      setUserName(`${data.user.first_name} ${data.user.last_name}`.trim());
      setStep("success");

      // Redirect to CRM after short celebration pause
      setTimeout(() => {
        router.push(`/crm/${data.cooperative.id}/dashboard`);
      }, 2400);

    } catch (e: any) {
      const msg = e?.message ?? "Something went wrong. Please try again.";
      if (msg.includes("already been accepted")) {
        setErrorMsg("This invitation has already been used. Please log in normally.");
      } else if (msg.includes("expired")) {
        setErrorMsg("This invitation has expired. Ask your Cooperative Chair to re-send it.");
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Success screen ────────────────────────────────────────────────────────────
  if (step === "success") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center text-center space-y-5"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", delay: 0.1, stiffness: 200 }}
          className="h-20 w-20 rounded-full bg-emerald-100 flex items-center justify-center"
        >
          <CheckCircle2 size={40} className="text-emerald-600" strokeWidth={1.5} />
        </motion.div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>
            Welcome, {userName}!
          </h2>
          <p className="mt-2 text-gray-500 text-sm leading-relaxed">
            You're now part of <strong className="text-gray-700">{coopName}</strong> on ShambaFlow.
            Taking you to the dashboard…
          </p>
        </div>
        <div className="flex items-center gap-2 text-emerald-600 text-sm font-medium">
          <Loader2 size={16} className="animate-spin" />
          Redirecting…
        </div>
      </motion.div>
    );
  }

  // ── Error screen (invalid / missing token) ────────────────────────────────────
  if (step === "error") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center text-center space-y-5"
      >
        <div className="h-20 w-20 rounded-full bg-red-50 flex items-center justify-center">
          <XCircle size={40} className="text-red-500" strokeWidth={1.5} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">Invalid Invitation</h2>
          <p className="mt-2 text-gray-500 text-sm leading-relaxed max-w-xs">{errorMsg}</p>
        </div>
        <a
          href="/login"
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 text-white
            px-5 py-2.5 text-sm font-semibold hover:bg-gray-700 transition"
        >
          Go to Login <ArrowRight size={15} />
        </a>
      </motion.div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>
          Accept Your Invitation
        </h1>
        <p className="mt-2 text-sm text-gray-500 leading-relaxed">
          Set a permanent password to activate your account.
        </p>
      </div>

      {/* Error banner */}
      <AnimatePresence>
        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3"
          >
            <p className="text-sm text-red-700 flex items-start gap-2">
              <XCircle size={16} className="flex-shrink-0 mt-0.5" />
              {errorMsg}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* New password */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700">New Password</label>
        <div className="relative">
          <input
            type={showPw ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="Choose a strong password"
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 pr-11
              text-sm text-gray-900 placeholder:text-gray-400
              focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
          />
          <button
            type="button"
            onClick={() => setShowPw(!showPw)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {/* Strength bar */}
        {password.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2 pt-1">
            <div className="flex gap-1">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-1.5 flex-1 rounded-full transition-all duration-300"
                  style={{ background: i <= strength.score ? strength.color : "#e5e7eb" }}
                />
              ))}
            </div>
            <p className="text-xs font-medium" style={{ color: strength.color }}>{strength.label}</p>
            <ul className="space-y-1">
              {RULES.map(({ test, label }) => {
                const passed = test(password);
                return (
                  <li key={label} className={`flex items-center gap-1.5 text-xs transition-colors ${passed ? "text-emerald-600" : "text-gray-400"}`}>
                    <CheckCircle2 size={12} className={passed ? "opacity-100" : "opacity-30"} />
                    {label}
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </div>

      {/* Confirm password */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700">Confirm Password</label>
        <div className="relative">
          <input
            type={showCfm ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="Repeat your password"
            className={`w-full rounded-xl border bg-white px-4 py-3 pr-11
              text-sm text-gray-900 placeholder:text-gray-400
              focus:outline-none focus:ring-2 focus:border-transparent transition
              ${mismatch
                ? "border-red-300 focus:ring-red-400"
                : "border-gray-200 focus:ring-emerald-500"}`}
          />
          <button
            type="button"
            onClick={() => setShowCfm(!showCfm)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {showCfm ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {mismatch && (
          <p className="text-xs text-red-500 flex items-center gap-1">
            <XCircle size={12} /> Passwords do not match
          </p>
        )}
        {confirm.length > 0 && !mismatch && (
          <p className="text-xs text-emerald-600 flex items-center gap-1">
            <CheckCircle2 size={12} /> Passwords match
          </p>
        )}
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={loading || !password || !confirm || mismatch}
        className="w-full rounded-xl bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900
          px-4 py-3.5 text-sm font-bold text-white transition
          disabled:opacity-50 disabled:cursor-not-allowed
          flex items-center justify-center gap-2"
        style={{ fontFamily: "'Playfair Display', serif", letterSpacing: "0.02em" }}
      >
        {loading ? (
          <><Loader2 size={16} className="animate-spin" /> Activating account…</>
        ) : (
          <><ShieldCheck size={16} /> Activate My Account</>
        )}
      </button>

      <p className="text-center text-xs text-gray-400">
        Already activated your account?{" "}
        <a href="/login" className="text-emerald-700 font-medium hover:underline">Log in</a>
      </p>
    </motion.div>
  );
}

// ── Page wrapper with layout ───────────────────────────────────────────────────

export default function AcceptInvitationPage() {
  return (
    <div className="min-h-screen bg-[#f7f5f0] flex items-center justify-center px-4 py-12"
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      {/* Background texture */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="h-10 w-10 rounded-xl bg-emerald-700 flex items-center justify-center">
            <Leaf size={20} className="text-white" strokeWidth={1.5} />
          </div>
          <span className="text-xl font-bold text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>
            Shamba<span className="text-emerald-700">Flow</span>
          </span>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <Suspense fallback={
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-emerald-600" size={28} />
            </div>
          }>
            <AcceptInvitationContent />
          </Suspense>
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-gray-400 mt-6">
          ShambaFlow — Digital Infrastructure for Organised Agricultural Supply
        </p>
      </div>
    </div>
  );
}