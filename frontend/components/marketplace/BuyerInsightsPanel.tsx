"use client";

import { useId } from "react";
import {
  Activity,
  BarChart3,
  LineChart,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import { cn } from "@/lib/utils";

export interface BuyerAnalyticsCard {
  id: string;
  label: string;
  value: string;
  helper_text: string;
  tone: "default" | "primary" | "accent";
}

export interface BuyerAnalyticsDatum {
  label: string;
  value: number;
}

export interface BuyerAnalyticsChart {
  id: string;
  type: "timeline" | "line" | "bar";
  title: string;
  description: string;
  data: BuyerAnalyticsDatum[];
}

export interface BuyerAnalyticsHighlight {
  label: string;
  value: string;
}

export interface BuyerDashboardAnalytics {
  cards: BuyerAnalyticsCard[];
  charts: BuyerAnalyticsChart[];
  highlights: BuyerAnalyticsHighlight[];
}

function formatChartValue(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function InsightTone(tone: BuyerAnalyticsCard["tone"]) {
  switch (tone) {
    case "primary":
      return {
        border: "border-[color:color-mix(in_oklch,var(--primary)_30%,var(--border))]",
        chip: "bg-[var(--primary-light)] text-[var(--primary)]",
      };
    case "accent":
      return {
        border: "border-[color:color-mix(in_oklch,var(--secondary)_34%,var(--border))]",
        chip: "bg-[color:color-mix(in_oklch,var(--secondary)_18%,var(--surface))] text-[var(--foreground)]",
      };
    default:
      return {
        border: "border-[var(--border)]",
        chip: "bg-[var(--background-muted)] text-[var(--foreground-muted)]",
      };
  }
}

function TrendChart({
  chart,
  strokeColor,
  fillStart,
  fillEnd,
}: {
  chart: BuyerAnalyticsChart;
  strokeColor: string;
  fillStart: string;
  fillEnd: string;
}) {
  const gradientId = useId();
  const width = 420;
  const height = 168;
  const padding = 18;
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
    <div className="space-y-4">
      <div className="rounded-[22px] border border-[var(--border)] bg-[var(--background)] p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full">
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
            </g>
          ))}
        </svg>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {chart.data.slice(-3).map((point) => (
          <div key={point.label} className="rounded-[18px] border border-[var(--border)] bg-[var(--background)] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">
              {point.label}
            </p>
            <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">{formatChartValue(point.value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarChartCard({ chart }: { chart: BuyerAnalyticsChart }) {
  const maxValue = Math.max(...chart.data.map((point) => point.value), 1);

  return (
    <div className="space-y-3">
      {chart.data.map((point) => (
        <div key={point.label} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-[var(--foreground)]">{point.label}</p>
            <p className="text-xs font-semibold text-[var(--foreground-muted)]">{formatChartValue(point.value)}</p>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-[var(--background-muted)]">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.max((point.value / maxValue) * 100, 8)}%`,
                background:
                  "linear-gradient(90deg, color-mix(in oklch, var(--primary) 88%, var(--surface) 12%) 0%, color-mix(in oklch, var(--secondary) 72%, var(--primary) 28%) 100%)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function BuyerInsightsPanel({ analytics }: { analytics: BuyerDashboardAnalytics | null | undefined }) {
  if (!analytics) return null;

  return (
    <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[var(--primary-light)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--primary)]">
            <Sparkles className="h-3.5 w-3.5" />
            Buyer Insights
          </div>
          <h2 className="mt-3 text-xl font-semibold text-[var(--foreground)]">Charts and graphs for your sourcing pulse</h2>
          <p className="mt-2 max-w-3xl text-sm text-[var(--foreground-muted)]">
            These charts turn your tender history into quick reading: response momentum, category mix, negotiation stage spread, and live demand.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {analytics.cards.map((card) => {
          const tone = InsightTone(card.tone);
          return (
            <div key={card.id} className={cn("rounded-[22px] border bg-[var(--background)] p-5", tone.border)}>
              <div className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]", tone.chip)}>
                <Activity className="h-3.5 w-3.5" />
                Insight
              </div>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">{card.label}</p>
              <p className="mt-3 text-3xl font-bold tracking-tight text-[var(--foreground)]">{card.value}</p>
              <p className="mt-2 text-sm text-[var(--foreground-muted)]">{card.helper_text}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {analytics.highlights.map((highlight) => (
          <div key={highlight.label} className="rounded-[18px] border border-[var(--border)] bg-[var(--background)] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">
              {highlight.label}
            </p>
            <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">{highlight.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {analytics.charts.map((chart) => (
          <article key={chart.id} className="overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--background)]">
            <div
              className="border-b border-[var(--border)] px-5 py-4"
              style={{
                background:
                  "linear-gradient(90deg, color-mix(in oklch, var(--primary) 10%, var(--surface)) 0%, color-mix(in oklch, var(--secondary) 12%, var(--surface)) 100%)",
              }}
            >
              <div className="flex items-center gap-2 text-[var(--foreground)]">
                {chart.type === "bar" ? <BarChart3 className="h-4 w-4" /> : chart.type === "line" ? <LineChart className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
                <p className="text-sm font-semibold">{chart.title}</p>
              </div>
              <p className="mt-1 text-sm text-[var(--foreground-muted)]">{chart.description}</p>
            </div>
            <div className="p-5">
              {chart.type === "bar" ? (
                <BarChartCard chart={chart} />
              ) : (
                <TrendChart
                  chart={chart}
                  strokeColor={
                    chart.type === "line"
                      ? "oklch(0.7815 0.2012 127.6331)"
                      : "oklch(0.5578 0.1688 142.8931)"
                  }
                  fillStart={
                    chart.type === "line"
                      ? "color-mix(in oklch, var(--secondary) 26%, transparent)"
                      : "color-mix(in oklch, var(--primary) 26%, transparent)"
                  }
                  fillEnd="rgba(255,255,255,0.02)"
                />
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default BuyerInsightsPanel;
