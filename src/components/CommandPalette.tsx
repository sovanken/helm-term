import { openSettingsJson } from "../lib/settingsJson";
import { focusSidebarSearch } from "./HistoryList";
import { TOOLS } from "../tools/registry";
import { startSnip } from "../snip/snip";
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
  FileJson,
  Slash,
  Sparkles,
  SquareTerminal,
  Sun,
  Wand2,
  FilePlus,
  Scissors,
  Timer,
  Images,
  FolderTree,
} from "lucide-react";
import { fuzzyScore, timeAgo } from "../lib/fuzzy";
import { ipc, type SlashCommand } from "../lib/ipc";
import { activePane, defaultFolder, folderName, useStore } from "../state/store";
import { focusTerminal, insertText, typeCommand } from "../terminal/terminals";
import { chooseFolder, chooseProject } from "./TitleBar";
import { exportActiveConversation } from "../lib/actions";
import { checkForUpdate } from "../lib/updater";
import { useTranslation } from "react-i18next";

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

/** Built-in Claude Code commands. `args` ones are typed without pressing Enter. `description` is a translation key. */
const BUILTIN: { name: string; description: string; args?: boolean }[] = [
  { name: "clear", description: "palette.builtin.clear" },
  { name: "compact", description: "palette.builtin.compact" },
  { name: "context", description: "palette.builtin.context" },
  { name: "model", description: "palette.builtin.model" },
  { name: "resume", description: "palette.builtin.resume" },
  { name: "rewind", description: "palette.builtin.rewind" },
  { name: "init", description: "palette.builtin.init" },
  { name: "memory", description: "palette.builtin.memory" },
  { name: "review", description: "palette.builtin.review", args: true },
  { name: "security-review", description: "palette.builtin.securityReview" },
  { name: "add-dir", description: "palette.builtin.addDir", args: true },
  { name: "permissions", description: "palette.builtin.permissions" },
  { name: "mcp", description: "palette.builtin.mcp" },
  { name: "agents", description: "palette.builtin.agents" },
  { name: "hooks", description: "palette.builtin.hooks" },
  { name: "plugin", description: "palette.builtin.plugin" },
  { name: "config", description: "palette.builtin.config" },
  { name: "usage", description: "palette.builtin.usage" },
  { name: "status", description: "palette.builtin.status" },
  { name: "export", description: "palette.builtin.export" },
  { name: "doctor", description: "palette.builtin.doctor" },
  { name: "help", description: "palette.builtin.help" },
];

const GROUP_ORDER = ["prompts", "commands", "actions", "projects", "conversations"];
const GROUP_LABEL: Record<string, string> = {
  prompts: "palette.groups.prompts",
  commands: "palette.groups.commands",
  actions: "palette.groups.actions",
  projects: "palette.groups.projects",
  conversations: "palette.groups.conversations",
};

export function CommandPalette() {
  const { t } = useTranslation();
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
        group: "prompts",
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
          group: "commands",
          label: `/${c.name}`,
          detail: c.description,
          hint: c.kind === "skill" ? t("palette.hint.skill") : c.scope === "project" ? t("palette.hint.project") : t("palette.hint.yours"),
          icon: c.kind === "skill" ? <Wand2 size={15} /> : <Slash size={15} />,
          run: () => typeCommand(pane.id, `/${c.name}${c.takesArgs ? " " : ""}`, !c.takesArgs),
        });
      }
      for (const c of BUILTIN) {
        if (custom.some((x) => x.name === c.name)) continue;
        out.push({
          id: `builtin-${c.name}`,
          group: "commands",
          label: `/${c.name}`,
          detail: t(c.description),
          icon: <Slash size={15} />,
          run: () => typeCommand(pane.id, `/${c.name}${c.args ? " " : ""}`, !c.args),
        });
      }
    }

    const action = (id: string, label: string, icon: ReactNode, run: () => void, hint?: string, keywords?: string) =>
      out.push({ id, group: "actions", label, icon, run, hint, keywords });
    if (pane && !claude) action("start-claude", t("palette.action.startClaude"), <Sparkles size={15} />, () => typeCommand(pane.id, "claude", true));
    action("new-claude", t("common.newClaudeTab"), <Sparkles size={15} />, () => s.openTab(cwd, "claude"), "Ctrl+Shift+T");
    action("new-shell", t("common.newTerminalTab"), <SquareTerminal size={15} />, () => s.openTab(cwd, "shell"), "Ctrl+Shift+N");
    action("open-folder", t("welcome.openFolder"), <FolderOpen size={15} />, () => void chooseFolder("claude"));
    action("agents", t("shortcuts.agents"), <LayoutDashboard size={15} />, () => s.openAgents(), "Ctrl+Shift+A", "dashboard limits quota approve");
    if (s.closedTabs.length)
      action("reopen", t("palette.action.reopen", { name: s.closedTabs[0].title || folderName(s.closedTabs[0].cwd) }), <RotateCcw size={15} />, () => s.reopenClosedTab(), "Ctrl+Alt+Shift+T", "restore undo close");
    action("composer", t("palette.action.composer"), <Wand2 size={15} />, () => s.set({ composerOpen: true }), "Ctrl+Shift+I", "compose better prompt rewrite clearer");
    action("bg-agents", t("palette.action.backgroundWork"), <Bot size={15} />, () => s.set({ changesOpen: true, inspectorTab: "agents" }), undefined, "subagents background tasks");
    action("details", t("palette.action.details"), <Info size={15} />, () => s.set({ changesOpen: true, inspectorTab: "details" }), undefined, "attachments screenshots files read changed");
    action("new-md", t("titleBar.newMarkdown"), <FilePlus size={15} />, () => s.set({ newFile: { ext: "md", dir: cwd } }), undefined, "create note document md write");
    action("new-txt", t("titleBar.newText"), <FilePlus size={15} />, () => s.set({ newFile: { ext: "txt", dir: cwd } }), undefined, "create note txt write");
    action("open-project", t("palette.action.openProjectHere", { name: folderName(cwd) }), <FolderTree size={15} />, () => s.openWorkspace(cwd), undefined, "explorer tree files browse workspace");
    action("open-project-pick", t("titleBar.openProject"), <FolderTree size={15} />, () => void chooseProject(), undefined, "explorer tree files browse workspace folder");
    action("snip", t("titleBar.snip"), <Scissors size={15} />, () => startSnip(0), useStore.getState().settings.snipShortcut || undefined, "snipping tool capture screen area window");
    action("snip-delay", t("titleBar.snipIn", { count: 5 }), <Timer size={15} />, () => startSnip(5), undefined, "snipping tool capture delay");
    action("snips", t("titleBar.screenshots"), <Images size={15} />, () => s.openSnips(), undefined, "snips history annotate");
    for (const tool of TOOLS) action(`tool-${tool.id}`, t("palette.action.tool", { tool: tool.label }), tool.icon(15), () => s.openTool(tool.id), undefined, `developer tools ${tool.keywords}`);
    action("browser", t("titleBar.newBrowserTab"), <Globe size={15} />, () => s.openBrowser("about:blank"), undefined, "web page localhost preview test phone responsive");
    if (pane) action("browser-beside", t("titleBar.browserBeside"), <Globe size={15} />, () => s.openBrowser("about:blank", { beside: true }), undefined, "web page localhost preview split");
    for (const url of s.devServers.slice(0, 3))
      action(`dev-${url}`, t("palette.action.devServer", { address: url.replace(/^https?:\/\//, "").replace(/\/$/, "") }), <Globe size={15} />, () => s.openBrowser(url, { beside: true }), undefined, "dev server localhost preview");
    action("new-task", t("palette.action.newTask"), <Layers size={15} />, () => s.set({ newTaskOpen: true }), undefined, "worktree branch parallel");
    if (pane) {
      action("split-right", t("shortcuts.splitRight"), <Columns2 size={15} />, () => s.splitActive("row", "shell"), "Alt+Shift+=");
      action("split-down", t("shortcuts.splitDown"), <Rows2 size={15} />, () => s.splitActive("column", "shell"), "Alt+Shift+-");
      action("find", t("shortcuts.find"), <Search size={15} />, () => s.set({ searchOpen: true }), "Ctrl+Shift+F");
    }
    action("changes", t("palette.action.changes"), <PanelRight size={15} />, () => s.set({ changesOpen: true }), "Ctrl+Shift+G", "git diff undo revert");
    action("history", t("shortcuts.search"), <History size={15} />, focusSidebarSearch, "Ctrl+Shift+H", "history sessions resume chats");
    action("sidebar", t("shortcuts.toggleSidebar"), <PanelLeft size={15} />, () => s.set({ sidebarOpen: !s.sidebarOpen }), "Ctrl+Shift+B");
    if (claude && pane) action("export", t("palette.action.export"), <FileDown size={15} />, exportActiveConversation, undefined, "save markdown share");
    action("claude-settings", t("titleBar.manage.claudeSettings"), <SlidersHorizontal size={15} />, () => s.openSettings("permissions"), undefined, "permissions hooks mcp claude.md memory");
    action("updates", t("titleBar.manage.checkUpdates"), <Download size={15} />, () => void checkForUpdate(true), undefined, "version upgrade");
    action("prompts", t("palette.action.prompts"), <BookmarkPlus size={15} />, () => s.set({ promptsOpen: true }), undefined, "snippets library add edit");
    const dark = document.documentElement.dataset.theme === "dark";
    action("theme", dark ? t("palette.action.lightTheme") : t("palette.action.darkTheme"), dark ? <Sun size={15} /> : <Moon size={15} />, () =>
      s.updateSettings({ theme: dark ? "light" : "dark" }),
    );
    action("settings", t("titleBar.settings"), <Settings size={15} />, () => s.openSettings(), "Ctrl+,", "preferences shortcuts font");
    action("settings-json", t("shortcuts.openSettingsJson"), <FileJson size={15} />, () => void openSettingsJson(), "Ctrl+Shift+,", "preferences json edit file custom");

    const projects = [...s.pinned, ...s.recent.map((r) => r.path).filter((p) => !s.pinned.includes(p))];
    for (const path of projects) {
      out.push({
        id: `project-${path}`,
        group: "projects",
        label: t("palette.openProject", { name: folderName(path) }),
        detail: path,
        icon: <Sparkles size={15} />,
        run: () => s.openTab(path, "claude"),
      });
    }

    for (const session of s.sessions.slice(0, 200)) {
      out.push({
        id: `session-${session.id}`,
        group: "conversations",
        label: session.title,
        detail: `${folderName(session.cwd)} · ${timeAgo(session.lastUsed)}`,
        icon: <History size={15} />,
        keywords: session.firstPrompt,
        run: () => s.resumeSession(session),
      });
    }
    return out;
  }, [custom, t]);

  const results = useMemo(() => {
    if (!query.trim()) {
      const limits: Record<string, number> = { prompts: 6, commands: 8, actions: 20, projects: 4, conversations: 5 };
      return GROUP_ORDER.flatMap((g) => items.filter((i) => i.group === g).slice(0, limits[g]));
    }
    // Typing "/" searches Claude commands only.
    const commandsOnly = query.startsWith("/");
    return items
      .filter((i) => !commandsOnly || i.group === "commands")
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
      <div role="dialog" aria-label={t("palette.label")} className="anim-pop flex h-fit max-h-[70vh] w-[620px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-2xl shadow-black/30">
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
            placeholder={claude ? t("palette.placeholderClaude") : t("palette.placeholder")}
            className="flex-1 bg-transparent py-3.5 text-[14px] text-fg outline-none placeholder:text-faint"
          />
        </div>
        <div ref={list} className="scroll-thin overflow-y-auto p-1.5">
          {results.map((item, i) => {
            const showGroup = i === 0 || results[i - 1].group !== item.group;
            return (
              <div key={item.id}>
                {showGroup && <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{t(GROUP_LABEL[item.group])}</div>}
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
          {results.length === 0 && <p className="px-3 py-6 text-center text-faint">{t("palette.noMatch", { query })}</p>}
        </div>
        <div className="flex gap-4 border-t border-line px-4 py-2 text-[11px] text-faint">
          <span>{t("palette.footer.move")}</span>
          <span>{t("palette.footer.run")}</span>
          <span>{t("palette.footer.close")}</span>
          <span className="ml-auto">{t("palette.footer.inserted")}</span>
        </div>
      </div>
    </div>
  );
}
