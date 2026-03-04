"use client";

/**
 * ShambaCard — Adaptive Card Component (barrel + remaining cards)
 *
 * StatCard  → now in ./StatCard.tsx
 * TenderCard → now in ./TenderCard.tsx
 *
 * This file retains:
 *  FeatureCard — landing page feature highlight
 *  MemberCard  — CRM member list item (with optional avatar image)
 *  CoopCard    — Marketplace cooperative profile card (with optional logo image)
 *  ActivityCard — CRM activity feed item
 *
 * And re-exports StatCard + TenderCard for backwards compatibility.
 */

import Image from "next/image";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowRight,
  Calendar,
  MapPin,
  Package,
  CheckCircle2,
  Leaf,
} from "lucide-react";
import { ReactNode } from "react";

/* ─── Re-exports (backwards compat) ──────────────────────────────── */

export { StatCard }  from "./StatCard";
export type { StatCardProps, TrendDirection, StatVariant } from "./StatCard";

export { TenderCard } from "./TenderCard";
export type { TenderCardProps, TenderStatus, TenderTier } from "./TenderCard";

/* ─── FeatureCard ─────────────────────────────────────────────────── */

export interface FeatureCardProps {
  icon:         ReactNode;
  title:        string;
  description:  string;
  accentColor?: string;
  delay?:       number;
}

export function FeatureCard({
  icon,
  title,
  description,
  accentColor = "bg-primary",
  delay       = 0,
}: FeatureCardProps) {
  return (
    <motion.div
      initial    ={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport   ={{ once: true, margin: "-60px" }}
      transition ={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover ={{ y: -4 }}
    >
      <Card className="h-full border border-border bg-card hover:border-primary/30 transition-colors duration-300 group overflow-hidden">
        <CardContent className="p-6">
          {/* Icon */}
          <div
            className={`w-11 h-11 rounded-xl ${accentColor} flex items-center justify-center mb-4 text-white group-hover:scale-110 transition-transform duration-200`}
          >
            {icon}
          </div>

          <h3
            className="font-bold text-foreground mb-2 text-base"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {title}
          </h3>
          <p
            className="text-sm text-muted-foreground leading-relaxed"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {description}
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ─── MemberCard ──────────────────────────────────────────────────── */

export type MemberStatus = "active" | "inactive" | "pending";

export interface MemberCardProps {
  name:           string;
  memberId:       string;
  region:         string;
  productionType: string;
  status:         MemberStatus;
  joinDate:       string;
  landSize?:      string;
  /** Optional avatar image path (e.g. from CRM profile upload) */
  avatarSrc?:     string;
  onClick?:       () => void;
  delay?:         number;
}

const STATUS_CFG: Record<MemberStatus, { label: string; className: string }> = {
  active:   { label: "Active",   className: "bg-primary/10 text-primary border-primary/20"          },
  inactive: { label: "Inactive", className: "bg-muted text-muted-foreground border-border"           },
  pending:  { label: "Pending",  className: "bg-amber-50 text-amber-700 border-amber-200"            },
};

export function MemberCard({
  name,
  memberId,
  region,
  productionType,
  status,
  joinDate,
  landSize,
  avatarSrc,
  onClick,
  delay = 0,
}: MemberCardProps) {
  const sc = STATUS_CFG[status];

  return (
    <motion.div
      initial    ={{ opacity: 0, x: -16 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport   ={{ once: true }}
      transition ={{ duration: 0.35, delay, ease: "easeOut" }}
      whileHover ={{ scale: 1.01 }}
      onClick    ={onClick}
      className  ={onClick ? "cursor-pointer" : ""}
    >
      <Card className="border border-border bg-card hover:border-primary/30 hover:shadow-sm transition-all duration-200">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            {/* Avatar: image or initials */}
            <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 bg-primary/10 border border-primary/20">
              {avatarSrc ? (
                <Image
                  src={avatarSrc}
                  alt={name}
                  width={40}
                  height={40}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-primary font-bold text-sm"
                     style={{ fontFamily: "var(--font-sans)" }}>
                  {name.slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4
                  className="font-semibold text-sm text-foreground truncate"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {name}
                </h4>
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 h-4 flex-shrink-0 ${sc.className}`}
                >
                  {sc.label}
                </Badge>
              </div>

              <p
                className="text-[11px] text-muted-foreground mb-2"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                ID: {memberId}
              </p>

              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <MapPin size={10} /> {region}
                </span>
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Leaf size={10} className="text-primary/60" /> {productionType}
                </span>
                {landSize && (
                  <span className="text-[11px] text-muted-foreground">{landSize} ac</span>
                )}
              </div>
            </div>

            {/* Join date */}
            <div className="text-right flex-shrink-0">
              <p className="text-[10px] text-muted-foreground">Joined</p>
              <p className="text-[11px] font-semibold text-foreground">{joinDate}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ─── CoopCard ────────────────────────────────────────────────────── */

export interface CoopCardProps {
  name:             string;
  type:             "Crop" | "Livestock" | "Mixed";
  region:           string;
  memberCount:      number;
  capacityScore:    number;
  reliabilityScore: number;
  isVerified:       boolean;
  completedTenders: number;
  /** Optional cooperative logo image */
  logoSrc?:         string;
  onView?:          () => void;
  delay?:           number;
}

export function CoopCard({
  name,
  type,
  region,
  memberCount,
  capacityScore,
  reliabilityScore,
  isVerified,
  completedTenders,
  logoSrc,
  onView,
  delay = 0,
}: CoopCardProps) {
  return (
    <motion.div
      initial    ={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport   ={{ once: true }}
      transition ={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover ={{ y: -3 }}
    >
      <Card className="border border-border bg-card hover:border-primary/30 hover:shadow-md transition-all duration-200">
        <CardContent className="p-5">
          {/* Header */}
          <div className="flex items-start gap-3 mb-4">
            {/* Logo: image or initials */}
            <div className="w-12 h-12 rounded-xl overflow-hidden border border-primary/20 flex-shrink-0 bg-primary/10">
              {logoSrc ? (
                <Image
                  src={logoSrc}
                  alt={`${name} logo`}
                  width={48}
                  height={48}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span
                    className="text-primary font-black text-base"
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    {name.slice(0, 2).toUpperCase()}
                  </span>
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <h4
                  className="font-bold text-sm text-foreground truncate"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {name}
                </h4>
                {isVerified && (
                  <CheckCircle2 size={13} className="text-primary flex-shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 h-4 border-primary/20 text-primary"
                >
                  {type}
                </Badge>
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <MapPin size={9} /> {region}
                </span>
              </div>
            </div>
          </div>

          {/* Score bars */}
          <div className="space-y-2.5 mb-4">
            <ScoreBar label="Capacity Index" value={capacityScore}    color="bg-primary" />
            <ScoreBar label="Reliability"    value={reliabilityScore} color="bg-secondary" />
          </div>

          {/* Stats footer */}
          <div className="flex items-center justify-between border-t border-border pt-3">
            <div className="text-center">
              <p
                className="text-base font-bold text-foreground"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {memberCount}
              </p>
              <p className="text-[10px] text-muted-foreground">Members</p>
            </div>
            <div className="w-px h-8 bg-border" />
            <div className="text-center">
              <p
                className="text-base font-bold text-foreground"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {completedTenders}
              </p>
              <p className="text-[10px] text-muted-foreground">Tenders Done</p>
            </div>
            <div className="w-px h-8 bg-border" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-primary hover:text-primary"
              onClick={onView}
            >
              View <ArrowRight size={11} />
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ─── ActivityCard ────────────────────────────────────────────────── */

export type ActivityType =
  | "member_added"
  | "production_logged"
  | "tender_bid"
  | "form_submitted"
  | "verification";

export interface ActivityCardProps {
  type:         ActivityType;
  title:        string;
  description:  string;
  timestamp:    string;
  actor?:       string;
  delay?:       number;
}

const ACTIVITY_CFG: Record<ActivityType, { dot: string }> = {
  member_added:      { dot: "bg-primary"          },
  production_logged: { dot: "bg-secondary"        },
  tender_bid:        { dot: "bg-amber-400"        },
  form_submitted:    { dot: "bg-blue-400"         },
  verification:      { dot: "bg-violet-400"       },
};

export function ActivityCard({
  type,
  title,
  description,
  timestamp,
  actor,
  delay = 0,
}: ActivityCardProps) {
  const cfg = ACTIVITY_CFG[type];

  return (
    <motion.div
      initial    ={{ opacity: 0, x: 12 }}
      animate    ={{ opacity: 1, x: 0 }}
      transition ={{ duration: 0.3, delay }}
      className  ="flex gap-3 py-3 border-b border-border last:border-0"
    >
      <div className="relative flex-shrink-0 pt-1.5">
        <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      </div>

      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-semibold text-foreground"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {title}
        </p>
        <p
          className="text-xs text-muted-foreground mt-0.5 leading-relaxed"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {description}
          {actor && (
            <> · <span className="font-semibold text-foreground">{actor}</span></>
          )}
        </p>
      </div>

      <p className="text-[10px] text-muted-foreground flex-shrink-0 pt-0.5">
        {timestamp}
      </p>
    </motion.div>
  );
}

/* ─── Shared: ScoreBar ────────────────────────────────────────────── */

function ScoreBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="text-[11px] font-semibold text-foreground">{value}%</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <motion.div
          className={`h-full ${color} rounded-full`}
          initial    ={{ width: 0 }}
          whileInView={{ width: `${value}%` }}
          viewport   ={{ once: true }}
          transition ={{ duration: 0.9, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}