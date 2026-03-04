"use client";

/**
 * ShambaCapacityCard — Cooperative Capacity & Certification Display
 *
 * Maps to the "Certification & Analytics Layer" in the ShambaFlow spec.
 * Used inside:
 *   • CRM Dashboard  — full card showing cooperative's own index
 *   • Tender Detail  — compact variant showing bidding cooperative's index
 *   • Coop Public Profile — public-facing capacity snapshot
 *
 * Variant:
 *   "full"    — CRM: complete breakdown with all sub-scores and history
 *   "compact" — Tender: concise version for bid comparison
 *   "public"  — Public cooperative profile
 */

import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  BarChart3,
  TrendingUp,
  Database,
  Users,
  Leaf,
  AlertCircle,
  Download,
} from "lucide-react";

/* ─── Types ───────────────────────────────────────────────────────── */

export type CapacityVariant = "full" | "compact" | "public";

export interface CapacitySubScore {
  label:       string;
  value:       number;    // 0–100
  icon:        React.ElementType;
  description: string;
}

export interface ShambaCapacityCardProps {
  variant?:           CapacityVariant;
  overallScore:       number;       // 0–100
  isVerified?:        boolean;
  verificationBadge?: string;       // e.g. "Gold Verified"
  subScores?:         CapacitySubScore[];
  tenderEligibility?: "open" | "premium" | "none";
  lastUpdated?:       string;
  onDownloadReport?:  () => void;
  onViewDetails?:     () => void;
}

/* ─── Gauge component ─────────────────────────────────────────────── */

function RadialGauge({
  value,
  size = 120,
  strokeWidth = 10,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
}) {
  const r     = (size - strokeWidth) / 2;
  const circ  = 2 * Math.PI * r;
  const arc   = circ * 0.75;                   // 270° sweep
  const fill  = arc * (value / 100);

  // Colour: red → amber → green via oklch
  const scoreColor =
    value >= 70 ? "oklch(0.5578 0.1688 142.89)"    // primary green
    : value >= 40 ? "oklch(0.75 0.15 80)"           // amber
    : "oklch(0.568 0.200 26.4)";                    // destructive red

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="rotate-[135deg]"
    >
      {/* Track */}
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke="oklch(0.9067 0 0)"
        strokeWidth={strokeWidth}
        strokeDasharray={`${arc} ${circ - arc}`}
        strokeLinecap="round"
      />
      {/* Fill */}
      <motion.circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke={scoreColor}
        strokeWidth={strokeWidth}
        strokeDasharray={`${arc} ${circ - arc}`}
        strokeLinecap="round"
        initial={{ strokeDashoffset: arc }}
        animate={{ strokeDashoffset: arc - fill }}
        transition={{ duration: 1.2, ease: "easeOut", delay: 0.2 }}
      />
    </svg>
  );
}

/* ─── Sub-score bar ───────────────────────────────────────────────── */

function SubScoreBar({ score }: { score: CapacitySubScore }) {
  const Icon = score.icon;
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon size={14} className="text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
            {score.label}
          </span>
          <span className="text-xs font-bold text-primary">{score.value}%</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary rounded-full"
            initial={{ width: 0 }}
            whileInView={{ width: `${score.value}%` }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">{score.description}</p>
      </div>
    </div>
  );
}

/* ─── Default sub-scores ──────────────────────────────────────────── */

const DEFAULT_SUB_SCORES: CapacitySubScore[] = [
  { label: "Production Volume",    value: 84, icon: Leaf,     description: "Estimated seasonal output capacity" },
  { label: "Volume Consistency",   value: 78, icon: TrendingUp, description: "Stability across reporting periods" },
  { label: "Data Completeness",    value: 91, icon: Database,  description: "CRM records coverage and quality" },
  { label: "Member Participation", value: 72, icon: Users,     description: "Active member engagement rate" },
];

/* ─── Eligibility config ──────────────────────────────────────────── */

const ELIGIBILITY = {
  premium: { label: "Premium Tender Eligible", className: "bg-secondary/20 text-secondary-foreground border-secondary/30" },
  open:    { label: "Open Tender Eligible",     className: "bg-primary/10 text-primary border-primary/20" },
  none:    { label: "Not Yet Eligible",         className: "bg-muted text-muted-foreground border-border" },
};

/* ─── Full variant ────────────────────────────────────────────────── */

function FullCapacityCard({
  overallScore,
  isVerified,
  verificationBadge,
  subScores = DEFAULT_SUB_SCORES,
  tenderEligibility = "open",
  lastUpdated,
  onDownloadReport,
  onViewDetails,
}: ShambaCapacityCardProps) {
  const elig = ELIGIBILITY[tenderEligibility];

  return (
    <Card className="border border-border bg-card">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold" style={{ fontFamily: "var(--font-sans)" }}>
            Capacity Index
          </CardTitle>
          <div className="flex items-center gap-2">
            {isVerified && (
              <Badge className="gap-1 text-[10px] px-2 bg-primary/10 text-primary border-primary/20 border">
                <ShieldCheck size={10} />
                {verificationBadge ?? "Verified"}
              </Badge>
            )}
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onDownloadReport}>
              <Download size={12} /> Report
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Gauge + score */}
        <div className="flex items-center gap-6">
          <div className="relative flex-shrink-0">
            <RadialGauge value={overallScore} size={120} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-black text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
                {overallScore}
              </span>
              <span className="text-[10px] text-muted-foreground -mt-0.5">/ 100</span>
            </div>
          </div>

          <div className="flex-1">
            <Badge variant="outline" className={`mb-2 text-xs ${elig.className}`}>
              {elig.label}
            </Badge>
            <p className="text-sm text-muted-foreground leading-relaxed" style={{ fontFamily: "var(--font-serif)" }}>
              Your cooperative's overall capacity score is calculated from production volume,
              data completeness, and member participation.
            </p>
            {lastUpdated && (
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Last recalculated: {lastUpdated}
              </p>
            )}
          </div>
        </div>

        {/* Sub-scores */}
        <div className="space-y-4 pt-2 border-t border-border">
          {subScores.map((s) => (
            <SubScoreBar key={s.label} score={s} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Compact variant ─────────────────────────────────────────────── */

function CompactCapacityCard({
  overallScore,
  isVerified,
  tenderEligibility = "open",
}: ShambaCapacityCardProps) {
  const elig  = ELIGIBILITY[tenderEligibility];
  const color =
    overallScore >= 70 ? "text-primary"
    : overallScore >= 40 ? "text-amber-600"
    : "text-destructive";

  return (
    <Card className="border border-border bg-card">
      <CardContent className="p-4 flex items-center gap-4">
        <div className="relative flex-shrink-0">
          <RadialGauge value={overallScore} size={72} strokeWidth={7} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-lg font-black ${color}`} style={{ fontFamily: "var(--font-sans)" }}>
              {overallScore}
            </span>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
              Capacity Index
            </p>
            {isVerified && <ShieldCheck size={13} className="text-primary" />}
          </div>
          <Badge variant="outline" className={`text-[10px] px-1.5 h-4 ${elig.className}`}>
            {elig.label}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Public variant ──────────────────────────────────────────────── */

function PublicCapacityCard({
  overallScore,
  isVerified,
  verificationBadge,
  tenderEligibility = "open",
  subScores = DEFAULT_SUB_SCORES,
}: ShambaCapacityCardProps) {
  const elig  = ELIGIBILITY[tenderEligibility];

  return (
    <Card className="border border-border bg-card">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
            Supply Capacity
          </p>
          <div className="flex items-center gap-2">
            {isVerified && (
              <Badge className="gap-1 text-[10px] bg-primary/10 text-primary border-primary/20 border">
                <ShieldCheck size={9} /> {verificationBadge ?? "Verified"}
              </Badge>
            )}
            <Badge variant="outline" className={`text-[10px] ${elig.className}`}>
              {elig.label}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-4 mb-4">
          <div className="relative flex-shrink-0">
            <RadialGauge value={overallScore} size={88} strokeWidth={8} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-black text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
                {overallScore}
              </span>
              <span className="text-[9px] text-muted-foreground">/ 100</span>
            </div>
          </div>
          <div className="flex-1 space-y-2">
            {subScores.slice(0, 2).map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="flex items-center gap-2">
                  <Icon size={12} className="text-muted-foreground flex-shrink-0" />
                  <span className="text-[11px] text-muted-foreground flex-1">{s.label}</span>
                  <span className="text-[11px] font-semibold text-foreground">{s.value}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Two lowest scores as warning if present */}
        {subScores.some((s) => s.value < 60) && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-100">
            <AlertCircle size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-700">
              Some capacity indicators below 60%. Cooperative may have limited availability.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Adaptive Export ─────────────────────────────────────────────── */

export function ShambaCapacityCard({
  variant = "full",
  ...props
}: ShambaCapacityCardProps) {
  if (variant === "compact") return <CompactCapacityCard {...props} />;
  if (variant === "public")  return <PublicCapacityCard  {...props} />;
  return <FullCapacityCard {...props} />;
}