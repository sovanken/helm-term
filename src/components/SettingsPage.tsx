import { type ReactNode, useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { ask, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { Bell, Bot, Download, FolderOpen, Info, Keyboard, Palette, RotateCcw, Search, Settings2, ShieldCheck, Sparkles, SquareTerminal, Upload, Wrench, X } from "lucide-react";
import { CHANGELOG } from "../lib/changelog";
import { ipc } from "../lib/ipc";
import { useShells } from "../lib/shells";
import { SHORTCUTS } from "../lib/shortcuts";
import {
  ACCENTS,
  accentColor,
  DEFAULT_FONT,
  fontStack,
  resolveTheme,
  terminalTheme,
  TERMINAL_FONT_CHOICES,
  TERMINAL_SCHEMES,
  type ThemeMode,
  UI_FONTS,
  uiFontStack,
} from "../lib/themes";
import { checkForUpdate } from "../lib/updater";
import { DEFAULT_SETTINGS, type Settings, type SettingsSection, showToast, useStore } from "../state/store";
import { windowsBuildNumber } from "../terminal/terminals";
import { CLAUDE_SECTIONS, ClaudeSection, type ClaudeSectionId } from "./ClaudeSettings";
import { HelmMark } from "./Welcome";

/** Nav entries with extra words the search box matches on. */
const HELM_SECTIONS: { id: SettingsSection; label: string; icon: ReactNode; keywords: string }[] = [
  { id: "general", label: "General", icon: <Settings2 size={15} />, keywords: "startup start windows login folder shell powershell bash restore reopen tabs confirm close" },
  { id: "appearance", label: "Appearance", icon: <Palette size={15} />, keywords: "theme dark light accent color colour font size zoom scale scheme cursor line height mica transparency" },
  { id: "terminal", label: "Terminal", icon: <SquareTerminal size={15} />, keywords: "scrollback history copy select right click paste bell sound gpu webgl rendering" },
  { id: "notifications", label: "Notifications", icon: <Bell size={15} />, keywords: "notify alert toast sound finished approval usage limit" },
  { id: "claude-in-helm", label: "Claude in Helm", icon: <Bot size={15} />, keywords: "approvals permission usage limits status line windows hints" },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: <Keyboard size={15} />, keywords: "keys hotkeys keybindings" },
  { id: "privacy", label: "Privacy", icon: <ShieldCheck size={15} />, keywords: "data telemetry tracking analytics network clear delete screenshots" },
  { id: "advanced", label: "Advanced", icon: <Wrench size={15} />, keywords: "arguments args environment variables data folder export import backup reset" },
  { id: "whats-new", label: "What's new", icon: <Sparkles size={15} />, keywords: "changelog release notes new features version" },
  { id: "about", label: "About & updates", icon: <Info size={15} />, keywords: "version update github license" },
];

const CLAUDE_KEYWORDS: Record<string, string> = {
  permissions: "allow deny ask rules mode",
  hooks: "events commands automation",
  mcp: "servers tools plugins",
  memory: "claude.md instructions notes",
};

// ---------- building blocks ----------

function Row({ label, hint, children, disabled }: { label: string; hint?: ReactNode; children: ReactNode; disabled?: boolean }) {
  return (
    <div className={`flex items-center gap-6 border-b border-line py-3.5 last:border-b-0 ${disabled ? "opacity-50" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-fg">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-relaxed text-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      {title && <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">{title}</h2>}
      <div className="rounded-xl border border-line bg-raised px-4">{children}</div>
    </section>
  );
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed ${checked ? "bg-accent" : "border border-line bg-hover"}`}
    >
      <span className={`absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-all duration-200 ${checked ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-lg border border-line bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-3 py-1 text-[12px] ${value === o.id ? "bg-raised font-medium text-fg shadow-sm" : "text-muted hover:text-fg"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Select({ value, onChange, children, className = "w-52" }: { value: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent ${className}`}>
      {children}
    </select>
  );
}

function Slider({ value, min, max, step, onChange, format }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-40 accent-[var(--accent)]"
      />
      <span className="w-12 text-right text-[12px] text-muted tabular-nums">{format(value)}</span>
    </div>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onChange(Math.max(min, value - 1))} className="size-7 rounded-md border border-line hover:bg-hover">
        −
      </button>
      <span className="w-9 text-center tabular-nums">{value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} className="size-7 rounded-md border border-line hover:bg-hover">
        +
      </button>
    </div>
  );
}

function Button({ children, onClick, tone = "normal" }: { children: ReactNode; onClick: () => void; tone?: "normal" | "danger" | "primary" }) {
  const cls =
    tone === "primary"
      ? "bg-accent text-on-accent hover:opacity-90"
      : tone === "danger"
        ? "border border-line text-danger hover:bg-hover"
        : "border border-line text-fg hover:bg-hover";
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium ${cls}`}>
      {children}
    </button>
  );
}

function Heading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-[20px] font-semibold tracking-tight text-fg">{title}</h1>
      <p className="mt-1 text-muted">{hint}</p>
    </div>
  );
}

function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useStore((s) => s.settings);
  return [settings, useStore.getState().updateSettings];
}

// ---------- sections ----------

function General() {
  const [s, update] = useSettings();
  const shells = useShells();
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => void autostartEnabled().then(setAutostart).catch(() => setAutostart(false)), []);
  const custom = s.startFolder !== "home" && s.startFolder !== "last";

  return (
    <>
      <Heading title="General" hint="How Helm starts and opens new tabs." />
      <Card title="Startup">
        <Row label="Start Helm when you sign in to Windows" hint="Opens Helm in the background when your PC starts.">
          <Toggle
            label="Start with Windows"
            checked={!!autostart}
            disabled={autostart === null}
            onChange={async (v) => {
              try {
                if (v) await enableAutostart();
                else await disableAutostart();
                setAutostart(await autostartEnabled());
              } catch (e) {
                showToast(`Couldn't change that: ${String(e)}`, "error");
              }
            }}
          />
        </Row>
        <Row label="Reopen tabs on start" hint="Claude tabs continue the same conversation.">
          <Toggle label="Reopen tabs" checked={s.restoreTabs} onChange={(v) => update({ restoreTabs: v })} />
        </Row>
      </Card>
      <Card title="New tabs">
        <Row label="Shell" hint="You can also pick a shell per tab from the + menu.">
          <Select value={s.shell} onChange={(v) => update({ shell: v })}>
            {shells.map((sh) => (
              <option key={sh.id} value={sh.id}>
                {sh.label}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Starting folder" hint={custom ? s.startFolder : "Used when no tab is open. New tabs otherwise open in the current tab's folder."}>
          <div className="flex items-center gap-2">
            <Select value={custom ? "custom" : s.startFolder} onChange={async (v) => {
              if (v !== "custom") return update({ startFolder: v });
              const dir = await openDialog({ directory: true, title: "Choose the starting folder" });
              if (typeof dir === "string") update({ startFolder: dir });
            }} className="w-44">
              <option value="home">Home folder</option>
              <option value="last">Last used folder</option>
              <option value="custom">Choose a folder…</option>
            </Select>
          </div>
        </Row>
      </Card>
      <Card title="Closing">
        <Row label="Ask before closing while Claude is working" hint="Applies to closing a tab, a pane or the window.">
          <Toggle label="Confirm close" checked={s.confirmClose} onChange={(v) => update({ confirmClose: v })} />
        </Row>
      </Card>
    </>
  );
}

function TerminalPreview({ s }: { s: Settings }) {
  const mode = resolveTheme(s.theme);
  const t = terminalTheme(s.terminalScheme, mode, s.accent);
  const line = (parts: [string, string | undefined][]) => (
    <div>
      {parts.map(([text, color], i) => (
        <span key={i} style={{ color: color ?? (t.foreground as string) }}>
          {text}
        </span>
      ))}
    </div>
  );
  const cursor = s.cursorStyle === "block" ? "▉" : s.cursorStyle === "underline" ? "▁" : "▏";
  return (
    <div
      className="mb-5 overflow-hidden rounded-xl border border-line px-4 py-3"
      style={{ background: t.background as string, fontFamily: fontStack(s.fontFamily), fontSize: s.fontSize, lineHeight: s.lineHeight }}
    >
      {line([["PS C:\\projects\\helm> ", t.blue as string], ["claude", t.yellow as string]])}
      {line([["✻ ", t.magenta as string], ["Reviewing src/app.ts", undefined]])}
      {line([["  + ", t.green as string], ["const total = items.reduce((a, b) => a + b, 0);", t.green as string]])}
      {line([["  − ", t.red as string], ["let total = 0; for (const i of items) total += i;", t.red as string]])}
      {line([["  ✓ ", t.cyan as string], ["12 tests passed · 0 failed ", undefined], ["→ =>  != ≠ ", t.brightBlack as string]])}
      {line([["> ", t.foreground as string], [cursor, (t.cursor as string) ?? accentColor(s.accent, mode)]])}
    </div>
  );
}

function Appearance() {
  const [s, update] = useSettings();
  const mode = resolveTheme(s.theme);
  const micaSupported = windowsBuildNumber() >= 22000;
  const customFont = !TERMINAL_FONT_CHOICES.includes(s.fontFamily);
  const [fontDraft, setFontDraft] = useState(customFont ? s.fontFamily : "");

  return (
    <>
      <Heading title="Appearance" hint="Make Helm and your terminals look the way you like. Changes show right away." />
      <Card title="App">
        <Row label="Theme" hint="System follows your Windows setting.">
          <Segmented<ThemeMode> value={s.theme} onChange={(v) => update({ theme: v })} options={[{ id: "dark", label: "Dark" }, { id: "light", label: "Light" }, { id: "system", label: "System" }]} />
        </Row>
        <Row label="Accent color" hint="Used for buttons, highlights, the cursor and selection.">
          <div className="flex gap-2">
            {Object.entries(ACCENTS).map(([id, a]) => (
              <button
                key={id}
                title={a.label}
                aria-label={a.label}
                onClick={() => update({ accent: id as Settings["accent"] })}
                className={`size-6 rounded-full transition-transform hover:scale-110 ${s.accent === id ? "ring-2 ring-fg ring-offset-2 ring-offset-[var(--raised)]" : ""}`}
                style={{ background: a[mode] }}
              />
            ))}
          </div>
        </Row>
        <Row label="Interface font">
          <Select value={s.uiFont} onChange={(v) => update({ uiFont: v as Settings["uiFont"] })} className="w-48">
            {Object.entries(UI_FONTS).map(([id, f]) => (
              <option key={id} value={id} style={{ fontFamily: uiFontStack(id) }}>
                {f.label}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Interface size" hint="Ctrl + mouse wheel outside a terminal also changes this.">
          <Slider value={s.uiScale} min={0.8} max={1.5} step={0.05} onChange={(v) => update({ uiScale: Math.round(v * 100) / 100 })} format={(v) => `${Math.round(v * 100)}%`} />
        </Row>
        <Row label="See-through window (Mica)" hint={micaSupported ? "Lets your desktop color tint the sidebar and title bar, like Windows 11 apps." : "Needs Windows 11."} disabled={!micaSupported}>
          <Toggle label="Mica" checked={s.mica && micaSupported} disabled={!micaSupported} onChange={(v) => update({ mica: v })} />
        </Row>
      </Card>

      <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">Terminal colors</h2>
      <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {[{ id: "helm", label: "Helm (matches theme)", theme: terminalTheme("helm", mode, s.accent) }, ...TERMINAL_SCHEMES].map((sc) => (
          <button
            key={sc.id}
            onClick={() => update({ terminalScheme: sc.id })}
            className={`overflow-hidden rounded-lg border text-left transition-transform hover:-translate-y-0.5 ${s.terminalScheme === sc.id ? "border-accent ring-1 ring-accent" : "border-line"}`}
          >
            <div className="flex h-12 items-end gap-1 px-2.5 pb-2" style={{ background: sc.theme.background as string }}>
              {(["red", "green", "yellow", "blue", "magenta", "cyan"] as const).map((c) => (
                <span key={c} className="size-2.5 rounded-full" style={{ background: sc.theme[c] as string }} />
              ))}
              <span className="ml-auto text-[11px]" style={{ color: sc.theme.foreground as string, fontFamily: fontStack(s.fontFamily) }}>
                Aa
              </span>
            </div>
            <div className="truncate bg-raised px-2.5 py-1.5 text-[12px] text-fg">{sc.label}</div>
          </button>
        ))}
      </div>

      <TerminalPreview s={s} />

      <Card title="Terminal text">
        <Row label="Font" hint="JetBrains Mono and Geist Mono come with Helm. Every language and emoji still renders.">
          <div className="flex items-center gap-2">
            <Select
              value={customFont ? "custom" : s.fontFamily}
              onChange={(v) => (v === "custom" ? update({ fontFamily: fontDraft || "Cascadia Code" }) : update({ fontFamily: v }))}
              className="w-44"
            >
              {TERMINAL_FONT_CHOICES.map((f) => (
                <option key={f} value={f}>
                  {f}
                  {f === DEFAULT_FONT ? " (default)" : ""}
                </option>
              ))}
              <option value="custom">Other installed font…</option>
            </Select>
            {customFont && (
              <input
                value={fontDraft}
                onChange={(e) => setFontDraft(e.target.value)}
                onBlur={() => update({ fontFamily: fontDraft.trim() || DEFAULT_FONT })}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                placeholder="Font name"
                className="w-40 rounded-lg border border-line bg-bg px-2.5 py-1.5 outline-none focus:border-accent"
              />
            )}
          </div>
        </Row>
        <Row label="Text size" hint="Ctrl + mouse wheel over a terminal, or Ctrl+= / Ctrl+-.">
          <Stepper value={s.fontSize} min={8} max={32} onChange={(v) => update({ fontSize: v })} />
        </Row>
        <Row label="Line height">
          <Slider value={s.lineHeight} min={1} max={1.6} step={0.05} onChange={(v) => update({ lineHeight: Math.round(v * 100) / 100 })} format={(v) => v.toFixed(2)} />
        </Row>
        <Row label="Cursor">
          <div className="flex items-center gap-4">
            <Segmented value={s.cursorStyle} onChange={(v) => update({ cursorStyle: v })} options={[{ id: "bar", label: "Bar" }, { id: "block", label: "Block" }, { id: "underline", label: "Underline" }]} />
            <label className="flex items-center gap-2 text-[12px] text-muted">
              <Toggle label="Blink" checked={s.cursorBlink} onChange={(v) => update({ cursorBlink: v })} /> Blink
            </label>
          </div>
        </Row>
      </Card>
    </>
  );
}

function Terminal() {
  const [s, update] = useSettings();
  return (
    <>
      <Heading title="Terminal" hint="How the terminal behaves. Applies to every tab right away." />
      <Card title="Text and clipboard">
        <Row label="Scrollback" hint="How many lines each tab keeps so you can scroll back.">
          <Select value={String(s.scrollback)} onChange={(v) => update({ scrollback: Number(v) })} className="w-36">
            {[1000, 5000, 10000, 50000, 100000].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()} lines
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Copy when you select text" hint="Selected text goes to the clipboard without pressing Ctrl+C.">
          <Toggle label="Copy on select" checked={s.copyOnSelect} onChange={(v) => update({ copyOnSelect: v })} />
        </Row>
        <Row label="Right-click">
          <Segmented value={s.rightClick} onChange={(v) => update({ rightClick: v })} options={[{ id: "smart", label: "Copy or paste" }, { id: "paste", label: "Always paste" }]} />
        </Row>
        <Row label="Warn before pasting several lines into a shell" hint="Each line would run as a command. Claude's prompt is never affected.">
          <Toggle label="Paste warning" checked={s.pasteWarning} onChange={(v) => update({ pasteWarning: v })} />
        </Row>
      </Card>
      <Card title="Bell and rendering">
        <Row label="Bell" hint="When a program rings the terminal bell.">
          <Segmented value={s.bell} onChange={(v) => update({ bell: v })} options={[{ id: "none", label: "Off" }, { id: "flash", label: "Flash" }, { id: "sound", label: "Sound" }]} />
        </Row>
        <Row label="GPU rendering" hint="Faster and smoother. Turn off only if text looks wrong on your PC.">
          <Toggle label="GPU rendering" checked={s.gpu} onChange={(v) => update({ gpu: v })} />
        </Row>
      </Card>
    </>
  );
}

function Notifications() {
  const [s, update] = useSettings();
  return (
    <>
      <Heading title="Notifications" hint="Windows notifications for tabs you're not looking at." />
      <Card>
        <Row label="Show notifications">
          <Toggle label="Notifications" checked={s.notifications} onChange={(v) => update({ notifications: v })} />
        </Row>
        <Row label="When Claude finishes" disabled={!s.notifications}>
          <Toggle label="Finished" checked={s.notifyFinished} disabled={!s.notifications} onChange={(v) => update({ notifyFinished: v })} />
        </Row>
        <Row label="When Claude needs approval" hint="With Allow / Deny buttons when approvals are answered in Helm." disabled={!s.notifications}>
          <Toggle label="Approval" checked={s.notifyApproval} disabled={!s.notifications} onChange={(v) => update({ notifyApproval: v })} />
        </Row>
        <Row label="Usage limit warnings" hint="At 80% and 95% of your 5-hour or weekly limit." disabled={!s.notifications}>
          <Toggle label="Usage" checked={s.notifyUsage} disabled={!s.notifications} onChange={(v) => update({ notifyUsage: v })} />
        </Row>
        <Row label="Play a sound" disabled={!s.notifications}>
          <Toggle label="Sound" checked={s.notifySound} disabled={!s.notifications} onChange={(v) => update({ notifySound: v })} />
        </Row>
      </Card>
      <Button onClick={() => void ipc.showToast("Helm notifications work", "This is how Helm tells you about tabs you're not looking at.", !s.notifySound)}>
        <Bell size={14} /> Send a test notification
      </Button>
    </>
  );
}

function ClaudeInHelm() {
  const [s, update] = useSettings();
  return (
    <>
      <Heading title="Claude in Helm" hint="How Helm works with the Claude sessions it starts. Changes apply to new Claude sessions." />
      <Card>
        <Row label="Answer approvals in Helm" hint="When a tab you're not looking at needs permission, ask in Helm and in a Windows notification with Allow / Deny. The tab you're looking at always asks in its terminal.">
          <Toggle label="Approvals in Helm" checked={s.approvals} onChange={(v) => update({ approvals: v })} />
        </Row>
        <Row label="Track usage limits" hint="Show your 5-hour and weekly limits, pace and warnings. Uses Claude's status line, so it's skipped if you set up your own status line.">
          <Toggle label="Usage limits" checked={s.usageCockpit} onChange={(v) => update({ usageCockpit: v })} />
        </Row>
        <Row label="Open background agents automatically" hint="When Claude starts a subagent or background command, open the right panel on Agents (only if it's closed).">
          <Toggle label="Auto-open agents" checked={s.autoOpenAgents} onChange={(v) => update({ autoOpenAgents: v })} />
        </Row>
        <Row label="Usage-saving hints" hint="A heads-up before a conversation's cache goes cold, a one-click /compact when context fills up, attach-as-file for huge pastes, and a nudge for big idle conversations.">
          <Toggle label="Usage hints" checked={s.usageTips} onChange={(v) => update({ usageTips: v })} />
        </Row>
        <Row label="Open web links in" hint="Links in the terminal and in Details, and dev servers you open. Helm's browser can test phone sizes and send errors, screenshots and page elements to Claude.">
          <Segmented<Settings["openLinksIn"]> value={s.openLinksIn} onChange={(v) => update({ openLinksIn: v })} options={[{ id: "helm", label: "Helm" }, { id: "browser", label: "My browser" }]} />
        </Row>
        <Row label="Offer to open dev servers" hint="When a terminal prints a local address such as localhost:5173, show a button to open it.">
          <Toggle label="Dev server prompt" checked={s.devServerPrompt} onChange={(v) => update({ devServerPrompt: v })} />
        </Row>
        <Row label="Windows hints for Claude" hint="Tell Claude it's on Windows and which shell syntax to use, so it stops mixing PowerShell and Bash commands.">
          <Toggle label="Windows hints" checked={s.windowsHints} onChange={(v) => update({ windowsHints: v })} />
        </Row>
      </Card>
    </>
  );
}

function Shortcuts() {
  const [filter, setFilter] = useState("");
  const list = SHORTCUTS.filter((s) => `${s.label} ${s.keys}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      <Heading title="Keyboard shortcuts" hint="Helm uses Ctrl+Shift and Alt+Shift so Claude Code keeps all of its own keys." />
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-raised px-3 focus-within:border-accent">
        <Search size={14} className="text-faint" />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a shortcut" className="flex-1 bg-transparent py-2 outline-none placeholder:text-faint" />
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-raised">
        {list.map((s) => (
          <div key={s.keys} className="flex items-center justify-between border-b border-line px-4 py-2.5 last:border-b-0">
            <span className="text-fg">{s.label}</span>
            <span className="flex gap-1">
              {s.keys.split(" / ").map((k) => (
                <kbd key={k} className="rounded-md border border-line bg-bg px-1.5 py-0.5 font-sans text-[11px] text-muted">
                  {k}
                </kbd>
              ))}
            </span>
          </div>
        ))}
        {list.length === 0 && <p className="p-4 text-center text-faint">No shortcut matches.</p>}
      </div>
    </>
  );
}

function Advanced() {
  const [s, update] = useSettings();
  const [args, setArgs] = useState(s.extraClaudeArgs);
  const [env, setEnv] = useState(s.extraEnv);

  const exportSettings = async () => {
    const path = await saveDialog({ title: "Export Helm settings", defaultPath: "helm-settings.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path) return;
    const st = useStore.getState();
    const data = { app: "helm", version: 1, settings: st.settings, prompts: st.prompts, pinned: st.pinned };
    await ipc.writeTextFile(path, JSON.stringify(data, null, 2)).then(() => showToast("Settings exported", "success"), (e) => showToast(String(e), "error"));
  };
  const importSettings = async () => {
    const path = await openDialog({ title: "Import Helm settings", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    try {
      const data = JSON.parse(await ipc.readTextFile(path));
      if (data?.app !== "helm" || typeof data.settings !== "object") throw new Error("This isn't a Helm settings file");
      const st = useStore.getState();
      st.set({
        settings: { ...DEFAULT_SETTINGS, ...data.settings },
        ...(Array.isArray(data.prompts) ? { prompts: data.prompts } : {}),
        ...(Array.isArray(data.pinned) ? { pinned: data.pinned } : {}),
      });
      showToast("Settings imported", "success");
    } catch (e) {
      showToast(String(e), "error");
    }
  };
  const reset = async () => {
    const ok = await ask("Reset every Helm setting to its default? Your tabs, saved prompts and pinned projects stay.", { title: "Reset settings", kind: "warning", okLabel: "Reset", cancelLabel: "Cancel" });
    if (!ok) return;
    useStore.getState().set({ settings: { ...DEFAULT_SETTINGS } });
    showToast("Settings reset to defaults", "success");
  };

  return (
    <>
      <Heading title="Advanced" hint="For power users. Applies to tabs you open from now on." />
      <Card title="Claude">
        <div className="py-3.5">
          <div className="text-[13px] text-fg">Extra options when Helm starts Claude</div>
          <div className="mt-0.5 mb-2 text-[12px] text-faint">Added after Helm's own options, exactly as typed, e.g. <code className="text-muted">--model sonnet</code> or <code className="text-muted">--add-dir ../shared</code>.</div>
          <input
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            onBlur={() => update({ extraClaudeArgs: args })}
            placeholder="--model sonnet"
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[12px] outline-none focus:border-accent"
          />
        </div>
      </Card>
      <Card title="Environment">
        <div className="py-3.5">
          <div className="text-[13px] text-fg">Environment variables for new tabs</div>
          <div className="mt-0.5 mb-2 text-[12px] text-faint">One per line: <code className="text-muted">NAME=value</code>. Available to the shell and Claude.</div>
          <textarea
            value={env}
            onChange={(e) => setEnv(e.target.value)}
            onBlur={() => update({ extraEnv: env })}
            rows={4}
            placeholder={"NODE_ENV=development\nHTTPS_PROXY=http://proxy:8080"}
            className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[12px] outline-none focus:border-accent"
          />
        </div>
      </Card>
      <Card title="Data">
        <Row label="Settings backup" hint="Settings, saved prompts and pinned projects in one file.">
          <div className="flex gap-2">
            <Button onClick={() => void exportSettings()}>
              <Download size={14} /> Export
            </Button>
            <Button onClick={() => void importSettings()}>
              <Upload size={14} /> Import
            </Button>
          </div>
        </Row>
        <Row label="Helm's data folder" hint="Settings, hook files and pasted screenshots.">
          <Button onClick={() => void ipc.dataDirPath().then((p) => openPath(p))}>
            <FolderOpen size={14} /> Open
          </Button>
        </Row>
        <Row label="Reset settings" hint="Back to defaults. Tabs, prompts and pinned projects are kept.">
          <Button tone="danger" onClick={() => void reset()}>
            <RotateCcw size={14} /> Reset
          </Button>
        </Row>
      </Card>
    </>
  );
}

function WhatsNew() {
  const [version, setVersion] = useState("");
  useEffect(() => void getVersion().then(setVersion), []);
  return (
    <>
      <Heading title="What's new" hint="Recent changes in Helm." />
      <div className="relative space-y-8 border-l border-line pl-6">
        {CHANGELOG.map((r) => (
          <section key={r.version} className="relative">
            <span className={`absolute top-1.5 -left-[29px] size-2.5 rounded-full ring-4 ring-[var(--surface)] ${r.version === version ? "bg-accent" : "bg-line"}`} />
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="text-[15px] font-semibold text-fg">Helm {r.version}</h2>
              <span className="text-[12px] text-faint">{r.date}</span>
              {r.version === version && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">Installed</span>}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {r.highlights.map((h) => (
                <div key={h.title} className="rounded-xl border border-line bg-raised p-3">
                  <div className="text-[13px] font-medium text-fg">{h.title}</div>
                  <div className="mt-1 text-[12px] leading-relaxed text-muted">{h.text}</div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function formatBytes(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

function Privacy() {
  const [s, update] = useSettings();
  const [shots, setShots] = useState<[number, number] | null>(null);
  const closed = useStore((st) => st.closedTabs.length);
  const refresh = () => void ipc.screenshotsInfo().then(setShots).catch(() => setShots([0, 0]));
  useEffect(refresh, []);

  const facts: [string, string][] = [
    ["Everything stays on this PC", "Your tabs, settings, saved prompts and terminal output never leave your computer. Helm has no account and no analytics or tracking."],
    ["One network request: updates", "Helm only goes online to check GitHub for a new version. You can turn that off below."],
    ["Claude's conversations", "Helm reads the conversation files Claude Code already keeps on your PC to show history, usage and cost. It never uploads them. Claude Code itself talks to Anthropic under Anthropic's own privacy policy."],
    ["Local status connection", "Claude tabs report their status to Helm over a private connection that only works on this PC and needs a secret key that changes every time Helm starts."],
  ];

  return (
    <>
      <Heading title="Privacy" hint="What Helm stores, where, and what you can clear." />
      <div className="mb-6 grid gap-2 sm:grid-cols-2">
        {facts.map(([title, text]) => (
          <div key={title} className="rounded-xl border border-line bg-raised p-3.5">
            <div className="text-[13px] font-medium text-fg">{title}</div>
            <div className="mt-1 text-[12px] leading-relaxed text-muted">{text}</div>
          </div>
        ))}
      </div>
      <Card title="Network">
        <Row label="Check for updates" hint="The only time Helm connects to the internet (github.com).">
          <Toggle label="Check for updates" checked={s.autoUpdate} onChange={(v) => update({ autoUpdate: v })} />
        </Row>
      </Card>
      <Card title="Your data">
        <Row label="Pasted screenshots" hint={shots ? `${shots[1]} ${shots[1] === 1 ? "image" : "images"} · ${formatBytes(shots[0])}. Deleted automatically after a week.` : "…"}>
          <Button
            onClick={async () => {
              const n = await ipc.clearScreenshots();
              showToast(`Deleted ${n} pasted ${n === 1 ? "screenshot" : "screenshots"}`, "success");
              refresh();
            }}
          >
            Delete now
          </Button>
        </Row>
        <Row label="Recently closed tabs" hint={`${closed} remembered so Ctrl+Alt+Shift+T can reopen them.`}>
          <Button onClick={() => { useStore.getState().set({ closedTabs: [] }); showToast("Forgot recently closed tabs", "success"); }}>Forget</Button>
        </Row>
        <Row label="Recent folder" hint="The last folder used, for the “Last used folder” starting option.">
          <Button onClick={() => { update({ lastFolder: undefined }); showToast("Forgot the last used folder", "success"); }}>Forget</Button>
        </Row>
        <Row label="Helm's data folder" hint="Where all of the above lives.">
          <Button onClick={() => void ipc.dataDirPath().then((p) => openPath(p))}>
            <FolderOpen size={14} /> Open
          </Button>
        </Row>
      </Card>
      <p className="text-[12px] text-faint">
        Helm is open source, so you can check all of this in the code at github.com/sovanken/helm-term.{" "}
        <button className="text-accent hover:underline" onClick={() => void openUrl("https://www.anthropic.com/legal/privacy")}>
          Anthropic's privacy policy
        </button>
      </p>
    </>
  );
}

function About() {
  const [s, update] = useSettings();
  const [version, setVersion] = useState("");
  const updateInfo = useStore((st) => st.update);
  useEffect(() => void getVersion().then(setVersion), []);
  return (
    <>
      <div className="mb-6 flex items-center gap-4 text-accent">
        <HelmMark size={48} />
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-fg">Helm {version}</h1>
          <p className="text-muted">A terminal made for Claude Code · free and open source (MIT)</p>
        </div>
      </div>
      <Card title="Updates">
        <Row label="Check for updates automatically" hint="Helm looks for a new version when it starts and every few hours.">
          <Toggle label="Automatic updates" checked={s.autoUpdate} onChange={(v) => update({ autoUpdate: v })} />
        </Row>
        <Row label={updateInfo ? `Version ${updateInfo.version} is ready` : "You're on the latest version"} hint={updateInfo ? "Installs and restarts Helm." : undefined}>
          {updateInfo ? (
            <Button tone="primary" onClick={() => void updateInfo.install()}>
              Update and restart
            </Button>
          ) : (
            <Button onClick={() => void checkForUpdate(true)}>Check now</Button>
          )}
        </Row>
      </Card>
      <Card title="Project">
        <Row label="Source code and issues" hint="github.com/sovanken/helm-term">
          <Button onClick={() => void openUrl("https://github.com/sovanken/helm-term")}>Open GitHub</Button>
        </Row>
        <Row label="Open-source notices" hint="Helm is built with Tauri, React, xterm.js, Inter, Geist and JetBrains Mono (OFL), and other open-source projects.">
          <Button onClick={() => void openUrl("https://github.com/sovanken/helm-term#license")}>View</Button>
        </Row>
      </Card>
      <p className="mt-2 text-[12px] text-faint">Helm is an independent community project and is not affiliated with Anthropic.</p>
    </>
  );
}

// ---------- page ----------

export function SettingsPage() {
  const section = useStore((s) => s.settingsSection);
  const set = useStore.getState().set;
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const helm = useMemo(() => HELM_SECTIONS.filter((s) => !q || `${s.label} ${s.keywords}`.toLowerCase().includes(q)), [q]);
  const claude = useMemo(() => CLAUDE_SECTIONS.filter((s) => !q || `${s.label} ${s.hint} ${CLAUDE_KEYWORDS[s.id] ?? ""}`.toLowerCase().includes(q)), [q]);
  // Jump to the first match while searching.
  useEffect(() => {
    if (!q) return;
    const first = helm[0]?.id ?? claude[0]?.id;
    if (first && first !== section) set({ settingsSection: first as SettingsSection });
  }, [q]);

  const navItem = (id: SettingsSection, label: string, icon: ReactNode) => (
    <button
      key={id}
      onClick={() => set({ settingsSection: id })}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] ${section === id ? "bg-hover font-medium text-fg" : "text-muted hover:bg-hover hover:text-fg"}`}
    >
      <span className={section === id ? "text-accent" : ""}>{icon}</span>
      {label}
    </button>
  );
  const isClaude = CLAUDE_SECTIONS.some((s) => s.id === section);

  return (
    <div className="flex h-full">
      <nav className="scroll-thin flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-bg p-3">
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 focus-within:border-accent">
          <Search size={13} className="shrink-0 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Search settings"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] outline-none placeholder:text-faint"
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery("")} className="text-faint hover:text-fg">
              <X size={12} />
            </button>
          )}
        </div>
        {helm.length > 0 && <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">Helm</div>}
        {helm.map((s) => navItem(s.id, s.label, s.icon))}
        {claude.length > 0 && <div className="px-2.5 pt-4 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">Claude Code</div>}
        {claude.map((s) => navItem(s.id, s.label, s.icon))}
        {helm.length === 0 && claude.length === 0 && <p className="px-2.5 py-3 text-[12px] text-faint">No settings match “{query}”.</p>}
      </nav>
      <div className="scroll-thin min-w-0 flex-1 overflow-y-auto">
        <div key={section} className="anim-fade mx-auto flex min-h-full max-w-3xl flex-col px-10 py-8">
          {section === "general" && <General />}
          {section === "appearance" && <Appearance />}
          {section === "terminal" && <Terminal />}
          {section === "notifications" && <Notifications />}
          {section === "claude-in-helm" && <ClaudeInHelm />}
          {section === "shortcuts" && <Shortcuts />}
          {section === "advanced" && <Advanced />}
          {section === "privacy" && <Privacy />}
          {section === "whats-new" && <WhatsNew />}
          {section === "about" && <About />}
          {isClaude && <ClaudeSection key={section} section={section as ClaudeSectionId} />}
        </div>
      </div>
    </div>
  );
}
