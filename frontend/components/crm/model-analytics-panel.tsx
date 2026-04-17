"use client";

import { useId } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  HeartPulse,
  Leaf,
  MapPinned,
  ShieldCheck,
  Tractor,
  Users,
  Wallet,
} from "lucide-react";

import { StatCard } from "@/components/shambaflow/StatCard";
import type { CRMAnalyticsCard, CRMAnalyticsChart, CRMAnalyticsResult, ModelSlug } from "@/hooks/useCRMData";

function formatChartValue(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function cardIcon(card: CRMAnalyticsCard, modelSlug: ModelSlug) {
  const className = "h-4 w-4";
  if (card.id.includes("member")) return <Users className={className} />;
  if (card.id.includes("scope")) return <ShieldCheck className={className} />;
  if (card.id.includes("recent") || card.id.includes("latest") || card.id.includes("activity")) {
    return <CalendarClock className={className} />;
  }
  if (card.id.includes("production")) return <Leaf className={className} />;
  if (card.id.includes("livestock")) return <HeartPulse className={className} />;
  if (card.id.includes("financial") || card.id.includes("finance")) return <Wallet className={className} />;
  if (card.id.includes("land")) return <MapPinned className={className} />;
  if (card.id.includes("herd")) return <Tractor className={className} />;
  if (card.id.includes("governance")) return <ShieldCheck className={className} />;
  if (card.id.includes("total") && modelSlug === "finance") return <Wallet className={className} />;
  if (card.id.includes("total") && modelSlug === "production") return <Leaf className={className} />;

  switch (modelSlug) {
    case "members":
      return <Users className={className} />;
    case "land":
      return <MapPinned className={className} />;
    case "herds":
      return <Tractor className={className} />;
    case "production":
      return <Leaf className={className} />;
    case "livestock":
      return <HeartPulse className={className} />;
    case "governance":
      return <ShieldCheck className={className} />;
    case "finance":
      return <Wallet className={className} />;
    default:
      return <BarChart3 className={className} />;
  }
}

function AnalyticsLoadingState() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-32 animate-pulse rounded-2xl border border-border bg-card/70"
          />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="h-72 animate-pulse rounded-2xl border border-border bg-card/70"
          />
        ))}
      </div>
    </div>
  );
}

function AnalyticsTrendCard({
  chart,
  variant = "timeline",
}: {
  chart: CRMAnalyticsChart;
  variant?: "timeline" | "line";
}) {
  const gradientId = useId();
  const width = 420;
  const height = 156;
  const padding = 18;
  const strokeColor = variant === "line" ? "#0f766e" : "#22c55e";
  const fillStart = variant === "line" ? "rgba(15, 118, 110, 0.22)" : "rgba(34, 197, 94, 0.26)";
  const fillEnd = variant === "line" ? "rgba(15, 118, 110, 0.02)" : "rgba(34, 197, 94, 0.02)";
  const haloFill = variant === "line" ? "rgba(15, 118, 110, 0.12)" : "rgba(34, 197, 94, 0.12)";
  const maxValue = Math.max(...chart.data.map((point) => point.value), 1);
  const points = chart.data.map((point, index) => {
    const x = chart.data.length === 1
      ? width / 2
      : padding + (index * (width - padding * 2)) / (chart.data.length - 1);
    const y = height - padding - (point.value / maxValue) * (height - padding * 2);
    return { ...point, x, y };
  });
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = [
    `${padding},${height - padding}`,
    ...points.map((point) => `${point.x},${point.y}`),
    `${width - padding},${height - padding}`,
  ].join(" ");

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="border-b border-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-5 py-4">
        <p className="text-sm font-semibold text-foreground">{chart.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{chart.description}</p>
      </div>

      <div className="space-y-4 p-5">
        <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full">
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={fillStart} />
                <stop offset="100%" stopColor={fillEnd} />
              </linearGradient>
            </defs>
            <polygon points={area} fill={`url(#${gradientId})`} />
            <polyline
              points={polyline}
              fill="none"
              stroke={strokeColor}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {points.map((point) => (
              <g key={point.label}>
                <circle cx={point.x} cy={point.y} r="4.5" fill={strokeColor} />
                <circle cx={point.x} cy={point.y} r="8" fill={haloFill} />
              </g>
            ))}
          </svg>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {chart.data.slice(-3).map((point) => (
            <div key={point.label} className="rounded-xl border border-border/70 bg-background/60 px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {point.label}
              </p>
              <p className="mt-1 text-lg font-bold text-foreground">{formatChartValue(point.value)}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function AnalyticsBarCard({ chart }: { chart: CRMAnalyticsChart }) {
  const maxValue = Math.max(...chart.data.map((point) => point.value), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="border-b border-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-5 py-4">
        <p className="text-sm font-semibold text-foreground">{chart.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{chart.description}</p>
      </div>

      <div className="space-y-3 p-5">
        {chart.data.map((point) => (
          <div key={point.label} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-medium text-foreground">{point.label}</p>
              <p className="text-xs font-semibold text-muted-foreground">{formatChartValue(point.value)}</p>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${Math.max((point.value / maxValue) * 100, 8)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export function ModelAnalyticsPanel({
  modelSlug,
  analytics,
  loading = false,
  error = null,
  onRetry,
}: {
  modelSlug: ModelSlug;
  analytics: Pick<CRMAnalyticsResult, "cards" | "charts" | "highlights"> | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  if (loading && !analytics) return <AnalyticsLoadingState />;

  if (!analytics && error) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
        <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
        {onRetry && (
          <button onClick={onRetry} className="ml-auto text-xs font-semibold text-destructive underline">
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!analytics) return null;

  const hasCharts = analytics.charts.length > 0;
  const hasHighlights = analytics.highlights.length > 0;

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
          {onRetry && (
            <button onClick={onRetry} className="ml-auto text-xs font-semibold text-destructive underline">
              Retry
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {analytics.cards.map((card, index) => (
          <StatCard
            key={card.id}
            label={card.label}
            value={card.value}
            trendValue={card.helper_text}
            icon={cardIcon(card, modelSlug)}
            variant={card.tone}
            delay={index * 0.04}
          />
        ))}
      </div>

      {hasHighlights && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {analytics.highlights.map((highlight) => (
            <div
              key={highlight.label}
              className="rounded-2xl border border-border bg-gradient-to-br from-card via-card to-primary/5 px-4 py-3"
            >
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                {highlight.label}
              </p>
              <p className="mt-2 text-sm font-semibold text-foreground">{highlight.value}</p>
            </div>
          ))}
        </div>
      )}

      {hasCharts ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {analytics.charts.map((chart) =>
            chart.type === "timeline" || chart.type === "line" ? (
              <AnalyticsTrendCard
                key={chart.id}
                chart={chart}
                variant={chart.type === "line" ? "line" : "timeline"}
              />
            ) : (
              <AnalyticsBarCard key={chart.id} chart={chart} />
            )
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <div className="mx-auto max-w-md space-y-2">
            <p className="text-sm font-semibold text-foreground">No analytics to chart yet</p>
            <p className="text-sm text-muted-foreground">
              Add more records to unlock visual trends for this section.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default ModelAnalyticsPanel;
