"use client";

/**
 * ShambaNav — Adaptive Navigation Component
 *
 * Variants:
 *  "landing" — transparent → solid on scroll, marketing links, two CTAs
 *  "crm"     — compact top bar inside the CRM shell (sidebar handles primary nav)
 *  "tender"  — compact top bar inside the Buyer Marketplace shell
 *
 * Logo is now imported from ShambaLogo.tsx — pass iconSrc + fullSrc for
 * real images, omit for the SVG placeholder.
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bell, Menu, X, ChevronDown, Settings, LogOut, User,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ShambaLogo } from "@/components/shambaflow/ShambaLogo";

/* ─── Types ───────────────────────────────────────────────────────── */

export type NavVariant = "landing" | "crm" | "tender";

export interface NavUser {
  name:            string;
  role:            string;
  avatarInitials:  string;
  avatarSrc?:      string;
}

export interface ShambaNavProps {
  variant?:          NavVariant;
  user?:             NavUser | null;
  cooperativeName?:  string;
  notificationCount?: number;
  onMenuToggle?:     () => void;
  /** Path to icon-only logo PNG (copy from /public/logo-icon.png) */
  iconSrc?:          string;
  /** Path to full logo PNG (copy from /public/logo-full.png) */
  fullSrc?:          string;
  className?:        string;
}

/* ─── Avatar helper ───────────────────────────────────────────────── */

function Avatar({ user, size = "sm" }: { user: NavUser; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "w-7 h-7" : "w-8 h-8";
  if (user.avatarSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarSrc}
        alt={user.name}
        className={`${dim} rounded-full object-cover`}
      />
    );
  }
  return (
    <div className={`${dim} rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold`}>
      {user.avatarInitials}
    </div>
  );
}

/* ─── Landing Nav ─────────────────────────────────────────────────── */

function LandingNav({ iconSrc, fullSrc }: Pick<ShambaNavProps, "iconSrc" | "fullSrc">) {
  const [scrolled,    setScrolled]    = useState(false);
  const [mobileOpen,  setMobileOpen]  = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const links = [
    { label: "How it works",    href: "#how-it-works"  },
    { label: "Cooperatives",    href: "#cooperatives"  },
    { label: "Marketplace",     href: "#marketplace"   },
    { label: "Pricing",         href: "#pricing"       },
  ];

  return (
    <motion.nav
      initial    ={{ y: -80, opacity: 0 }}
      animate    ={{ y: 0, opacity: 1 }}
      transition ={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-white/95 backdrop-blur-md border-b border-border shadow-sm"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 lg:h-20">
          <ShambaLogo size="sm" iconSrc={iconSrc} fullSrc={fullSrc} />

          {/* Desktop links */}
          <div className="hidden lg:flex items-center gap-8">
            {links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-sm font-semibold text-foreground/70 hover:text-primary transition-colors duration-200"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Desktop CTA */}
          <div className="hidden lg:flex items-center gap-3">
            <Button variant="ghost" size="sm" className="font-semibold">
              Sign in
            </Button>
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/90 font-bold px-5 shadow-sm"
            >
              Get Started Free
            </Button>
          </div>

          {/* Mobile toggle */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden p-2 rounded-lg text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial ={{ opacity: 0, height: 0 }}
            animate ={{ opacity: 1, height: "auto" }}
            exit    ={{ opacity: 0, height: 0 }}
            className="lg:hidden bg-white border-t border-border overflow-hidden"
          >
            <div className="px-4 py-4 space-y-1">
              {links.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="block px-3 py-2.5 rounded-lg text-sm font-semibold text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
                >
                  {link.label}
                </a>
              ))}
              <div className="pt-3 flex flex-col gap-2">
                <Button variant="outline" size="sm" className="w-full font-semibold">Sign in</Button>
                <Button size="sm" className="w-full bg-primary hover:bg-primary/90 font-bold">Get Started Free</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}

/* ─── CRM Top Bar ─────────────────────────────────────────────────── */

function CRMNav({
  user, cooperativeName, notificationCount = 0, onMenuToggle, iconSrc,
}: Pick<ShambaNavProps, "user" | "cooperativeName" | "notificationCount" | "onMenuToggle" | "iconSrc">) {
  return (
    <header className="h-14 bg-sidebar border-b border-sidebar-border flex items-center px-4 gap-4 w-full">
      <button
        onClick={onMenuToggle}
        className="lg:hidden p-1.5 rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
      >
        <Menu size={20} />
      </button>

      <div className="hidden lg:flex items-center gap-2 flex-1">
        <span
          className="text-sm font-bold text-sidebar-foreground/80"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {cooperativeName ?? "My Cooperative"}
        </span>
        <Badge variant="secondary" className="text-xs">CRM</Badge>
      </div>

      <div className="lg:hidden flex-1">
        <ShambaLogo size="xs" iconSrc={iconSrc} />
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <button className="relative p-2 rounded-lg text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
          <Bell size={18} />
          {notificationCount > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-primary text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {notificationCount > 9 ? "9+" : notificationCount}
            </span>
          )}
        </button>

        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-sidebar-accent transition-colors">
                <Avatar user={user} />
                <div className="hidden sm:block text-left">
                  <p className="text-xs font-bold text-sidebar-foreground leading-none">{user.name}</p>
                  <p className="text-[10px] text-sidebar-foreground/60 leading-none mt-0.5">{user.role}</p>
                </div>
                <ChevronDown size={14} className="text-sidebar-foreground/60 hidden sm:block" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem className="gap-2 text-sm"><User size={14} /> Profile</DropdownMenuItem>
              <DropdownMenuItem className="gap-2 text-sm"><Settings size={14} /> Settings</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2 text-sm text-destructive focus:text-destructive">
                <LogOut size={14} /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}

/* ─── Tender Top Bar ──────────────────────────────────────────────── */

function TenderNav({
  user, notificationCount = 0, onMenuToggle, iconSrc,
}: Pick<ShambaNavProps, "user" | "notificationCount" | "onMenuToggle" | "iconSrc">) {
  return (
    <header className="h-14 bg-white border-b border-border flex items-center px-4 gap-4 w-full">
      <button
        onClick={onMenuToggle}
        className="lg:hidden p-1.5 rounded-md text-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
      >
        <Menu size={20} />
      </button>

      <div className="hidden lg:block flex-1">
        <ShambaLogo size="xs" iconSrc={iconSrc} />
      </div>
      <div className="lg:hidden flex-1">
        <ShambaLogo size="xs" iconSrc={iconSrc} />
      </div>

      <div className="flex items-center gap-3 ml-auto">
        <Badge className="hidden sm:flex bg-secondary/20 text-secondary-foreground border-0 font-semibold text-xs">
          Buyer Marketplace
        </Badge>

        <button className="relative p-2 rounded-lg text-foreground/60 hover:text-foreground hover:bg-muted transition-colors">
          <Bell size={18} />
          {notificationCount > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-primary text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {notificationCount > 9 ? "9+" : notificationCount}
            </span>
          )}
        </button>

        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted transition-colors">
                <Avatar user={user} />
                <div className="hidden sm:block text-left">
                  <p className="text-xs font-bold leading-none">{user.name}</p>
                  <p className="text-[10px] text-muted-foreground leading-none mt-0.5">{user.role}</p>
                </div>
                <ChevronDown size={14} className="text-muted-foreground hidden sm:block" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem className="gap-2 text-sm"><User size={14} /> Buyer Profile</DropdownMenuItem>
              <DropdownMenuItem className="gap-2 text-sm"><Settings size={14} /> Settings</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2 text-sm text-destructive focus:text-destructive">
                <LogOut size={14} /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}

/* ─── Adaptive Export ─────────────────────────────────────────────── */

export function ShambaNav({
  variant           = "landing",
  user,
  cooperativeName,
  notificationCount = 0,
  onMenuToggle,
  iconSrc,
  fullSrc,
}: ShambaNavProps) {
  if (variant === "crm") {
    return (
      <CRMNav
        user={user}
        cooperativeName={cooperativeName}
        notificationCount={notificationCount}
        onMenuToggle={onMenuToggle}
        iconSrc={iconSrc}
      />
    );
  }
  if (variant === "tender") {
    return (
      <TenderNav
        user={user}
        notificationCount={notificationCount}
        onMenuToggle={onMenuToggle}
        iconSrc={iconSrc}
      />
    );
  }
  return <LandingNav iconSrc={iconSrc} fullSrc={fullSrc} />;
}

/* Named re-export kept for backwards compat with ShambaSidebar, page.tsx */
export { ShambaLogo };