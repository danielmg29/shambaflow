"use client";

/**
 * ShambaReputationBadge — Reputation & Performance Display
 *
 * Maps to the "Reputation & Performance Ledger" layer in the spec.
 *
 * Variants:
 *  "badge"   — small inline badge with score (used in tables, listings)
 *  "card"    — full card with breakdown (public profile, tender detail)
 *  "history" — timeline of past tender outcomes (CRM/Public profile)
 */

import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Star,
  TrendingUp,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
} from "lucide-react";

/* ─── Types ───────────────────────────────────────────────────────── */

export type ReputationVariant = "badge" | "card" | "history";

export interface TenderOutcome {
  tender_title:     string;
  buyer_name:       string;
  volume_kg:        number;
  status:           "completed" | "partial" | "failed" | "disputed";
  reliability_rating: number;   // 1–5
  date:             string;
}

export interface ShambaReputationBadgeProps {
  variant?:           ReputationVariant;
  reliabilityScore:   number;    // 0–100
  completionRate:     number;    // 0–100
  totalTenders:       number;
  completedTenders:   number;
  outcomes?:          TenderOutcome[];
  className?:         string;
}

/* ─── Score helpers ───────────────────────────────────────────────── */

function scoreLabel(score: number): string {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Fair";
  return "Poor";
}

function scoreColor(score: number): string {
  if (score >= 85) return "text-primary";
  if (score >= 70) return "text-secondary-foreground";
  if (score >= 50) return "text-amber-600";
  return "text-destructive";
}

function scoreBg(score: number): string {
  if (score >= 85) return "bg-primary/10 text-primary border-primary/20";
  if (score >= 70) return "bg-secondary/15 text-secondary-foreground border-secondary/30";
  if (score >= 50) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-destructive/10 text-destructive border-destructive/20";
}

/* ─── Star row ────────────────────────────────────────────────────── */

function StarRating({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <Star
          key={i}
          size={11}
          className={i < Math.round(value) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}
        />
      ))}
    </div>
  );
}

/* ─── Outcome status config ───────────────────────────────────────── */

const OUTCOME_STATUS = {
  completed: { icon: CheckCircle2, label: "Completed",  color: "text-primary" },
  partial:   { icon: AlertTriangle, label: "Partial",   color: "text-amber-600" },
  failed:    { icon: XCircle,       label: "Failed",    color: "text-destructive" },
  disputed:  { icon: AlertTriangle, label: "Disputed",  color: "text-amber-600" },
};

/* ─── Badge variant ───────────────────────────────────────────────── */

function ReputationBadge({
  reliabilityScore,
  className,
}: Pick<ShambaReputationBadgeProps, "reliabilityScore" | "className">) {
  return (
    <Badge
      variant="outline"
      className={`gap-1 text-[10px] px-2 h-5 ${scoreBg(reliabilityScore)} ${className ?? ""}`}
    >
      <Star size={9} className="fill-current" />
      {reliabilityScore}% · {scoreLabel(reliabilityScore)}
    </Badge>
  );
}

/* ─── Card variant ────────────────────────────────────────────────── */

function ReputationCard({
  reliabilityScore,
  completionRate,
  totalTenders,
  completedTenders,
}: ShambaReputationBadgeProps) {
  const metrics = [
    { label: "Reliability Score", value: reliabilityScore, suffix: "%", color: scoreColor(reliabilityScore) },
    { label: "Completion Rate",   value: completionRate,   suffix: "%", color: scoreColor(completionRate) },
  ];

  return (
    <Card className="border border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2" style={{ fontFamily: "var(--font-sans)" }}>
          <TrendingUp size={15} className="text-primary" />
          Reputation Ledger
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Score highlight */}
        <div className={`rounded-xl p-4 border ${scoreBg(reliabilityScore)}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold">Overall Reliability</span>
            <span className="text-2xl font-black" style={{ fontFamily: "var(--font-sans)" }}>
              {reliabilityScore}
              <span className="text-sm font-normal opacity-70">%</span>
            </span>
          </div>
          <p className="text-[10px] opacity-80">{scoreLabel(reliabilityScore)} performance across {totalTenders} tender{totalTenders !== 1 ? "s" : ""}</p>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-3">
          {metrics.map((m) => (
            <div key={m.label} className="text-center p-3 rounded-xl bg-muted/30 border border-border">
              <p className={`text-xl font-bold ${m.color}`} style={{ fontFamily: "var(--font-sans)" }}>
                {m.value}{m.suffix}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{m.label}</p>
            </div>
          ))}
        </div>

        {/* Tender count */}
        <div className="flex items-center justify-between py-2 border-t border-border">
          <span className="text-xs text-muted-foreground">Tenders Completed</span>
          <span className="text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
            {completedTenders} / {totalTenders}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── History variant ─────────────────────────────────────────────── */

function ReputationHistory({
  outcomes = [],
}: Pick<ShambaReputationBadgeProps, "outcomes">) {
  return (
    <Card className="border border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold" style={{ fontFamily: "var(--font-sans)" }}>
          Trade History
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0">
        {outcomes.length === 0 ? (
          <div className="py-8 text-center">
            <Clock size={20} className="mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No completed tenders yet.</p>
          </div>
        ) : (
          outcomes.map((outcome, i) => {
            const cfg = OUTCOME_STATUS[outcome.status];
            const Icon = cfg.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-start gap-3 py-3 border-b border-border last:border-0"
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                  outcome.status === "completed" ? "bg-primary/10" : "bg-muted"
                }`}>
                  <Icon size={12} className={cfg.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate"
                         style={{ fontFamily: "var(--font-sans)" }}>
                        {outcome.tender_title}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {outcome.buyer_name} · {outcome.volume_kg.toLocaleString()} kg
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <StarRating value={outcome.reliability_rating} />
                      <p className="text-[10px] text-muted-foreground mt-0.5">{outcome.date}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Adaptive Export ─────────────────────────────────────────────── */

export function ShambaReputationBadge({
  variant = "badge",
  ...props
}: ShambaReputationBadgeProps) {
  if (variant === "card")    return <ReputationCard {...props} />;
  if (variant === "history") return <ReputationHistory outcomes={props.outcomes} />;
  return <ReputationBadge reliabilityScore={props.reliabilityScore} className={props.className} />;
}