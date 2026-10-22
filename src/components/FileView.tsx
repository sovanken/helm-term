import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { AtSign, Check, ChevronDown, ChevronUp, Code, Copy, Eye, FileText, FileWarning, FolderOpen, FolderTree, Pencil, RefreshCw, Save, SquareArrowOutUpRight, WrapText, X } from "lucide-react";

import { ipc, type FilePreview } from "../lib/ipc";
import { type FileTab, showToast, useStore } from "../state/store";
import { locale } from "../i18n";
import { Editor } from "./Editor";
import { Menu, type MenuItem } from "./Menu";
import { PdfView } from "./PdfView";
import { renderMarkdown } from "../lib/markdown";
import { isSettingsFile, onFileSaved, settingsEditorExtensions } from "../lib/settingsJson";
import { ShimmerBlock, ShimmerLines } from "./Shimmer";

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

/** Keeps a menu hint short: the end of a long path is the part that tells files apart. */
function shorten(text: string, max = 36) {
  return text.length > max ? `…${text.slice(-(max - 1))}` : text;
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
  const { t } = useTranslation();
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

  if (failed) return <Notice title={t("files.couldntOpen")} path={path} />;
  if (pdf) return <PdfView data={pdf} />;
  if (!url) return <ShimmerBlock className="m-6 min-h-0 flex-1" />;
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

function CodeView({ text, lang, wrap, truncated, line }: { text: string; lang: string; wrap: boolean; truncated: boolean; line?: number }) {
  const [html, setHtml] = useState<string | null>(null);
  const { t } = useTranslation();
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
  const box = useRef<HTMLDivElement>(null);
  // Jump to a line (from search): scroll it to the middle and mark it for a moment.
  useEffect(() => {
    if (!line) return;
    const el = box.current?.querySelectorAll(".line")[line - 1] as HTMLElement | undefined;
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("line-target");
    const t = setTimeout(() => el.classList.remove("line-target"), 1600);
    return () => clearTimeout(t);
  }, [line, html]);
  return (
    <div ref={box} className={`code-view scroll-thin min-h-0 flex-1 overflow-auto select-text ${wrap ? "wrap" : ""}`}>
      {truncated && <p className="border-b border-line bg-raised px-4 py-1.5 text-[12px] text-faint">{t("files.truncated")}</p>}
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

/** Find in rendered text: highlights every match (CSS Custom Highlight API) and steps through them. */
function FindBar({ root, onClose }: { root: HTMLElement | null; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [ranges, setRanges] = useState<Range[]>([]);
  const [index, setIndex] = useState(0);
  const { t } = useTranslation();

  useEffect(() => {
    const q = query.trim().toLowerCase();
    const found: Range[] = [];
    if (root && q) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node && found.length < 2000; node = walker.nextNode()) {
        const text = node.textContent?.toLowerCase() ?? "";
        for (let at = text.indexOf(q); at >= 0 && found.length < 2000; at = text.indexOf(q, at + q.length)) {
          const r = document.createRange();
          r.setStart(node, at);
          r.setEnd(node, at + q.length);
          found.push(r);
        }
      }
    }
    setRanges(found);
    setIndex(0);
  }, [query, root]);

  useEffect(() => {
    const hl = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const Highlight = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!hl || !Highlight) return;
    hl.set("helm-find", new Highlight(...ranges));
    if (ranges[index]) hl.set("helm-find-current", new Highlight(ranges[index]));
    else hl.delete("helm-find-current");
    // Bring the current match into view (its text node's parent element).
    ranges[index]?.startContainer.parentElement?.scrollIntoView({ block: "center" });
    return () => {
      hl.delete("helm-find");
      hl.delete("helm-find-current");
    };
  }, [ranges, index]);

  const step = (d: number) => ranges.length && setIndex((i) => (i + d + ranges.length) % ranges.length);
  return (
    <div className="absolute top-2 right-4 z-10 flex items-center gap-1 rounded-lg border border-line bg-raised p-1 shadow-lg shadow-black/20">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") step(e.shiftKey ? -1 : 1);
          if (e.key === "Escape") onClose();
        }}
        placeholder={t("files.find.placeholder")}
        aria-label={t("files.find.label")}
        className="h-7 w-52 rounded-md bg-bg px-2 text-[12.5px] text-fg outline-none placeholder:text-faint"
      />
      <span className="w-14 text-center text-[11px] text-faint tabular-nums">{query.trim() ? (ranges.length ? t("files.find.count", { current: index + 1, total: ranges.length }) : t("files.find.none")) : ""}</span>
      <ToolButton label={t("files.find.previous")} onClick={() => step(-1)}>
        <ChevronUp size={14} />
      </ToolButton>
      <ToolButton label={t("files.find.next")} onClick={() => step(1)}>
        <ChevronDown size={14} />
      </ToolButton>
      <ToolButton label={t("files.find.close")} onClick={onClose}>
        <X size={14} />
      </ToolButton>
    </div>
  );
}

function MarkdownView({ text }: { text: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const article = useRef<HTMLElement>(null);
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFinding(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {finding && <FindBar root={article.current} onClose={() => setFinding(false)} />}
      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        {/* Sanitized with DOMPurify. */}
        {html !== null && <article ref={article} className="markdown mx-auto max-w-3xl px-8 py-6 select-text" dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
    </div>
  );
}

/** File text as the editor sees it: no byte-order mark, \n line endings. */
function splitText(text: string) {
  const bom = text.startsWith("﻿");
  const body = bom ? text.slice(1) : text;
  return { bom, eol: body.includes("\r\n") ? "\r\n" : "\n", text: body.replace(/\r\n/g, "\n") };
}

export function FileBody({ file }: { file: FileTab }) {
  const activity = useStore((s) => s.activity);
  const { updateFile } = useStore.getState();
  const { t } = useTranslation();
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyMenu, setCopyMenu] = useState(false);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  /** The file changed outside Helm while there are unsaved edits. */
  const [conflict, setConflict] = useState(false);
  /** Bumped to restart the editor with the file's new text. */
  const [editorKey, setEditorKey] = useState(0);
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

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2500);
    return () => clearTimeout(t);
  }, [justSaved]);

  const disk = useMemo(() => (preview?.kind === "text" ? splitText(preview.text) : null), [preview]);
  const editable = preview?.kind === "text" && preview.editable;
  const editing = !!file.editing && editable;

  // A newer version on disk: take it if nothing is unsaved, otherwise ask.
  useEffect(() => {
    if (preview?.kind !== "text") return;
    const tab = useStore.getState().fileTabs.find((f) => f.id === file.id);
    if (!tab || tab.base === preview.modified) return setConflict(false);
    if (tab.base === undefined || tab.draft === undefined) {
      if (tab.base !== undefined) setEditorKey((k) => k + 1);
      updateFile(file.id, { base: preview.modified });
    } else setConflict(true);
  }, [preview, file.id, updateFile]);

  const shown = file.draft ?? disk?.text ?? "";

  const save = async (force = false) => {
    const tab = useStore.getState().fileTabs.find((f) => f.id === file.id);
    if (!tab || tab.draft === undefined || !disk || saving) return;
    const text = (disk.bom ? "﻿" : "") + tab.draft.replace(/\n/g, disk.eol);
    setSaving(true);
    try {
      const modified = await ipc.saveFile(file.path, text, tab.base ?? 0, force);
      updateFile(file.id, { draft: undefined, base: modified });
      setPreview({ kind: "text", text, size: new TextEncoder().encode(text).length, truncated: false, editable: true, modified });
      setConflict(false);
      setJustSaved(true);
      onFileSaved(file.path, text);
    } catch (e) {
      if (String(e) === "changed") {
        setConflict(true);
        setReload((n) => n + 1);
      } else showToast(t("files.saveFailed", { error: String(e) }), "error");
    } finally {
      setSaving(false);
    }
  };

  const useTheirs = () => {
    if (preview?.kind !== "text") return;
    updateFile(file.id, { draft: undefined, base: preview.modified });
    setEditorKey((k) => k + 1);
    setConflict(false);
  };

  const name = fileName(file.path);
  const rel = shortPath(file.path, file.cwd);
  const cut = Math.max(rel.lastIndexOf("\\"), rel.lastIndexOf("/"));
  const folder = cut > 0 ? rel.slice(0, cut) : "";
  const lineCount = disk ? shown.replace(/\n$/, "").split("\n").length : 0;
  const dirty = file.draft !== undefined;
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  // Inside the project: the path from its folder, and Claude's @mention form (forward slashes).
  const inProject = rel !== file.path;
  const copyItems: MenuItem[] = [
    { label: t("common.copyPath"), hint: shorten(file.path), icon: <Copy size={14} />, onSelect: () => copy(file.path) },
    ...(inProject ? [{ label: t("common.copyRelativePath"), hint: shorten(rel), icon: <FolderTree size={14} />, onSelect: () => copy(rel) }] : []),
    { label: t("files.copyFileName"), hint: shorten(name), icon: <FileText size={14} />, onSelect: () => copy(name) },
    {
      label: t("files.copyAtPath"),
      hint: shorten(`@${inProject ? rel.replace(/\\/g, "/") : file.path}`),
      icon: <AtSign size={14} />,
      onSelect: () => copy(`@${inProject ? rel.replace(/\\/g, "/") : file.path}`),
      separatorBefore: true,
    },
  ];
  const startEditing = (
    <button onClick={() => updateFile(file.id, { editing: true })} className="mt-1 flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] text-fg hover:bg-hover">
      <Pencil size={13} /> {t("common.edit")}
    </button>
  );
  const openInEditor = (
    <button onClick={() => void ipc.openInEditor(file.path)} className="mt-1 rounded-lg border border-line px-3 py-1.5 text-[12px] text-fg hover:bg-hover">
      {t("common.openInEditor")}
    </button>
  );

  let body: ReactNode;
  if (error) body = <Notice title={error.includes("no longer exists") ? t("files.gone") : t("files.couldntOpen")} path={file.path} />;
  else if (!preview) body = <ShimmerLines lines={14} className="px-6 py-5" />;
  else if (preview.kind === "image")
    body = (
      <div className="checker flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
        <img src={preview.dataUrl} alt={name} className="max-h-full max-w-full rounded-md border border-line object-contain" />
      </div>
    );
  else if (preview.kind === "media") body = <MediaView path={file.path} mime={preview.mime} version={preview.modified} />;
  else if (preview.kind === "tooLarge") body = <Notice title={t("files.tooLarge", { size: formatSize(preview.size) })} action={openInEditor} />;
  else if (preview.kind === "binary") body = <Notice title={t("files.binary")} action={openInEditor} />;
  else if (editing)
    body = (
      <Editor
        key={`${file.id}-${editorKey}`}
        name={name}
        initial={shown}
        wrap={wrap}
        onChange={(text) => updateFile(file.id, { draft: text === disk?.text ? undefined : text })}
        onSave={() => void save()}
        line={file.line}
        extra={isSettingsFile(file.path) ? settingsEditorExtensions() : undefined}
      />
    );
  else if (!shown) body = <Notice title={t("files.empty")} action={editable ? startEditing : undefined} />;
  else if (isMarkdown && rendered && !file.line) body = <MarkdownView text={shown} />;
  else body = <CodeView text={shown} lang={lang} wrap={wrap} truncated={preview.truncated} line={file.line} />;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-4">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate text-[13px] font-semibold text-fg">{name}</span>
          {folder && <span className="truncate text-[12px] text-faint">{folder}</span>}
        </div>
        {preview && (
          <span className="shrink-0 text-[11px] text-faint">
            {dirty ? (
              <span className="text-attention">{t("files.notSaved")}</span>
            ) : justSaved ? (
              <span className="text-done">{t("files.saved")}</span>
            ) : preview.kind === "text" ? (
              t("files.linesAndSize", { count: lineCount, n: lineCount.toLocaleString(locale()), size: formatSize(preview.size) })
            ) : (
              formatSize(preview.size)
            )}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          {editable && (
            <ToolButton label={editing ? t("files.stopEditing") : t("common.edit")} onClick={() => updateFile(file.id, { editing: !editing })} active={editing}>
              <Pencil size={14} />
            </ToolButton>
          )}
          {preview?.kind === "text" && isMarkdown && !editing && (
            <ToolButton label={rendered ? t("files.showSource") : t("files.showPreview")} onClick={() => setRendered((r) => !r)}>
              {rendered ? <Code size={14} /> : <Eye size={14} />}
            </ToolButton>
          )}
          {preview?.kind === "text" && isMarkdown && editing && (
            <ToolButton
              label={t("files.showPreview")}
              onClick={() => {
                setRendered(true);
                updateFile(file.id, { editing: false });
              }}
            >
              <Eye size={14} />
            </ToolButton>
          )}
          {preview?.kind === "text" && !(isMarkdown && rendered && !editing) && (
            <ToolButton label={wrap ? t("files.noWrap") : t("files.wrap")} onClick={() => setWrap((w) => !w)} active={wrap}>
              <WrapText size={14} />
            </ToolButton>
          )}
          {!editing && (
            <ToolButton label={t("files.reload")} onClick={() => setReload((n) => n + 1)}>
              <RefreshCw size={14} />
            </ToolButton>
          )}
          <div className="relative">
            <ToolButton label={copied ? t("common.copied") : t("common.copyPath")} onClick={() => setCopyMenu((m) => !m)} active={copyMenu}>
              {copied ? <Check size={14} className="text-done" /> : <Copy size={14} />}
            </ToolButton>
            {copyMenu && <Menu items={copyItems} onClose={() => setCopyMenu(false)} align="right" />}
          </div>
          <ToolButton label={t("common.showInExplorer")} onClick={() => void revealItemInDir(file.path)}>
            <FolderOpen size={14} />
          </ToolButton>
          <ToolButton label={t("common.openInEditor")} onClick={() => void ipc.openInEditor(file.path)}>
            <SquareArrowOutUpRight size={14} />
          </ToolButton>
          {(editing || dirty) && (
            <button
              title={t("files.saveShortcut")}
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="ml-1.5 flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[12px] font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
            >
              <Save size={13} /> {t("common.save")}
            </button>
          )}
        </div>
      </header>
      {conflict && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line bg-raised px-4 py-2 text-[12px]">
          <span className="flex-1 text-muted">{t("files.conflict")}</span>
          <button onClick={useTheirs} className="rounded-md border border-line px-2.5 py-1 text-fg hover:bg-hover">
            {t("files.loadNew")}
          </button>
          <button onClick={() => void save(true)} className="rounded-md bg-accent px-2.5 py-1 font-medium text-on-accent hover:opacity-90">
            {t("files.keepMine")}
          </button>
        </div>
      )}
      {body}
    </div>
  );
}

export function FileView() {
  const file = useStore((s) => s.fileTabs.find((f) => f.id === s.activeFileId));
  if (!file) return null;
  return <FileBody key={file.id} file={file} />;
}
