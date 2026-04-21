"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  FileCheck,
  ShieldCheck,
} from "lucide-react";

import ModelAnalyticsPanel from "@/components/crm/model-analytics-panel";
import type { CRMAnalyticsCard, CRMAnalyticsChart, CRMAnalyticsHighlight } from "@/hooks/useCRMData";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

interface VerificationDocumentItem {
  id: string;
  document_type: string;
  document_type_label: string;
  status: string;
  status_label: string;
  uploaded_at: string;
  notes: string;
  file_name: string;
}

interface CertificationPayload {
  status: {
    verification_status: string;
    verification_status_label: string;
    is_verified: boolean;
    is_premium_eligible: boolean;
  };
  weights: {
    data_completeness: number;
    production_consistency: number;
    governance_participation: number;
    verification_status: number;
    premium_threshold: number;
  };
  scores: {
    capacity_index: number;
    data_completeness: number;
    production_regularity: number;
    governance_participation: number;
    verification_score: number;
    estimated_annual_volume_kg: number;
    total_members_scored: number;
    total_production_records: number;
    last_calculated_at: string | null;
  };
  cards: CRMAnalyticsCard[];
  charts: CRMAnalyticsChart[];
  highlights: CRMAnalyticsHighlight[];
  documents: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    verified: number;
    items: VerificationDocumentItem[];
  };
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not calculated yet";

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Not calculated yet";

  return timestamp.toLocaleString("en-KE", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function WeightBar({
  label,
  score,
  weight,
  tone = "primary",
}: {
  label: string;
  score: number;
  weight: number;
  tone?: "primary" | "blue" | "amber" | "emerald";
}) {
  const barTone = {
    primary: "bg-[var(--primary)]",
    blue: "bg-blue-500",
    amber: "bg-amber-500",
    emerald: "bg-emerald-500",
  }[tone];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[var(--foreground)]">{label}</p>
          <p className="text-xs text-[var(--foreground-muted)]">Weight {Math.round(weight * 100)}%</p>
        </div>
        <span className="text-sm font-semibold text-[var(--foreground)]">{score}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-[var(--background-muted)]">
        <div className={cn("h-full rounded-full transition-all duration-500", barTone)} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

export default function CRMCertificationPage() {
  const params = useParams();
  const cooperativeId = params?.cooperative_id as string;

  const [payload, setPayload] = useState<CertificationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkspace = useCallback(async () => {
    if (!cooperativeId) return;

    setLoading(true);
    setError(null);
    try {
      const nextPayload = await apiFetch<CertificationPayload>(`/api/crm/${cooperativeId}/certification/`);
      setPayload(nextPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load certification workspace.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [cooperativeId]);

  useEffect(() => {
    void fetchWorkspace();
  }, [fetchWorkspace]);

  const documentItems = payload?.documents.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--foreground-subtle)]">
            Certification & Capacity
          </p>
          <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">Certification Workspace</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--foreground-muted)]">
            This workspace brings the CRM-driven certification signals together: capacity score, data completeness, production trends, and verification readiness.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/crm/${cooperativeId}/submissions`}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
          >
            <BarChart3 className="h-4 w-4" />
            View Submissions
          </Link>
          <Link
            href={`/crm/${cooperativeId}/settings`}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-fg)] transition-colors hover:bg-[var(--primary-hover)]"
          >
            <FileCheck className="h-4 w-4" />
            Verification Docs
          </Link>
        </div>
      </div>

      <div
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium",
          payload?.status.is_verified
            ? "border-green-200 bg-[var(--success-light)] text-[var(--success)] dark:border-green-900/40"
            : "border-amber-200 bg-[var(--warning-light)] text-[var(--warning)] dark:border-amber-900/40"
        )}
      >
        {payload?.status.is_verified ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <Clock3 className="h-4 w-4" />
        )}
        {payload?.status.verification_status_label ?? "Loading status…"}
      </div>

      <ModelAnalyticsPanel
        modelSlug="workspace"
        analytics={payload ? { cards: payload.cards, charts: payload.charts, highlights: payload.highlights } : null}
        loading={loading}
        error={error}
        onRetry={() => { void fetchWorkspace(); }}
      />

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-[var(--foreground)]">Score Composition</h2>
              <p className="mt-1 text-sm text-[var(--foreground-muted)]">
                Weighted inputs used by the certification and premium-eligibility logic.
              </p>
            </div>
            <span className="rounded-full bg-[var(--background-muted)] px-3 py-1 text-xs font-semibold text-[var(--foreground-muted)]">
              Premium threshold {payload?.weights.premium_threshold ?? 60}
            </span>
          </div>

          <div className="mt-5 space-y-5">
            <WeightBar
              label="Data Completeness"
              score={payload?.scores.data_completeness ?? 0}
              weight={payload?.weights.data_completeness ?? 0}
              tone="blue"
            />
            <WeightBar
              label="Production Regularity"
              score={payload?.scores.production_regularity ?? 0}
              weight={payload?.weights.production_consistency ?? 0}
              tone="primary"
            />
            <WeightBar
              label="Governance Participation"
              score={payload?.scores.governance_participation ?? 0}
              weight={payload?.weights.governance_participation ?? 0}
              tone="amber"
            />
            <WeightBar
              label="Verification Contribution"
              score={payload?.scores.verification_score ?? 0}
              weight={payload?.weights.verification_status ?? 0}
              tone="emerald"
            />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--background-muted)]/60 p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--foreground-subtle)]">
                Annual Volume
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">
                {(payload?.scores.estimated_annual_volume_kg ?? 0).toLocaleString()} kg
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--background-muted)]/60 p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--foreground-subtle)]">
                Members Scored
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">
                {(payload?.scores.total_members_scored ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--background-muted)]/60 p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--foreground-subtle)]">
                Last Recalculated
              </p>
              <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">
                {formatDateTime(payload?.scores.last_calculated_at)}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="border-b border-[var(--border)] px-5 py-4">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Verification Workflow</h2>
            <p className="mt-1 text-sm text-[var(--foreground-muted)]">
              Recent compliance documents and where review is still blocked.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 px-5 py-4">
            {[
              { label: "Pending", value: payload?.documents.pending ?? 0 },
              { label: "Approved", value: payload?.documents.approved ?? 0 },
              { label: "Rejected", value: payload?.documents.rejected ?? 0 },
              { label: "Verified", value: payload?.documents.verified ?? 0 },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-[var(--border)] bg-[var(--background-muted)]/60 p-4">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--foreground-subtle)]">
                  {item.label}
                </p>
                <p className="mt-2 text-2xl font-bold text-[var(--foreground)]">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="border-t border-[var(--border)] px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Recent Documents</h3>
              <Link
                href={`/crm/${cooperativeId}/settings`}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--primary)] transition-colors hover:text-[var(--primary-hover)]"
              >
                Manage in settings
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="mt-4 space-y-3">
              {documentItems.length ? (
                documentItems.map((document) => (
                  <div key={document.id} className="rounded-2xl border border-[var(--border)] px-4 py-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-[var(--foreground)]">{document.document_type_label}</p>
                        <p className="mt-1 text-xs text-[var(--foreground-muted)]">{document.file_name}</p>
                      </div>
                      <span className="rounded-full bg-[var(--background-muted)] px-2.5 py-1 text-[11px] font-semibold text-[var(--foreground-muted)]">
                        {document.status_label}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-[var(--foreground-subtle)]">
                      Uploaded {formatDateTime(document.uploaded_at)}
                    </p>
                    {document.notes && (
                      <p className="mt-2 text-sm text-[var(--foreground-muted)]">{document.notes}</p>
                    )}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-10 text-center">
                  <ShieldCheck className="mx-auto h-10 w-10 text-[var(--foreground-subtle)]" />
                  <p className="mt-4 text-sm font-semibold text-[var(--foreground)]">No verification documents uploaded yet.</p>
                  <p className="mt-2 text-sm text-[var(--foreground-muted)]">
                    Upload the cooperative’s compliance documents from Settings to move verification forward.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
