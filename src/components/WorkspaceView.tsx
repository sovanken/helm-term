import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Trans, useTranslation } from "react-i18next";
import {
  AtSign,
  CaseSensitive,
  ChevronRight,
  ChevronsDownUp,
  Code2,
  Copy,
  FilePlus,
  FileText,
  Files,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { type DirEntry, ipc, type ProjectSearch } from "../lib/ipc";
import { fuzzyScore } from "../lib/fuzzy";
import { folderName, type FileTab, showToast, useStore, type Workspace } from "../state/store";
import { FileBody } from "./FileView";
import { MaterialIcon } from "../lib/fileIcons";
import { Menu, type MenuItem } from "./Menu";
import { locale, t as tr } from "../i18n";
import { ShimmerRows } from "./Shimmer";

const lower = (p: string) => p.toLowerCase();
const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
const parentOf = (p: string) => p.replace(/[\\/][^\\/]+$/, "");
const rel = (root: string, p: string) => (lower(p).startsWith(lower(root)) ? p.slice(root.length).replace(/^[\\/]/, "") : p);
const isInside = (p: string, dir: string) => lower(p) === lower(dir) || lower(p).startsWith(`${lower(dir)}\\`);

function FileIcon({ name, size = 16 }: { name: string; size?: number }) {
  return <MaterialIcon name={name} size={size} />;
}

/** Git status colours, like VS Code's: modified amber, new green, renamed blue. */
const GIT_TONE: Record<string, string> = { M: "text-attention", A: "text-done", U: "text-done", R: "text-working", D: "text-danger" };
/** Keys under workspace.git, translated when shown. */
const GIT_LABEL: Record<string, string> = { M: "changed", A: "added", U: "new", R: "renamed", D: "deleted" };

type Editing = { kind: "new-file" | "new-folder"; dir: string } | { kind: "rename"; path: string; isDir: boolean };

/** Asks before closing a workspace file with unsaved edits. */
async function closeWsFile(ws: Workspace, file: FileTab) {
  if (file.draft !== undefined) {
    const yes = await ask(tr("actions.unsaved.close", { count: 1, names: nameOf(file.path) }), {
      title: tr("actions.unsaved.closeTitle"),
      kind: "warning",
      okLabel: tr("actions.unsaved.closeOk"),
      cancelLabel: tr("actions.keepOpen"),
    });
    if (!yes) return;
  }
  useStore.getState().closeWorkspaceFile(ws.id, file.id);
}

function NameInput({ initial, depth, isDir, onDone }: { initial: string; depth: number; isDir: boolean; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Select the name without its extension, like VS Code.
    const dot = isDir ? -1 : initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial, isDir]);
  return (
    <div className="flex items-center gap-1.5 py-0.5 pr-2" style={{ paddingLeft: 8 + depth * 12 + 14 }}>
      {isDir ? <MaterialIcon name={initial || "folder"} isDir /> : <FileIcon name={initial || "file"} />}
      <input
        ref={ref}
        defaultValue={initial}
        spellCheck={false}
        aria-label={isDir ? t("workspace.folderName") : t("workspace.fileName")}
        onKeyDown={(e) => {
          if (e.key === "Enter") onDone(e.currentTarget.value.trim() || null);
          if (e.key === "Escape") onDone(null);
        }}
        onBlur={(e) => onDone(e.currentTarget.value.trim() || null)}
        className="min-w-0 flex-1 rounded border border-accent bg-bg px-1.5 py-0.5 text-[12.5px] text-fg outline-none"
      />
    </div>
  );
}

function QuickOpen({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const { t } = useTranslation();
  useEffect(() => {
    ipc.listProjectFiles(ws.root).then(setFiles, () => setFiles([]));
  }, [ws.root]);
  const results = useMemo(() => {
    const list = files ?? [];
    const q = query.trim();
    if (!q) {
      // Recently opened in this workspace first.
      const open = ws.files.map((f) => rel(ws.root, f.path));
      return [...open, ...list.filter((f) => !open.includes(f))].slice(0, 50);
    }
    return list
      .map((f) => ({ f, score: Math.max(fuzzyScore(q, nameOf(f)) + 100, fuzzyScore(q, f.replace(/\\/g, "/"))) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((r) => r.f);
  }, [files, query, ws]);
  const open = (f: string) => {
    useStore.getState().openWorkspaceFile(ws.id, `${ws.root}\\${f}`);
    onClose();
  };
  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-black/30 pt-[12vh]" data-overlay role="dialog" aria-label={t("workspace.goToFile")} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="anim-pop flex h-fit max-h-[60vh] w-[560px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-2xl shadow-black/30">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={14} className="text-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => (setQuery(e.target.value), setIndex(0))}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") (e.preventDefault(), setIndex((i) => Math.min(results.length - 1, i + 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setIndex((i) => Math.max(0, i - 1)));
              if (e.key === "Enter" && results[index]) open(results[index]);
            }}
            placeholder={t("workspace.quickOpen.placeholder", { name: folderName(ws.root) })}
            className="h-11 min-w-0 flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-faint"
          />
        </div>
        <div className="scroll-thin overflow-y-auto p-1">
          {!files && <ShimmerRows rows={5} className="px-3 py-2" />}
          {files && results.length === 0 && <p className="px-3 py-2 text-[12px] text-faint">{t("workspace.quickOpen.none")}</p>}
          {results.map((f, i) => (
            <button
              key={f}
              onClick={() => open(f)}
              onPointerMove={() => setIndex(i)}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left ${i === index ? "bg-hover" : ""}`}
            >
              <FileIcon name={f} />
              <span className="truncate text-[13px] text-fg">{nameOf(f)}</span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">{parentOf(f) === f ? "" : parentOf(f)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SearchPanel({ ws }: { ws: Workspace }) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState<ProjectSearch | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();
  useEffect(() => {
    setResult(null);
    if (query.trim().length < 2) return;
    setBusy(true);
    let alive = true;
    const t = setTimeout(() => {
      ipc
        .searchProject(ws.root, query, caseSensitive)
        .then((r) => alive && setResult(r))
        .catch(() => {})
        .finally(() => alive && setBusy(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, caseSensitive, ws.root]);

  const groups = useMemo(() => {
    const map = new Map<string, ProjectSearch["matches"]>();
    for (const m of result?.matches ?? []) map.set(m.path, [...(map.get(m.path) ?? []), m]);
    return [...map.entries()];
  }, [result]);

  const mark = (text: string) => {
    const at = caseSensitive ? text.indexOf(query) : text.toLowerCase().indexOf(query.toLowerCase());
    if (at < 0) return text;
    const start = Math.max(0, at - 30);
    return (
      <>
        {start > 0 && "…"}
        {text.slice(start, at)}
        <mark className="rounded-sm bg-accent/30 text-fg">{text.slice(at, at + query.length)}</mark>
        {text.slice(at + query.length)}
      </>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-2 mb-2 flex items-center gap-1 rounded-lg border border-line bg-surface px-2 focus-within:border-accent">
        <Search size={13} className="shrink-0 text-faint" />
        <input
          id="workspace-search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("workspace.search.placeholder")}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[12.5px] text-fg outline-none placeholder:text-faint"
        />
        {busy && <span className="status-working size-3 shrink-0 rounded-full border border-faint border-t-transparent" />}
        <button
          aria-label={t("workspace.search.matchCase")}
          title={t("workspace.search.matchCase")}
          aria-pressed={caseSensitive}
          onClick={() => setCaseSensitive(!caseSensitive)}
          className={`flex size-6 items-center justify-center rounded ${caseSensitive ? "bg-accent-soft text-accent" : "text-faint hover:text-fg"}`}
        >
          <CaseSensitive size={15} />
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1 pb-3">
        {result && (
          <p className="px-2 pb-1 text-[11.5px] text-faint">
            {result.matches.length === 0
              ? t("workspace.search.noMatches")
              : t("workspace.search.summary", {
                  matches: t("workspace.search.matches", { count: result.matches.length, n: `${result.matches.length.toLocaleString(locale())}${result.truncated ? "+" : ""}` }),
                  files: t("workspace.search.files", { count: groups.length }),
                })}
          </p>
        )}
        {groups.map(([path, list]) => (
          <div key={path} className="mb-1">
            <div className="flex items-center gap-1.5 px-2 py-1" title={path}>
              <FileIcon name={path} size={13} />
              <span className="truncate text-[12.5px] font-medium text-fg">{nameOf(path)}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{parentOf(path) === path ? "" : parentOf(path)}</span>
              <span className="rounded-full bg-hover px-1.5 text-[10.5px] text-muted">{list.length}</span>
            </div>
            {list.slice(0, 50).map((m) => (
              <button
                key={`${m.line}:${m.column}`}
                onClick={() => useStore.getState().openWorkspaceFile(ws.id, `${ws.root}\\${path}`, { line: m.line })}
                className="flex w-full items-baseline gap-2 rounded-md py-0.5 pr-2 pl-6 text-left hover:bg-hover"
              >
                <span className="w-7 shrink-0 text-right font-mono text-[10.5px] text-faint">{m.line}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">{mark(m.text)}</span>
              </button>
            ))}
          </div>
        ))}
        {!result && query.trim().length < 2 && (
          <p className="px-3 text-[12px] leading-relaxed text-faint">{t("workspace.search.hint")}</p>
        )}
      </div>
    </div>
  );
}

function WorkspaceBody({ ws }: { ws: Workspace }) {
  const activity = useStore((s) => s.activity);
  const { updateWorkspace, openWorkspaceFile, openTab } = useStore.getState();
  const { t } = useTranslation();
  const [dirs, setDirs] = useState<Map<string, DirEntry[]>>(new Map());
  const [git, setGit] = useState<Map<string, string>>(new Map());
  const [mode, setMode] = useState<"files" | "search">("files");
  const [quick, setQuick] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const expanded = useMemo(() => new Set(ws.expanded), [ws.expanded]);
  const active = ws.files.find((f) => f.id === ws.activeFileId) ?? null;

  const load = useCallback(async (dir: string) => {
    try {
      const list = await ipc.listDir(dir);
      setDirs((m) => new Map(m).set(lower(dir), list));
    } catch {
      setDirs((m) => {
        const next = new Map(m);
        next.delete(lower(dir));
        return next;
      });
    }
  }, []);

  // Reload the open folders and git colours: on open, when Claude does something, every few
  // seconds while showing, and when the window comes back into focus.
  const refresh = useCallback(() => {
    void load(ws.root);
    for (const d of ws.expanded) void load(d);
    ipc.gitChanges(ws.root).then(
      (c) => {
        const map = new Map<string, string>();
        if (c.isRepo && c.root) {
          const base = c.root.replace(/\//g, "\\");
          for (const f of c.files) map.set(lower(`${base}\\${f.path.replace(/\//g, "\\")}`), f.status);
        }
        setGit(map);
      },
      () => setGit(new Map()),
    );
  }, [load, ws.root, ws.expanded]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh, activity]);

  // Ctrl+P: go to file. Ctrl+Shift+F: search in files.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        setQuick(true);
      }
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === "KeyF") {
        e.preventDefault();
        e.stopPropagation();
        setMode("search");
        requestAnimationFrame(() => document.getElementById("workspace-search")?.focus());
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // A search result jumps to its line once; forget the line afterwards so switching back doesn't jump again.
  useEffect(() => {
    if (!active?.line) return;
    const t = setTimeout(() => useStore.getState().updateFile(active.id, { line: undefined }), 1500);
    return () => clearTimeout(t);
  }, [active?.id, active?.line]);

  // Folders with changes inside get a dot.
  const changedDirs = useMemo(() => {
    const set = new Set<string>();
    for (const p of git.keys()) for (let d = parentOf(p); d.length > ws.root.length; d = parentOf(d)) set.add(d);
    return set;
  }, [git, ws.root]);

  const toggle = (dir: string) => {
    const key = lower(dir);
    if (expanded.has(key)) updateWorkspace(ws.id, { expanded: ws.expanded.filter((d) => d !== key) });
    else {
      updateWorkspace(ws.id, { expanded: [...ws.expanded, key] });
      void load(dir);
    }
  };

  const expand = (dir: string) => {
    if (lower(dir) === lower(ws.root) || expanded.has(lower(dir))) return;
    updateWorkspace(ws.id, { expanded: [...ws.expanded, lower(dir)] });
    void load(dir);
  };

  const finishEdit = async (value: string | null) => {
    const e = editing;
    setEditing(null);
    if (!e || !value) return;
    try {
      if (e.kind === "new-file") {
        const path = await ipc.createFile(e.dir, value);
        void load(e.dir);
        openWorkspaceFile(ws.id, path, { edit: true });
      } else if (e.kind === "new-folder") {
        await ipc.createDir(e.dir, value);
        void load(e.dir);
      } else if (e.kind === "rename" && value !== nameOf(e.path)) {
        const from = e.path;
        const to = await ipc.renamePath(from, value);
        void load(parentOf(from));
        // Keep open files pointing at their new place.
        updateWorkspace(ws.id, {
          files: useStore.getState().workspaces.find((w) => w.id === ws.id)!.files.map((f) => (isInside(f.path, from) ? { ...f, path: to + f.path.slice(from.length) } : f)),
        });
      }
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const remove = async (path: string, isDir: boolean) => {
    const open = ws.files.filter((f) => isInside(f.path, path));
    const unsaved = open.some((f) => f.draft !== undefined);
    const yes = await ask(
      `${t(isDir ? "workspace.remove.folder" : "workspace.remove.file", { name: nameOf(path) })}${unsaved ? ` ${t("workspace.remove.unsavedLost")}` : ""}`,
      { title: t(isDir ? "workspace.remove.titleFolder" : "workspace.remove.titleFile"), kind: "warning", okLabel: t("projectActions.delete.moveToBin"), cancelLabel: t("common.cancel") },
    );
    if (!yes) return;
    try {
      await ipc.trashPath(path);
      for (const f of open) useStore.getState().closeWorkspaceFile(ws.id, f.id);
      void load(parentOf(path));
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const contextItems = (path: string, isDir: boolean): MenuItem[] => {
    const dir = isDir ? path : parentOf(path);
    const r = rel(ws.root, path);
    return [
      ...(isDir
        ? [
            { label: t("workspace.menu.newFile"), icon: <FilePlus size={14} />, onSelect: () => (expand(path), setEditing({ kind: "new-file", dir: path })) },
            { label: t("workspace.menu.newFolder"), icon: <FolderPlus size={14} />, onSelect: () => (expand(path), setEditing({ kind: "new-folder", dir: path })) },
          ]
        : [{ label: t("common.open"), icon: <FileText size={14} />, onSelect: () => openWorkspaceFile(ws.id, path) }]),
      ...(lower(path) !== lower(ws.root)
        ? [
            { label: t("workspace.menu.rename"), icon: <Pencil size={14} />, onSelect: () => setEditing({ kind: "rename", path, isDir }), separatorBefore: true },
            { label: t("common.delete"), icon: <Trash2 size={14} />, danger: true, onSelect: () => void remove(path, isDir) },
          ]
        : []),
      { label: t("common.copyPath"), icon: <Copy size={14} />, separatorBefore: true, onSelect: () => void navigator.clipboard.writeText(path) },
      ...(r !== path ? [{ label: t("common.copyRelativePath"), icon: <Copy size={14} />, onSelect: () => void navigator.clipboard.writeText(r) }] : []),
      { label: t("files.copyAtPath"), icon: <AtSign size={14} />, onSelect: () => void navigator.clipboard.writeText(`@${r.replace(/\\/g, "/")}`) },
      { label: t("common.showInExplorer"), icon: <FolderSearch size={14} />, separatorBefore: true, onSelect: () => void revealItemInDir(path) },
      { label: t("common.openInEditor"), icon: <Code2 size={14} />, onSelect: () => void ipc.openInEditor(path) },
      { label: t("sidebar.newTerminalTabHere"), icon: <SquareTerminal size={14} />, onSelect: () => openTab(dir, "shell") },
      { label: t("sidebar.newClaudeTabHere"), icon: <Sparkles size={14} />, onSelect: () => openTab(dir, "claude") },
    ];
  };

  const openMenu = (e: React.MouseEvent, path: string, isDir: boolean) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items: contextItems(path, isDir) });
  };

  const renderDir = (dir: string, depth: number): ReactNode => {
    const list = dirs.get(lower(dir));
    const creating = editing && editing.kind !== "rename" && lower(editing.dir) === lower(dir) ? editing : null;
    return (
      <>
        {creating && <NameInput initial={creating.kind === "new-file" ? "" : ""} depth={depth} isDir={creating.kind === "new-folder"} onDone={(v) => void finishEdit(v)} />}
        {!list && <ShimmerRows rows={3} indent={8 + depth * 12 + 14} className="pr-3" />}
        {list?.length === 0 && !creating && <p className="py-0.5 text-[11.5px] text-faint italic" style={{ paddingLeft: 8 + depth * 12 + 14 }}>{t("workspace.emptyFolder")}</p>}
        {list?.map((e) => {
          const key = lower(e.path);
          if (editing?.kind === "rename" && lower(editing.path) === key)
            return <NameInput key={e.path} initial={e.name} depth={depth} isDir={e.isDir} onDone={(v) => void finishEdit(v)} />;
          const status = git.get(key);
          const dirChanged = e.isDir && changedDirs.has(key);
          const open = e.isDir && expanded.has(key);
          const current = !e.isDir && active && lower(active.path) === key;
          return (
            <div key={e.path}>
              <button
                onClick={() => (e.isDir ? toggle(e.path) : openWorkspaceFile(ws.id, e.path))}
                onContextMenu={(ev) => openMenu(ev, e.path, e.isDir)}
                title={status ? `${e.path}\n${t(`workspace.git.${GIT_LABEL[status]}`)}` : e.path}
                className={`flex w-full items-center gap-1.5 py-[3px] pr-2 text-left hover:bg-hover ${current ? "bg-hover" : ""}`}
                style={{ paddingLeft: 8 + depth * 12 }}
              >
                {e.isDir ? (
                  <>
                    <ChevronRight size={12} className={`shrink-0 text-faint transition-transform duration-100 ${open ? "rotate-90" : ""}`} />
                    <MaterialIcon name={e.name} isDir open={open} />
                  </>
                ) : (
                  <>
                    <span className="w-3 shrink-0" />
                    <FileIcon name={e.name} />
                  </>
                )}
                <span className={`min-w-0 flex-1 truncate text-[12.5px] ${status ? GIT_TONE[status] : current ? "text-fg" : "text-fg/85"}`}>{e.name}</span>
                {status && <span className={`shrink-0 font-mono text-[10.5px] ${GIT_TONE[status]}`}>{status === "U" ? "U" : status}</span>}
                {dirChanged && !open && <span className="size-1.5 shrink-0 rounded-full bg-attention/80" />}
              </button>
              {open && renderDir(e.path, depth + 1)}
            </div>
          );
        })}
      </>
    );
  };

  const treeButton = (label: string, icon: ReactNode, onClick: () => void) => (
    <button aria-label={label} title={label} onClick={onClick} className="flex size-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg">
      {icon}
    </button>
  );

  return (
    <div className="flex h-full">
      <aside className="flex w-[264px] shrink-0 flex-col border-r border-line">
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line pr-2 pl-3">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg" title={ws.root}>
            {folderName(ws.root)}
          </span>
          <div className="flex rounded-md border border-line p-0.5">
            <button aria-label={t("workspace.files")} title={t("workspace.files")} onClick={() => setMode("files")} className={`flex size-6 items-center justify-center rounded ${mode === "files" ? "bg-hover text-fg" : "text-faint hover:text-fg"}`}>
              <Files size={14} />
            </button>
            <button aria-label={t("workspace.searchInFilesShortcut")} title={t("workspace.searchInFilesShortcut")} onClick={() => setMode("search")} className={`flex size-6 items-center justify-center rounded ${mode === "search" ? "bg-hover text-fg" : "text-faint hover:text-fg"}`}>
              <Search size={14} />
            </button>
          </div>
        </div>
        {mode === "files" ? (
          <>
            <div className="flex items-center gap-0.5 px-2 py-1">
              <button onClick={() => setQuick(true)} className="mr-auto flex h-6 items-center gap-1.5 rounded px-1.5 text-[11.5px] text-faint hover:bg-hover hover:text-fg" title={t("workspace.goToFileShortcut")}>
                <Search size={12} /> {t("workspace.goToFile")} <kbd className="font-sans text-[10.5px] opacity-70">Ctrl+P</kbd>
              </button>
              {treeButton(t("workspace.newFile"), <FilePlus size={14} />, () => setEditing({ kind: "new-file", dir: ws.root }))}
              {treeButton(t("workspace.newFolder"), <FolderPlus size={14} />, () => setEditing({ kind: "new-folder", dir: ws.root }))}
              {treeButton(t("common.refresh"), <RefreshCw size={13} />, refresh)}
              {treeButton(t("sidebar.collapseAll"), <ChevronsDownUp size={14} />, () => updateWorkspace(ws.id, { expanded: [] }))}
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-auto pb-4" onContextMenu={(e) => e.target === e.currentTarget && openMenu(e, ws.root, true)}>
              {renderDir(ws.root, 0)}
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col pt-2">
            <SearchPanel ws={ws} />
          </div>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {ws.files.length > 0 && (
          <div className="scroll-thin flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-line px-1.5">
            {ws.files.map((f) => {
              const isActive = f.id === ws.activeFileId;
              const dirty = f.draft !== undefined;
              return (
                <div
                  key={f.id}
                  role="tab"
                  aria-selected={isActive}
                  title={f.path}
                  onPointerDown={(e) => e.button === 0 && updateWorkspace(ws.id, { activeFileId: f.id })}
                  onAuxClick={(e) => e.button === 1 && void closeWsFile(ws, f)}
                  className={`group/ft flex h-8 max-w-52 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 ${isActive ? "border-line bg-surface text-fg" : "border-transparent text-muted hover:text-fg"}`}
                >
                  <FileIcon name={f.path} size={13} />
                  <span className={`truncate text-[12.5px] ${git.get(lower(f.path)) ? GIT_TONE[git.get(lower(f.path))!] : ""}`}>{nameOf(f.path)}</span>
                  <button
                    aria-label={t("workspace.closeFile", { name: nameOf(f.path) })}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => void closeWsFile(ws, f)}
                    className={`flex size-4 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg ${isActive || dirty ? "" : "opacity-0 group-hover/ft:opacity-100"}`}
                  >
                    {dirty ? <span className="size-1.5 rounded-full bg-fg/70 group-hover/ft:hidden" /> : null}
                    <X size={11} className={dirty ? "hidden group-hover/ft:block" : ""} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="min-h-0 flex-1">
          {active ? (
            <FileBody key={active.id} file={active} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <FolderOpen size={30} className="text-faint" />
              <div>
                <p className="text-[15px] font-semibold text-fg">{folderName(ws.root)}</p>
                <p className="mt-0.5 text-[12px] text-faint">{ws.root}</p>
              </div>
              <p className="text-[12.5px] text-muted">
                <Trans
                  i18nKey="workspace.emptyState"
                  components={[<kbd key="0" className="rounded border border-line px-1 text-[11px]" />, <kbd key="1" className="rounded border border-line px-1 text-[11px]" />]}
                />
              </p>
              <div className="mt-1 flex gap-2">
                <button onClick={() => openTab(ws.root, "claude")} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-on-accent hover:opacity-90">
                  <Sparkles size={13} /> {t("sidebar.newClaudeTabHere")}
                </button>
                <button onClick={() => openTab(ws.root, "shell")} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-fg hover:bg-hover">
                  <SquareTerminal size={13} /> {t("sidebar.newTerminalTabHere")}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {quick && <QuickOpen ws={ws} onClose={() => setQuick(false)} />}
      {menu && (
        <div className="fixed z-50" style={{ left: menu.x, top: menu.y, width: 1, height: 1 }}>
          <Menu items={menu.items} onClose={() => setMenu(null)} />
        </div>
      )}
    </div>
  );
}

export function WorkspaceView() {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId));
  if (!ws) return null;
  return <WorkspaceBody key={ws.id} ws={ws} />;
}
