import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, ExternalLink, Plug, Plus, RefreshCw, ShieldCheck, Trash2, Webhook, X } from "lucide-react";
import { ipc, type McpServer, type Scope, type SettingsFile } from "../lib/ipc";
import { activePane, folderName, showToast, useStore } from "../state/store";

type Section = "permissions" | "hooks" | "mcp" | "memory";

const SECTIONS: { id: Section; label: string; icon: ReactNode; hint: string }[] = [
  { id: "permissions", label: "Permissions", icon: <ShieldCheck size={15} />, hint: "What Claude may do without asking" },
  { id: "hooks", label: "Hooks", icon: <Webhook size={15} />, hint: "Commands that run on Claude events" },
  { id: "mcp", label: "MCP servers", icon: <Plug size={15} />, hint: "Extra tools for Claude" },
  { id: "memory", label: "CLAUDE.md", icon: <BookOpen size={15} />, hint: "Instructions Claude always reads" },
];

const SCOPES: { id: Scope; label: string; hint: string }[] = [
  { id: "user", label: "All projects", hint: "Only you, every project" },
  { id: "project", label: "This project", hint: "Shared with your team (commit it)" },
  { id: "local", label: "This project, only me", hint: "Not committed" },
];

const HOOK_EVENTS = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Notification", "Stop", "SubagentStop", "SessionStart", "SessionEnd", "PreCompact"];
const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse"]);
const MODES: { id: string; label: string }[] = [
  { id: "", label: "Claude's default (ask when needed)" },
  { id: "default", label: "Ask before edits and commands" },
  { id: "acceptEdits", label: "Accept file edits automatically" },
  { id: "plan", label: "Plan only (no changes)" },
  { id: "bypassPermissions", label: "Never ask (dangerous)" },
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
            <button aria-label={`Remove ${r}`} onClick={() => onChange(rules.filter((x) => x !== r))} className="rounded p-0.5 text-faint hover:text-danger">
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          onBlur={add}
          placeholder={rules.length ? "Add rule…" : "e.g. Bash(npm test:*) or Read(./docs/**)"}
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
  const mode = (perms.defaultMode as string) ?? "";
  const modes = MODES.some((m) => m.id === mode) ? MODES : [...MODES, { id: mode, label: mode }];
  return (
    <div className="space-y-4">
      <Field label="When Claude wants to do something" hint="The starting mode for new sessions. You can still switch with Shift+Tab inside Claude.">
        <select value={mode} onChange={(e) => update({ defaultMode: e.target.value })} className={input}>
          {modes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>
      <RuleList title="Allow" hint="Claude does these without asking" tone="text-done" rules={perms.allow ?? []} onChange={(allow) => update({ allow })} />
      <RuleList title="Ask" hint="Claude always asks first" tone="text-attention" rules={perms.ask ?? []} onChange={(ask) => update({ ask })} />
      <RuleList title="Deny" hint="Claude is never allowed" tone="text-danger" rules={perms.deny ?? []} onChange={(deny) => update({ deny })} />
      <p className="text-[12px] leading-relaxed text-faint">
        Rules look like <code className="text-muted">Tool</code> or <code className="text-muted">Tool(pattern)</code>:{" "}
        <code className="text-muted">Bash(git status)</code>, <code className="text-muted">Bash(npm run test:*)</code>,{" "}
        <code className="text-muted">Edit(src/**)</code>, <code className="text-muted">WebFetch(domain:github.com)</code>,{" "}
        <code className="text-muted">mcp__server__tool</code>. Deny wins over ask, and ask wins over allow.
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
        {entries.length === 0 && <p className="p-4 text-center text-[13px] text-faint">No hooks in this file.</p>}
        {entries.map(({ ev, gi, hi, matcher: m, hook }) => (
          <div key={`${ev}-${gi}-${hi}`} className="flex items-start gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
            <div className="w-36 shrink-0">
              <div className="font-medium text-fg">{ev}</div>
              {m && <div className="truncate font-mono text-[11px] text-faint">{m}</div>}
            </div>
            <code className="min-w-0 flex-1 font-mono text-[12px] break-all text-muted">{hook.command ?? hook.type}</code>
            <button aria-label="Remove hook" onClick={() => removeAt(ev, gi, hi)} className="rounded p-1 text-faint hover:bg-hover hover:text-danger">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-line p-3">
        <div className="mb-2 font-medium">Add a hook</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="When">
            <select value={event} onChange={(e) => setEvent(e.target.value)} className={input}>
              {HOOK_EVENTS.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </Field>
          <Field label="For tools (optional)">
            <input value={matcher} disabled={!TOOL_EVENTS.has(event)} onChange={(e) => setMatcher(e.target.value)} placeholder="e.g. Edit|Write or Bash" className={`${input} disabled:opacity-40`} />
          </Field>
        </div>
        <div className="mt-3 flex gap-2">
          <input value={command} onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Command to run, e.g. npx prettier --write ." className={`${input} font-mono text-[12px]`} />
          <button onClick={add} disabled={!command.trim()} className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 font-medium text-on-accent hover:opacity-90 disabled:opacity-40">
            <Plus size={14} /> Add
          </button>
        </div>
        <p className="mt-2 text-[11px] text-faint">The command gets the event's details as JSON on its input. Hooks run with your permissions — only add commands you trust.</p>
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
      showToast(`Added MCP server ${name.trim()}`, "success");
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
      showToast(`Removed ${s.name}`, "success");
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
          <span>All servers Claude can use here</span>
          <button onClick={load} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover hover:text-fg">
            <RefreshCw size={11} className={servers === null && !error ? "status-working" : ""} /> Check again
          </button>
        </div>
        {servers === null && !error && <p className="p-4 text-center text-[13px] text-faint">Checking servers… this can take a few seconds.</p>}
        {error && <p className="p-4 text-[13px] text-danger">{error}</p>}
        {servers?.length === 0 && <p className="p-4 text-center text-[13px] text-faint">No MCP servers yet.</p>}
        {servers?.map((s) => (
          <div key={s.name} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
            <span className={`size-2 shrink-0 rounded-full ${dot[s.health]}`} title={s.status} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-fg">{s.name}</span>
                {s.managed && <span className="rounded bg-hover px-1.5 text-[10px] text-faint">{s.name.startsWith("claude.ai") ? "from claude.ai" : "from plugin"}</span>}
              </div>
              <div className="truncate font-mono text-[11px] text-faint">{s.target}</div>
            </div>
            <span className="shrink-0 text-[12px] text-muted">{s.status}</span>
            {!s.managed && (
              <button aria-label={`Remove ${s.name}`} onClick={() => void remove(s)} className="rounded p-1 text-faint hover:bg-hover hover:text-danger">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-line p-3">
        <div className="mb-2 font-medium">Add a server <span className="text-[12px] font-normal text-faint">· saved to “{SCOPES.find((s) => s.id === scope)?.label}”</span></div>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. github" className={input} />
          </Field>
          <Field label="Type">
            <div className="flex rounded-md border border-line p-0.5">
              {(["stdio", "http"] as const).map((t) => (
                <button key={t} onClick={() => setTransport(t)} className={`rounded px-3 py-1 ${transport === t ? "bg-hover text-fg" : "text-muted"}`}>
                  {t === "stdio" ? "Command" : "URL"}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="mt-3">
          <Field label={transport === "stdio" ? "Command" : "URL"}>
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder={transport === "stdio" ? "npx -y @modelcontextprotocol/server-filesystem C:/docs" : "https://mcp.example.com/mcp"} className={`${input} font-mono text-[12px]`} />
          </Field>
        </div>
        {transport === "stdio" && (
          <div className="mt-3">
            <Field label="Environment variables (optional)" hint="One per line: KEY=value">
              <textarea value={env} onChange={(e) => setEnv(e.target.value)} rows={2} className={`${input} resize-none font-mono text-[12px]`} />
            </Field>
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <button onClick={() => void add()} disabled={busy || !name.trim() || !target.trim()} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:opacity-90 disabled:opacity-40">
            <Plus size={14} /> {busy ? "Adding…" : "Add server"}
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
      showToast("Saved CLAUDE.md", "success");
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  if (error) return <p className="text-[13px] text-danger">{error}</p>;
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2 text-[12px] text-faint">
        <code className="min-w-0 flex-1 truncate">{path}</code>
        {!exists && <span className="shrink-0">Doesn't exist yet — saving creates it</span>}
        {exists && (
          <button onClick={() => void ipc.openInEditor(path)} className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover hover:text-fg">
            <ExternalLink size={11} /> VS Code
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
        placeholder={"# Project notes for Claude\n\n- How to run and test\n- Code style rules\n- Things to avoid"}
        className="scroll-thin min-h-[380px] flex-1 resize-none rounded-md border border-line bg-bg p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-accent"
      />
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-faint">{text !== saved ? "Unsaved changes" : "Claude reads this at the start of every session."}</span>
        <button onClick={() => void save()} disabled={text === saved} className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:opacity-90 disabled:opacity-40">
          Save (Ctrl+S)
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
        <h1 className="text-[18px] font-semibold text-fg">{info.label}</h1>
        <p className="mt-0.5 text-muted">{info.hint}. These are the same files Claude Code uses; changes apply to new Claude sessions.</p>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border border-line p-0.5">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              title={s.hint}
              onClick={() => setScope(s.id)}
              className={`rounded px-3 py-1 text-[12px] ${scope === s.id ? "bg-hover text-fg" : "text-muted hover:text-fg"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-faint">
          {scope !== "user" && cwd ? `${folderName(cwd)} · ` : ""}
          {SCOPES.find((s) => s.id === scope)?.hint}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        {needsProject ? (
          <p className="text-[13px] text-faint">Open a tab in a project first to edit its settings.</p>
        ) : section === "mcp" ? (
          <Mcp cwd={cwd} scope={scope} />
        ) : section === "memory" ? (
          <Memory cwd={cwd} scope={scope} />
        ) : error ? (
          <p className="text-[13px] text-danger">{error}</p>
        ) : !file ? (
          <p className="text-[13px] text-faint">Loading…</p>
        ) : (
          <>
            <p className="mb-4 truncate text-[12px] text-faint">
              <code>{file.path}</code> {!file.exists && "· created when you make a change"}
            </p>
            {section === "permissions" ? <Permissions file={file} save={save("permissions")} /> : <Hooks file={file} save={save("hooks")} />}
          </>
        )}
      </div>
    </div>
  );
}
