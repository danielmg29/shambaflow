"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  RemoveFormatting,
  Underline,
  Link2,
  Redo2,
  Undo2,
} from "lucide-react";

import { normalizeLinkHref, sanitizeRichTextHtml, stripRichText } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

type Command =
  | "bold"
  | "italic"
  | "underline"
  | "strikeThrough"
  | "subscript"
  | "superscript"
  | "insertUnorderedList"
  | "insertOrderedList"
  | "unlink"
  | "undo"
  | "redo"
  | "insertHorizontalRule"
  | "removeFormat";

type BlockType = "p" | "h2" | "h3" | "h4" | "blockquote" | "pre";

const BLOCK_FORMAT_COMMAND_VALUE: Record<BlockType, string> = {
  p: "<p>",
  h2: "<h2>",
  h3: "<h3>",
  h4: "<h4>",
  blockquote: "<blockquote>",
  pre: "<pre>",
};

interface ToolbarState {
  block: BlockType;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeThrough: boolean;
  subscript: boolean;
  superscript: boolean;
  unorderedList: boolean;
  orderedList: boolean;
  link: boolean;
}

const DEFAULT_TOOLBAR_STATE: ToolbarState = {
  block: "p",
  bold: false,
  italic: false,
  underline: false,
  strikeThrough: false,
  subscript: false,
  superscript: false,
  unorderedList: false,
  orderedList: false,
  link: false,
};

function ToolbarButton({
  active,
  label,
  visibleLabel,
  onClick,
  children,
  className,
}: {
  active?: boolean;
  label: string;
  visibleLabel?: string;
  onClick: () => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 min-w-fit items-center justify-center gap-2 rounded-xl border px-3 text-[13px] font-semibold text-[var(--foreground-muted)] transition-colors",
        active
          ? "border-[var(--primary)] bg-[var(--primary-light)] text-[var(--primary)]"
          : "border-[var(--border)] bg-[var(--background)] hover:border-[var(--border-strong)] hover:text-[var(--foreground)]"
        ,
        className
      )}
    >
      {children ? (
        <span aria-hidden="true" className="inline-flex items-center justify-center">
          {children}
        </span>
      ) : null}
      <span className="whitespace-nowrap">{visibleLabel ?? label}</span>
    </button>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (nextValue: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const plainText = useMemo(() => stripRichText(value), [value]);
  const [toolbarState, setToolbarState] = useState<ToolbarState>(DEFAULT_TOOLBAR_STATE);
  const [linkMenuOpen, setLinkMenuOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const wordCount = useMemo(
    () => (plainText ? plainText.split(/\s+/).filter(Boolean).length : 0),
    [plainText]
  );
  const characterCount = plainText.length;

  useEffect(() => {
    if (!editorRef.current) return;
    const sanitized = sanitizeRichTextHtml(value);
    if (editorRef.current.innerHTML !== sanitized) {
      editorRef.current.innerHTML = sanitized;
    }
  }, [value]);

  const syncValue = () => {
    if (!editorRef.current) return;
    const nextValue = sanitizeRichTextHtml(editorRef.current.innerHTML);
    onChange(nextValue);
  };

  const selectionInsideEditor = useCallback(() => {
    if (!editorRef.current || typeof window === "undefined") return false;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const node = container.nodeType === Node.TEXT_NODE ? container.parentNode : container;
    return Boolean(node && editorRef.current.contains(node));
  }, []);

  const getSelectionElement = useCallback(() => {
    if (!editorRef.current || typeof window === "undefined") return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const node = selection.anchorNode;
    if (!node) return null;
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement;
    if (!element || !editorRef.current.contains(element)) return null;
    return element;
  }, []);

  const captureSelection = useCallback(() => {
    if (!selectionInsideEditor() || typeof window === "undefined") return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    savedSelectionRef.current = selection.getRangeAt(0).cloneRange();
  }, [selectionInsideEditor]);

  const restoreSelection = useCallback(() => {
    if (!savedSelectionRef.current || typeof window === "undefined") return;
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(savedSelectionRef.current);
  }, []);

  const syncToolbarState = useCallback(() => {
    if (!editorRef.current || typeof document === "undefined") return;
    if (!selectionInsideEditor()) {
      setToolbarState(DEFAULT_TOOLBAR_STATE);
      return;
    }

    const element = getSelectionElement();
    let block: BlockType = "p";
    let link = false;
    let current = element;

    while (current && current !== editorRef.current) {
      const tagName = current.tagName?.toLowerCase();
      if (tagName === "a") link = true;
      if (tagName === "pre") {
        block = "pre";
        break;
      }
      if (tagName === "blockquote") {
        block = "blockquote";
        break;
      }
      if (tagName === "h2" || tagName === "h3" || tagName === "h4" || tagName === "p") {
        block = tagName;
        break;
      }
      current = current.parentElement;
    }

    setToolbarState({
      block,
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      strikeThrough: document.queryCommandState("strikeThrough"),
      subscript: document.queryCommandState("subscript"),
      superscript: document.queryCommandState("superscript"),
      unorderedList: document.queryCommandState("insertUnorderedList"),
      orderedList: document.queryCommandState("insertOrderedList"),
      link,
    });
  }, [getSelectionElement, selectionInsideEditor]);

  useEffect(() => {
    syncToolbarState();
  }, [syncToolbarState, value]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleSelectionChange = () => {
      syncToolbarState();
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [syncToolbarState]);

  const runCommand = (command: Command, commandValue?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    syncValue();
    syncToolbarState();
  };

  const applyBlock = (block: BlockType) => {
    restoreSelection();
    editorRef.current?.focus();
    document.execCommand("formatBlock", false, BLOCK_FORMAT_COMMAND_VALUE[block]);
    syncValue();
    syncToolbarState();
  };

  const openLinkMenu = () => {
    captureSelection();
    const selectedElement = getSelectionElement();
    const anchor = selectedElement?.closest("a");
    setLinkDraft(anchor?.getAttribute("href") ?? "");
    setLinkError(null);
    setLinkMenuOpen(true);
  };

  const applyLink = () => {
    const href = normalizeLinkHref(linkDraft);
    if (!href) {
      setLinkError("Enter a valid URL, email link, or phone link.");
      return;
    }

    restoreSelection();
    editorRef.current?.focus();
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    const collapsed = !selection || selection.rangeCount === 0 || selection.getRangeAt(0).collapsed;

    if (collapsed) {
      document.execCommand("insertHTML", false, `<a href="${href}">${href}</a>`);
    } else {
      document.execCommand("createLink", false, href);
    }

    syncValue();
    syncToolbarState();
    setLinkMenuOpen(false);
    setLinkDraft("");
    setLinkError(null);
  };

  return (
    <div className={cn("rounded-[24px] border border-[var(--input-border)] bg-[var(--input-bg)]", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--foreground-subtle)]">
          Text style
        </span>
        <select
          aria-label="Block style"
          value={toolbarState.block}
          onMouseDown={captureSelection}
          onChange={(event) => applyBlock(event.target.value as BlockType)}
          className="h-9 min-w-[11rem] rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
        >
          <option value="p">Paragraph</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="h4">Heading 4</option>
          <option value="blockquote">Quote</option>
          <option value="pre">Code block</option>
        </select>

        <ToolbarButton active={toolbarState.bold} label="Bold" onClick={() => runCommand("bold")}>
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton active={toolbarState.italic} label="Italic" onClick={() => runCommand("italic")}>
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton active={toolbarState.underline} label="Underline" onClick={() => runCommand("underline")}>
          <Underline className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.strikeThrough}
          label="Strikethrough"
          visibleLabel="Strike"
          onClick={() => runCommand("strikeThrough")}
        >
          S
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.subscript}
          label="Subscript"
          visibleLabel="Sub"
          onClick={() => runCommand("subscript")}
        >
          sub
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.superscript}
          label="Superscript"
          visibleLabel="Sup"
          onClick={() => runCommand("superscript")}
        >
          sup
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.unorderedList}
          label="Bulleted list"
          visibleLabel="Bullets"
          onClick={() => runCommand("insertUnorderedList")}
        >
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.orderedList}
          label="Numbered list"
          visibleLabel="Numbers"
          onClick={() => runCommand("insertOrderedList")}
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton active={toolbarState.block === "blockquote"} label="Quote" onClick={() => applyBlock("blockquote")}>
          <Quote className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton active={toolbarState.link} label="Insert link" visibleLabel="Add link" onClick={openLinkMenu}>
          <Link2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Remove link" onClick={() => runCommand("unlink")} />
        <ToolbarButton label="Insert divider" visibleLabel="Divider" onClick={() => runCommand("insertHorizontalRule")} />
        <ToolbarButton label="Undo" onClick={() => runCommand("undo")}>
          <Undo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Redo" onClick={() => runCommand("redo")}>
          <Redo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Clear formatting" visibleLabel="Clear" onClick={() => runCommand("removeFormat")}>
          <RemoveFormatting className="h-4 w-4" />
        </ToolbarButton>
      </div>

      {linkMenuOpen ? (
        <div className="border-b border-[var(--border)] px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={linkDraft}
              onChange={(event) => {
                setLinkDraft(event.target.value);
                if (linkError) setLinkError(null);
              }}
              placeholder="https://buyer-example.com/specification"
              className="h-10 flex-1 rounded-xl border border-[var(--input-border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
            <div className="flex items-center gap-2">
              <ToolbarButton label="Apply" onClick={applyLink} className="w-auto px-3" />
              <ToolbarButton
                label="Cancel"
                onClick={() => {
                  setLinkMenuOpen(false);
                  setLinkDraft("");
                  setLinkError(null);
                }}
                className="w-auto px-3"
              />
            </div>
          </div>
          {linkError ? (
            <p className="mt-2 text-xs font-medium text-rose-600">{linkError}</p>
          ) : (
            <p className="mt-2 text-xs text-[var(--foreground-subtle)]">
              Supports `https://`, `mailto:`, `tel:`, or plain domains.
            </p>
          )}
        </div>
      ) : null}

      <div className="relative px-4 py-4">
        {!plainText && placeholder ? (
          <p className="pointer-events-none absolute left-4 top-4 max-w-[92%] text-sm leading-6 text-[var(--foreground-subtle)]">
            {placeholder}
          </p>
        ) : null}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={syncValue}
          onKeyUp={syncToolbarState}
          onMouseUp={syncToolbarState}
          onFocus={syncToolbarState}
          onBlur={() => window.setTimeout(syncToolbarState, 0)}
          className={cn(
            "min-h-[190px] rounded-2xl text-sm leading-7 text-[var(--foreground)] focus:outline-none",
            "[&_blockquote]:border-l-2 [&_blockquote]:border-[var(--primary)] [&_blockquote]:pl-4 [&_blockquote]:text-[var(--foreground-muted)]",
            "[&_a]:font-semibold [&_a]:text-[var(--primary)] [&_a]:underline [&_a]:underline-offset-4",
            "[&_code]:rounded-md [&_code]:bg-black/5 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]",
            "[&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-3 [&_h3]:text-base [&_h3]:font-semibold [&_h4]:mb-2 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:uppercase [&_h4]:tracking-[0.14em]",
            "[&_hr]:my-5 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-[var(--border)] [&_li]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_p]:mb-3 [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:bg-[var(--background)] [&_pre]:px-4 [&_pre]:py-3 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:space-y-2"
          )}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--foreground-subtle)]">
        <p>Advanced formatting enabled: headings, code blocks, links, dividers, undo/redo, and inline typography controls.</p>
        <p>{wordCount} words · {characterCount} characters</p>
      </div>
    </div>
  );
}
