import { type ReactNode, useEffect, useMemo, useState } from "react";
import { openLink } from "../lib/links";
import { Bot, ChevronRight, FileDiff, FileText, Globe, Image, Info, Layers, Paperclip, PenLine, Plug, X } from "lucide-react";

import { ipc, type SessionDetails } from "../lib/ipc";
import { activePane, useStore } from "../state/store";
import { AgentsTab, Empty } from "./AgentsPanel";
import { ChangesPanel } from "./ChangesPanel";

type InspectorTab = "changes" | "agents" | "details";

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
      onClick={() => useStore.getState().openFile(/^([a-z]:[\\/]|[\\/]{2})/i.test(path) ? path : `${cwd.replace(/[\\/]$/, "")}\\${path}`, cwd)}
      title={`${path}\nOpen in a tab`}
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
            onClick={() => !u.startsWith("Search: ") && openLink(u, { cwd: pane.cwd })}
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

