const ALLOWED_TAGS = new Set([
  "P",
  "BR",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "S",
  "STRIKE",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "A",
  "PRE",
  "CODE",
  "HR",
  "H2",
  "H3",
  "H4",
  "SUB",
  "SUP",
]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeRichTextHtml(value: string): string {
  return value
    .replace(/<(p|pre|blockquote|h2|h3|h4)>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi, "")
    .replace(/<div>/gi, "<p>")
    .replace(/<\/div>/gi, "</p>")
    .trim();
}

export function normalizeLinkHref(value: string | null | undefined): string | null {
  const nextValue = (value ?? "").trim();
  if (!nextValue) return null;

  if (nextValue.startsWith("/") || nextValue.startsWith("#")) {
    return nextValue;
  }

  const lower = nextValue.toLowerCase();
  if (
    lower.startsWith("http://")
    || lower.startsWith("https://")
    || lower.startsWith("mailto:")
    || lower.startsWith("tel:")
  ) {
    return nextValue;
  }

  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#].*)?$/i.test(nextValue)) {
    return `https://${nextValue}`;
  }

  return null;
}

function sanitizeNode(documentRef: Document, node: Node): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return documentRef.createTextNode(node.textContent ?? "");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as HTMLElement;
  const tagName = element.tagName.toUpperCase();

  if (!ALLOWED_TAGS.has(tagName)) {
    const fragment = documentRef.createDocumentFragment();
    Array.from(element.childNodes).forEach((child) => {
      const sanitizedChild = sanitizeNode(documentRef, child);
      if (sanitizedChild) fragment.appendChild(sanitizedChild);
    });
    return fragment;
  }

  if (tagName === "A") {
    const href = normalizeLinkHref(element.getAttribute("href"));
    if (!href) {
      const fragment = documentRef.createDocumentFragment();
      Array.from(element.childNodes).forEach((child) => {
        const sanitizedChild = sanitizeNode(documentRef, child);
        if (sanitizedChild) fragment.appendChild(sanitizedChild);
      });
      return fragment;
    }

    const anchor = documentRef.createElement("a");
    anchor.setAttribute("href", href);
    if (/^https?:/i.test(href)) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noreferrer noopener");
    }
    Array.from(element.childNodes).forEach((child) => {
      const sanitizedChild = sanitizeNode(documentRef, child);
      if (sanitizedChild) anchor.appendChild(sanitizedChild);
    });
    return anchor;
  }

  const cleanElement = documentRef.createElement(tagName.toLowerCase());
  Array.from(element.childNodes).forEach((child) => {
    const sanitizedChild = sanitizeNode(documentRef, child);
    if (sanitizedChild) cleanElement.appendChild(sanitizedChild);
  });
  return cleanElement;
}

export function stripRichText(value: string | null | undefined): string {
  if (!value) return "";

  if (typeof window === "undefined") {
    return value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<hr\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|blockquote|h2|h3|h4|pre)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  const parser = new window.DOMParser();
  const doc = parser.parseFromString(value, "text/html");
  return (doc.body.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeRichTextHtml(value: string | null | undefined): string {
  if (!value) return "";

  if (typeof window === "undefined") {
    const text = stripRichText(value);
    return text ? `<p>${escapeHtml(text)}</p>` : "";
  }

  const parser = new window.DOMParser();
  const doc = parser.parseFromString(value, "text/html");
  const container = doc.createElement("div");

  Array.from(doc.body.childNodes).forEach((child) => {
    const sanitizedChild = sanitizeNode(doc, child);
    if (sanitizedChild) container.appendChild(sanitizedChild);
  });

  return normalizeRichTextHtml(container.innerHTML);
}
