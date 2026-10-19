import { type ReactNode, useEffect, useMemo, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Check, Code, Copy, Eye, FileWarning, FolderOpen, RefreshCw, SquareArrowOutUpRight, WrapText } from "lucide-react";

import { ipc, type FilePreview } from "../lib/ipc";
import { type FileTab, useStore } from "../state/store";
import { PdfView } from "./PdfView";

/** Above this, highlighting would make the tab sluggish; show plain text instead. */
const HIGHLIGHT_LIMIT = 400_000;

const SPECIAL_NAMES: Record<string, string> = { dockerfile: "docker", makefile: "make", ".gitignore": "ini", ".env": "dotenv" };

function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function languageFor(path: string) {
  const name = fileName(path).toLowerCase();
  if (SPECIAL_NAMES[name]) return SPECIAL_NAMES[name];
  return name.includes(".") ? name.split(".").pop()! : "";
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function shortPath(path: string, cwd?: string) {
  if (cwd && path.toLowerCase().startsWith(cwd.toLowerCase())) return path.slice(cwd.length).replace(/^[\\/]/, "") || path;
  return path;
}

/** Highlights code with Shiki (loaded on first use, one language at a time). */
async function highlight(code: string, lang: string): Promise<string | null> {
  const { getSingletonHighlighter, createJavaScriptRegexEngine, bundledLanguages, bundledLanguagesAlias } = await import("shiki");
  if (!(lang in bundledLanguages || lang in bundledLanguagesAlias)) return null;
  const hl = await getSingletonHighlighter({ themes: ["github-light", "github-dark"], langs: [], engine: createJavaScriptRegexEngine() });
  await hl.loadLanguage(lang as Parameters<typeof hl.loadLanguage>[0]);
  const html = hl.codeToHtml(code, { lang, themes: { light: "github-light", dark: "github-dark" }, defaultColor: false });
  // Lines are block elements here (full-width hover, wrapping), so drop the newlines between them.
  return html.replace(/<\/span>\n<span class="line">/g, '</span><span class="line">');
}

/** Markdown to safe HTML (scripts, event handlers and the like are stripped). */
async function renderMarkdown(text: string) {
  const [{ marked }, { default: DOMPurify }] = await Promise.all([import("marked"), import("dompurify")]);
  return DOMPurify.sanitize(await marked.parse(text, { gfm: true }));
}

function ToolButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex size-7 items-center justify-center rounded-md hover:bg-hover hover:text-fg ${active ? "bg-hover text-fg" : "text-muted"}`}
    >
      {children}
    </button>
  );
}

function Notice({ title, path, action }: { title: string; path?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <FileWarning size={22} className="text-faint" />
      <p className="text-[13px] text-muted">{title}</p>
      {path && <p className="max-w-md truncate font-mono text-[11px] text-faint">{path}</p>}
      {action}
    </div>
  );
}

/** PDF, video or audio, played by the window from the file's bytes. */
function MediaView({ path, mime, version }: { path: string; mime: string; version: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [pdf, setPdf] = useState<ArrayBuffer | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setFailed(false);
    ipc.fileBytes(path).then(
      (buf) => {
        if (!alive) return;
        if (mime === "application/pdf") return setPdf(buf);
        made = URL.createObjectURL(new Blob([buf], { type: mime }));
        setUrl(made);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path, mime, version]);

  if (failed) return <Notice title="Couldn't open this file." path={path} />;
  if (pdf) return <PdfView data={pdf} />;
  if (!url) return <p className="p-4 text-[12px] text-faint">Opening…</p>;
  if (mime.startsWith("video/"))
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black/90 p-4">
        <video src={url} controls className="max-h-full max-w-full rounded-md" />
      </div>
    );
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <span className="text-[13px] font-medium text-fg">{fileName(path)}</span>
      <audio src={url} controls className="w-full max-w-md" />
    </div>
  );
}

function CodeView({ text, lang, wrap, truncated }: { text: string; lang: string; wrap: boolean; truncated: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    setHtml(null);
    if (text.length > HIGHLIGHT_LIMIT) return;
    let alive = true;
    highlight(text, lang).then(
      (h) => alive && setHtml(h),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [text, lang]);
  const lines = useMemo(() => text.replace(/\n$/, "").split("\n"), [text]);
  return (
    <div className={`code-view scroll-thin min-h-0 flex-1 overflow-auto select-text ${wrap ? "wrap" : ""}`}>
      {truncated && <p className="border-b border-line bg-raised px-4 py-1.5 text-[12px] text-faint">Showing the first 3 MB of this file.</p>}
      {html ? (
        // Shiki escapes the file's text; the markup is its own.
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="shiki">
          <code>
            {lines.map((l, i) => (
              <span key={i} className="line">
                {l}
              </span>
            ))}
          </code>
        </pre>
      )}
    </div>
  );
}

function MarkdownView({ text }: { text: string }) {
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
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-auto">
      {/* Sanitized with DOMPurify. */}
      {html !== null && <article className="markdown mx-auto max-w-3xl px-8 py-6 select-text" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

function FileBody({ file }: { file: FileTab }) {
  const activity = useStore((s) => s.activity);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reload, setReload] = useState(0);
  const lang = languageFor(file.path);
  const isMarkdown = lang === "md" || lang === "markdown" || lang === "mdx";
  const [rendered, setRendered] = useState(isMarkdown);

  // Re-read when Claude does something (the file may have changed) or on Reload.
  useEffect(() => {
    let alive = true;
    ipc.previewFile(file.path).then(
      (p) => {
        if (!alive) return;
        setError(null);
        setPreview((old) => (old && old.modified === p.modified && old.size === p.size && old.kind === p.kind ? old : p));
      },
      (e) => alive && setError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [file.path, activity, reload]);

  const name = fileName(file.path);
  const rel = shortPath(file.path, file.cwd);
  const cut = Math.max(rel.lastIndexOf("\\"), rel.lastIndexOf("/"));
  const folder = cut > 0 ? rel.slice(0, cut) : "";
  const lineCount = preview?.kind === "text" ? preview.text.replace(/\n$/, "").split("\n").length : 0;
  const openInEditor = (
    <button onClick={() => void ipc.openInEditor(file.path)} className="mt-1 rounded-lg border border-line px-3 py-1.5 text-[12px] text-fg hover:bg-hover">
      Open in your editor
    </button>
  );

  let body: ReactNode;
  if (error) body = <Notice title={error.includes("no longer exists") ? "This file no longer exists." : "Couldn't open this file."} path={file.path} />;
  else if (!preview) body = <p className="p-4 text-[12px] text-faint">Opening…</p>;
  else if (preview.kind === "image")
    body = (
      <div className="checker flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
        <img src={preview.dataUrl} alt={name} className="max-h-full max-w-full rounded-md border border-line object-contain" />
      </div>
    );
  else if (preview.kind === "media") body = <MediaView path={file.path} mime={preview.mime} version={preview.modified} />;
  else if (preview.kind === "tooLarge") body = <Notice title={`This file is too large to show here (${formatSize(preview.size)}).`} action={openInEditor} />;
  else if (preview.kind === "binary") body = <Notice title="This file can't be shown as text." action={openInEditor} />;
  else if (preview.size === 0) body = <Notice title="This file is empty." />;
  else if (isMarkdown && rendered) body = <MarkdownView text={preview.text} />;
  else body = <CodeView text={preview.text} lang={lang} wrap={wrap} truncated={preview.truncated} />;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-4">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate text-[13px] font-semibold text-fg">{name}</span>
          {folder && <span className="truncate text-[12px] text-faint">{folder}</span>}
        </div>
        {preview && (
          <span className="shrink-0 text-[11px] text-faint">
            {preview.kind === "text" && `${lineCount.toLocaleString()} ${lineCount === 1 ? "line" : "lines"} · `}
            {formatSize(preview.size)}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          {preview?.kind === "text" && isMarkdown && (
            <ToolButton label={rendered ? "Show the source" : "Show the preview"} onClick={() => setRendered((r) => !r)}>
              {rendered ? <Code size={14} /> : <Eye size={14} />}
            </ToolButton>
          )}
          {preview?.kind === "text" && !(isMarkdown && rendered) && (
            <ToolButton label={wrap ? "Don't wrap long lines" : "Wrap long lines"} onClick={() => setWrap((w) => !w)} active={wrap}>
              <WrapText size={14} />
            </ToolButton>
          )}
          <ToolButton label="Reload" onClick={() => setReload((n) => n + 1)}>
            <RefreshCw size={14} />
          </ToolButton>
          <ToolButton
            label={copied ? "Copied" : "Copy path"}
            onClick={() => {
              void navigator.clipboard.writeText(file.path);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? <Check size={14} className="text-done" /> : <Copy size={14} />}
          </ToolButton>
          <ToolButton label="Show in folder" onClick={() => void revealItemInDir(file.path)}>
            <FolderOpen size={14} />
          </ToolButton>
          <ToolButton label="Open in your editor" onClick={() => void ipc.openInEditor(file.path)}>
            <SquareArrowOutUpRight size={14} />
          </ToolButton>
        </div>
      </header>
      {body}
    </div>
  );
}

export function FileView() {
  const file = useStore((s) => s.fileTabs.find((f) => f.id === s.activeFileId));
  if (!file) return null;
  return <FileBody key={file.id} file={file} />;
}
