import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  PanelRight,
  LayoutDashboard, Globe,
  BookmarkPlus,
  Info,
  Bot,
  RotateCcw,
  Download,
  FileDown,
  Layers,
  SlidersHorizontal,
  Columns2,
  
  FolderOpen,
  History,
  MessageSquareText,
  Moon,
  PanelLeft,
  Rows2,
  Search,
  Settings,
  Slash,
  Sparkles,
  SquareTerminal,
  Sun,
  Wand2,
} from "lucide-react";
import { fuzzyScore, timeAgo } from "../lib/fuzzy";
import { ipc, type SlashCommand } from "../lib/ipc";
import { activePane, defaultFolder, folderName, useStore } from "../state/store";
import { focusTerminal, insertText, typeCommand } from "../terminal/terminals";
import { chooseFolder } from "./TitleBar";
import { exportActiveConversation } from "../lib/actions";
import { checkForUpdate } from "../lib/updater";

interface Item {
  id: string;
  group: string;
  label: string;
  detail?: string;
  hint?: string;
  icon: ReactNode;
  /** Extra text matched by search but not shown. */
  keywords?: string;
  run: () => void;
}

/** Built-in Claude Code commands. `args` ones are typed without pressing Enter. */
const BUILTIN: { name: string; description: string; args?: boolean }[] = [
  { name: "clear", description: "Start a fresh conversation" },
  { name: "compact", description: "Summarize the conversation to free up context" },
  { name: "context", description: "See what is using the context window" },
  { name: "model", description: "Switch the model" },
  { name: "resume", description: "Pick a past conversation" },
  { name: "rewind", description: "Go back to an earlier point in the conversation" },
  { name: "init", description: "Create a CLAUDE.md guide for this project" },
  { name: "memory", description: "Edit Claude's memory files" },
  { name: "review", description: "Review a pull request", args: true },
  { name: "security-review", description: "Check pending changes for security issues" },
  { name: "add-dir", description: "Give Claude access to another folder", args: true },
  { name: "permissions", description: "Manage what Claude may do without asking" },
  { name: "mcp", description: "Manage MCP servers" },
  { name: "agents", description: "Manage subagents" },
  { name: "hooks", description: "Manage hooks" },
  { name: "plugin", description: "Manage plugins" },
  { name: "config", description: "Open Claude Code settings" },
  { name: "usage", description: "Show plan usage limits" },
  { name: "status", description: "Show account and system status" },
  { name: "export", description: "Export this conversation" },
  { name: "doctor", description: "Check the Claude Code installation" },
  { name: "help", description: "Show Claude Code help" },
];

const GROUP_ORDER = ["Saved prompts", "Claude commands", "Actions", "Projects", "Recent conversations"];

export function CommandPalette() {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [custom, setCustom] = useState<SlashCommand[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const s = useStore.getState();
  const pane = activePane();
  const claude = !!pane && (pane.claudeActive || pane.kind === "claude");
  const close = () => {
    useStore.getState().set({ paletteOpen: false });
    if (pane) focusTerminal(pane.id);
  };

  useEffect(() => {
    input.current?.focus();
    void ipc.slashCommands(pane?.cwd ?? s.homeDir).then(setCustom).catch(() => {});
  }, []);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const cwd = pane?.cwd ?? defaultFolder();

    for (const p of s.prompts) {
      out.push({
        id: `prompt-${p.id}`,
        group: "Saved prompts",
        label: p.title,
        detail: p.text,
        icon: <MessageSquareText size={15} />,
        run: () => pane && insertText(pane.id, p.text),
      });
    }

    if (claude && pane) {
      for (const c of custom) {
        out.push({
          id: `custom-${c.name}`,
          group: "Claude commands",
          label: `/${c.name}`,
          detail: c.description,
          hint: c.kind === "skill" ? "skill" : c.scope === "project" ? "project" : "yours",
          icon: c.kind === "skill" ? <Wand2 size={15} /> : <Slash size={15} />,
          run: () => typeCommand(pane.id, `/${c.name}${c.takesArgs ? " " : ""}`, !c.takesArgs),
        });
      }
      for (const c of BUILTIN) {
        if (custom.some((x) => x.name === c.name)) continue;
        out.push({
          id: `builtin-${c.name}`,
          group: "Claude commands",
          label: `/${c.name}`,
          detail: c.description,
          icon: <Slash size={15} />,
          run: () => typeCommand(pane.id, `/${c.name}${c.args ? " " : ""}`, !c.args),
        });
      }
    }

    const action = (id: string, label: string, icon: ReactNode, run: () => void, hint?: string, keywords?: string) =>
      out.push({ id, group: "Actions", label, icon, run, hint, keywords });
    if (pane && !claude) action("start-claude", "Start Claude here", <Sparkles size={15} />, () => typeCommand(pane.id, "claude", true));
    action("new-claude", "New Claude tab", <Sparkles size={15} />, () => s.openTab(cwd, "claude"), "Ctrl+Shift+T");
    action("new-shell", "New PowerShell tab", <SquareTerminal size={15} />, () => s.openTab(cwd, "shell"), "Ctrl+Shift+N");
    action("open-folder", "Open folder with Claude…", <FolderOpen size={15} />, () => void chooseFolder("claude"));
    action("agents", "Agents: sessions, approvals and usage", <LayoutDashboard size={15} />, () => s.openAgents(), "Ctrl+Shift+A", "dashboard limits quota approve");
    if (s.closedTabs.length)
      action("reopen", `Reopen closed tab (${s.closedTabs[0].title || folderName(s.closedTabs[0].cwd)})`, <RotateCcw size={15} />, () => s.reopenClosedTab(), "Ctrl+Alt+Shift+T", "restore undo close");
    action("composer", "Write and improve a prompt…", <Wand2 size={15} />, () => s.set({ composerOpen: true }), "Ctrl+Shift+I", "compose better prompt rewrite clearer");
    action("bg-agents", "Show background agents", <Bot size={15} />, () => s.set({ changesOpen: true, inspectorTab: "agents" }), undefined, "subagents background tasks");
    action("details", "Show conversation details", <Info size={15} />, () => s.set({ changesOpen: true, inspectorTab: "details" }), undefined, "attachments screenshots files read changed");
    action("browser", "New browser tab", <Globe size={15} />, () => s.openBrowser("about:blank"), undefined, "web page localhost preview test phone responsive");
    if (pane) action("browser-beside", "Open a browser beside this tab", <Globe size={15} />, () => s.openBrowser("about:blank", { beside: true }), undefined, "web page localhost preview split");
    for (const url of s.devServers.slice(0, 3))
      action(`dev-${url}`, `Open ${url.replace(/^https?:\/\//, "").replace(/\/$/, "")} beside this tab`, <Globe size={15} />, () => s.openBrowser(url, { beside: true }), undefined, "dev server localhost preview");
    action("new-task", "New parallel task…", <Layers size={15} />, () => s.set({ newTaskOpen: true }), undefined, "worktree branch parallel");
    if (pane) {
      action("split-right", "Split right", <Columns2 size={15} />, () => s.splitActive("row", "shell"), "Alt+Shift+=");
      action("split-down", "Split down", <Rows2 size={15} />, () => s.splitActive("column", "shell"), "Alt+Shift+-");
      action("find", "Find in output", <Search size={15} />, () => s.set({ searchOpen: true }), "Ctrl+Shift+F");
    }
    action("changes", "Show changes", <PanelRight size={15} />, () => s.set({ changesOpen: true }), "Ctrl+Shift+G", "git diff undo revert");
    action("history", "Conversation history", <History size={15} />, () => s.set({ sidebarOpen: true, sidebarView: "history" }), "Ctrl+Shift+H", "sessions resume");
    action("sidebar", "Show or hide sidebar", <PanelLeft size={15} />, () => s.set({ sidebarOpen: !s.sidebarOpen }), "Ctrl+Shift+B");
    if (claude && pane) action("export", "Export this conversation to Markdown…", <FileDown size={15} />, exportActiveConversation, undefined, "save markdown share");
    action("claude-settings", "Claude Code settings…", <SlidersHorizontal size={15} />, () => s.openSettings("permissions"), undefined, "permissions hooks mcp claude.md memory");
    action("updates", "Check for updates", <Download size={15} />, () => void checkForUpdate(true), undefined, "version upgrade");
    action("prompts", "Manage saved prompts…", <BookmarkPlus size={15} />, () => s.set({ promptsOpen: true }), undefined, "snippets library add edit");
    const dark = document.documentElement.dataset.theme === "dark";
    action("theme", dark ? "Switch to light theme" : "Switch to dark theme", dark ? <Sun size={15} /> : <Moon size={15} />, () =>
      s.updateSettings({ theme: dark ? "light" : "dark" }),
    );
    action("settings", "Settings", <Settings size={15} />, () => s.openSettings(), "Ctrl+,", "preferences shortcuts font");

    const projects = [...s.pinned, ...s.recent.map((r) => r.path).filter((p) => !s.pinned.includes(p))];
    for (const path of projects) {
      out.push({
        id: `project-${path}`,
        group: "Projects",
        label: `Open ${folderName(path)} with Claude`,
        detail: path,
        icon: <Sparkles size={15} />,
        run: () => s.openTab(path, "claude"),
      });
    }

    for (const session of s.sessions.slice(0, 200)) {
      out.push({
        id: `session-${session.id}`,
        group: "Recent conversations",
        label: session.title,
        detail: `${folderName(session.cwd)} · ${timeAgo(session.lastUsed)}`,
        icon: <History size={15} />,
        keywords: session.firstPrompt,
        run: () => s.resumeSession(session),
      });
    }
    return out;
  }, [custom]);

  const results = useMemo(() => {
    if (!query.trim()) {
      const limits: Record<string, number> = { "Saved prompts": 6, "Claude commands": 8, Actions: 20, Projects: 4, "Recent conversations": 5 };
      return GROUP_ORDER.flatMap((g) => items.filter((i) => i.group === g).slice(0, limits[g]));
    }
    // Typing "/" searches Claude commands only.
    const commandsOnly = query.startsWith("/");
    return items
      .filter((i) => !commandsOnly || i.group === "Claude commands")
      .map((i) => ({
        i,
        score: Math.max(
          fuzzyScore(query, i.label),
          fuzzyScore(query, i.detail ?? "") - 300,
          fuzzyScore(query, i.keywords ?? "") - 400,
        ),
      }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map((r) => r.i);
  }, [items, query]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (item?: Item) => {
    if (!item) return;
    useStore.getState().set({ paletteOpen: false });
    item.run();
  };

  return (
    <div data-overlay className="anim-fade fixed inset-0 z-40 flex justify-center bg-black/30 pt-[12vh]" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label="Command palette" className="anim-pop flex h-fit max-h-[70vh] w-[620px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-2xl shadow-black/30">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="text-faint" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter") { e.preventDefault(); choose(results[index]); }
              if (e.key === "Escape") { e.preventDefault(); close(); }
            }}
            placeholder={claude ? "Search prompts, Claude commands, actions… ( / for commands)" : "Search actions, projects, conversations…"}
            className="flex-1 bg-transparent py-3.5 text-[14px] text-fg outline-none placeholder:text-faint"
          />
        </div>
        <div ref={list} className="scroll-thin overflow-y-auto p-1.5">
          {results.map((item, i) => {
            const showGroup = i === 0 || results[i - 1].group !== item.group;
            return (
              <div key={item.id}>
                {showGroup && <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{item.group}</div>}
                <button
                  data-index={i}
                  onPointerMove={() => setIndex(i)}
                  onClick={() => choose(item)}
                  className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left ${i === index ? "bg-hover" : ""}`}
                >
                  <span className={`shrink-0 ${i === index ? "text-accent" : "text-muted"}`}>{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-fg">{item.label}</span>
                    {item.detail && <span className="block truncate text-[12px] text-faint">{item.detail}</span>}
                  </span>
                  {item.hint && <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-faint">{item.hint}</span>}
                </button>
              </div>
            );
          })}
          {results.length === 0 && <p className="px-3 py-6 text-center text-faint">Nothing matches “{query}”.</p>}
        </div>
        <div className="flex gap-4 border-t border-line px-4 py-2 text-[11px] text-faint">
          <span>↑↓ to move</span>
          <span>Enter to run</span>
          <span>Esc to close</span>
          <span className="ml-auto">Prompts are inserted, not sent — press Enter in the terminal to send</span>
        </div>
      </div>
    </div>
  );
}
