"use client";

/**
 * ShambaSidebar — Adaptive Sidebar Navigation
 *
 * Variants:
 *  "crm"    — Cooperative CRM modules (Chair/Helper workflow)
 *  "tender" — Buyer Marketplace modules
 *
 * Follows the module structure defined in the ShambaFlow product spec.
 * On mobile it slides in/out via AnimatePresence.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { ShambaLogo } from "./ShambaLogo";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  FileText,
  BarChart3,
  Briefcase,
  Settings,
  CreditCard,
  ShieldCheck,
  Building2,
  Leaf,
  Heart,
  Gavel,
  Wallet,
  PlusCircle,
  Search,
  Star,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";

/* ─── Types ───────────────────────────────────────────────────────── */

export type SidebarVariant = "crm" | "tender";

export interface SidebarItem {
  id: string;
  label: string;
  icon: React.ElementType;
  href: string;
  badge?: string | number;
  subItems?: SidebarItem[];
}

export interface ShambaSidebarProps {
  variant?: SidebarVariant;
  items?: SidebarItem[];
  activeId?: string;
  onNavigate?: (id: string, href: string) => void;
  cooperativeName?: string;
  cooperativeType?: "Crop" | "Livestock" | "Mixed";
  buyerCompanyName?: string;
  isOpen?: boolean;           // Mobile: controlled open state
  onClose?: () => void;
  className?: string;
}

/* ─── Nav data ────────────────────────────────────────────────────── */

const CRM_NAV: SidebarItem[] = [
  { id: "dashboard",   label: "Dashboard",        icon: LayoutDashboard, href: "/crm/dashboard" },
  { id: "members",     label: "Members",           icon: Users,           href: "/crm/members",    badge: undefined },
  { id: "production",  label: "Production",        icon: Leaf,            href: "/crm/production" },
  { id: "livestock",   label: "Livestock",          icon: Heart,           href: "/crm/livestock" },
  { id: "governance",  label: "Governance",         icon: Gavel,           href: "/crm/governance" },
  { id: "finance",     label: "Finance",            icon: Wallet,          href: "/crm/finance" },
  { id: "form-builder",       label: "Form Builder",       icon: ClipboardList,   href: "/crm/form-builder" },
  { id: "certification", label: "Certification",   icon: ShieldCheck,     href: "/crm/certification" },
  { id: "settings",    label: "Settings",           icon: Settings,        href: "/crm/settings" },
];

const TENDER_NAV: SidebarItem[] = [
  { id: "dashboard",     label: "Dashboard",         icon: LayoutDashboard, href: "/tender" },
  { id: "create-tender", label: "Create Tender",     icon: PlusCircle,      href: "/tender/create" },
  { id: "my-tenders",   label: "My Tenders",         icon: Briefcase,       href: "/tender/my-tenders" },
  { id: "browse",       label: "Browse Cooperatives",icon: Search,          href: "/tender/cooperatives" },
  { id: "bids",         label: "Bids Received",      icon: FileText,        href: "/tender/bids" },
  { id: "shortlisted",  label: "Shortlisted",        icon: Star,            href: "/tender/shortlisted" },
  { id: "history",      label: "Trade History",      icon: BarChart3,       href: "/tender/history" },
  { id: "profile",      label: "Buyer Profile",      icon: Building2,       href: "/tender/profile" },
  { id: "billing",      label: "Billing",            icon: CreditCard,      href: "/tender/billing" },
  { id: "settings",     label: "Settings",           icon: Settings,        href: "/tender/settings" },
];

/* ─── Sidebar Item ────────────────────────────────────────────────── */

function NavItem({
  item,
  isActive,
  variant,
  onClick,
  index,
  collapsed = false,
}: {
  item: SidebarItem;
  isActive: boolean;
  variant: SidebarVariant;
  onClick: () => void;
  index: number;
  collapsed?: boolean;
}) {
  const Icon = item.icon;
  const activeClass =
    variant === "crm"
      ? "bg-sidebar-primary text-sidebar-primary-foreground"
      : "bg-primary/10 text-primary";
  const inactiveClass =
    "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent";

  return (
    <motion.button
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "w-full flex items-center rounded-lg text-left transition-colors duration-150 group",
        collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
        isActive ? activeClass : inactiveClass
      )}
    >
      <Icon size={17} className="flex-shrink-0" />

      {collapsed ? (
        <span className="sr-only">{item.label}</span>
      ) : (
        <span
          className="flex-1 text-sm font-medium"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {item.label}
        </span>
      )}

      {!collapsed && item.badge !== undefined && (
        <Badge
          className={`text-[10px] px-1.5 h-4 min-w-[1rem] justify-center border-0 ${
            isActive
              ? "bg-white/20 text-white"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {item.badge}
        </Badge>
      )}
      {!collapsed && isActive && <ChevronRight size={14} className="opacity-60" />}
    </motion.button>
  );
}

/* ─── Sidebar Shell ───────────────────────────────────────────────── */

function SidebarShell({
  variant,
  items,
  activeId = "dashboard",
  onNavigate,
  cooperativeName,
  cooperativeType,
  buyerCompanyName,
  onClose,
  collapsed = false,
  onToggleCollapsed,
}: Omit<ShambaSidebarProps, "isOpen" | "className"> & {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const navItems = items ?? (variant === "crm" ? CRM_NAV : TENDER_NAV);

  return (
    <div
      className={cn(
        "relative z-30 flex h-full flex-shrink-0 flex-col overflow-y-hidden overflow-x-visible border-r border-sidebar-border bg-sidebar",
        "transition-[width] duration-200 ease-in-out",
        collapsed ? "w-20" : "w-64"
      )}
    >
      {/* Logo + controls */}
      <div
        className={cn(
          "relative flex items-center justify-center border-b border-sidebar-border flex-shrink-0",
          collapsed ? "h-20 px-2" : "h-20 px-4"
        )}
      >
        <ShambaLogo
          size="md"
          mode={collapsed ? "icon" : "full"}
          fullSrc="/logo-full.svg"
          iconSrc="/logo-icon.svg"
          className="mx-auto"
        />
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="fixed z-[80] hidden h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-sidebar-border bg-background text-sidebar-foreground/70 shadow-xl ring-2 ring-background transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:inline-flex"
            style={{
              top: "40px",
              left: collapsed ? "80px" : "256px",
            }}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        )}
        <div className="absolute right-2 flex items-center gap-1.5">
          {onClose && (
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
              aria-label="Close sidebar"
              title="Close sidebar"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Cooperative / Buyer context banner */}
      {!collapsed && (
        <div className="px-4 py-3 border-b border-sidebar-border flex-shrink-0">
          {variant === "crm" && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-sidebar-foreground/50 font-semibold mb-0.5"
                 style={{ fontFamily: "var(--font-sans)" }}>
                Cooperative
              </p>
              <p className="text-sm font-bold text-sidebar-foreground truncate"
                 style={{ fontFamily: "var(--font-sans)" }}>
                {cooperativeName ?? "My Cooperative"}
              </p>
              {cooperativeType && (
                <Badge variant="outline" className="mt-1 text-[9px] h-4 px-1.5 border-sidebar-border text-sidebar-foreground/60">
                  {cooperativeType}
                </Badge>
              )}
            </div>
          )}
          {variant === "tender" && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-sidebar-foreground/50 font-semibold mb-0.5"
                 style={{ fontFamily: "var(--font-sans)" }}>
                Buyer Account
              </p>
              <p className="text-sm font-bold text-sidebar-foreground truncate"
                 style={{ fontFamily: "var(--font-sans)" }}>
                {buyerCompanyName ?? "My Company"}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav
        className={cn(
          "flex-1 overflow-y-auto py-3 space-y-0.5",
          collapsed ? "px-2" : "px-3"
        )}
      >
        {navItems.map((item, i) => (
          <NavItem
            key={item.id}
            item={item}
            isActive={activeId === item.id}
            variant={variant ?? "crm"}
            index={i}
            collapsed={collapsed}
            onClick={() => onNavigate?.(item.id, item.href)}
          />
        ))}
      </nav>

      {/* Footer — version / help */}
      {!collapsed && (
        <div className="px-4 py-3 border-t border-sidebar-border flex-shrink-0">
          <p className="text-[10px] text-sidebar-foreground/40" style={{ fontFamily: "var(--font-sans)" }}>
            ShambaFlow v0.1.0
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Adaptive Export ─────────────────────────────────────────────── */

export function ShambaSidebar({
  variant = "crm",
  items,
  activeId,
  onNavigate,
  cooperativeName,
  cooperativeType,
  buyerCompanyName,
  isOpen = false,
  onClose,
  className,
}: ShambaSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const toggleCollapsed = () => setCollapsed((c) => !c);

  const shared = {
    variant,
    items,
    activeId,
    onNavigate,
    cooperativeName,
    cooperativeType,
    buyerCompanyName,
    onClose,
  };

  return (
    <>
      {/* Desktop sidebar — always visible ≥ lg */}
      <div className={`hidden lg:flex ${className ?? ""}`}>
        <SidebarShell
          {...shared}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
      </div>

      {/* Mobile sidebar — slides in via AnimatePresence */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            />
            {/* Drawer */}
            <motion.div
              key="drawer"
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", stiffness: 380, damping: 40 }}
              className="fixed top-0 left-0 bottom-0 z-50 lg:hidden flex"
            >
              <SidebarShell {...shared} onClose={onClose} collapsed={false} />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
