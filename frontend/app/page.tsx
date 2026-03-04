"use client";

/**
 * Root Page — ShambaFlow Component Showcase
 *
 * Nav overlay fix: the landing nav is fixed z-50 (h-16 mobile, h-20 desktop).
 * The hero handles its own top offset (pt-28/pt-36). Every <Section> carries
 * scroll-mt-20 so in-page anchor links land below the nav bar.
 *
 * Logo images are served from /public/logo-icon.png and /public/logo-full.png.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";

/* ── Standalone component imports ─────────────────────────────────── */
import { ShambaNav }             from "@/components/shambaflow/ShambaNav";
import { ShambaLogo }            from "@/components/shambaflow/ShambaLogo";
import { ShambaHero }            from "@/components/shambaflow/ShambaHero";
import { StatCard }              from "@/components/shambaflow/StatCard";
import { TenderCard }            from "@/components/shambaflow/TenderCard";
import {
  FeatureCard,
  MemberCard,
  CoopCard,
  ActivityCard,
}                                from "@/components/shambaflow/ShambaCard";
import { ShambaSidebar }         from "@/components/shambaflow/ShambaSidebar";
import { ShambaCapacityCard }    from "@/components/shambaflow/ShambaCapacityCard";
import { ShambaReputationBadge } from "@/components/shambaflow/ShambaReputationBadge";
import {
  ShambaTable,
  MEMBER_COLUMNS,
  TENDER_COLUMNS,
}                                from "@/components/shambaflow/ShambaTable";
import { ShambaFormBuilder }     from "@/components/shambaflow/ShambaFormBuilder";
import { Users, BarChart3, TrendingUp, Package, Database } from "lucide-react";

/* ── Logo asset paths ─────────────────────────────────────────────── */
const LOGO_ICON = "/logo-icon.svg";
const LOGO_FULL = "/logo-full.svg";

/* ─── Section wrapper ─────────────────────────────────────────────── */

function Section({ id, title, badge, children, dark }: {
  id: string; title: string; badge?: string;
  children: React.ReactNode; dark?: boolean;
}) {
  return (
    /* scroll-mt-20 ensures fixed nav doesn't overlap section headings on anchor nav */
    <section
      id={id}
      className={`py-20 scroll-mt-20 ${dark ? "bg-foreground" : "bg-background"}`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ duration: 0.45 }} className="mb-10"
        >
          <div className="flex items-center gap-3 mb-2">
            <h2
              className={`text-2xl font-extrabold ${dark ? "text-background" : "text-foreground"}`}
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {title}
            </h2>
            {badge && (
              <Badge variant="outline" className="text-xs border-primary/30 text-primary">{badge}</Badge>
            )}
          </div>
          <div className="h-0.5 w-16 bg-primary rounded-full" />
        </motion.div>
        {children}
      </div>
    </section>
  );
}

/* ─── Demo data ───────────────────────────────────────────────────── */

const DEMO_MEMBERS = [
  { id: "1", name: "Amina Wanjiku",  member_id: "MBR-0012", region: "Kiambu",  production_type: "Coffee", status: "active",   join_date: "Jan 2023", land_size: "4.2" },
  { id: "2", name: "Juma Otieno",   member_id: "MBR-0019", region: "Kisumu",  production_type: "Maize",  status: "active",   join_date: "Mar 2023", land_size: "2.8" },
  { id: "3", name: "Grace Muthoni", member_id: "MBR-0031", region: "Nyeri",   production_type: "Tea",    status: "pending",  join_date: "Oct 2024" },
  { id: "4", name: "Samson Kiprop", member_id: "MBR-0044", region: "Eldoret", production_type: "Wheat",  status: "inactive", join_date: "Jun 2022", land_size: "7.0" },
];

const DEMO_TENDERS = [
  { id: "1", title: "Premium Arabica Coffee – Q2 Bulk",  product_type: "Coffee", region: "Central",     status: "open",         bid_count: 7, deadline: "Apr 30, 2025", quantity_kg: 12_000 },
  { id: "2", title: "White Maize – Feed Grade",          product_type: "Maize",  region: "Rift Valley", status: "closing_soon", bid_count: 3, deadline: "Mar 25, 2025", quantity_kg: 50_000 },
  { id: "3", title: "KTDA Grade A Black Tea",            product_type: "Tea",    region: "Nyeri",       status: "awarded",      bid_count: 9, deadline: "Feb 10, 2025", quantity_kg: 8_000  },
];

const OUTCOMES = [
  { tender_title: "Arabica Coffee Lot 3",  buyer_name: "NBO Fresh Ltd",  volume_kg: 8_200,  status: "completed" as const, reliability_rating: 5, date: "Jan 2025" },
  { tender_title: "Maize Bulk Jan Supply", buyer_name: "AgriPros Kenya", volume_kg: 18_000, status: "completed" as const, reliability_rating: 4, date: "Dec 2024" },
  { tender_title: "Tea Grade Export",      buyer_name: "Leafy Exports",  volume_kg: 3_400,  status: "partial"   as const, reliability_rating: 3, date: "Nov 2024" },
];

const AVAILABLE_FIELDS = [
  { field_name: "volume_kg",     verbose_name: "Volume (kg)",   django_type: "DecimalField" },
  { field_name: "quality_grade", verbose_name: "Quality Grade", django_type: "CharField" },
  { field_name: "harvest_date",  verbose_name: "Harvest Date",  django_type: "DateField" },
  { field_name: "moisture_pct",  verbose_name: "Moisture %",    django_type: "DecimalField" },
  { field_name: "notes",         verbose_name: "Notes",         django_type: "TextField" },
  { field_name: "is_certified",  verbose_name: "GAP Certified", django_type: "BooleanField" },
];

const FORM_FIELDS = [
  { id: "f1", label: "Harvest Volume (kg)", display_type: "decimal"  as const, tag: "CAPACITY"      as const, maps_to_model_field: "volume_kg",    is_required: true,  placeholder: "e.g. 1200.00" },
  { id: "f2", label: "Quality Grade",       display_type: "dropdown" as const, tag: "CAPACITY"      as const, maps_to_model_field: "quality_grade", is_required: true  },
  { id: "f3", label: "Harvest Date",        display_type: "date"     as const, tag: "INFORMATIONAL" as const, maps_to_model_field: "harvest_date",  is_required: true  },
  { id: "f4", label: "Moisture %",          display_type: "decimal"  as const, tag: "CAPACITY"      as const, maps_to_model_field: "moisture_pct",  is_required: false },
  { id: "f5", label: "Notes",               display_type: "textarea" as const, tag: "INFORMATIONAL" as const, maps_to_model_field: "notes",         is_required: false },
];

/* ─── Page ────────────────────────────────────────────────────────── */

export default function ShowcasePage() {
  const [activeCrm,    setActiveCrm]    = useState("dashboard");
  const [activeTender, setActiveTender] = useState("dashboard");
  const demoUser = { name: "Joyce Kamau", role: "Chair", avatarInitials: "JK" };

  return (
    <div className="min-h-screen bg-background">

      {/*
       * Fixed landing nav — sits above the document flow at z-50.
       * Height: h-16 (64px) mobile → h-20 (80px) desktop.
       * The hero section below handles its own top padding to clear this bar.
       * All <Section> elements carry scroll-mt-20 so hash-link navigation
       * positions correctly below the nav.
       */}
      <ShambaNav
        variant="landing"
        iconSrc={LOGO_ICON}
        fullSrc={LOGO_FULL}
      />

      {/*
       * Hero starts at y=0 (behind the fixed nav by design — transparent nav
       * becomes solid on scroll). Its pt-28/pt-36 (112px/144px) ensures the
       * text content always clears the 64px/80px nav bar.
       */}
      <ShambaHero />

      {/* ── Feature Cards ─────────────────────────────────────────── */}
      <Section id="features" title="Platform Layers" badge="Landing">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          <FeatureCard delay={0.00} icon={<Users size={18} />}      title="Identity & Authority"      description="Cooperative onboarding, Chair root-admin model, and granular role-based helper accounts." />
          <FeatureCard delay={0.08} icon={<Database size={18} />}   title="Cooperative CRM"           description="Member registry, production tracking, governance records, and a flexible dynamic form builder." accentColor="bg-secondary" />
          <FeatureCard delay={0.16} icon={<BarChart3 size={18} />}  title="Certification & Analytics" description="Capacity index engine, data completeness scores, and one-click institutional reports." accentColor="bg-chart-4" />
          <FeatureCard delay={0.24} icon={<Package size={18} />}    title="Tender Marketplace"        description="Structured buyer tenders, cooperative bidding, and in-platform negotiation." accentColor="bg-chart-5" />
          <FeatureCard delay={0.32} icon={<TrendingUp size={18} />} title="Reputation Ledger"         description="Cumulative trade credibility, fulfillment rates, and historical trade profiles." />
        </div>
      </Section>

      {/* ── Stat Cards ────────────────────────────────────────────── */}
      <Section id="stats" title="Dashboard Stat Cards" badge="CRM + Tender">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Members"   value={248}   trend="up"      trendValue="+12 this month" icon={<Users size={16} />}      variant="default" delay={0.00} />
          <StatCard label="Capacity Index"  value={87}    unit="/100"     trend="up"   trendValue="+3 pts"        icon={<BarChart3 size={16} />}  variant="primary" delay={0.08} />
          <StatCard label="Active Tenders"  value={14}    trend="up"      trendValue="+2 this week"   icon={<Package size={16} />}    variant="accent"  delay={0.16} />
          <StatCard label="Completion Rate" value="94%"   trend="neutral" trendValue="No change"      icon={<TrendingUp size={16} />} variant="default" delay={0.24} />
        </div>
      </Section>

      {/* ── Member Cards ──────────────────────────────────────────── */}
      <Section id="members" title="Member Cards" badge="CRM">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {DEMO_MEMBERS.map((m, i) => (
            <MemberCard key={m.id}
              name={m.name} memberId={m.member_id} region={m.region}
              productionType={m.production_type} status={m.status as any}
              joinDate={m.join_date} landSize={m.land_size} delay={i * 0.07}
            />
          ))}
        </div>
      </Section>

      {/* ── Tender Cards ──────────────────────────────────────────── */}
      <Section id="tenders" title="Tender Cards" badge="Marketplace">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <TenderCard id="T001" title="Premium Arabica Coffee – Q2 Bulk"
            buyerName="NBO Fresh Ltd" productType="Coffee" quantityKg={12_000}
            pricePerKgKes={320} deadline="Apr 30, 2025" region="Central Kenya"
            status="open" tier="premium" bidCount={7} delay={0.00} />
          <TenderCard id="T002" title="White Maize – Feed Grade 50,000 kg"
            buyerName="AgriPros Kenya" productType="Maize" quantityKg={50_000}
            deadline="Mar 25, 2025" region="Rift Valley"
            status="closing_soon" tier="open" bidCount={3} isUrgent delay={0.10} />
          <TenderCard id="T003" title="KTDA Grade A Black Tea Export"
            buyerName="Leafy Exports Ltd" productType="Tea" quantityKg={8_000}
            pricePerKgKes={195} deadline="Feb 10, 2025" region="Nyeri"
            status="awarded" tier="premium" bidCount={9} delay={0.20} />
        </div>
      </Section>

      {/* ── Cooperative Cards ─────────────────────────────────────── */}
      <Section id="coops" title="Cooperative Cards" badge="Marketplace">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <CoopCard name="Kiambu Coffee Farmers SACCO"     type="Crop"  region="Kiambu County" memberCount={312} capacityScore={87} reliabilityScore={91} isVerified  completedTenders={24} delay={0.00} />
          <CoopCard name="Rift Valley Maize Growers Co-op" type="Mixed" region="Nakuru County" memberCount={184} capacityScore={72} reliabilityScore={78} isVerified  completedTenders={11} delay={0.10} />
          <CoopCard name="Nyeri Tea Smallholders Union"    type="Crop"  region="Nyeri County"  memberCount={96}  capacityScore={55} reliabilityScore={60} isVerified={false} completedTenders={4}  delay={0.20} />
        </div>
      </Section>

      {/* ── Capacity Cards ────────────────────────────────────────── */}
      <Section id="capacity" title="Capacity Index Cards" badge="CRM + Marketplace">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          <ShambaCapacityCard variant="full"    overallScore={87} isVerified verificationBadge="Gold Verified" tenderEligibility="premium" lastUpdated="Today, 09:14 AM" />
          <ShambaCapacityCard variant="compact" overallScore={72} isVerified tenderEligibility="open" />
          <ShambaCapacityCard variant="public"  overallScore={55} isVerified={false} tenderEligibility="open" />
        </div>
      </Section>

      {/* ── Reputation Ledger ─────────────────────────────────────── */}
      <Section id="reputation" title="Reputation Ledger" badge="CRM + Marketplace">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          <div className="flex flex-col gap-4">
            <p className="text-sm font-semibold text-muted-foreground" style={{ fontFamily: "var(--font-sans)" }}>Inline Badge Variant</p>
            <div className="flex flex-col gap-2">
              <ShambaReputationBadge variant="badge" reliabilityScore={91} completionRate={94} totalTenders={24} completedTenders={22} />
              <ShambaReputationBadge variant="badge" reliabilityScore={72} completionRate={78} totalTenders={11} completedTenders={9}  />
              <ShambaReputationBadge variant="badge" reliabilityScore={45} completionRate={60} totalTenders={4}  completedTenders={2}  />
            </div>
          </div>
          <ShambaReputationBadge variant="card"    reliabilityScore={91} completionRate={94} totalTenders={24} completedTenders={22} />
          <ShambaReputationBadge variant="history" reliabilityScore={91} completionRate={94} totalTenders={24} completedTenders={22} outcomes={OUTCOMES} />
        </div>
      </Section>

      {/* ── Data Tables ───────────────────────────────────────────── */}
      <Section id="tables" title="Data Tables" badge="CRM + Tender">
        <div className="space-y-10">
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-3" style={{ fontFamily: "var(--font-sans)" }}>
              Member Registry — Import &amp; Export buttons are on the right of the toolbar
            </p>
            <ShambaTable variant="members" columns={MEMBER_COLUMNS} data={DEMO_MEMBERS}
              keyField="id" totalCount={248} searchPlaceholder="Search members…"
              exportFileName="members-export"
              onImport={(rows, type) => console.log("Imported", rows.length, "rows as", type)}
              rowActions={[
                { label: "View Profile", onClick: (r) => console.log(r) },
                { label: "Edit",         onClick: (r) => console.log(r) },
                { label: "Deactivate",   onClick: (r) => console.log(r), variant: "destructive" },
              ]}
            />
          </div>
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-3" style={{ fontFamily: "var(--font-sans)" }}>
              Active Tenders — Import &amp; Export buttons are on the right of the toolbar
            </p>
            <ShambaTable variant="tenders" columns={TENDER_COLUMNS} data={DEMO_TENDERS}
              keyField="id" totalCount={14} searchPlaceholder="Search tenders…"
              exportFileName="tenders-export"
              onImport={(rows, type) => console.log("Imported", rows.length, "rows as", type)}
              rowActions={[
                { label: "View Bids",    onClick: (r) => console.log(r) },
                { label: "Close Tender", onClick: (r) => console.log(r), variant: "destructive" },
              ]}
            />
          </div>
        </div>
      </Section>

      {/* ── Form Builder ──────────────────────────────────────────── */}
      <Section id="form-builder" title="Form Builder" badge="CRM">
        <ShambaFormBuilder
          templateName="Production Harvest Log"
          targetModel="ProductionRecord"
          availableFields={AVAILABLE_FIELDS}
          initialFields={FORM_FIELDS}
          canActivate={false}
          semanticIssues={[{
            field_label: "Moisture %",
            issue_type:  "NUMERIC_UNIT_AMBIGUITY",
            severity:    "WARNING",
            description: "Numeric label omits unit. Consider 'Moisture Percentage (%)' for clarity.",
            suggestion:  "Rename to 'Moisture Percentage (%)'",
          }]}
        />
      </Section>

      {/* ── Sidebars ──────────────────────────────────────────────── */}
      <Section id="sidebars" title="Sidebar Navigation" badge="CRM + Tender">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-3" style={{ fontFamily: "var(--font-sans)" }}>CRM Sidebar</p>
            <div className="h-[500px] rounded-2xl overflow-hidden border border-border flex shadow-md">
              <ShambaSidebar variant="crm" activeId={activeCrm} cooperativeName="Kiambu Coffee Farmers SACCO"
                cooperativeType="Crop" onNavigate={(id) => setActiveCrm(id)} className="!flex" />
              <div className="flex-1 bg-muted/20 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Page content area</p>
              </div>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-3" style={{ fontFamily: "var(--font-sans)" }}>Buyer Marketplace Sidebar</p>
            <div className="h-[500px] rounded-2xl overflow-hidden border border-border flex shadow-md">
              <ShambaSidebar variant="tender" activeId={activeTender} buyerCompanyName="NBO Fresh Ltd"
                onNavigate={(id) => setActiveTender(id)} className="!flex" />
              <div className="flex-1 bg-muted/20 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Page content area</p>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/*
       * ── Nav Variants preview ──────────────────────────────────────
       * CRM and Tender nav bars rendered inside bounded containers —
       * they do NOT behave as fixed overlays here (unlike the landing nav above).
       */}
      <Section id="navbars" title="Top Navigation Variants" badge="All Platforms">
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-2" style={{ fontFamily: "var(--font-sans)" }}>CRM Top Bar</p>
            <div className="rounded-xl border border-border overflow-hidden relative h-14">
              <div className="absolute inset-0">
                <ShambaNav variant="crm" user={demoUser} cooperativeName="Kiambu Coffee Farmers SACCO"
                  notificationCount={3} iconSrc={LOGO_ICON} />
              </div>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-2" style={{ fontFamily: "var(--font-sans)" }}>Buyer Marketplace Top Bar</p>
            <div className="rounded-xl border border-border overflow-hidden relative h-14">
              <div className="absolute inset-0">
                <ShambaNav variant="tender" user={{ name: "David Mwangi", role: "Buyer", avatarInitials: "DM" }}
                  notificationCount={1} iconSrc={LOGO_ICON} />
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Activity Feed ─────────────────────────────────────────── */}
      <Section id="activity" title="Activity Feed" badge="CRM">
        <div className="max-w-xl">
          <div className="bg-card rounded-2xl border border-border px-1">
            {[
              { type: "member_added"      as const, title: "New member registered",       description: "Amina Wanjiku (MBR-0248) added to registry",  actor: "Joyce Kamau",   timestamp: "2m ago"    },
              { type: "production_logged" as const, title: "Production record created",   description: "1,200 kg Arabica coffee logged — Grade A",    actor: "James Njoroge", timestamp: "18m ago"   },
              { type: "tender_bid"        as const, title: "Bid submitted",               description: "NBO Fresh Ltd — 12,000 kg at KES 320/kg",     actor: "System",        timestamp: "1h ago"    },
              { type: "form_submitted"    as const, title: "Governance form submitted",   description: "Q1 2025 board meeting minutes uploaded",       actor: "Grace Muthoni", timestamp: "3h ago"    },
              { type: "verification"      as const, title: "Verification status updated", description: "Cooperative upgraded to Gold Verified",        actor: "ShambaFlow",    timestamp: "Yesterday" },
            ].map((item, i) => (
              <ActivityCard key={i} {...item} delay={i * 0.06} />
            ))}
          </div>
        </div>
      </Section>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <footer className="bg-foreground py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <ShambaLogo size="sm" mode="icon" iconSrc={LOGO_ICON} />
          <p className="text-xs text-background/50" style={{ fontFamily: "var(--font-serif)" }}>
            © 2025 ShambaFlow. Digital Infrastructure for Organised Agricultural Supply.
          </p>
        </div>
      </footer>
    </div>
  );
}