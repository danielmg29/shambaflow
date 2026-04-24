export function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "Not set";
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDecimal(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatDate(value: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    ...(options ?? {}),
  }).format(date);
}

export function formatDateTime(value: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
    ...(options ?? {}),
  }).format(date);
}

export function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";

  const diffMs = date.getTime() - Date.now();
  const absSeconds = Math.round(Math.abs(diffMs) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absSeconds < 60) return rtf.format(Math.round(diffMs / 1000), "second");
  if (absSeconds < 3600) return rtf.format(Math.round(diffMs / (1000 * 60)), "minute");
  if (absSeconds < 86400) return rtf.format(Math.round(diffMs / (1000 * 60 * 60)), "hour");
  return rtf.format(Math.round(diffMs / (1000 * 60 * 60 * 24)), "day");
}

export function formatQuantityRange(min?: number | null, max?: number | null): string {
  const safeMin = min ?? 0;
  const safeMax = max ?? 0;
  return `${formatDecimal(safeMin, 0)} kg - ${formatDecimal(safeMax, 0)} kg`;
}

export function tenderStatusTone(status: string): string {
  switch (status) {
    case "PUBLISHED":
      return "sf-tone-success";
    case "UNDER_REVIEW":
      return "sf-tone-warning";
    case "AWARDED":
      return "sf-tone-info";
    case "CLOSED":
      return "sf-tone-neutral";
    case "CANCELLED":
      return "sf-tone-danger";
    default:
      return "sf-tone-neutral";
  }
}

export function bidStatusTone(status: string): string {
  switch (status) {
    case "ACCEPTED":
      return "sf-tone-success";
    case "SHORTLISTED":
      return "sf-tone-warning";
    case "SUBMITTED":
      return "sf-tone-info";
    case "REJECTED":
      return "sf-tone-danger";
    default:
      return "sf-tone-neutral";
  }
}
