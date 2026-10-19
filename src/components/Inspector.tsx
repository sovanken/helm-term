import { type ReactNode, useEffect, useMemo, useState } from "react";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { Bot, ChevronDown, ChevronRight, FileDiff, FileText, Globe, Image, Info, Layers, Paperclip, PenLine, Plug, SquareTerminal, X } from "lucide-react";

import { ipc, type SessionDetails } from "../lib/ipc";
import { paneIds } from "../lib/layout";
import { activePane, type BgTask, cleanTitle, folderName, type Pane, useStore } from "../state/store";
import { ChangesPanel } from "./ChangesPanel";

type InspectorTab = "changes" | "agents" | "details";

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function elapsed(task: BgTask) {
  const secs = Math.max(0, Math.round(((task.endedAt ?? Date.now()) - task.startedAt) / 1000));
  return secs < 60 ? `${secs}s` : secs < 3600 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="mx-3 mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-4 py-8 text-center">
      <span className="text-faint">{icon}</span>
      <div className="text-[13px] font-medium text-fg">{title}</div>
      <p className="text-[12px] leading-relaxed text-faint">{text}</p>
    </div>
  );
}

// ---------- Agents ----------

function TaskCard({ task }: { task: BgTask }) {
  const [open, setOpen] = useState(false);
  const running = task.status === "running";
  return (
    <div className="rounded-lg border border-line bg-raised">
      <button onClick={() => task.summary && setOpen((o) => !o)} className="flex w-full items-start gap-2.5 p-2.5 text-left">
        <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md ${running ? "bg-accent-soft text-accent" : "bg-hover text-muted"}`}>
          {task.kind === "agent" ? <Bot size={13} /> : <SquareTerminal size={13} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] leading-snug text-fg">{task.label}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-faint">
            {running ? <span className="status-working size-2.5 rounded-full border-[1.5px] border-working border-t-transparent" /> : <span className="size-1.5 rounded-full bg-done" />}
            {task.kind === "agent" ? task.type ?? "Subagent" : "Background command"}
            {task.background && <span className="rounded bg-hover px-1 text-[10px]">background</span>}
            <span>· {running ? `running ${elapsed(task)}` : `took ${elapsed(task)}`}</span>
            {!!task.steps && <span>· {task.steps} {task.steps === 1 ? "step" : "steps"}</span>}
          </span>
          {running && task.doing && <span className="mt-1 block truncate font-mono text-[11px] text-muted">{task.doing}</span>}
        </span>
        {task.summary && <span className="mt-1 text-faint">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>}
      </button>
      {open && task.summary && (
        <div className="scroll-thin max-h-64 overflow-y-auto border-t border-line px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-muted select-text">{task.summary}</div>
      )}
    </div>
  );
}

function AgentsTab() {
  useTick(1000);
  const panes = useStore((s) => s.panes);
  const activeTabId = useStore((s) => s.activeTabId);
  const current = useMemo(() => activePane(), [activeTabId, panes]);
  const withTasks = Object.values(panes).filter((p) => p.bgTasks?.length);
  if (withTasks.length === 0) {
    return (
      <Empty
        icon={<Bot size={20} />}
        title="No background agents yet"
        text="When Claude starts a subagent or a background command, it shows up here with what it's doing, how long it has run, and its result."
      />
    );
  }
  const ordered = [...withTasks].sort((a, b) => (a.id === current?.id ? -1 : b.id === current?.id ? 1 : 0));
  return (
    <div className="scroll-thin flex-1 overflow-y-auto px-2.5 pb-3">
      {ordered.map((p: Pane) => {
        const tasks = [...(p.bgTasks ?? [])].reverse();
        const running = tasks.filter((t) => t.status === "running").length;
        return (
          <section key={p.id} className="mt-2">
            <button
              onClick={() => {
                const s = useStore.getState();
                const tab = s.tabs.find((t) => paneIds(t.root).includes(p.id));
                if (tab) s.setActiveTab(tab.id);
              }}
              className="mb-1.5 flex w-full items-center gap-1.5 px-1 text-left text-[11px] font-semibold tracking-wide text-faint uppercase hover:text-muted"
              title="Show this tab"
            >
              <span className="truncate">{folderName(p.cwd)}{cleanTitle(p.title) ? ` · ${cleanTitle(p.title)}` : ""}</span>
              {running > 0 && <span className="shrink-0 rounded-full bg-accent-soft px-1.5 font-semibold normal-case text-accent">{running} running</span>}
            </button>
            <div className="space-y-1.5">
              {tasks.map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---------- Details ----------

function Group({ icon, title, count, children }: { icon: ReactNode; title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  if (count === 0) return null;
  return (
    <section className="mb-2">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 px-1 py-1 text-left text-[11px] font-semibold tracking-wide text-faint uppercase hover:text-muted">
        <ChevronRight size={12} className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
        <span className="text-muted">{icon}</span>
        {title} <span className="font-normal normal-case">{count}</span>
      </button>
      {open && <div className="anim-fade">{children}</div>}
    </section>
  );
}

function FileRow({ path, count, cwd }: { path: string; count?: number; cwd: string }) {
  const short = path.toLowerCase().startsWith(cwd.toLowerCase()) ? path.slice(cwd.length).replace(/^[\\/]/, "") : path;
  return (
    <button
      onClick={() => void ipc.openInEditor(path).then((ok) => !ok && void openPath(path))}
      title={`${path}\nClick to open`}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] hover:bg-hover"
    >
      <span className="min-w-0 flex-1 truncate font-mono text-fg">{short}</span>
      {count !== undefined && count > 1 && <span className="shrink-0 text-[11px] text-faint">×{count}</span>}
    </button>
  );
}

function DetailsTab() {
  const panes = useStore((s) => s.panes);
  const activeTabId = useStore((s) => s.activeTabId);
  const activity = useStore((s) => s.activity);
  const pane = useMemo(() => activePane(), [activeTabId, panes]);
  const [details, setDetails] = useState<SessionDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const key = `${pane?.transcriptPath ?? ""}|${pane?.sessionId ?? ""}`;

  useEffect(() => {
    if (!pane || !(pane.claudeActive || pane.kind === "claude")) return setDetails(null);
    let alive = true;
    const t = setTimeout(() => {
      ipc.sessionDetails(pane.transcriptPath, pane.sessionId).then(
        (d) => alive && (setDetails(d), setError(null)),
        (e) => alive && setError(String(e)),
      );
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [key, activity]);

  if (!pane || !(pane.claudeActive || pane.kind === "claude")) {
    return <Empty icon={<Info size={20} />} title="No Claude conversation here" text="Open a Claude tab to see the screenshots and files you attached, and the files Claude read, changed and looked up." />;
  }
  if (error) return <Empty icon={<Info size={20} />} title="Nothing yet" text="Details appear after the first message in this conversation." />;
  if (!details) return <p className="p-4 text-[12px] text-faint">Loading…</p>;
  const total = details.images.length + details.mentioned.length + details.read.length + details.changed.length + details.web.length + details.mcp.length + details.subagents.length;
  if (total === 0) return <Empty icon={<Paperclip size={20} />} title="Nothing attached or used yet" text="Pasted screenshots, @-mentioned files and everything Claude reads or changes in this conversation will be listed here." />;

  return (
    <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-3">
      <Group icon={<Image size={12} />} title="Screenshots you pasted" count={details.images.length}>
        <div className="grid grid-cols-3 gap-1.5 px-1 pb-1">
          {details.images.map((src, i) => (
            <button key={i} onClick={() => setPreview(src)} className="aspect-video overflow-hidden rounded-md border border-line bg-bg hover:border-accent">
              <img src={src} alt={`Pasted screenshot ${i + 1}`} className="size-full object-cover" />
            </button>
          ))}
        </div>
      </Group>
      <Group icon={<Paperclip size={12} />} title="Files you attached" count={details.mentioned.length}>
        {details.mentioned.map((p) => (
          <FileRow key={p} path={p} cwd={pane.cwd} />
        ))}
      </Group>
      <Group icon={<PenLine size={12} />} title="Files Claude changed" count={details.changed.length}>
        {details.changed.map((f) => (
          <FileRow key={f.path} path={f.path} count={f.count} cwd={pane.cwd} />
        ))}
      </Group>
      <Group icon={<FileText size={12} />} title="Files Claude read" count={details.read.length}>
        {details.read.map((f) => (
          <FileRow key={f.path} path={f.path} count={f.count} cwd={pane.cwd} />
        ))}
      </Group>
      <Group icon={<Globe size={12} />} title="Web" count={details.web.length}>
        {details.web.map((u) => (
          <button
            key={u}
            onClick={() => !u.startsWith("Search: ") && void openUrl(u)}
            className="flex w-full items-center rounded-md px-2 py-1 text-left text-[12px] hover:bg-hover"
            title={u}
          >
            <span className="truncate text-fg">{u}</span>
          </button>
        ))}
      </Group>
      <Group icon={<Layers size={12} />} title="Subagents used" count={details.subagents.length}>
        {details.subagents.map((s) => (
          <div key={s.path} className="flex items-center justify-between px-2 py-1 text-[12px]">
            <span className="text-fg">{s.path}</span>
            <span className="text-faint">×{s.count}</span>
          </div>
        ))}
      </Group>
      <Group icon={<Plug size={12} />} title="MCP tools used" count={details.mcp.length}>
        {details.mcp.map((s) => (
          <div key={s.path} className="flex items-center justify-between gap-2 px-2 py-1 text-[12px]">
            <span className="truncate font-mono text-fg">{s.path.replace(/^mcp__/, "").replace(/__/, " · ")}</span>
            <span className="shrink-0 text-faint">×{s.count}</span>
          </div>
        ))}
      </Group>
      {preview && (
        <div className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-10" onClick={() => setPreview(null)}>
          <img src={preview} alt="Screenshot" className="anim-pop max-h-full max-w-full rounded-lg border border-line" />
        </div>
      )}
    </div>
  );
}

// ---------- panel ----------

export function Inspector() {
  const tab = useStore((s) => s.inspectorTab);
  const running = useStore((s) => Object.values(s.panes).reduce((n, p) => n + (p.bgTasks?.filter((t) => t.status === "running").length ?? 0), 0));
  const { set } = useStore.getState();
  const tabs: { id: InspectorTab; label: string; icon: ReactNode; badge?: number }[] = [
    { id: "changes", label: "Changes", icon: <FileDiff size={13} /> },
    { id: "agents", label: "Agents", icon: <Bot size={13} />, badge: running || undefined },
    { id: "details", label: "Details", icon: <Info size={13} /> },
  ];
  return (
    <div className="flex w-full min-w-0 flex-col bg-bg">
      <div className="flex items-center gap-1.5 px-2 pt-1 pb-1.5">
        <div role="tablist" className="flex flex-1 rounded-lg border border-line bg-bg p-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => set({ inspectorTab: t.id })}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-[12px] font-medium ${tab === t.id ? "bg-raised text-fg shadow-sm" : "text-muted hover:text-fg"}`}
            >
              {t.icon}
              {t.label}
              {t.badge !== undefined && <span className="rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold text-accent">{t.badge}</span>}
            </button>
          ))}
        </div>
        <button
          aria-label="Close panel"
          title="Close (Ctrl+Shift+G)"
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

