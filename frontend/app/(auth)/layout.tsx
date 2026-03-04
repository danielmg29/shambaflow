/**
 * Auth Layout — Split-panel design
 *
 * Left panel: ShambaFlow dark green branding with agricultural pattern
 * Right panel: The form — white/dark-surface, responsive
 *
 * On mobile: stacks vertically, left panel becomes a top header strip.
 */

import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "@/components/providers/ThemeToggle";

const stats = [
  { value: "2,400+", label: "Cooperatives" },
  { value: "94K+",   label: "Farmers" },
  { value: "KES 2B", label: "Trade Value" },
];

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen flex">
      {/* ── Left Panel: Branding ─────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-[45%] xl:w-[42%] flex-col justify-between
                   relative overflow-hidden"
        aria-hidden="true"
      >
        {/* Dot pattern overlay */}
        <div
          className="absolute inset-0 pointer-events-none opacity-60
                     bg-[radial-gradient(circle_at_1px_1px,rgba(34,197,94,0.24)_1.5px,transparent_1.5px)]
                     [background-size:18px_18px]
                     dark:opacity-30
                     dark:bg-[radial-gradient(circle_at_1px_1px,rgba(147,206,12,0.16)_1.5px,transparent_1.5px)]"
        />

        {/* Decorative circles */}
        <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full
                        bg-[var(--primary-light)] border border-green-500/20
                        dark:bg-green-500/10 dark:border-green-400/10" />
        <div className="absolute top-32 -right-20 w-64 h-64 rounded-full
                        bg-lime-400/10 border border-lime-500/20
                        dark:bg-green-300/5 dark:border-green-400/5" />

        {/* Fade into the form panel */}
        <div
          className="absolute inset-y-0 right-0 w-24 pointer-events-none
                     bg-gradient-to-r from-transparent to-[var(--background)]"
        />

        {/* Logo */}
        <div className="relative z-10 p-10">
          <Link href="/" className="inline-block">
            <Image
              src="/logo-full.svg"
              alt="ShambaFlow"
              width={200}
              height={48}
              className="h-10 w-auto"
              priority
            />
          </Link>
        </div>

        {/* Central message */}
        <div className="relative z-10 px-10 pb-8">
          <blockquote className="space-y-6">
            <p className="text-2xl xl:text-3xl font-bold text-[var(--foreground)]
                         dark:text-white leading-snug font-[var(--font-sans)]">
              Structured access to
              <br />
              <span className="text-[var(--primary)] dark:text-green-300">
                agricultural markets.
              </span>
            </p>
            <p className="text-[var(--foreground-muted)] dark:text-green-200/80 text-base leading-relaxed max-w-xs">
              The cooperative operating system that transforms fragmented
              agricultural supply into credible, organised trade infrastructure.
            </p>
          </blockquote>

          {/* Stats */}
          <div className="mt-10 grid grid-cols-3 gap-4">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-xl font-bold text-[var(--primary)] dark:text-green-300 font-[var(--font-sans)]">
                  {stat.value}
                </div>
                <div className="text-xs text-[var(--foreground-subtle)] dark:text-green-200/60 mt-0.5">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          {/* Verification badges */}
          <div className="mt-8 flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[var(--foreground-muted)] dark:text-green-200/70 text-xs">
              <svg className="w-4 h-4 text-[var(--primary)] dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
              </svg>
              Brevo-powered email
            </span>
            <span className="flex items-center gap-1.5 text-[var(--foreground-muted)] dark:text-green-200/70 text-xs">
              <svg className="w-4 h-4 text-[var(--primary)] dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
              </svg>
              Infobip SMS OTP
            </span>
          </div>
        </div>

        {/* Bottom copyright */}
        <div className="relative z-10 px-10 py-6 border-t border-[var(--border)] dark:border-green-800/40">
          <p className="text-[var(--foreground-subtle)] dark:text-green-200/40 text-xs">
            © {year} ShambaFlow. All rights reserved.
          </p>
        </div>
      </div>

      {/* ── Right Panel: Form ────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-[var(--background)]">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between px-5 py-4
                           border-b border-[var(--border)]">
          <Link href="/">
            <Image
              src="/logo-full.svg"
              alt="ShambaFlow"
              width={140}
              height={34}
              className="h-8 w-auto"
              priority
            />
          </Link>
          <ThemeToggle size="md" />
        </header>

        {/* Desktop theme toggle */}
        <div className="hidden lg:flex justify-end px-8 pt-6">
          <ThemeToggle size="md" />
        </div>

        {/* Form content */}
        <div className="flex-1 flex items-center justify-center px-5 sm:px-8 py-8">
          <div className="w-full max-w-md">
            {/* Mobile logo */}
            <div className="lg:hidden mb-8 text-center">
              <Image
                src="/logo-icon.svg"
                alt="ShambaFlow"
                width={48}
                height={48}
                className="h-12 w-auto mx-auto mb-3"
              />
            </div>
            {children}
          </div>
        </div>

        {/* Footer */}
        <footer className="px-8 py-5 border-t border-[var(--border)] flex flex-wrap
                          items-center justify-between gap-3">
          <p className="text-xs text-[var(--foreground-subtle)]">
            © {year} ShambaFlow
          </p>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="text-xs text-[var(--foreground-subtle)] hover:text-[var(--foreground)] transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="text-xs text-[var(--foreground-subtle)] hover:text-[var(--foreground)] transition-colors">
              Terms
            </Link>
            <Link href="/contact" className="text-xs text-[var(--foreground-subtle)] hover:text-[var(--foreground)] transition-colors">
              Support
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
