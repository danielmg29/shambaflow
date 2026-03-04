"use client";

/**
 * TenderCard — Marketplace Tender Listing Card
 *
 * Used on:
 *  • Buyer Dashboard  — active / recent tenders
 *  • Cooperative CRM  — tender opportunities visible to cooperatives
 *  • Tender Browse    — filterable grid of available tenders
 *
 * Status variants drive the visual treatment:
 *  "open"         — normal green state, bid button shown
 *  "closing_soon" — amber urgency, bid button shown
 *  "closed"       — muted, no actions
 *  "awarded"      — secondary tint, outcome recorded
 *
 * Tier variants:
 *  "open"    — any verified cooperative can bid
 *  "premium" — only CRM-active cooperatives above capacity threshold
 */

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Package,
  MapPin,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  Star,
  ArrowRight,
  Zap,
} from "lucide-react";

/* ─── Types ───────────────────────────────────────────────────────── */

export type TenderStatus = "open" | "closing_soon" | "closed" | "awarded";
export type TenderTier   = "open" | "premium";

export interface TenderCardProps {
  id:              string;
  title:           string;
  buyerName:       string;
  productType:     string;
  quantityKg:      number;
  pricePerKgKes?:  number;
  deadline:        string;
  region:          string;
  status:          TenderStatus;
  tier:            TenderTier;
  bidCount:        number;
  /** When true, renders amber urgency treatment (paid boost feature) */
  isUrgent?:       boolean;
  /** Optional image URL for the buyer logo */
  buyerLogoSrc?:   string;
  onBid?:          () => void;
  onView?:         () => void;
  delay?:          number;
}

/* ─── Status config ───────────────────────────────────────────────── */

const STATUS_CONFIG: Record<TenderStatus, {
  label:     string;
  Icon:      typeof CheckCircle2;
  className: string;
}> = {
  open:         { label: "Open",         Icon: CheckCircle2, className: "bg-primary/10 text-primary border-primary/20" },
  closing_soon: { label: "Closing Soon", Icon: Clock,        className: "bg-amber-50 text-amber-700 border-amber-200"  },
  closed:       { label: "Closed",       Icon: AlertCircle,  className: "bg-muted text-muted-foreground border-border"  },
  awarded:      { label: "Awarded",      Icon: Star,         className: "bg-secondary/15 text-secondary-foreground border-secondary/30" },
};

/* ─── Buyer logo placeholder ──────────────────────────────────────── */

function BuyerLogo({
  name,
  src,
  size = 36,
}: {
  name:  string;
  src?:  string;
  size?: number;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`${name} logo`}
        width={size}
        height={size}
        className="rounded-lg object-contain border border-border bg-white"
        style={{ width: size, height: size }}
      />
    );
  }
  /* Initials fallback */
  return (
    <div
      className="rounded-lg bg-muted/80 border border-border flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
    >
      <span
        className="text-[10px] font-black text-muted-foreground"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {name
          .split(" ")
          .slice(0, 2)
          .map((w) => w[0])
          .join("")
          .toUpperCase()}
      </span>
    </div>
  );
}

/* ─── Component ───────────────────────────────────────────────────── */

export function TenderCard({
  id,
  title,
  buyerName,
  productType,
  quantityKg,
  pricePerKgKes,
  deadline,
  region,
  status,
  tier,
  bidCount,
  isUrgent    = false,
  buyerLogoSrc,
  onBid,
  onView,
  delay       = 0,
}: TenderCardProps) {
  const sc         = STATUS_CONFIG[status];
  const StatusIcon = sc.Icon;
  const canBid     = status === "open" || status === "closing_soon";

  return (
    <motion.div
      initial    ={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport   ={{ once: true }}
      transition ={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover ={{ y: -3 }}
    >
      <Card
        className={`relative border bg-card transition-all duration-200 hover:shadow-lg ${
          isUrgent
            ? "border-amber-300 hover:border-amber-400"
            : "border-border hover:border-primary/40"
        }`}
      >
        {/* Urgent stripe */}
        {isUrgent && (
          <div className="h-1 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 rounded-t-xl" />
        )}

        <CardContent className="p-5">
          {/* ── Row 1: Buyer logo + badges + quantity ─────────────── */}
          <div className="flex items-start gap-3 mb-3">
            <BuyerLogo name={buyerName} src={buyerLogoSrc} size={40} />

            <div className="flex-1 min-w-0">
              {/* Badge row */}
              <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                <Badge
                  variant="outline"
                  className={`text-[10px] px-2 h-5 gap-1 flex items-center ${sc.className}`}
                >
                  <StatusIcon size={9} />
                  {sc.label}
                </Badge>

                {tier === "premium" && (
                  <Badge className="text-[10px] px-2 h-5 bg-secondary text-secondary-foreground border-0 font-semibold">
                    Premium
                  </Badge>
                )}

                {isUrgent && (
                  <Badge className="text-[10px] px-2 h-5 bg-amber-500 text-white border-0 font-semibold gap-1 flex items-center">
                    <Zap size={8} /> Urgent
                  </Badge>
                )}
              </div>

              {/* Title */}
              <h4
                className="font-bold text-sm text-foreground leading-snug"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {title}
              </h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {buyerName}
              </p>
            </div>

            {/* Quantity block */}
            <div className="text-right flex-shrink-0 pt-0.5">
              <p
                className="text-xl font-black text-primary leading-none"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {quantityKg.toLocaleString()}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">kg required</p>
              {pricePerKgKes && (
                <p className="text-[11px] font-semibold text-foreground mt-1">
                  KES {pricePerKgKes.toLocaleString()}/kg
                </p>
              )}
            </div>
          </div>

          {/* ── Row 2: Meta chips ────────────────────────────────── */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 py-3 border-y border-border mb-3">
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Package size={11} className="text-primary/60" />
              {productType}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <MapPin size={11} className="text-primary/60" />
              {region}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Calendar size={11} className="text-primary/60" />
              Closes {deadline}
            </span>
          </div>

          {/* ── Row 3: Bid count + actions ────────────────────────── */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              <span className="font-bold text-foreground">{bidCount}</span>{" "}
              bid{bidCount !== 1 ? "s" : ""} received
            </span>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                onClick={onView}
              >
                Details <ArrowRight size={11} />
              </Button>

              {canBid && (
                <Button
                  size="sm"
                  className={`h-7 text-xs font-bold gap-1 ${
                    isUrgent
                      ? "bg-amber-500 hover:bg-amber-600 text-white"
                      : "bg-primary hover:bg-primary/90"
                  }`}
                  onClick={onBid}
                >
                  Submit Bid
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default TenderCard;