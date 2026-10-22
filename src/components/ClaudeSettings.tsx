import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, ExternalLink, Plug, Plus, RefreshCw, ShieldCheck, Trash2, Webhook, X } from "lucide-react";
import { ipc, type McpServer, type Scope, type SettingsFile } from "../lib/ipc";
import { Trans, useTranslation } from "react-i18next";
import { activePane, folderName, showToast, useStore } from "../state/store";
import { ShimmerLines, ShimmerRows } from "./Shimmer";

type Section = "permissions" | "hooks" | "mcp" | "memory";

/** `label` and `hint` are translation keys. */
const SECTIONS: { id: Section; label: string; icon: ReactNode; hint: string }[] = [
  { id: "permissions", label: "claudeSettings.sections.permissions.label", icon: <ShieldCheck size={15} />, hint: "claudeSettings.sections.permissions.hint" },
  { id: "hooks", label: "claudeSettings.sections.hooks.label", icon: <Webhook size={15} />, hint: "claudeSettings.sections.hooks.hint" },
  { id: "mcp", label: "claudeSettings.sections.mcp.label", icon: <Plug size={15} />, hint: "claudeSettings.sections.mcp.hint" },
  { id: "memory", label: "claudeSettings.sections.memory.label", icon: <BookOpen size={15} />, hint: "claudeSettings.sections.memory.hint" },
];

/** `label` and `hint` are translation keys. */
const SCOPES: { id: Scope; label: string; hint: string }[] = [
  { id: "user", label: "claudeSettings.scopes.user.label", hint: "claudeSettings.scopes.user.hint" },
  { id: "project", label: "claudeSettings.scopes.project.label", hint: "claudeSettings.scopes.project.hint" },
  { id: "local", label: "claudeSettings.scopes.local.label", hint: "claudeSettings.scopes.local.hint" },
];

const HOOK_EVENTS = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Notification", "Stop", "SubagentStop", "SessionStart", "SessionEnd", "PreCompact"];
const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse"]);
/** `label` is a translation key; an unknown mode from the file shows its raw name. */
const MODES: { id: string; label: string }[] = [
  { id: "", label: "claudeSettings.modes.claudeDefault" },
  { id: "default", label: "claudeSettings.modes.default" },
  { id: "acceptEdits", label: "claudeSettings.modes.acceptEdits" },
  { id: "plan", label: "claudeSettings.modes.plan" },
  { id: "bypassPermissions", label: "claudeSettings.modes.bypassPermissions" },
];

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

const input = "w-full rounded-md border border-line bg-bg px-2.5 py-1.5 outline-none focus:border-accent";

// ---------- permissions ----------

function RuleList({
  title,
  hint,
  rules,
  onChange,
  tone,
}: {
  title: string;
  hint: string;
  rules: string[];
  onChange: (rules: string[]) => void;
  tone: string;
}) {
  const [draft, setDraft] = useState("");
  const { t } = useTranslation();
  const add = () => {
    const rule = draft.trim();
    if (!rule || rules.includes(rule)) return;
    onChange([...rules, rule]);
    setDraft("");
  };
  return (
    <div className="rounded-lg border border-line">
      <div className="flex items-baseline gap-2 border-b border-line px-3 py-2">
        <span className={`font-medium ${tone}`}>{title}</span>
        <span className="text-[12px] text-faint">{hint}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 p-2.5">
        {rules.map((r) => (
          <span key={r} className="flex items-center gap-1 rounded-md bg-hover py-0.5 pr-1 pl-2 font-mono text-[12px] text-fg">
            {r}
            <button aria-label={t("claudeSettings.permissions.removeRule", { rule: r })} onClick={() => onChange(rules.filter((x) => x !== r))} className="rounded p-0.5 text-faint hover:text-danger">
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          onBlur={add}
          placeholder={rules.length ? t("claudeSettings.permissions.addRule") : t("claudeSettings.permissions.rulePlaceholder")}
          className="min-w-48 flex-1 bg-transparent px-1 py-0.5 font-mono text-[12px] outline-none placeholder:font-sans placeholder:text-faint"
        />
      </div>
    </div>
  );
}

function Permissions({ file, save }: { file: SettingsFile; save: (value: unknown) => Promise<void> }) {
  const perms = file.permissions ?? {};
  const update = (patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...perms, ...patch };
    for (const k of Object.keys(next)) if (next[k] === "" || next[k] === undefined) delete next[k];
    void save(next);
  };
  const { t } = useTranslation();
  const mode = (perms.defaultMode as string) ?? "";
  const modes = MODES.some((m) => m.id === mode) ? MODES : [...MODES, { id: mode, label: mode }];
  return (
    <div className="space-y-4">
      <Field label={t("claudeSettings.permissions.mode.label")} hint={t("claudeSettings.permissions.mode.hint")}>
        <select value={mode} onChange={(e) => update({ defaultMode: e.target.value })} className={input}>
          {modes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label.startsWith("claudeSettings.") ? t(m.label) : m.label}
            </option>
          ))}
        </select>
      </Field>
      <RuleList title={t("claudeSettings.permissions.allow.title")} hint={t("claudeSettings.permissions.allow.hint")} tone="text-done" rules={perms.allow ?? []} onChange={(allow) => update({ allow })} />
      <RuleList title={t("claudeSettings.permissions.ask.title")} hint={t("claudeSettings.permissions.ask.hint")} tone="text-attention" rules={perms.ask ?? []} onChange={(ask) => update({ ask })} />
      <RuleList title={t("claudeSettings.permissions.deny.title")} hint={t("claudeSettings.permissions.deny.hint")} tone="text-danger" rules={perms.deny ?? []} onChange={(deny) => update({ deny })} />
      <p className="text-[12px] leading-relaxed text-faint">
        <Trans i18nKey="claudeSettings.permissions.help" components={{ 1: <code className="text-muted" /> }} />
      </p>
    </div>
  );
}

// ---------- hooks ----------

function Hooks({ file, save }: { file: SettingsFile; save: (value: unknown) => Promise<void> }) {
  const hooks = file.hooks ?? {};
  const [event, setEvent] = useState("PostToolUse");
  const [matcher, setMatcher] = useState("");
  const [command, setCommand] = useState("");
  const { t } = useTranslation();

  const entries = Object.entries(hooks).flatMap(([ev, groups]) =>
    (groups ?? []).flatMap((g, gi) => (g.hooks ?? []).map((h, hi) => ({ ev, gi, hi, matcher: g.matcher, hook: h }))),
  );

  const removeAt = (ev: string, gi: number, hi: number) => {
    const next = structuredClone(hooks);
    next[ev][gi].hooks.splice(hi, 1);
    if (next[ev][gi].hooks.length === 0) next[ev].splice(gi, 1);
    if (next[ev].length === 0) delete next[ev];
    void save(next);
  };
  const add = () => {
    if (!command.trim()) return;
    const next = structuredClone(hooks);
    const group = { ...(TOOL_EVENTS.has(event) && matcher.trim() ? { matcher: matcher.trim() } : {}), hooks: [{ type: "command", command: command.trim() }] };
    next[event] = [...(next[event] ?? []), group];
    void save(next).then(() => {
      setCommand("");
      setMatcher("");
    });
  };

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-line">
        {entries.length === 0 && <p className="p-4 text-center text-[13px] text-faint">{t("claudeSettings.hooks.empty")}</p>}
        {entries.map(({ ev, gi, hi, matcher: m, hook }) => (
          <div key={`${ev}-${gi}-${hi}`} className="flex items-start gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
            <div className="w-36 shrink-0">
              <div className="font-medium text-fg">{ev}</div>
              {m && <div className="truncate font-mono text-[11px] text-faint">{m}</div>}
            </div>
            <code className="min-w-0 flex-1 font-mono text-[12px] break-all text-muted">{hook.command ?? hook.type}</code>
            <button aria-label={t("claudeSettings.hooks.remove")} onClick={() => removeAt(ev, gi, hi)} className="rounded p-1 text-faint hover:bg-hover hover:text-danger">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-line p-3">
        <div className="mb-2 font-medium">{t("claudeSettings.hooks.addTitle")}</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("claudeSettings.hooks.when")}>
            <select value={event} onChange={(e) => setEvent(e.target.value)} className={input}>
              {HOOK_EVENTS.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </Field>
          <Field label={t("claudeSettings.hooks.forTools")}>
            <input value={matcher} disabled={!TOOL_EVENTS.has(event)} onChange={(e) => setMatcher(e.target.value)} placeholder={t("claudeSettings.hooks.matcherPlaceholder")} className={`${input} disabled:opacity-40`} />
          </Field>
        </div>
        <div className="mt-3 flex gap-2">
          <input value={command} onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder={t("claudeSettings.hooks.commandPlaceholder")} className={`${input} font-mono text-[12px]`} />
          <button onClick={add} disabled={!command.trim()} className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 font-medium text-on-accent hover:opacity-90 disabled:opacity-40">
            <Plus size={14} /> {t("claudeSettings.hooks.add")}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-faint">{t("claudeSettings.hooks.help")}</p>
      </div>
    </div>
  );
}

// ---------- MCP ----------

function splitArgs(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}

function Mcp({ cwd, scope }: { cwd: string; scope: Scope }) {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [target, setTarget] = useState("");
  const [env, setEnv] = useState("");
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();

  const load = useCallback(() => {
    setServers(null);
    setError(null);
    ipc.mcpList(cwd).then(setServers, (e) => setError(String(e)));
  }, [cwd]);
  useEffect(load, [load]);

  const add = async () => {
    const [cmd, ...args] = transport === "stdio" ? splitArgs(target) : [target.trim()];
    if (!name.trim() || !cmd) return;
    setBusy(true);
    try {
      await ipc.mcpAdd(cwd, name.trim(), scope, transport, cmd, args, env.split("\n").map((l) => l.trim()).filter(Boolean));
      showToast(t("claudeSettings.mcp.added", { name: name.trim() }), "success");
      setName("");
      setTarget("");
      setEnv("");
      load();
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (s: McpServer) => {
    try {
      await ipc.mcpRemove(cwd, s.name);
      showToast(t("claudeSettings.mcp.removed", { name: s.name }), "success");
      load();
    } catch (e) {
      showToast(String(e), "error");
    }
  };
  const dot = { ok: "bg-done", auth: "bg-attention", failed: "bg-danger", pending: "bg-faint", unknown: "bg-faint" };

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-line">
        <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[12px] text-faint">
          <span>{t("claudeSettings.mcp.listTitle")}</span>
          <button onClick={load} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover hover:text-fg">
            <RefreshCw size={11} className={servers === null && !error ? "status-working" : ""} /> {t("claudeSettings.mcp.checkAgain")}
          </button>
        </div>
        {servers === null && !error && <ShimmerRows rows={3} className="p-4" />}
        {error && <p className="p-4 text-[13px] text-danger">{error}</p>}
        {servers?.length === 0 && <p className="p-4 text-center text-[13px] text-faint">{t("claudeSettings.mcp.empty")}</p>}
        {servers?.map((s) => (
          <div key={s.name} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
            <span className={`size-2 shrink-0 rounded-full ${dot[s.health]}`} title={s.status} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-fg">{s.name}</span>
                {s.managed && <span className="rounded bg-hover px-1.5 text-[10px] text-faint">{s.name.startsWith("claude.ai") ? t("claudeSettings.mcp.fromClaudeAi") : t("claudeSettings.mcp.fromPlugin")}</span>}
              </div>
              <div className="truncate font-mono text-[11px] text-faint">{s.target}</div>
            </div>
            <span className="shrink-0 text-[12px] text-muted">{s.status}</span>
            {!s.managed && (
              <button aria-label={t("claudeSettings.mcp.removeServer", { name: s.name })} onClick={() => void remove(s)} className="rounded p-1 text-faint hover:bg-hover hover:text-danger">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-line p-3">
        <div className="mb-2 font-medium"><Trans i18nKey="claudeSettings.mcp.addTitle" values={{ scope: t(SCOPES.find((s) => s.id === scope)?.label ?? "") }} components={{ 1: <span className="text-[12px] font-normal text-faint" /> }} /></div>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label={t("claudeSettings.mcp.name")}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("claudeSettings.mcp.namePlaceholder")} className={input} />
          </Field>
          <Field label={t("claudeSettings.mcp.type")}>
            <div className="flex rounded-md border border-line p-0.5">
              {(["stdio", "http"] as const).map((kind) => (
                <button key={kind} onClick={() => setTransport(kind)} className={`rounded px-3 py-1 ${transport === kind ? "bg-hover text-fg" : "text-muted"}`}>
                  {kind === "stdio" ? t("claudeSettings.mcp.command") : t("claudeSettings.mcp.url")}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="mt-3">
          <Field label={transport === "stdio" ? t("claudeSettings.mcp.command") : t("claudeSettings.mcp.url")}>
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder={transport === "stdio" ? "npx -y @modelcontextprotocol/server-filesystem C:/docs" : "https://mcp.example.com/mcp"} className={`${input} font-mono text-[12px]`} />
          </Field>
        </div>
        {transport === "stdio" && (
          <div className="mt-3">
            <Field label={t("claudeSettings.mcp.env.label")} hint={t("claudeSettings.mcp.env.hint")}>
              <textarea value={env} onChange={(e) => setEnv(e.target.value)} rows={2} className={`${input} resize-none font-mono text-[12px]`} />
            </Field>
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <button onClick={() => void add()} disabled={busy || !name.trim() || !target.trim()} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:opacity-90 disabled:opacity-40">
            <Plus size={14} /> {busy ? t("claudeSettings.mcp.adding") : t("claudeSettings.mcp.addServer")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- CLAUDE.md ----------

function Memory({ cwd, scope }: { cwd: string; scope: Scope }) {
  const [path, setPath] = useState("");
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [exists, setExists] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    setError(null);
    ipc.memoryRead(scope, cwd).then(
      (m) => {
        setPath(m.path);
        setText(m.content);
        setSaved(m.content);
        setExists(m.exists);
      },
      (e) => setError(String(e)),
    );
  }, [scope, cwd]);

  const save = async () => {
    try {
      await ipc.memoryWrite(scope, cwd, text);
      setSaved(text);
      setExists(true);
      showToast(t("claudeSettings.memory.saved"), "success");
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  if (error) return <p className="text-[13px] text-danger">{error}</p>;
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2 text-[12px] text-faint">
        <code className="min-w-0 flex-1 truncate">{path}</code>
        {!exists && <span className="shrink-0">{t("claudeSettings.memory.notYet")}</span>}
        {exists && (
          <button onClick={() => void ipc.openInEditor(path)} className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover hover:text-fg">
            <ExternalLink size={11} /> {t("common.openInEditor")}
          </button>
        )}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "s" && e.ctrlKey) {
            e.preventDefault();
            void save();
          }
        }}
        placeholder={t("claudeSettings.memory.placeholder")}
        className="scroll-thin min-h-[380px] flex-1 resize-none rounded-md border border-line bg-bg p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-accent"
      />
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-faint">{text !== saved ? t("claudeSettings.memory.unsaved") : t("claudeSettings.memory.hint")}</span>
        <button onClick={() => void save()} disabled={text === saved} className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:opacity-90 disabled:opacity-40">
          {t("claudeSettings.memory.save")}
        </button>
      </div>
    </div>
  );
}

// ---------- section host (used by the Settings tab) ----------

export type ClaudeSectionId = Section;
export const CLAUDE_SECTIONS = SECTIONS;

/** One Claude Code settings section with its scope switch (all projects / this project / only me). */
export function ClaudeSection({ section }: { section: Section }) {
  const [scope, setScope] = useState<Scope>("user");
  const [file, setFile] = useState<SettingsFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeTabId = useStore((s) => s.activeTabId);
  const cwd = useMemo(() => activePane()?.cwd ?? "", [activeTabId]);
  const { t } = useTranslation();

  const loadFile = useCallback(() => {
    if (section !== "permissions" && section !== "hooks") return;
    setError(null);
    ipc.claudeSettingsRead(scope, cwd).then(setFile, (e) => {
      setFile(null);
      setError(String(e));
    });
  }, [scope, cwd, section]);
  useEffect(loadFile, [loadFile]);

  const save = (key: "permissions" | "hooks") => async (value: unknown) => {
    try {
      await ipc.claudeSettingsWrite(scope, cwd, key, value);
      loadFile();
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const info = SECTIONS.find((s) => s.id === section)!;
  const needsProject = scope !== "user" && !cwd;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-5">
        <h1 className="text-[18px] font-semibold text-fg">{t(info.label)}</h1>
        <p className="mt-0.5 text-muted">{t("claudeSettings.intro", { hint: t(info.hint) })}</p>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border border-line p-0.5">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              title={t(s.hint)}
              onClick={() => setScope(s.id)}
              className={`rounded px-3 py-1 text-[12px] ${scope === s.id ? "bg-hover text-fg" : "text-muted hover:text-fg"}`}
            >
              {t(s.label)}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-faint">
          {scope !== "user" && cwd
            ? t("claudeSettings.scopeInFolder", { folder: folderName(cwd), hint: t(SCOPES.find((s) => s.id === scope)?.hint ?? "") })
            : t(SCOPES.find((s) => s.id === scope)?.hint ?? "")}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        {needsProject ? (
          <p className="text-[13px] text-faint">{t("claudeSettings.needsProject")}</p>
        ) : section === "mcp" ? (
          <Mcp cwd={cwd} scope={scope} />
        ) : section === "memory" ? (
          <Memory cwd={cwd} scope={scope} />
        ) : error ? (
          <p className="text-[13px] text-danger">{error}</p>
        ) : !file ? (
          <ShimmerLines lines={8} />
        ) : (
          <>
            <p className="mb-4 truncate text-[12px] text-faint">
              <code>{file.path}</code> {!file.exists && t("claudeSettings.createdOnChange")}
            </p>
            {section === "permissions" ? <Permissions file={file} save={save("permissions")} /> : <Hooks file={file} save={save("hooks")} />}
          </>
        )}
      </div>
    </div>
  );
}
