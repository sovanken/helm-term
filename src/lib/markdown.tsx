// Markdown to safe HTML (marked + DOMPurify), loaded on first use.

import { useEffect, useState } from "react";

export async function renderMarkdown(text: string) {
  const [{ marked }, { default: DOMPurify }] = await Promise.all([import("marked"), import("dompurify")]);
  return DOMPurify.sanitize(await marked.parse(text, { gfm: true }));
}

/** Rendered Markdown in the compact style used inside panels. Plain text until it's ready. */
export function MarkdownBlock({ text, className = "" }: { text: string; className?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    renderMarkdown(text).then(
      (h) => alive && setHtml(h),
      () => alive && setHtml(null),
    );
    return () => {
      alive = false;
    };
  }, [text]);
  if (html === null) return <div className={`markdown compact whitespace-pre-wrap select-text ${className}`}>{text}</div>;
  // Sanitized with DOMPurify.
  return <div className={`markdown compact select-text ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
