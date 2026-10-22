// Project actions from the sidebar's ⋯ menu that need a dialog: rename, delete, delete old
// chats and usage. Rename and delete check first (Helm tabs using the folder, protected
// folders, permission, in use) and say what's inside before anything changes.

import { type ReactNode, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { AlertTriangle, BarChart3, Clock, Pencil, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { locale, t } from "../i18n";

import { ipc, type ProjectCheck, type SessionInfo, type UsageTotals } from "../lib/ipc";
import { fileSafe } from "../lib/actions";
import { money, tokens } from "../lib/format";
import { folderName, showToast, useStore } from "../state/store";
import { refreshSessions } from "./HistoryList";
import { refreshRecent } from "./Sidebar";
import { ShimmerLines } from "./Shimmer";

export type ProjectDialogKind = "rename" | "delete" | "old-chats" | "usage";

const lower = (p: string) => p.toLowerCase().replace(/[\\/]+$/, "");
/** At or inside the folder. */
const within = (path: string, root: string) => lower(path) === lower(root) || lower(path).startsWith(`${lower(root)}\\`);

/** Helm tabs that have the folder open: terminals, Claude tabs, file tabs and project tabs. */
function helmUse(path: string) {
  const s = useStore.getState();
  const panes = Object.values(s.panes).filter((p) => p.kind !== "browser" && within(p.cwd, path));
  const files = [...s.fileTabs, ...s.workspaces.flatMap((w) => w.files)].filter((f) => within(f.path, path));
  const workspaces = s.workspaces.filter((w) => within(w.root, path));
  const parts = [
    panes.length && t("projectActions.inUse.terminalTabs", { count: panes.length }),
    workspaces.length && t("projectActions.inUse.projectTabs", { count: workspaces.length }),
    files.length && t("projectActions.inUse.fileTabs", { count: files.length }),
  ].filter((p): p is string => !!p);
  // Intl.ListFormat (WebView2 has it; the TS lib here predates it): "a, b, c" in English.
  const List = (Intl as unknown as { ListFormat: new (l: string, o: object) => { format: (p: string[]) => string } }).ListFormat;
  return parts.length ? new List(locale(), { style: "short", type: "unit" }).format(parts) : null;
}

/** Closes the project tabs and file tabs for this folder (never terminals: they may be working). */
function closeViewerTabs(path: string) {
  const s = useStore.getState();
  s.set({
    fileTabs: s.fileTabs.filter((f) => !within(f.path, path)),
    workspaces: s.workspaces.filter((w) => !within(w.root, path)),
  });
}

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** After a rename: move Helm's own references (pins, labels, expanded folders) to the new path. */
function moveHelmState(oldPath: string, newPath: string) {
  const s = useStore.getState();
  const swap = (p: string) => (within(p, oldPath) ? newPath + p.slice(oldPath.replace(/[\\/]+$/, "").length) : p);
  const swapKeys = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).map(([k, v]) => [within(k, oldPath) ? lower(swap(k)) : k, v]));
  s.set({ pinned: s.pinned.map(swap) });
  s.updateSettings({
    projectColors: swapKeys(s.settings.projectColors),
    hiddenProjects: swapKeys(s.settings.hiddenProjects),
    lastFolder: s.settings.lastFolder ? swap(s.settings.lastFolder) : s.settings.lastFolder,
  });
  try {
    const raw = localStorage.getItem("helm-expanded");
    if (raw) localStorage.setItem("helm-expanded", JSON.stringify((JSON.parse(raw) as string[]).map((k) => (within(k, oldPath) ? lower(swap(k)) : k))));
  } catch {
    // A per-viewer convenience: fine to lose.
  }
}

/** Forgets Helm's references to a folder that's gone. */
function dropHelmState(path: string) {
  const s = useStore.getState();
  const keep = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([k]) => !within(k, path)));
  s.set({ pinned: s.pinned.filter((p) => !within(p, path)) });
  s.updateSettings({ projectColors: keep(s.settings.projectColors), hiddenProjects: keep(s.settings.hiddenProjects) });
}

function DialogShell({ icon, title, danger, children, footer, onClose }: { icon: ReactNode; title: string; danger?: boolean; children: ReactNode; footer: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      className="m-auto w-[480px] max-w-[calc(100vw-32px)] rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl shadow-black/30 backdrop:bg-black/40"
    >
      <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${danger ? "bg-danger/12 text-danger" : "bg-accent-soft text-accent"}`}>{icon}</span>
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h2>
        <button aria-label={t("common.close")} onClick={onClose} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <X size={15} />
        </button>
      </div>
      <div className="flex flex-col gap-3 px-5 py-4 text-[13px]">{children}</div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
    </dialog>
  );
}

function Notice({ tone, children }: { tone: "block" | "warn" | "info"; children: ReactNode }) {
  const cls = tone === "block" ? "border-danger/40 bg-danger/8 text-fg" : tone === "warn" ? "border-attention/40 bg-attention/8 text-fg" : "border-line bg-raised text-muted";
  return (
    <div className={`flex gap-2 rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed ${cls}`}>
      {tone !== "info" && <AlertTriangle size={14} className={`mt-0.5 shrink-0 ${tone === "block" ? "text-danger" : "text-attention"}`} />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const cancelBtn = "rounded-md px-3 py-1.5 text-muted hover:bg-hover hover:text-fg";

/** Runs the checks; `null` while they run. */
function useCheck(path: string) {
  const [check, setCheck] = useState<ProjectCheck | null>(null);
  useEffect(() => {
    void ipc.projectCheck(path).then(setCheck, (e) => setCheck({ blocked: String(e), files: 0, bytes: 0, more: false }));
  }, [path]);
  return check;
}

/** Tabs using the folder: terminals must be closed by the user; viewer tabs can be closed here. */
function InUse({ path, onChange }: { path: string; onChange: () => void }) {
  const { t } = useTranslation();
  const use = helmUse(path);
  if (!use) return null;
  const terminals = Object.values(useStore.getState().panes).some((p) => p.kind !== "browser" && within(p.cwd, path));
  return (
    <Notice tone="block">
      {t(terminals ? "projectActions.inUse.terminals" : "projectActions.inUse.viewers", { use })}
      {!terminals && (
        <button
          onClick={() => {
            closeViewerTabs(path);
            onChange();
          }}
          className="ml-1 font-medium text-accent hover:underline"
        >
          {t("projectActions.inUse.closeThem")}
        </button>
      )}
    </Notice>
  );
}

function RenameDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const { t } = useTranslation();
  const check = useCheck(path);
  const [, rerender] = useState(0);
  const [name, setName] = useState(folderName(path));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inUse = helmUse(path);
  const chats = useStore((s) => s.sessions.filter((x) => within(x.cwd, path)).length);
  const can = !!check && !check.blocked && !inUse && !!name.trim() && name.trim() !== folderName(path) && !busy;

  const go = async () => {
    if (!can) return;
    setBusy(true);
    try {
      const r = await ipc.projectRename(path, name.trim());
      moveHelmState(path, r.path);
      await Promise.all([refreshRecent(), refreshSessions()]);
      onClose();
      if (r.warning) showToast(r.warning, "info");
      else showToast(r.chats ? t("projectActions.rename.renamedWithChats", { name: folderName(r.path), count: r.chats }) : t("projectActions.rename.renamed", { name: folderName(r.path) }), "success");
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <DialogShell
      icon={<Pencil size={14} />}
      title={t("projectActions.rename.title", { name: folderName(path) })}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={cancelBtn}>
            {t("common.cancel")}
          </button>
          <button onClick={() => void go()} disabled={!can} className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:opacity-90 disabled:opacity-40">
            {busy ? t("projectActions.rename.renaming") : t("common.rename")}
          </button>
        </>
      }
    >
      <div>
        <label htmlFor="rename-project" className="mb-1.5 block text-[12px] font-medium text-muted">
          {t("projectActions.rename.newName")}
        </label>
        <input
          id="rename-project"
          autoFocus
          value={name}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && void go()}
          className={`w-full rounded-md border bg-bg px-3 py-2 outline-none ${error ? "border-danger" : "border-line focus:border-accent"}`}
        />
        <p className="mt-1.5 truncate text-[12px] text-faint" title={path}>
          {path}
        </p>
      </div>
      <InUse path={path} onChange={() => rerender((n) => n + 1)} />
      {!check && <ShimmerLines lines={2} className="py-1" />}
      {check?.blocked && <Notice tone="block">{t("projectActions.rename.blocked", { reason: check.blocked })}</Notice>}
      {check && !check.blocked && check.busy && <Notice tone="warn">{check.busy}</Notice>}
      {error && <Notice tone="block">{error}</Notice>}
      {check && !check.blocked && (
        <Notice tone="info">{chats > 0 ? t("projectActions.rename.infoWithChats", { count: chats }) : t("projectActions.rename.info")}</Notice>
      )}
    </DialogShell>
  );
}

function DeleteDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const { t } = useTranslation();
  const check = useCheck(path);
  const [, rerender] = useState(0);
  const [withChats, setWithChats] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inUse = helmUse(path);
  const chats = useStore((s) => s.sessions.filter((x) => within(x.cwd, path)));
  const can = !!check && !check.blocked && !inUse && !busy;

  const go = async () => {
    if (!can) return;
    setBusy(true);
    try {
      await ipc.projectTrash(path);
      let failed = 0;
      if (withChats) for (const c of chats) await ipc.sessionTrash(c.id).catch(() => failed++);
      dropHelmState(path);
      await Promise.all([refreshRecent(), refreshSessions()]);
      onClose();
      showToast(`${t("projectActions.delete.done", { name: folderName(path) })}${failed ? ` ${t("projectActions.delete.chatsFailed", { count: failed })}` : ""}`, "success");
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <DialogShell
      danger
      icon={<Trash2 size={14} />}
      title={t("projectActions.delete.title", { name: folderName(path) })}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={cancelBtn}>
            {t("common.cancel")}
          </button>
          <button onClick={() => void go()} disabled={!can} className="rounded-md bg-danger px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-40">
            {busy ? t("projectActions.delete.moving") : t("projectActions.delete.moveToBin")}
          </button>
        </>
      }
    >
      <p className="truncate text-[12px] text-faint" title={path}>
        {path}
      </p>
      <InUse path={path} onChange={() => rerender((n) => n + 1)} />
      {!check && <ShimmerLines lines={2} className="py-1" />}
      {check?.blocked && <Notice tone="block">{t("projectActions.delete.blocked", { reason: check.blocked })}</Notice>}
      {check && !check.blocked && (
        <>
          <div className="rounded-lg border border-line bg-raised px-3 py-2.5">
            <div className="text-[13px] text-fg">
              {t(check.more ? "projectActions.delete.moreFiles" : "projectActions.delete.files", { count: check.files, files: check.files.toLocaleString(locale()), size: size(check.bytes) })}
            </div>
            <div className="mt-0.5 text-[12px] text-faint">{t("projectActions.delete.wholeFolder")}</div>
          </div>
          {!!check.gitChanges && (
            <Notice tone="warn">{t("projectActions.delete.gitChanges", { count: check.gitChanges })}</Notice>
          )}
          {check.busy && <Notice tone="warn">{check.busy}</Notice>}
          {chats.length > 0 && (
            <label className="flex cursor-pointer items-start gap-2 text-[12.5px]">
              <input type="checkbox" checked={withChats} onChange={(e) => setWithChats(e.target.checked)} className="mt-0.5 accent-[var(--danger)]" />
              <span>
                {t("projectActions.delete.alsoChats", { count: chats.length })}
                <span className="block text-[11.5px] text-faint">{t("projectActions.delete.unchecked")}</span>
              </span>
            </label>
          )}
        </>
      )}
      {error && <Notice tone="block">{error}</Notice>}
    </DialogShell>
  );
}

const AGES = [7, 14, 30, 60];

function OldChatsDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const sessions = useStore((s) => s.sessions);
  const metas = useStore((s) => s.settings.sessionMeta);
  const panes = useStore((s) => s.panes);
  const openIds = new Set(Object.values(panes).map((p) => p.sessionId));
  const cutoff = Date.now() - days * 86_400_000;
  // Never open or pinned chats.
  const old = sessions.filter((x) => within(x.cwd, path) && x.lastUsed < cutoff && !openIds.has(x.id) && !metas?.[x.id]?.pinned);

  const go = async () => {
    setBusy(true);
    let failed = 0;
    for (const c of old) await ipc.sessionTrash(c.id).catch(() => failed++);
    await refreshSessions();
    onClose();
    showToast(`${t("projectActions.oldChats.done", { count: old.length - failed })}${failed ? ` ${t("projectActions.oldChats.failed", { count: failed })}` : ""}`, failed ? "info" : "success");
  };

  return (
    <DialogShell
      icon={<Clock size={14} />}
      title={t("projectActions.oldChats.title", { name: folderName(path) })}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={cancelBtn}>
            {t("common.cancel")}
          </button>
          <button onClick={() => void go()} disabled={!old.length || busy} className="rounded-md bg-danger px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-40">
            {busy ? t("projectActions.delete.moving") : old.length ? t("projectActions.oldChats.moveN", { count: old.length }) : t("projectActions.oldChats.nothing")}
          </button>
        </>
      }
    >
      <div>
        <div className="mb-1.5 text-[12px] font-medium text-muted">{t("projectActions.oldChats.notUsedFor")}</div>
        <div className="flex gap-1.5">
          {AGES.map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`rounded-md border px-3 py-1.5 text-[12.5px] ${days === d ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:bg-hover"}`}>
              {t("projectActions.oldChats.days", { count: d })}
            </button>
          ))}
        </div>
      </div>
      <OldList chats={old} />
      <Notice tone="info">{t("projectActions.oldChats.note")}</Notice>
    </DialogShell>
  );
}

function OldList({ chats }: { chats: SessionInfo[] }) {
  const metas = useStore((s) => s.settings.sessionMeta);
  const { t } = useTranslation();
  if (!chats.length) return <p className="text-[12.5px] text-faint">{t("projectActions.oldChats.none")}</p>;
  return (
    <div className="scroll-thin max-h-44 overflow-y-auto rounded-lg border border-line">
      {chats.map((c) => (
        <div key={c.id} className="flex items-center gap-2 border-b border-line px-3 py-1.5 last:border-0">
          <span className="min-w-0 flex-1 truncate text-[12.5px]">{metas?.[c.id]?.title || c.title}</span>
          <span className="shrink-0 text-[11px] text-faint">{new Date(c.lastUsed).toLocaleDateString(locale(), { month: "short", day: "numeric" })}</span>
        </div>
      ))}
    </div>
  );
}

function UsageDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [days, setDays] = useState(7);
  const [loaded, setLoaded] = useState<{ days: number; totals: UsageTotals } | null>(null);
  useEffect(() => {
    let alive = true;
    void ipc.usageTotals(days).then((totals) => alive && setLoaded({ days, totals }), () => {});
    return () => {
      alive = false;
    };
  }, [days]);
  const totals = loaded?.days === days ? loaded.totals : null;
  const rows = totals?.byProject.filter((g) => within(g.key, path)) ?? [];
  const cost = rows.reduce((n, g) => n + g.costUsd, 0);
  const tok = rows.reduce((n, g) => n + g.tokens, 0);
  const share = totals ? cost / Math.max(1e-9, totals.byProject.reduce((n, g) => n + g.costUsd, 0)) : 0;
  const stat = (label: string, value: string | null) => (
    <div className="rounded-lg border border-line bg-raised px-3 py-2">
      <div className="text-[11px] text-faint">{label}</div>
      {value === null ? <span className="shimmer mt-1 block h-5 w-16 rounded" /> : <div className="text-[17px] font-semibold tabular-nums">{value}</div>}
    </div>
  );
  return (
    <DialogShell
      icon={<BarChart3 size={14} />}
      title={t("projectActions.usage.title", { name: folderName(path) })}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={cancelBtn}>
            {t("common.close")}
          </button>
          <button
            onClick={() => {
              onClose();
              useStore.getState().set({ agentsTab: "usage" });
              useStore.getState().openAgents();
            }}
            className="rounded-md border border-line px-3 py-1.5 hover:bg-hover"
          >
            {t("projectActions.usage.showAll")}
          </button>
        </>
      }
    >
      <div className="flex gap-1.5">
        {[7, 14, 30].map((d) => (
          <button key={d} onClick={() => setDays(d)} className={`rounded-md border px-3 py-1 text-[12.5px] ${days === d ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:bg-hover"}`}>
            {t("projectActions.usage.lastDays", { count: d })}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {stat(t("projectActions.usage.cost"), totals ? money(cost) : null)}
        {stat(t("projectActions.usage.tokens"), totals ? tokens(tok) : null)}
        {stat(t("projectActions.usage.share"), totals ? new Intl.NumberFormat(locale(), { style: "percent" }).format(share) : null)}
      </div>
      <p className="text-[12px] text-faint">{t("projectActions.usage.note")}</p>
    </DialogShell>
  );
}

export function ProjectDialog({ kind, path, onClose }: { kind: ProjectDialogKind; path: string; onClose: () => void }) {
  if (kind === "rename") return <RenameDialog path={path} onClose={onClose} />;
  if (kind === "delete") return <DeleteDialog path={path} onClose={onClose} />;
  if (kind === "old-chats") return <OldChatsDialog path={path} onClose={onClose} />;
  return <UsageDialog path={path} onClose={onClose} />;
}

/** Opens one of the project's Claude files in an editor tab, creating it first if needed. */
export async function openClaudeFile(project: string, which: "memory" | "shared" | "local") {
  const dir = which === "memory" ? project : `${project.replace(/[\\/]+$/, "")}\\.claude`;
  const name = which === "memory" ? "CLAUDE.md" : which === "shared" ? "settings.json" : "settings.local.json";
  const full = `${dir}\\${name}`;
  try {
    if (which !== "memory") await ipc.createDir(project, ".claude").catch(() => {});
    await ipc.createFile(dir, name).then(
      () => ipc.saveFile(full, which === "memory" ? `# ${folderName(project)}\n\n` : "{\n}\n", 0, true),
      () => undefined, // already there
    );
    useStore.getState().openFile(full, project, { edit: true });
  } catch (e) {
    showToast(String(e), "error");
  }
}

/** Saves every chat of a project as Markdown files in a folder you pick. */
export async function exportProjectChats(project: string) {
  const s = useStore.getState();
  const chats = s.sessions.filter((x) => within(x.cwd, project));
  if (!chats.length) return showToast(t("projectActions.export.none"), "info");
  const dir = await open({ directory: true, title: t("projectActions.export.dialogTitle", { count: chats.length, name: folderName(project) }) });
  if (typeof dir !== "string") return;
  const used = new Set<string>();
  let failed = 0;
  for (const c of chats) {
    const date = new Date(c.lastUsed).toLocaleDateString("en-CA");
    let base = `${date} ${fileSafe(s.settings.sessionMeta?.[c.id]?.title || c.title || "conversation")}`.slice(0, 120);
    for (let i = 2; used.has(base.toLowerCase()); i++) base = `${base.replace(/ \(\d+\)$/, "")} (${i})`;
    used.add(base.toLowerCase());
    await ipc.exportSession(`${dir}\\${base}.md`, true, c.id).catch(() => failed++);
  }
  showToast(`${t("projectActions.export.exported", { count: chats.length - failed })}${failed ? ` ${t("projectActions.export.failed", { count: failed })}` : ""}`, failed ? "info" : "success", { label: t("projectActions.export.openFolder"), run: () => void openPath(dir) });
}

/** Hides a project from the sidebar until it's used again. */
export function removeFromList(project: string) {
  const s = useStore.getState();
  s.set({ pinned: s.pinned.filter((p) => lower(p) !== lower(project)) });
  s.updateSettings({ hiddenProjects: { ...s.settings.hiddenProjects, [lower(project)]: Date.now() } });
  showToast(t("projectActions.removed", { name: folderName(project) }), "info", {
    label: t("projectActions.undo"),
    run: () => {
      const { [lower(project)]: _, ...rest } = useStore.getState().settings.hiddenProjects;
      useStore.getState().updateSettings({ hiddenProjects: rest });
    },
  });
}
