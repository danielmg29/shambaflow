"use client";

/**
 * ShambaLogo — Brand Identity Component
 *
 * Renders the ShambaFlow logo in three size variants.
 * Supports two display modes:
 *   "full"  — icon + "ShambaFlow" wordmark (default)
 *   "icon"  — icon only (for collapsed sidebars, favicons)
 *
 * Image setup:
 *   Copy the provided logo files into your Next.js public directory:
 *     /public/logo-icon.png  → ShambaFlowLogo_Icon.png
 *     /public/logo-full.png  → ShambaFlowLogo_Full.png
 *
 *   Then pass:
 *     <ShambaLogo iconSrc="/logo-icon.png" fullSrc="/logo-full.png" />
 *
 *   Without src props, the component renders a styled SVG placeholder
 *   that matches the brand palette exactly.
 */

import Image from "next/image";

/* ─── Types ───────────────────────────────────────────────────────── */

export type LogoSize = "xs" | "sm" | "md" | "lg" | "xl";
export type LogoMode = "full" | "icon";

export interface ShambaLogoProps {
  size?:     LogoSize;
  mode?:     LogoMode;
  /** Path to the icon-only PNG (e.g. "/logo-icon.png") */
  iconSrc?:  string;
  /** Path to the full logo PNG with wordmark (e.g. "/logo-full.png") */
  fullSrc?:  string;
  className?: string;
}

/* ─── Size config ─────────────────────────────────────────────────── */

const SIZE_CONFIG: Record<LogoSize, {
  iconW:   number;
  iconH:   number;
  fullW:   number;
  fullH:   number;
  text:    string;
  height:  string;
}> = {
  xs: { iconW: 20, iconH: 20, fullW: 80,  fullH: 20, text: "text-sm",   height: "h-5"  },
  sm: { iconW: 28, iconH: 28, fullW: 112, fullH: 28, text: "text-base", height: "h-7"  },
  md: { iconW: 36, iconH: 36, fullW: 144, fullH: 36, text: "text-xl",   height: "h-9"  },
  lg: { iconW: 44, iconH: 44, fullW: 176, fullH: 44, text: "text-2xl",  height: "h-11" },
  xl: { iconW: 56, iconH: 56, fullW: 224, fullH: 56, text: "text-3xl",  height: "h-14" },
};

/* ─── SVG Placeholder Icon ────────────────────────────────────────── */
/* Mirrors the visual language of ShambaFlowLogo_Icon.png              */

function PlaceholderIcon({ width, height }: { width: number; height: number }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Dark green background square */}
      <rect width="100" height="100" rx="14" fill="oklch(0.35 0.13 143)" />

      {/* Book / open pages */}
      <rect x="14" y="44" width="72" height="42" rx="4" fill="oklch(0.25 0.11 143)" />

      {/* Left page line */}
      <line x1="50" y1="44" x2="50" y2="86" stroke="oklch(0.5578 0.1688 142)" strokeWidth="2" />

      {/* Signal / field rows (bottom) */}
      <path d="M20 74 Q50 68 80 74" stroke="oklch(0.5578 0.1688 142)" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <path d="M26 82 Q50 75 74 82" stroke="oklch(0.7815 0.2012 127)" strokeWidth="3" strokeLinecap="round" fill="none" />

      {/* Leaf stem */}
      <path d="M50 42 Q50 28 50 20" stroke="oklch(0.5578 0.1688 142)" strokeWidth="2.5" strokeLinecap="round" />

      {/* Left leaf */}
      <path
        d="M50 36 C44 30 34 28 30 22 C36 22 46 26 50 36Z"
        fill="oklch(0.7815 0.2012 127)"
      />
      {/* Right leaf */}
      <path
        d="M50 32 C56 26 66 22 70 16 C64 18 54 24 50 32Z"
        fill="oklch(0.5578 0.1688 142)"
      />
    </svg>
  );
}

/* ─── Wordmark text (used when no fullSrc supplied) ──────────────── */

function WordMark({ size }: { size: LogoSize }) {
  const cfg = SIZE_CONFIG[size];
  return (
    <span
      className={`font-black tracking-tight text-foreground ${cfg.text}`}
      style={{ fontFamily: "var(--font-sans)", letterSpacing: "-0.02em" }}
    >
      Shamba<span className="text-primary">Flow</span>
    </span>
  );
}

/* ─── Main Component ──────────────────────────────────────────────── */

export function ShambaLogo({
  size      = "md",
  mode      = "full",
  iconSrc,
  fullSrc,
  className,
}: ShambaLogoProps) {
  const cfg = SIZE_CONFIG[size];

  /* ── Icon-only mode ─────────────────────────────────────────────── */
  if (mode === "icon") {
    return (
      <div
        className={`flex-shrink-0 ${className ?? ""}`}
        style={{ width: cfg.iconW, height: cfg.iconH }}
      >
        {iconSrc ? (
          <Image
            src={iconSrc}
            alt="ShambaFlow icon"
            width={cfg.iconW}
            height={cfg.iconH}
            className="object-contain"
            priority
          />
        ) : (
          <PlaceholderIcon width={cfg.iconW} height={cfg.iconH} />
        )}
      </div>
    );
  }

  /* ── Full mode with explicit full logo image ────────────────────── */
  if (mode === "full" && fullSrc) {
    return (
      <div
        className={`flex-shrink-0 ${className ?? ""}`}
        style={{ width: cfg.fullW, height: cfg.fullH }}
      >
        <Image
          src={fullSrc}
          alt="ShambaFlow"
          width={cfg.fullW}
          height={cfg.fullH}
          className="object-contain"
          priority
        />
      </div>
    );
  }

  /* ── Full mode: icon SVG + wordmark (default fallback) ───────────── */
  return (
    <div className={`flex items-center gap-2.5 ${cfg.height} ${className ?? ""}`}>
      {iconSrc ? (
        <Image
          src={iconSrc}
          alt="ShambaFlow icon"
          width={cfg.iconW}
          height={cfg.iconH}
          className="object-contain flex-shrink-0"
          priority
        />
      ) : (
        <div className="flex-shrink-0">
          <PlaceholderIcon width={cfg.iconW} height={cfg.iconH} />
        </div>
      )}
      <WordMark size={size} />
    </div>
  );
}

/* ─── Default export for convenience ─────────────────────────────── */
export default ShambaLogo;