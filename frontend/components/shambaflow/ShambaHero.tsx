"use client";

/**
 * ShambaHero — Landing Page Hero Section
 *
 * Variant: "landing" only (no CRM/Tender counterpart; platforms use page-level headers)
 *
 * Design:
 *  • Full-viewport hero with subtle diagonal green gradient background
 *  • Animated word-by-word headline reveal
 *  • Two-column layout: copy left, hero visual placeholder right
 *  • Trust bar below (logos / metrics strip)
 */

import { motion } from "framer-motion";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, CheckCircle2, TrendingUp, Users, Package } from "lucide-react";

/* ─── Animation variants ──────────────────────────────────────────── */

const CONTAINER = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

const WORD = {
  hidden: { opacity: 0, y: 20, filter: "blur(6px)" },
  show:   { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
};

const FADE_UP = {
  hidden: { opacity: 0, y: 24 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const } },
};

/* ─── Trust metrics ───────────────────────────────────────────────── */

const TRUST_METRICS = [
  { icon: Users,    value: "2,400+",  label: "Cooperative Members" },
  { icon: Package,  value: "180+",    label: "Tenders Matched" },
  { icon: TrendingUp, value: "94%",   label: "Fulfillment Rate" },
];

/* ─── Component ───────────────────────────────────────────────────── */

export interface ShambaHeroProps {
  /** Overridable headline words for A/B testing */
  headline?: string[];
  subheadline?: string;
  ctaPrimaryLabel?: string;
  ctaSecondaryLabel?: string;
  onCtaPrimary?: () => void;
  onCtaSecondary?: () => void;
  /** Pass /public/logo-icon.png — used inside the mock dashboard visual */
  iconSrc?: string;
  /** Pass /public/logo-full.png — shown in the hero visual header bar */
  fullSrc?: string;
}

export function ShambaHero({
  headline = [
    "Digital",
    "Infrastructure",
    "for",
    "Organised",
    "Agricultural",
    "Supply.",
  ],
  subheadline = "ShambaFlow connects verified cooperatives to structured buyers through a trusted CRM, dynamic tender marketplace, and reputation system built for African agriculture.",
  ctaPrimaryLabel = "Register Your Cooperative",
  ctaSecondaryLabel = "Explore as a Buyer",
  onCtaPrimary,
  onCtaSecondary,
  iconSrc,
  fullSrc,
}: ShambaHeroProps) {
  return (
    <section className="relative min-h-screen flex flex-col overflow-hidden">
      {/* Background gradient */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.97 0 0) 0%, oklch(0.93 0.02 142) 40%, oklch(0.96 0.01 142) 100%)",
        }}
      />
      {/* Subtle grid texture */}
      <div
        className="absolute inset-0 -z-10 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(oklch(0.30 0 0) 1px, transparent 1px), linear-gradient(90deg, oklch(0.30 0 0) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />
      {/* Top wave / decorative circle */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-primary/5 -translate-y-1/3 translate-x-1/3 -z-10" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-secondary/10 translate-y-1/3 -translate-x-1/4 -z-10" />

      {/* Content */}
      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 lg:pt-36 pb-20 flex flex-col lg:flex-row items-center gap-12 lg:gap-16">

        {/* Left: copy */}
        <div className="flex-1 max-w-xl lg:max-w-none">
          {/* Pre-badge */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.05 }}
            className="mb-6"
          >
            <Badge className="bg-primary/10 text-primary border border-primary/20 text-xs font-semibold px-3 py-1 rounded-full">
              🌱 Built for African Cooperatives
            </Badge>
          </motion.div>

          {/* Headline with per-word animation */}
          <motion.h1
            variants={CONTAINER}
            initial="hidden"
            animate="show"
            className="mb-6 leading-tight"
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "clamp(2.2rem, 5.5vw, 3.75rem)",
              fontWeight: 800,
              letterSpacing: "-0.02em",
            }}
          >
            {headline.map((word, i) => (
              <motion.span key={i} variants={WORD} className="inline-block mr-[0.25em]">
                {["agricultural", "supply.", "infrastructure"].includes(word.toLowerCase()) ? (
                  <span className="text-primary">{word}</span>
                ) : (
                  <span className="text-foreground">{word}</span>
                )}
              </motion.span>
            ))}
          </motion.h1>

          {/* Sub-headline */}
          <motion.p
            variants={FADE_UP}
            initial="hidden"
            animate="show"
            transition={{ delay: 0.55 }}
            className="text-base lg:text-lg text-muted-foreground mb-8 max-w-lg leading-relaxed"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {subheadline}
          </motion.p>

          {/* Feature bullets */}
          <motion.ul
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65, duration: 0.45 }}
            className="space-y-2 mb-9"
          >
            {[
              "Cooperative CRM & Member Registry",
              "Structured Tender Marketplace",
              "Capacity Index & Certification Engine",
              "Reputation Ledger for credible trade",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-sm text-foreground/80"
                  style={{ fontFamily: "var(--font-serif)" }}>
                <CheckCircle2 size={15} className="text-primary flex-shrink-0" />
                {item}
              </li>
            ))}
          </motion.ul>

          {/* CTA row */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.75, duration: 0.45 }}
            className="flex flex-col sm:flex-row gap-3"
          >
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 font-bold text-base px-7 gap-2"
              onClick={onCtaPrimary}
            >
              {ctaPrimaryLabel}
              <ArrowRight size={17} />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="font-semibold text-base px-7 border-2"
              onClick={onCtaSecondary}
            >
              {ctaSecondaryLabel}
            </Button>
          </motion.div>
        </div>

        {/* Right: Hero visual placeholder */}
        <motion.div
          initial={{ opacity: 0, scale: 0.93, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="flex-1 w-full max-w-lg lg:max-w-none"
        >
          <HeroVisualPlaceholder fullSrc={fullSrc} iconSrc={iconSrc} />
        </motion.div>
      </div>

      {/* Trust bar */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9, duration: 0.45 }}
        className="border-t border-border bg-white/60 backdrop-blur-sm"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-12">
            {TRUST_METRICS.map((m) => {
              const Icon = m.icon;
              return (
                <div key={m.label} className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon size={15} className="text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
                      {m.value}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{m.label}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>
    </section>
  );
}

/* ─── Hero Visual Placeholder ─────────────────────────────────────── */

function HeroVisualPlaceholder({ fullSrc, iconSrc }: { fullSrc?: string; iconSrc?: string }) {
  /**
   * Placeholder for the hero dashboard screenshot or illustration.
   * Replace the inner content with:
   *   <Image src="/hero-dashboard.png" alt="ShambaFlow Dashboard" fill className="object-cover rounded-2xl" />
   */
  return (
    <div className="relative">
      {/* Main card mock */}
      <div className="rounded-2xl bg-white border border-border shadow-xl overflow-hidden aspect-[4/3]">
        {/* Top bar */}
        <div className="h-10 bg-sidebar border-b border-sidebar-border flex items-center px-4 gap-2">
          {/* Traffic-light dots */}
          <div className="w-3 h-3 rounded-full bg-muted" />
          <div className="w-3 h-3 rounded-full bg-muted" />
          <div className="w-3 h-3 rounded-full bg-muted" />
          {/* Logo in top-bar */}
          {fullSrc ? (
            <div className="ml-2 flex-shrink-0">
              <Image src={fullSrc} alt="ShambaFlow" width={80} height={20} className="object-contain h-5 w-auto" />
            </div>
          ) : iconSrc ? (
            <div className="ml-2 flex-shrink-0">
              <Image src={iconSrc} alt="ShambaFlow" width={20} height={20} className="object-contain h-5 w-5" />
            </div>
          ) : (
            <span className="ml-2 text-[11px] font-black text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
              Shamba<span className="text-primary">Flow</span>
            </span>
          )}
          <div className="flex-1 mx-2 h-4 rounded bg-muted/50" />
        </div>

        {/* Mock dashboard body */}
        <div className="flex h-full">
          {/* Sidebar mock */}
          <div className="w-16 lg:w-20 bg-sidebar border-r border-sidebar-border h-full flex flex-col gap-2 p-2 pt-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className={`h-7 rounded-lg ${i === 0 ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </div>

          {/* Content mock */}
          <div className="flex-1 p-4 bg-muted/20 overflow-hidden">
            {/* Stat cards */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              {["bg-primary", "bg-secondary/50", "bg-muted"].map((c, i) => (
                <div key={i} className={`${c} rounded-xl h-14 opacity-80`} />
              ))}
            </div>
            {/* Table mock rows */}
            <div className="bg-white rounded-xl border border-border p-3 space-y-2">
              <div className="h-3 bg-muted rounded w-1/3" />
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-2">
                  <div className="w-6 h-6 rounded-full bg-muted flex-shrink-0" />
                  <div className="flex-1 space-y-1">
                    <div className="h-2 bg-muted rounded w-3/4" />
                    <div className="h-2 bg-muted/50 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Floating accent cards */}
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -bottom-4 -left-6 bg-white border border-border rounded-xl shadow-lg p-3 flex items-center gap-2.5 min-w-[140px]"
      >
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <TrendingUp size={14} className="text-primary" />
        </div>
        <div>
          <p className="text-xs font-bold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
            Capacity Index
          </p>
          <p className="text-[10px] text-muted-foreground">87 / 100</p>
        </div>
      </motion.div>

      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        className="absolute -top-4 -right-4 bg-primary text-white rounded-xl shadow-lg p-3 text-center min-w-[110px]"
      >
        <p className="text-xl font-black" style={{ fontFamily: "var(--font-sans)" }}>48</p>
        <p className="text-[10px] text-white/80">Active Tenders</p>
      </motion.div>
    </div>
  );
}