import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ask } from "@tauri-apps/plugin-dialog";
import { ExternalLink, FileDiff, GitBranch, RefreshCw, Undo2, X } from "lucide-react";
import { type Changes, type ChangedFile, ipc } from "../lib/ipc";
import { parseUnified, type Cell } from "../lib/diff";
import { activePane, folderName, useStore } from "../state/store";

const STATUS: Record<ChangedFile["status"], { label: string; className: string }> = {
  M: { label: "Changed", className: "text-working" },
  A: { label: "Added", className: "text-done" },
  U: { label: "New", className: "text-done" },
  D: { label: "Deleted", className: "text-danger" },
  R: { label: "Renamed", className: "text-attention" },
};

function splitPath(path: string) {
  const i = path.lastIndexOf("/");
  return i < 0 ? { dir: "", name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) };
}

export function ChangesPanel() {
  const activity = useStore((s) => s.activity);
  const activeTabId = useStore((s) => s.activeTabId);
  const panes = useStore((s) => s.panes);
  const cwd = useMemo(() => activePane()?.cwd, [activeTabId, panes]);
  const [changes, setChanges] = useState<Changes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<ChangedFile | null>(null);

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
    const t = setInterval(() => document.hasFocus() && void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  const revert = async (file: ChangedFile) => {
    if (!changes?.root) return;
    const what = file.status === "U" || file.status === "A" ? "delete this new file" : "undo all changes to this file";
    const ok = await ask(`This will ${what}:\n\n${file.path}\n\nThis cannot be undone.`, {
      title: "Undo changes?",
      kind: "warning",
      okLabel: file.status === "U" || file.status === "A" ? "Delete file" : "Undo changes",
      cancelLabel: "Cancel",
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

  const totals = changes?.files.reduce((t, f) => ({ add: t.add + (f.added ?? 0), del: t.del + (f.removed ?? 0) }), { add: 0, del: 0 });

  return (
    <>
      <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-bg">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <FileDiff size={15} className="text-muted" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-fg">Changes</div>
            <div className="flex items-center gap-1 truncate text-[11px] text-faint">
              {cwd && folderName(changes?.root ?? cwd)}
              {changes?.branch && (
                <>
                  <span>·</span>
                  <GitBranch size={10} /> {changes.branch}
                </>
              )}
            </div>
          </div>
          <button aria-label="Refresh" title="Refresh" onClick={() => void load()} className="flex size-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg">
            <RefreshCw size={12} className={loading ? "status-working" : ""} />
          </button>
          <button aria-label="Close" title="Close (Ctrl+Shift+G)" onClick={() => useStore.getState().set({ changesOpen: false })} className="flex size-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg">
            <X size={14} />
          </button>
        </div>

        {changes?.isRepo && changes.files.length > 0 && totals && (
          <div className="flex items-center gap-2 border-y border-line px-3 py-1.5 text-[12px] text-muted">
            <span>{changes.files.length} {changes.files.length === 1 ? "file" : "files"} since last commit</span>
            <span className="ml-auto text-done">+{totals.add}</span>
            <span className="text-danger">−{totals.del}</span>
          </div>
        )}

        <div className="scroll-thin flex-1 overflow-y-auto p-1.5">
          {error && <p className="m-1.5 rounded-md bg-hover p-2.5 text-[12px] text-danger">{error}</p>}
          {!cwd && <p className="p-3 text-[12px] text-faint">Open a tab to see its changes.</p>}
          {changes && !changes.isRepo && (
            <p className="p-3 text-[12px] leading-relaxed text-faint">
              This folder isn't a git repository. Helm uses git to show what changed and to undo changes — run <code className="text-muted">git init</code> here to turn it on.
            </p>
          )}
          {changes?.isRepo && changes.files.length === 0 && (
            <p className="p-3 text-[12px] leading-relaxed text-faint">No changes since the last commit.</p>
          )}
          {changes?.files.map((f) => {
            const { dir, name } = splitPath(f.path);
            const st = STATUS[f.status];
            return (
              <div key={f.path} className={`group flex items-center gap-2 rounded-md px-2 py-1.5 ${open?.path === f.path ? "bg-hover" : "hover:bg-hover"}`}>
                <button onClick={() => setOpen(f)} title={`${st.label}: ${f.path}`} className="flex min-w-0 flex-1 items-center gap-2 text-left">
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
                  aria-label={`Undo changes to ${f.path}`}
                  title="Undo changes to this file"
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
          <DiffView root={changes.root} file={open} onClose={() => setOpen(null)} onRevert={() => void revert(open)} />,
          document.getElementById("main-area")!,
        )}
    </>
  );
}

function DiffCell({ cell }: { cell?: Cell }) {
  const bg = !cell ? "bg-hover/40" : cell.kind === "del" ? "bg-danger/12" : cell.kind === "add" ? "bg-done/12" : "";
  return (
    <>
      <td className={`w-12 border-r border-line px-2 text-right align-top text-faint select-none ${bg}`}>{cell?.no ?? ""}</td>
      <td className={`px-3 align-top whitespace-pre-wrap [overflow-wrap:anywhere] ${bg}`}>
        {cell && cell.kind !== "context" && <span className={`mr-2 select-none ${cell.kind === "del" ? "text-danger" : "text-done"}`}>{cell.kind === "del" ? "−" : "+"}</span>}
        {cell?.text}
      </td>
    </>
  );
}

function DiffView({ root, file, onClose, onRevert }: { root: string; file: ChangedFile; onClose: () => void; onRevert: () => void }) {
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activity = useStore((s) => s.activity);

  useEffect(() => {
    ipc.gitDiff(root, file.path, file.status).then(setDiff, (e) => setError(String(e)));
  }, [root, file.path, file.status, activity]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const parsed = useMemo(() => (diff === null ? null : parseUnified(diff)), [diff]);
  const full = `${root}/${file.path}`;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className={`text-[11px] font-semibold ${STATUS[file.status].className}`}>{STATUS[file.status].label}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{file.path}</span>
        {file.status !== "D" && (
          <button onClick={() => void ipc.openInEditor(full)} className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-muted hover:bg-hover hover:text-fg">
            <ExternalLink size={13} /> Open in VS Code
          </button>
        )}
        <button onClick={onRevert} className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-muted hover:bg-hover hover:text-danger">
          <Undo2 size={13} /> Undo changes
        </button>
        <button aria-label="Close diff" title="Close (Esc)" onClick={onClose} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <X size={15} />
        </button>
      </div>
      <div className="flex border-b border-line text-[11px] font-semibold tracking-wide text-faint uppercase">
        <div className="flex-1 px-4 py-1.5">Before (last commit)</div>
        <div className="flex-1 border-l border-line px-4 py-1.5">Now</div>
      </div>
      <div className="scroll-thin flex-1 overflow-auto font-mono text-[12.5px] leading-[1.55] select-text" style={{ fontFamily: "var(--font-mono, 'Cascadia Mono', Consolas, monospace)" }}>
        {error && <p className="p-4 text-danger">{error}</p>}
        {parsed?.binary && <p className="p-4 text-faint">This is a binary file, so there is no text to compare.</p>}
        {parsed && !parsed.binary && parsed.rows.length === 0 && <p className="p-4 text-faint">No line changes (only file mode or rename).</p>}
        {parsed && !parsed.binary && parsed.rows.length > 0 && (
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col className="w-12" />
              <col />
              <col className="w-12" />
              <col />
            </colgroup>
            <tbody>
              {parsed.rows.map((row, i) =>
                row.type === "hunk" ? (
                  <tr key={i}>
                    <td colSpan={4} className="border-y border-line bg-bg px-4 py-1 text-[11px] text-faint">
                      {row.header || "···"}
                    </td>
                  </tr>
                ) : (
                  <tr key={i}>
                    <DiffCell cell={row.left} />
                    <DiffCell cell={row.right} />
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
