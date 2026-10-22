import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { openLink } from "../lib/links";
import { useTranslation } from "react-i18next";
import { Bot, Check, ChevronRight, Copy, FileDiff, FileText, Globe, Image, Info, Layers, Paperclip, PenLine, Plug, Search, X } from "lucide-react";

import { MaterialIcon } from "../lib/fileIcons";

import { ipc, type SessionDetails } from "../lib/ipc";
import { activePane, folderName, useStore } from "../state/store";
import { AgentsTab, Empty } from "./AgentsPanel";
import { ChangesPanel } from "./ChangesPanel";

type InspectorTab = "changes" | "agents" | "details";

// ---------- Details ----------

/** How many rows a long list shows before "Show more". */
const LIST_LIMIT = 8;

function Group({ id, icon, title, count, children }: { id: string; icon: ReactNode; title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  if (count === 0) return null;
  return (
    <section id={`details-${id}`} className="mb-1.5 scroll-mt-2">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-hover">
        <span className="text-faint">{icon}</span>
        <span className="flex-1 text-[12px] font-semibold text-fg">{title}</span>
        <span className="rounded-full bg-hover px-1.5 text-[10.5px] font-medium text-muted tabular-nums">{count}</span>
        <ChevronRight size={12} className={`text-faint transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
      </button>
      {open && <div className="anim-fade pb-1">{children}</div>}
    </section>
  );
}

/** First LIST_LIMIT items, then a "Show N more" button. */
function Capped<T>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, LIST_LIMIT);
  return (
    <>
      {shown.map(render)}
      {items.length > LIST_LIMIT && (
        <button onClick={() => setAll((a) => !a)} className="ml-8 rounded-md px-1.5 py-0.5 text-[11.5px] text-muted hover:bg-hover hover:text-fg">
          {all ? t("common.showLess") : t("common.showMore", { count: items.length - LIST_LIMIT })}
        </button>
      )}
    </>
  );
}

function CopyIcon({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <span
      role="button"
      tabIndex={-1}
      aria-label={label}
      title={copied ? t("common.copied") : label}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={`flex size-6 shrink-0 items-center justify-center rounded-md text-faint hover:bg-raised hover:text-fg ${copied ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
    >
      {copied ? <Check size={12} className="text-done" /> : <Copy size={12} />}
    </span>
  );
}

function FileRow({ path, count, cwd, unit }: { path: string; count?: number; cwd: string; unit?: "edit" | "time" }) {
  const { t } = useTranslation();
  const trimmed = path.replace(/[\\/]+$/, "");
  const root = cwd.replace(/[\\/]+$/, "");
  const inProject = trimmed.toLowerCase().startsWith(root.toLowerCase());
  const short = inProject ? trimmed.slice(root.length).replace(/^[\\/]/, "") : trimmed;
  // The project folder itself.
  const isProject = inProject && short === "";
  const cut = Math.max(short.lastIndexOf("\\"), short.lastIndexOf("/"));
  const name = isProject ? folderName(cwd) : short.slice(cut + 1);
  const folder = isProject ? t("inspector.details.projectFolder") : cut > 0 ? short.slice(0, cut) : "";
  const full = /^([a-z]:[\\/]|[\\/]{2})/i.test(path) ? path : `${root}\\${path}`;
  return (
    <button
      onClick={() => (isProject ? useStore.getState().openWorkspace(cwd) : useStore.getState().openFile(full, cwd))}
      title={`${full}\n${isProject ? t("inspector.details.openProject") : t("inspector.details.openInNewTab")}`}
      className="group flex h-8 w-full items-center gap-2 rounded-md pr-1 pl-2 text-left hover:bg-hover"
    >
      <MaterialIcon name={name} isDir={isProject} size={16} />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="shrink-0 truncate text-[12.5px] text-fg">{name}</span>
        {folder && <span className="min-w-0 truncate text-[11px] text-faint">{folder}</span>}
      </span>
      {count !== undefined && count > 1 && unit && (
        <span className="shrink-0 text-[11px] text-faint tabular-nums group-hover:hidden">
          {unit === "edit" ? t("inspector.details.editCount", { count }) : t("inspector.details.readCount", { count })}
        </span>
      )}
      <span className="hidden group-hover:flex">
        <CopyIcon text={full} label={t("common.copyPath")} />
      </span>
    </button>
  );
}

function WebRow({ entry, cwd }: { entry: string; cwd: string }) {
  const { t } = useTranslation();
  if (entry.startsWith("Search: ")) {
    return (
      <div className="flex h-8 items-center gap-2 rounded-md px-2 text-[12.5px]" title={entry}>
        <Search size={14} className="shrink-0 text-faint" />
        <span className="min-w-0 truncate text-fg">{entry.slice(8)}</span>
        <span className="ml-auto shrink-0 text-[11px] text-faint">{t("inspector.details.search")}</span>
      </div>
    );
  }
  let host = entry;
  let rest = "";
  try {
    const u = new URL(entry);
    host = u.hostname.replace(/^www\./, "");
    rest = `${u.pathname === "/" ? "" : u.pathname}${u.search}`;
  } catch {
    // Not a URL: show as is.
  }
  return (
    <button onClick={() => openLink(entry, { cwd })} title={entry} className="group flex h-8 w-full items-center gap-2 rounded-md pr-1 pl-2 text-left hover:bg-hover">
      <Globe size={14} className="shrink-0 text-faint" />
      <span className="flex min-w-0 flex-1 items-baseline gap-1">
        <span className="shrink-0 text-[12.5px] text-fg">{host}</span>
        <span className="min-w-0 truncate text-[11px] text-faint">{rest}</span>
      </span>
      <span className="hidden group-hover:flex">
        <CopyIcon text={entry} label={t("inspector.details.copyLink")} />
      </span>
    </button>
  );
}

function CountRow({ label, count, mono }: { label: string; count: number; mono?: boolean }) {
  return (
    <div className="flex h-7 items-center gap-2 rounded-md px-2 text-[12.5px]" title={label}>
      <span className={`min-w-0 flex-1 truncate text-fg ${mono ? "font-mono text-[11.5px]" : ""}`}>{label}</span>
      <span className="shrink-0 text-[11px] text-faint tabular-nums">{count}×</span>
    </div>
  );
}

/** One tile in the summary row; jumps to its section. */
function Stat({ id, label, count, scroller }: { id: string; label: string; count: number; scroller: RefObject<HTMLDivElement | null> }) {
  return (
    <button
      disabled={count === 0}
      onClick={() => scroller.current?.querySelector(`#details-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      className="flex min-w-0 flex-col rounded-lg border border-line px-2 py-1.5 text-left enabled:bg-raised enabled:hover:border-faint"
    >
      <span className={`text-[15px] leading-tight font-semibold tabular-nums ${count ? "text-fg" : "text-faint"}`}>{count}</span>
      <span className="truncate text-[10.5px] text-faint">{label}</span>
    </button>
  );
}

function DetailsShimmer() {
  return (
    <div className="flex flex-col gap-3 px-3 pt-1">
      <div className="grid grid-cols-4 gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="shimmer block h-11 rounded-lg" />
        ))}
      </div>
      {[0.7, 0.5, 0.85, 0.4, 0.6].map((w, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="shimmer block size-4 rounded" />
          <span className="shimmer block h-3 rounded" style={{ width: `${w * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

function DetailsTab() {
  const { t } = useTranslation();
  const panes = useStore((s) => s.panes);
  const activeTabId = useStore((s) => s.activeTabId);
  const activity = useStore((s) => s.activity);
  const pane = useMemo(() => activePane(), [activeTabId, panes]);
  const [loaded, setLoaded] = useState<{ key: string; details: SessionDetails } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const key = `${pane?.transcriptPath ?? ""}|${pane?.sessionId ?? ""}`;
  const isClaude = !!pane && (pane.claudeActive || pane.kind === "claude");

  useEffect(() => {
    if (!pane || !isClaude) return;
    let alive = true;
    const timer = setTimeout(() => {
      ipc.sessionDetails(pane.transcriptPath, pane.sessionId).then(
        (d) => alive && (setLoaded({ key, details: d }), setError(null)),
        (e) => alive && setError(String(e)),
      );
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, activity]);

  if (!pane || !isClaude) {
    return <Empty icon={<Info size={20} />} title={t("inspector.details.noClaude.title")} text={t("inspector.details.noClaude.text")} />;
  }
  // Never show another conversation's details while this one loads.
  const details = loaded?.key === key ? loaded.details : null;
  if (error && !details) return <Empty icon={<Info size={20} />} title={t("inspector.details.nothingYet.title")} text={t("inspector.details.nothingYet.text")} />;
  if (!details) return <DetailsShimmer />;
  const total = details.images.length + details.mentioned.length + details.read.length + details.changed.length + details.web.length + details.mcp.length + details.subagents.length;
  if (total === 0) return <Empty icon={<Paperclip size={20} />} title={t("inspector.details.nothingUsed.title")} text={t("inspector.details.nothingUsed.text")} />;

  return (
    <div ref={scroller} className="scroll-thin flex-1 overflow-y-auto px-2 pb-3">
      <div className="grid grid-cols-4 gap-1.5 px-1 pb-2.5">
        <Stat id="changed" label={t("inspector.details.stat.changed")} count={details.changed.length} scroller={scroller} />
        <Stat id="read" label={t("inspector.details.stat.read")} count={details.read.length} scroller={scroller} />
        <Stat id="attached" label={t("inspector.details.stat.attached")} count={details.mentioned.length + details.images.length} scroller={scroller} />
        <Stat id="web" label={t("inspector.details.stat.web")} count={details.web.length} scroller={scroller} />
      </div>
      <Group id="changed" icon={<PenLine size={13} />} title={t("inspector.details.group.changed")} count={details.changed.length}>
        <Capped items={details.changed} render={(f) => <FileRow key={f.path} path={f.path} count={f.count} cwd={pane.cwd} unit="edit" />} />
      </Group>
      <span id="details-attached" className="block scroll-mt-2" />
      <Group id="screenshots" icon={<Image size={13} />} title={t("inspector.details.group.screenshots")} count={details.images.length}>
        <div className="grid grid-cols-3 gap-1.5 px-1.5 pt-0.5 pb-1">
          {details.images.map((src, i) => (
            <button key={i} onClick={() => setPreview(src)} className="aspect-video overflow-hidden rounded-md border border-line bg-bg hover:border-faint">
              <img src={src} alt={t("inspector.details.pastedScreenshot", { n: i + 1 })} className="size-full object-cover" />
            </button>
          ))}
        </div>
      </Group>
      <Group id="mentioned" icon={<Paperclip size={13} />} title={t("inspector.details.group.mentioned")} count={details.mentioned.length}>
        <Capped items={details.mentioned} render={(p) => <FileRow key={p} path={p} cwd={pane.cwd} />} />
      </Group>
      <Group id="read" icon={<FileText size={13} />} title={t("inspector.details.group.read")} count={details.read.length}>
        <Capped items={details.read} render={(f) => <FileRow key={f.path} path={f.path} count={f.count} cwd={pane.cwd} unit="time" />} />
      </Group>
      <Group id="web" icon={<Globe size={13} />} title={t("inspector.details.group.web")} count={details.web.length}>
        <Capped items={details.web} render={(u) => <WebRow key={u} entry={u} cwd={pane.cwd} />} />
      </Group>
      <Group id="subagents" icon={<Layers size={13} />} title={t("inspector.details.group.subagents")} count={details.subagents.length}>
        {details.subagents.map((s) => (
          <CountRow key={s.path} label={s.path} count={s.count} />
        ))}
      </Group>
      <Group id="mcp" icon={<Plug size={13} />} title={t("inspector.details.group.mcp")} count={details.mcp.length}>
        {details.mcp.map((s) => (
          <CountRow key={s.path} label={s.path.replace(/^mcp__/, "").replace(/__/, " · ")} count={s.count} mono />
        ))}
      </Group>
      {preview && (
        <div data-overlay className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-10" onClick={() => setPreview(null)}>
          <img src={preview} alt={t("inspector.details.screenshot")} className="anim-pop max-h-full max-w-full rounded-lg border border-line" />
        </div>
      )}
    </div>
  );
}

// ---------- panel ----------

export function Inspector() {
  const { t } = useTranslation();
  const tab = useStore((s) => s.inspectorTab);
  const running = useStore((s) => Object.values(s.panes).reduce((n, p) => n + (p.bgTasks?.filter((task) => task.status === "running").length ?? 0), 0));
  const { set } = useStore.getState();
  const tabs: { id: InspectorTab; label: string; icon: ReactNode; badge?: number }[] = [
    { id: "changes", label: t("inspector.tabs.changes"), icon: <FileDiff size={13} /> },
    { id: "agents", label: t("inspector.tabs.background"), icon: <Bot size={13} />, badge: running || undefined },
    { id: "details", label: t("inspector.tabs.details"), icon: <Info size={13} /> },
  ];
  return (
    <div className="flex w-full min-w-0 flex-col bg-bg">
      <div className="flex items-center gap-1.5 px-2 pt-1 pb-1.5">
        <div role="tablist" className="flex flex-1 rounded-lg border border-line bg-bg p-0.5">
          {tabs.map((it) => (
            <button
              key={it.id}
              role="tab"
              aria-selected={tab === it.id}
              onClick={() => set({ inspectorTab: it.id })}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-[12px] font-medium ${tab === it.id ? "bg-raised text-fg shadow-sm" : "text-muted hover:text-fg"}`}
            >
              {it.icon}
              {it.label}
              {it.badge !== undefined && <span className="rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold text-accent">{it.badge}</span>}
            </button>
          ))}
        </div>
        <button
          aria-label={t("inspector.closePanel")}
          title={t("inspector.closeShortcut")}
          onClick={() => set({ changesOpen: false })}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-faint hover:bg-hover hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>
      <div key={tab} className="anim-fade flex min-h-0 flex-1 flex-col">
        {tab === "changes" && <ChangesPanel />}
        {tab === "agents" && <AgentsTab />}
        {tab === "details" && <DetailsTab />}
      </div>
    </div>
  );
}

