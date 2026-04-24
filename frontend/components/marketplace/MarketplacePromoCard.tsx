"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface MarketplacePromotion {
  id: string;
  placement: string;
  eyebrow: string;
  title: string;
  body: string;
  highlight: string;
  surface_theme: "CANOPY" | "SUNRISE" | "SKYLINE" | "MIDNIGHT";
  primary_cta_label: string;
  primary_cta_href: string;
  secondary_cta_label: string;
  secondary_cta_href: string;
}

const promotionThemes: Record<MarketplacePromotion["surface_theme"], { shell: CSSProperties; panelClassName: string }> = {
  CANOPY: {
    shell: {
      background:
        "radial-gradient(circle at top right, rgba(255,255,255,0.14) 0%, transparent 28%), linear-gradient(140deg, color-mix(in oklch, var(--foreground) 82%, var(--primary) 18%) 0%, color-mix(in oklch, var(--primary) 74%, var(--foreground) 26%) 48%, color-mix(in oklch, var(--primary-light) 82%, var(--surface) 18%) 100%)",
      boxShadow: "0 24px 70px color-mix(in oklch, var(--primary) 18%, transparent)",
    },
    panelClassName: "border-white/16 bg-black/14 text-white/82",
  },
  SUNRISE: {
    shell: {
      background:
        "radial-gradient(circle at top left, rgba(255,255,255,0.14) 0%, transparent 30%), linear-gradient(140deg, color-mix(in oklch, var(--foreground) 80%, var(--warning) 20%) 0%, color-mix(in oklch, var(--warning) 70%, var(--foreground) 30%) 42%, color-mix(in oklch, var(--secondary) 82%, var(--surface) 18%) 100%)",
      boxShadow: "0 24px 70px color-mix(in oklch, var(--warning) 20%, transparent)",
    },
    panelClassName: "border-white/16 bg-black/14 text-white/82",
  },
  SKYLINE: {
    shell: {
      background:
        "radial-gradient(circle at top right, rgba(255,255,255,0.16) 0%, transparent 30%), linear-gradient(140deg, color-mix(in oklch, var(--foreground) 80%, var(--info) 20%) 0%, color-mix(in oklch, var(--info) 72%, var(--foreground) 28%) 45%, color-mix(in oklch, var(--surface) 80%, var(--info) 20%) 100%)",
      boxShadow: "0 24px 70px color-mix(in oklch, var(--info) 20%, transparent)",
    },
    panelClassName: "border-white/16 bg-black/14 text-white/82",
  },
  MIDNIGHT: {
    shell: {
      background:
        "radial-gradient(circle at top left, rgba(255,255,255,0.1) 0%, transparent 28%), linear-gradient(145deg, color-mix(in oklch, var(--foreground) 90%, black 10%) 0%, color-mix(in oklch, var(--foreground) 72%, var(--surface) 28%) 52%, color-mix(in oklch, var(--surface) 80%, black 20%) 100%)",
      boxShadow: "0 24px 70px color-mix(in oklch, black 16%, transparent)",
    },
    panelClassName: "border-white/14 bg-white/8 text-white/78",
  },
};

function PromoLink({
  href,
  label,
  secondary = false,
}: {
  href: string;
  label: string;
  secondary?: boolean;
}) {
  if (!href || !label) return null;
  const isExternal = /^https?:\/\//i.test(href);
  const className = secondary
    ? "h-10 rounded-2xl border-white/18 bg-black/12 px-4 text-white hover:bg-black/20"
    : "h-10 rounded-2xl bg-white px-4 text-[color:color-mix(in_oklch,var(--foreground)_20%,black)] hover:bg-white/90";

  if (isExternal) {
    return (
      <Button asChild variant={secondary ? "outline" : "secondary"} className={className}>
        <a href={href} target="_blank" rel="noreferrer">
          {label}
          <ArrowUpRight className="h-4 w-4" />
        </a>
      </Button>
    );
  }

  return (
    <Button asChild variant={secondary ? "outline" : "secondary"} className={className}>
      <Link href={href}>
        {label}
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </Button>
  );
}

export function MarketplacePromoCard({
  promotion,
  className,
}: {
  promotion: MarketplacePromotion;
  className?: string;
}) {
  const theme = promotionThemes[promotion.surface_theme] ?? promotionThemes.CANOPY;

  return (
    <article
      className={cn("overflow-hidden rounded-[28px] border border-white/10 px-5 py-5 text-white sm:px-6 sm:py-6", className)}
      style={theme.shell}
    >
      <div className="flex h-full flex-col gap-5">
        <div className="space-y-3">
          <Badge className="w-fit border-white/12 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white shadow-none hover:bg-white/10">
            {promotion.eyebrow || "Featured campaign"}
          </Badge>
          <div className="space-y-2">
            <h3 className="max-w-2xl text-2xl font-semibold tracking-tight text-white">
              {promotion.title}
            </h3>
            {promotion.body ? (
              <p className="max-w-2xl text-sm leading-7 text-white/82">
                {promotion.body}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-auto flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className={cn("rounded-[22px] border px-4 py-4 backdrop-blur-sm", theme.panelClassName)}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/62">
              Marketplace signal
            </p>
            <p className="mt-2 text-sm font-medium text-white">
              {promotion.highlight || "Position your cooperative for more buyer-ready briefs with sharper qualification and response timing."}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <PromoLink href={promotion.primary_cta_href} label={promotion.primary_cta_label} />
            <PromoLink href={promotion.secondary_cta_href} label={promotion.secondary_cta_label} secondary />
          </div>
        </div>
      </div>
    </article>
  );
}
