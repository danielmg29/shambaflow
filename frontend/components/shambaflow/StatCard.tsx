"use client";

/**
 * StatCard — Dashboard Metric Card
 *
 * Used on:
 *  • CRM Dashboard   — member count, capacity score, production totals
 *  • Tender Dashboard — active tenders, bids received, completion rates
 *
 * Variants:
 *  "default" — white card, dark text
 *  "primary" — solid green, white text (hero metric)
 *  "accent"  — soft lime tint, for secondary emphasis
 */

import { ReactNode } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

/* ─── Types ───────────────────────────────────────────────────────── */

export type TrendDirection = "up" | "down" | "neutral";
export type StatVariant    = "default" | "primary" | "accent";

export interface StatCardProps {
  /** Short label shown above the value */
  label:      string;
  /** Primary metric value */
  value:      string | number;
  /** Optional unit appended to the value (e.g. "/ 100", "kg") */
  unit?:      string;
  /** Arrow direction for the trend indicator */
  trend?:     TrendDirection;
  /** Human-readable trend description (e.g. "+12 this month") */
  trendValue?: string;
  /** Lucide icon element shown in the top-right corner */
  icon?:      ReactNode;
  /** Visual style variant */
  variant?:   StatVariant;
  /** Framer Motion stagger delay in seconds */
  delay?:     number;
  /** Optional click handler */
  onClick?:   () => void;
}

/* ─── Component ───────────────────────────────────────────────────── */

export function StatCard({
  label,
  value,
  unit,
  trend        = "neutral",
  trendValue,
  icon,
  variant      = "default",
  delay        = 0,
  onClick,
}: StatCardProps) {
  const TrendIcon =
    trend === "up"   ? TrendingUp   :
    trend === "down" ? TrendingDown :
    Minus;

  const trendColor =
    trend === "up"   ? "text-primary"     :
    trend === "down" ? "text-destructive"  :
    "text-muted-foreground";

  /* Variant-driven tokens */
  const bg    = variant === "primary" ? "bg-primary"        : variant === "accent" ? "bg-secondary/15 border-secondary/30" : "bg-card";
  const label_ = variant === "primary" ? "text-white/70"    : "text-muted-foreground";
  const value_ = variant === "primary" ? "text-white"       : "text-foreground";
  const icon_  = variant === "primary" ? "text-white/50"    : "text-muted-foreground";
  const trend_ = variant === "primary" ? "text-white/70"    : trendColor;

  return (
    <motion.div
      initial    ={{ opacity: 0, scale: 0.96, y: 8 }}
      animate    ={{ opacity: 1, scale: 1, y: 0 }}
      transition ={{ duration: 0.4, delay, ease: "easeOut" }}
      whileHover ={{ y: -2 }}
      onClick    ={onClick}
      className  ={onClick ? "cursor-pointer" : ""}
    >
      <Card className={`border overflow-hidden ${bg}`}>
        <CardContent className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <p
              className={`text-[11px] font-bold uppercase tracking-widest ${label_}`}
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {label}
            </p>
            {icon && (
              <div className={`${icon_} flex-shrink-0`}>{icon}</div>
            )}
          </div>

          {/* Value */}
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-3xl font-black tracking-tight ${value_}`}
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {value}
            </span>
            {unit && (
              <span className={`text-sm font-medium ${label_}`}>{unit}</span>
            )}
          </div>

          {/* Trend */}
          {trendValue && (
            <div className={`flex items-center gap-1 mt-2.5 ${trend_}`}>
              <TrendIcon size={12} />
              <span
                className="text-xs font-semibold"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {trendValue}
              </span>
            </div>
          )}
        </CardContent>

        {/* Accent bar along the bottom for primary variant */}
        {variant === "primary" && (
          <div className="h-0.5 bg-white/20 mx-5 mb-4 rounded-full" />
        )}
      </Card>
    </motion.div>
  );
}

export default StatCard;