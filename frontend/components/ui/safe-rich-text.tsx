"use client";

import { useMemo } from "react";

import { sanitizeRichTextHtml, stripRichText } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

export function SafeRichText({
  value,
  emptyText,
  className,
}: {
  value: string | null | undefined;
  emptyText?: string;
  className?: string;
}) {
  const plainText = useMemo(() => stripRichText(value), [value]);
  const html = useMemo(() => sanitizeRichTextHtml(value), [value]);

  if (!plainText) {
    return emptyText ? (
      <p className={cn("text-sm leading-7 text-[var(--foreground-muted)]", className)}>{emptyText}</p>
    ) : null;
  }

  return (
    <div
      className={cn(
        "text-sm leading-7 text-[var(--foreground-muted)]",
        "[&_a]:font-semibold [&_a]:text-[var(--primary)] [&_a]:underline [&_a]:underline-offset-4",
        "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--primary)] [&_blockquote]:pl-4",
        "[&_code]:rounded-md [&_code]:bg-black/5 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-[var(--foreground)]",
        "[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-[var(--foreground)]",
        "[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-[var(--foreground)]",
        "[&_h4]:mb-2 [&_h4]:mt-4 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:uppercase [&_h4]:tracking-[0.14em] [&_h4]:text-[var(--foreground)]",
        "[&_hr]:my-5 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-[var(--border)]",
        "[&_li]:ml-5 [&_li]:pl-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-2 [&_p]:mb-3 [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:bg-[var(--background)] [&_pre]:px-4 [&_pre]:py-3 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre]:text-[var(--foreground)] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:text-[var(--foreground)] [&_sub]:text-[0.8em] [&_sup]:text-[0.8em] [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-2",
        className
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
