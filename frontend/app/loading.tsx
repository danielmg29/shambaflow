"use client";

/**
 * AnimatedLoader
 * ==============
 * Full-screen loading screen used across all ShambaFlow pages.
 *
 * What it does:
 *  - logo-icon.svg continuously spins
 *  - The icon bounces on the vertical axis
 *  - A single ring orbits the logo to indicate activity
 *  - Title and subtitle fade in after the logo appears
 *  - Three dots pulse in sequence below the text
 *
 * Animation notes:
 *  1. The icon uses a continuous spin plus a repeating Y-axis bounce.
 *  2. All `times` arrays stay within 0–1 and match the keyframe count.
 *  3. The rings and dot indicators repeat independently from the logo motion.
 *  4. Layout stays in normal document flow; only the rings are absolutely positioned.
 */

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

// ── Spinning ring around the logo ─────────────────────────────────────────────

function SpinRing({
  size,
  borderWidth,
  duration,
  reverse = false,
  opacity = 1,
}: {
  size: number;
  borderWidth: number;
  duration: number;
  reverse?: boolean;
  opacity?: number;
}) {
  return (
    <motion.div
      className="absolute rounded-full"
      style={{
        width:       size,
        height:      size,
        top:         "50%",
        left:        "50%",
        marginTop:   -size / 2,
        marginLeft:  -size / 2,
        border:      `${borderWidth}px solid`,
        borderColor: `color-mix(in srgb, var(--primary) ${Math.round(opacity * 100)}%, transparent)`,
        // Cut one segment so it looks like a spinner arc
        borderTopColor: "transparent",
        opacity,
      }}
      animate={{ rotate: reverse ? [0, -360] : [0, 360] }}
      transition={{
        duration,
        ease:   "linear",
        repeat: Infinity,
      }}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Loading() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Avoid a flash of unanimated content on the server
  if (!mounted) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center" />
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-10"
      style={{ background: "var(--background)" }}
    >
      {/* ── Logo + rings container ───────────────────────────────────────── */}
      {/* The outer div is the positioning anchor for the rings and logo. */}
      <div className="relative w-28 h-28 flex items-center justify-center">

        {/* Outer slow ring */}
        <SpinRing size={112} borderWidth={3} duration={3} opacity={0.35} />

        {/* Inner fast ring (reverse direction) */}
        <SpinRing size={84}  borderWidth={3} duration={1.4} reverse opacity={0.7} />

        <motion.img
          src="/logo-icon.svg"
          alt="ShambaFlow"
          className="w-14 h-14 object-contain select-none"
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{
            opacity: 1,
            scale: 1,
            rotate: [0, 360],
            y: [0, 0, -16, -16, 0, 6, 0],
          }}
          transition={{
            opacity: { duration: 0.45 },
            scale: { duration: 0.45, ease: "backOut" },
            rotate: {
              duration: 2.1,
              ease: "linear",
              repeat: Infinity,
            },
            y: {
              duration: 2.8,
              ease: "easeInOut",
              repeat: Infinity,
              times: [0, 0.42, 0.56, 0.64, 0.8, 0.9, 1],
            },
          }}
        />
      </div>

      {/* ── Brand name + subtitle ─────────────────────────────────────────── */}
      <motion.div
        className="text-center"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.35 }}
      >
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ color: "var(--foreground)", fontFamily: "var(--font-sans)" }}
        >
          ShambaFlow
        </h1>
        <p
          className="mt-1.5 text-sm"
          style={{ color: "var(--foreground-muted, #6b7280)" }}
        >
          Loading your cooperative platform…
        </p>
      </motion.div>

      {/* ── Bouncing dots ─────────────────────────────────────────────────── */}
      {/*
        The dots stay in normal document flow below the text.
      */}
      <div className="flex items-center gap-2.5">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-2 h-2 rounded-full"
            style={{ background: "var(--primary)" }}
            animate={{ y: [0, -10, 0], opacity: [0.4, 1, 0.4] }}
            transition={{
              duration: 0.65,
              ease:     "easeInOut",
              repeat:   Infinity,
              delay:    i * 0.15,
            }}
          />
        ))}
      </div>
    </div>
  );
}
