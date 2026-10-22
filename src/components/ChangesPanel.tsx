import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Trans, useTranslation } from "react-i18next";
import { ask } from "@tauri-apps/plugin-dialog";
import { ExternalLink, FileDiff, GitBranch, MessageSquare, MessageSquarePlus, RefreshCw, Send, Undo2, X } from "lucide-react";
import { type Changes, type ChangedFile, ipc } from "../lib/ipc";
import { parseUnified, singleHunkPatch, type Cell, type Row } from "../lib/diff";
import { paneIds } from "../lib/layout";
import { insertText } from "../terminal/terminals";
import { activePane, folderName, showToast, useStore } from "../state/store";
import { t } from "../i18n";
import { ShimmerRows } from "./Shimmer";

/** `label` is a translation key. */
const STATUS: Record<ChangedFile["status"], { label: string; className: string }> = {
  M: { label: "changes.status.changed", className: "text-working" },
  A: { label: "changes.status.added", className: "text-done" },
  U: { label: "changes.status.new", className: "text-done" },
  D: { label: "changes.status.deleted", className: "text-danger" },
  R: { label: "changes.status.renamed", className: "text-attention" },
};

function splitPath(path: string) {
  const i = path.lastIndexOf("/");
  return i < 0 ? { dir: "", name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) };
}

export function ChangesPanel() {
  const { t } = useTranslation();
  const activity = useStore((s) => s.activity);
  const activeTabId = useStore((s) => s.activeTabId);
  const panes = useStore((s) => s.panes);
  const cwd = useMemo(() => activePane()?.cwd, [activeTabId, panes]);
  const [changes, setChanges] = useState<Changes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<ChangedFile | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);

  const load = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    try {
      setChanges(await ipc.gitChanges(cwd));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  // Refresh when Claude acts, when the folder changes, and every few seconds while visible.
  useEffect(() => {
    void load();
  }, [load, activity]);
  useEffect(() => {
    const timer = setInterval(() => document.hasFocus() && void load(), 4000);
    return () => clearInterval(timer);
  }, [load]);

  const revert = async (file: ChangedFile) => {
    if (!changes?.root) return;
    const isNew = file.status === "U" || file.status === "A";
    const ok = await ask(isNew ? t("changes.revert.deleteNewMessage", { path: file.path }) : t("changes.revert.undoMessage", { path: file.path }), {
      title: t("changes.revert.title"),
      kind: "warning",
      okLabel: isNew ? t("changes.revert.deleteFile") : t("changes.revert.undoChanges"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      await ipc.gitRevert(changes.root, file.path, file.status);
      if (open?.path === file.path) setOpen(null);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const totals = changes?.files.reduce((acc, f) => ({ add: acc.add + (f.added ?? 0), del: acc.del + (f.removed ?? 0) }), { add: 0, del: 0 });

  return (
    <>
      <aside className="flex w-full min-w-0 flex-col bg-bg">
        <div className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-muted">
          <FileDiff size={13} className="shrink-0" />
          <span className="truncate font-medium text-fg">{cwd && folderName(changes?.root ?? cwd)}</span>
          {changes?.branch && (
            <span className="flex shrink-0 items-center gap-1 text-faint">
              <GitBranch size={11} /> {changes.branch}
            </span>
          )}
          <button aria-label={t("common.refresh")} title={t("common.refresh")} onClick={() => void load()} className="ml-auto flex size-6 shrink-0 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg">
            <RefreshCw size={12} className={loading ? "status-working" : ""} />
          </button>
        </div>

        {comments.length > 0 && changes?.root && (
          <div className="mx-2 mb-2 flex items-center gap-2 rounded-md bg-accent-soft px-2.5 py-1.5 text-[12px] text-fg">
            <MessageSquare size={13} className="text-accent" />
            <span className="flex-1">
              {t("changes.reviewComments", { count: comments.length })}
            </span>
            <button onClick={() => setComments([])} className="text-muted hover:text-fg">
              {t("changes.clear")}
            </button>
            <button
              onClick={() => {
                if (!sendReview(changes.root!, comments)) return;
                setComments([]);
                setOpen(null);
              }}
              className="rounded bg-accent px-2 py-0.5 font-medium text-on-accent"
            >
              {t("changes.sendToClaude")}
            </button>
          </div>
        )}
        {changes?.isRepo && changes.files.length > 0 && totals && (
          <div className="flex items-center gap-2 border-y border-line px-3 py-1.5 text-[12px] text-muted">
            <span>{t("changes.filesSinceCommit", { count: changes.files.length })}</span>
            <span className="ml-auto text-done">+{totals.add}</span>
            <span className="text-danger">−{totals.del}</span>
          </div>
        )}

        <div className="scroll-thin flex-1 overflow-y-auto p-1.5">
          {error && <p className="m-1.5 rounded-md bg-hover p-2.5 text-[12px] text-danger">{error}</p>}
          {!cwd && <p className="p-3 text-[12px] text-faint">{t("changes.noTab")}</p>}
          {cwd && !changes && !error && <ShimmerRows rows={5} className="p-2" />}
          {changes && !changes.isRepo && (
            <p className="p-3 text-[12px] leading-relaxed text-faint">
              <Trans i18nKey="changes.notRepo" components={[<code className="text-muted" />]} />
            </p>
          )}
          {changes?.isRepo && changes.files.length === 0 && (
            <p className="p-3 text-[12px] leading-relaxed text-faint">{t("changes.noChanges")}</p>
          )}
          {changes?.files.map((f) => {
            const { dir, name } = splitPath(f.path);
            const st = STATUS[f.status];
            return (
              <div key={f.path} className={`group flex items-center gap-2 rounded-md px-2 py-1.5 ${open?.path === f.path ? "bg-hover" : "hover:bg-hover"}`}>
                <button onClick={() => setOpen(f)} title={t("changes.fileTitle", { status: t(st.label), path: f.path })} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className={`w-3 shrink-0 text-center text-[11px] font-semibold ${st.className}`}>{f.status === "U" ? "+" : f.status}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${f.status === "D" ? "text-muted line-through" : "text-fg"}`}>{name}</span>
                    {dir && <span className="block truncate text-[11px] text-faint">{dir}</span>}
                  </span>
                  {(f.added !== undefined || f.removed !== undefined) && (
                    <span className="shrink-0 text-[11px] tabular-nums group-hover:hidden">
                      {!!f.added && <span className="text-done">+{f.added}</span>} {!!f.removed && <span className="text-danger">−{f.removed}</span>}
                    </span>
                  )}
                </button>
                <button
                  aria-label={t("changes.undoFileNamed", { path: f.path })}
                  title={t("changes.undoFile")}
                  onClick={() => void revert(f)}
                  className="hidden size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-bg hover:text-danger group-hover:flex"
                >
                  <Undo2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </aside>
      {/* The diff covers the terminal area only, so the file list stays clickable. */}
      {open &&
        changes?.root &&
        document.getElementById("main-area") &&
        createPortal(
          <DiffView
            root={changes.root}
            file={open}
            onClose={() => setOpen(null)}
            onRevert={() => void revert(open)}
            onReload={() => void load()}
            comments={comments}
            setComments={setComments}
          />,
          document.getElementById("main-area")!,
        )}
    </>
  );
}

export interface ReviewComment {
  id: string;
  path: string;
  line: number;
  /** "new" = line in the current file, "old" = removed line. */
  side: "old" | "new";
  code: string;
  text: string;
}

/** Sends review comments to the Claude tab working in this repository. */
function sendReview(root: string, comments: ReviewComment[]): boolean {
  const s = useStore.getState();
  const inRepo = (p: { cwd: string }) => p.cwd.toLowerCase().startsWith(root.replace(/\//g, "\\").toLowerCase()) || p.cwd.toLowerCase().startsWith(root.toLowerCase());
  const candidates = Object.values(s.panes).filter((p) => (p.claudeActive || p.kind === "claude") && inRepo(p));
  const active = activePane();
  const target = candidates.find((p) => p.id === active?.id) ?? candidates[0];
  if (!target) {
    showToast(t("changes.openClaudeFirst"), "error");
    return false;
  }
  const lines = comments.map(
    (c, i) => `${i + 1}. ${c.path}:${c.line}${c.side === "old" ? " (removed line)" : ""} — ${c.text}\n   Code: ${c.code.trim().slice(0, 160)}`,
  );
  const message = `Please address these review comments on the current uncommitted changes:\n\n${lines.join("\n")}`;
  const tab = s.tabs.find((tb) => paneIds(tb.root).includes(target.id));
  if (tab) {
    s.setActiveTab(tab.id);
    s.focusPane(target.id);
  }
  insertText(target.id, message);
  setTimeout(() => void ipc.write(target.id, "\r"), 200);
  showToast(t("changes.sentComments", { count: comments.length }), "success");
  return true;
}

function DiffCell({ cell, onComment }: { cell?: Cell; onComment?: () => void }) {
  const { t } = useTranslation();
  const bg = !cell ? "bg-hover/40" : cell.kind === "del" ? "bg-danger/12" : cell.kind === "add" ? "bg-done/12" : "";
  return (
    <>
      <td className={`group/no w-12 border-r border-line px-1 text-right align-top text-faint select-none ${bg}`}>
        {cell && onComment ? (
          <button onClick={onComment} title={t("changes.commentOnLine")} className="w-full rounded px-1 text-right hover:bg-accent-soft hover:text-accent">
            <span className="group-hover/no:hidden">{cell.no}</span>
            <MessageSquarePlus size={12} className="ml-auto hidden group-hover/no:block" />
          </button>
        ) : (
          cell?.no ?? ""
        )}
      </td>
      <td className={`px-3 align-top whitespace-pre-wrap [overflow-wrap:anywhere] ${bg}`}>
        {cell && cell.kind !== "context" && <span className={`mr-2 select-none ${cell.kind === "del" ? "text-danger" : "text-done"}`}>{cell.kind === "del" ? "−" : "+"}</span>}
        {cell?.text}
      </td>
    </>
  );
}

function CommentEditor({ onSave, onCancel, initial = "" }: { onSave: (text: string) => void; onCancel: () => void; initial?: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState(initial);
  return (
    <div className="m-2 rounded-lg border border-accent/50 bg-raised p-2 font-sans">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || !e.shiftKey)) {
            e.preventDefault();
            if (text.trim()) onSave(text.trim());
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        rows={2}
        placeholder={t("changes.commentPlaceholder")}
        className="w-full resize-none bg-transparent text-[13px] text-fg outline-none placeholder:text-faint"
      />
      <div className="flex justify-end gap-1.5">
        <button onClick={onCancel} className="rounded px-2 py-0.5 text-[12px] text-muted hover:bg-hover">
          {t("common.cancel")}
        </button>
        <button onClick={() => text.trim() && onSave(text.trim())} className="rounded bg-accent px-2 py-0.5 text-[12px] font-medium text-on-accent">
          {t("changes.addComment")}
        </button>
      </div>
    </div>
  );
}

function DiffView({
  root,
  file,
  onClose,
  onRevert,
  onReload,
  comments,
  setComments,
}: {
  root: string;
  file: ChangedFile;
  onClose: () => void;
  onRevert: () => void;
  onReload: () => void;
  comments: ReviewComment[];
  setComments: (c: ReviewComment[]) => void;
}) {
  const { t } = useTranslation();
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const activity = useStore((s) => s.activity);

  useEffect(() => {
    ipc.gitDiff(root, file.path, file.status).then(setDiff, (e) => setError(String(e)));
  }, [root, file.path, file.status, activity, version]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && editing === null && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose, editing]);

  const parsed = useMemo(() => (diff === null ? null : parseUnified(diff)), [diff]);
  const full = `${root}/${file.path}`;
  const fileComments = comments.filter((c) => c.path === file.path);
  const canUndoHunk = file.status === "M" || file.status === "R";

  const undoHunk = async (index: number) => {
    if (!diff) return;
    const patch = singleHunkPatch(diff, index);
    if (!patch) return;
    const ok = await ask(t("changes.hunk.message"), { title: t("changes.hunk.title"), kind: "warning", okLabel: t("changes.hunk.ok"), cancelLabel: t("common.cancel") });
    if (!ok) return;
    try {
      await ipc.gitRevertHunk(root, patch);
      showToast(t("changes.hunk.done"), "success");
      setVersion((v) => v + 1);
      onReload();
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const commentFor = (row: Extract<Row, { type: "line" }>) => {
    const cell = row.right ?? row.left!;
    return { line: cell.no, side: row.right ? ("new" as const) : ("old" as const), code: cell.text };
  };

  return (
    <div className="anim-fade absolute inset-0 z-30 flex flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className={`text-[11px] font-semibold ${STATUS[file.status].className}`}>{t(STATUS[file.status].label)}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{file.path}</span>
        {comments.length > 0 && (
          <button
            onClick={() => {
              if (!sendReview(root, comments)) return;
              setComments([]);
              onClose(); // show Claude's tab so the reply is visible
            }}
            className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 font-medium text-on-accent hover:opacity-90"
          >
            <Send size={13} /> {t("changes.sendComments", { count: comments.length })}
          </button>
        )}
        {file.status !== "D" && (
          <button onClick={() => void ipc.openInEditor(full)} className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-muted hover:bg-hover hover:text-fg">
            <ExternalLink size={13} /> {t("common.openInEditor")}
          </button>
        )}
        <button onClick={onRevert} className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-muted hover:bg-hover hover:text-danger">
          <Undo2 size={13} /> {t("changes.undoFileChanges")}
        </button>
        <button aria-label={t("changes.closeDiff")} title={t("changes.closeEsc")} onClick={onClose} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <X size={15} />
        </button>
      </div>
      <div className="flex border-b border-line text-[11px] font-semibold tracking-wide text-faint uppercase">
        <div className="flex-1 px-4 py-1.5">{t("changes.before")}</div>
        <div className="flex-1 border-l border-line px-4 py-1.5">
          <Trans i18nKey="changes.now" components={[<span className="ml-2 font-normal tracking-normal text-faint normal-case" />]} />
        </div>
      </div>
      <div className="scroll-thin flex-1 overflow-auto font-mono text-[12.5px] leading-[1.55] select-text" style={{ fontFamily: "'Cascadia Mono', Consolas, monospace" }}>
        {error && <p className="p-4 text-danger">{error}</p>}
        {parsed?.binary && <p className="p-4 text-faint">{t("changes.binary")}</p>}
        {parsed && !parsed.binary && parsed.rows.length === 0 && <p className="p-4 text-faint">{t("changes.noTextChanged")}</p>}
        {parsed && !parsed.binary && parsed.rows.length > 0 && (
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col className="w-12" />
              <col />
              <col className="w-12" />
              <col />
            </colgroup>
            <tbody>
              {parsed.rows.map((row, i) => {
                if (row.type === "hunk") {
                  return (
                    <tr key={i}>
                      <td colSpan={4} className="border-y border-line bg-bg px-4 py-1 text-[11px] text-faint">
                        <div className="flex items-center gap-2 font-sans">
                          <span className="min-w-0 flex-1 truncate font-mono">{row.header || "···"}</span>
                          {canUndoHunk && (
                            <button onClick={() => void undoHunk(row.index)} className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-muted hover:bg-hover hover:text-danger">
                              <Undo2 size={11} /> {t("changes.hunk.button")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }
                const c = commentFor(row);
                const here = fileComments.filter((x) => x.line === c.line && x.side === c.side);
                return (
                  <Fragment key={i}>
                    <tr>
                      <DiffCell cell={row.left} onComment={row.right ? undefined : () => setEditing(i)} />
                      <DiffCell cell={row.right} onComment={() => setEditing(i)} />
                    </tr>
                    {here.map((cm) => (
                      <tr key={cm.id}>
                        <td colSpan={4} className="px-2 py-1">
                          <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent-soft px-3 py-1.5 font-sans text-[13px] text-fg">
                            <MessageSquare size={13} className="mt-0.5 shrink-0 text-accent" />
                            <span className="min-w-0 flex-1 whitespace-pre-wrap">{cm.text}</span>
                            <button aria-label={t("changes.removeComment")} onClick={() => setComments(comments.filter((x) => x.id !== cm.id))} className="rounded p-0.5 text-faint hover:text-danger">
                              <X size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {editing === i && (
                      <tr>
                        <td colSpan={4}>
                          <CommentEditor
                            onCancel={() => setEditing(null)}
                            onSave={(text) => {
                              setComments([...comments, { id: crypto.randomUUID(), path: file.path, ...c, text }]);
                              setEditing(null);
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
