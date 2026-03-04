"use client";

/**
 * ThemeToggle — Light/Dark mode switch button
 *
 * Sizes: "sm" | "md" | "lg"
 * Variants: "icon" (circular icon only) | "labeled" (icon + text)
 *
 * Accessible: aria-label, keyboard navigation, focus ring.
 * Used in: landing nav, CRM topbar, marketplace topbar, auth pages.
 */

import { useTheme } from "@/components/providers/ThemeProvider";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  size?: "sm" | "md" | "lg";
  variant?: "icon" | "labeled";
  className?: string;
}

const sizeMap = {
  sm: { button: "h-8 w-8", icon: "w-3.5 h-3.5", text: "text-xs" },
  md: { button: "h-9 w-9", icon: "w-4 h-4",   text: "text-sm" },
  lg: { button: "h-10 w-10", icon: "w-5 h-5",  text: "text-base" },
};

export function ThemeToggle({
  size = "md",
  variant = "icon",
  className,
}: ThemeToggleProps) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const s = sizeMap[size];

  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  if (variant === "labeled") {
    return (
      <button
        onClick={toggleTheme}
        aria-label={label}
        title={label}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium",
          "bg-[var(--surface)] border border-[var(--border)]",
          "text-[var(--foreground-muted)] hover:text-[var(--foreground)]",
          "hover:border-[var(--border-strong)] hover:bg-[var(--background-muted)]",
          "transition-all duration-150 cursor-pointer",
          s.text,
          className
        )}
      >
        {isDark ? (
          <>
            <Sun className={s.icon} />
            <span>Light</span>
          </>
        ) : (
          <>
            <Moon className={s.icon} />
            <span>Dark</span>
          </>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex items-center justify-center rounded-lg",
        "text-[var(--foreground-muted)] hover:text-[var(--foreground)]",
        "hover:bg-[var(--background-muted)]",
        "border border-transparent hover:border-[var(--border)]",
        "transition-all duration-150 cursor-pointer",
        "focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]",
        s.button,
        className
      )}
    >
      {/* Sun icon — shown in dark mode (click → go light) */}
      <Sun
        className={cn(
          s.icon,
          "absolute transition-all duration-300",
          isDark
            ? "opacity-100 rotate-0 scale-100"
            : "opacity-0 rotate-90 scale-75"
        )}
      />
      {/* Moon icon — shown in light mode (click → go dark) */}
      <Moon
        className={cn(
          s.icon,
          "absolute transition-all duration-300",
          isDark
            ? "opacity-0 -rotate-90 scale-75"
            : "opacity-100 rotate-0 scale-100"
        )}
      />
      <span className="sr-only">{label}</span>
    </button>
  );
}