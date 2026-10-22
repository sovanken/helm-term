import { type ReactNode, useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { ask, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { Bell, Bot, FileJson, Download, FolderOpen, Info, Keyboard, Palette, RotateCcw, Search, Settings2, ShieldCheck, Sparkles, SquareTerminal, Upload, Wrench, X } from "lucide-react";
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
import { openSettingsJson } from "../lib/settingsJson";
import { LANGUAGES, locale, resolveLanguage } from "../i18n";
import { Trans, useTranslation } from "react-i18next";
import { InstallProgress, LevelBars, useVoiceInstall } from "./Voice";
import { isMicTesting, startMicTest, stopVoice, useVoice } from "../lib/voice";

/** Nav entries with extra words the search box matches on. `label` is a translation key. */
const HELM_SECTIONS: { id: SettingsSection; label: string; icon: ReactNode; keywords: string }[] = [
  { id: "general", label: "settings.nav.general", icon: <Settings2 size={15} />, keywords: "startup start windows login folder shell powershell bash restore reopen tabs confirm close voice microphone mic speech dictation talk" },
  { id: "appearance", label: "settings.nav.appearance", icon: <Palette size={15} />, keywords: "theme dark light accent color colour font size zoom scale scheme cursor line height mica transparency" },
  { id: "terminal", label: "settings.nav.terminal", icon: <SquareTerminal size={15} />, keywords: "scrollback history copy select right click paste bell sound gpu webgl rendering" },
  { id: "notifications", label: "settings.nav.notifications", icon: <Bell size={15} />, keywords: "notify alert toast sound finished approval usage limit" },
  { id: "claude-in-helm", label: "settings.nav.claudeInHelm", icon: <Bot size={15} />, keywords: "approvals permission usage limits status line windows hints" },
  { id: "shortcuts", label: "settings.nav.shortcuts", icon: <Keyboard size={15} />, keywords: "keys hotkeys keybindings" },
  { id: "privacy", label: "settings.nav.privacy", icon: <ShieldCheck size={15} />, keywords: "data telemetry tracking analytics network clear delete screenshots" },
  { id: "advanced", label: "settings.nav.advanced", icon: <Wrench size={15} />, keywords: "arguments args environment variables data folder export import backup reset" },
  { id: "whats-new", label: "settings.nav.whatsNew", icon: <Sparkles size={15} />, keywords: "changelog release notes new features version" },
  { id: "about", label: "settings.nav.about", icon: <Info size={15} />, keywords: "version update github license" },
];

const CLAUDE_KEYWORDS: Record<string, string> = {
  permissions: "allow deny ask rules mode",
  hooks: "events commands automation",
  mcp: "servers tools plugins",
  memory: "claude.md instructions notes",
};

// ---------- building blocks ----------

function Row({ label, hint, children, disabled, k }: { label: string; hint?: ReactNode; children: ReactNode; disabled?: boolean; k?: keyof Settings }) {
  const value = useStore((s) => (k ? s.settings[k] : undefined));
  const modified = !!k && JSON.stringify(value) !== JSON.stringify(DEFAULT_SETTINGS[k]);
  const { t } = useTranslation();
  return (
    <div className={`group/row relative flex items-center gap-6 border-b border-line py-3.5 last:border-b-0 ${disabled ? "opacity-50" : ""}`}>
      {modified && <span className="absolute top-1/2 -left-2.5 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" title={t("settings.row.changed")} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px] text-fg">
          {label}
          {modified && (
            <button
              aria-label={t("settings.row.resetLabel", { label })}
              title={t("settings.row.resetTitle", { value: JSON.stringify(DEFAULT_SETTINGS[k!]) })}
              onClick={() => useStore.getState().updateSettings({ [k!]: DEFAULT_SETTINGS[k!] } as Partial<Settings>)}
              className="flex size-5 items-center justify-center rounded text-faint opacity-0 group-hover/row:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100"
            >
              <RotateCcw size={11} />
            </button>
          )}
        </div>
        {hint && <div className="mt-0.5 text-[12px] leading-relaxed text-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Records a key combo like "Ctrl+Alt+S" (needs at least one of Ctrl / Alt plus a key). */
function ShortcutBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(e) => {
          if (!recording) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.key === "Escape") return setRecording(false);
          if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
          if (!e.ctrlKey && !e.altKey) return;
          const key = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : /^F\d+$/.test(e.code) ? e.code : null;
          if (!key) return;
          onChange([e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", key].filter(Boolean).join("+"));
          setRecording(false);
        }}
        className={`h-8 min-w-36 rounded-md border px-2.5 text-[12.5px] ${recording ? "border-accent text-accent" : "border-line text-fg hover:bg-hover"}`}
      >
        {recording ? t("settings.shortcutBox.recording") : value || t("common.off")}
      </button>
      {value && (
        <button onClick={() => onChange("")} className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg">
          {t("settings.shortcutBox.turnOff")}
        </button>
      )}
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
  const { t } = useTranslation();

  return (
    <>
      <Heading title={t("settings.nav.general")} hint={t("settings.general.hint")} />
      <Card title={t("settings.general.startup")}>
        <Row label={t("settings.general.autostart.label")} hint={t("settings.general.autostart.hint")}>
          <Toggle
            label={t("settings.general.autostart.toggle")}
            checked={!!autostart}
            disabled={autostart === null}
            onChange={async (v) => {
              try {
                if (v) await enableAutostart();
                else await disableAutostart();
                setAutostart(await autostartEnabled());
              } catch (e) {
                showToast(t("settings.general.autostart.failed", { error: String(e) }), "error");
              }
            }}
          />
        </Row>
        <Row k="restoreTabs" label={t("settings.general.restoreTabs.label")} hint={t("settings.general.restoreTabs.hint")}>
          <Toggle label={t("settings.general.restoreTabs.toggle")} checked={s.restoreTabs} onChange={(v) => update({ restoreTabs: v })} />
        </Row>
      </Card>
      <Card title={t("settings.general.newTabs")}>
        <Row k="shell" label={t("settings.general.shell.label")} hint={t("settings.general.shell.hint")}>
          <Select value={s.shell} onChange={(v) => update({ shell: v })}>
            {shells.map((sh) => (
              <option key={sh.id} value={sh.id}>
                {sh.label}
              </option>
            ))}
          </Select>
        </Row>
        <Row k="startFolder" label={t("settings.general.startFolder.label")} hint={custom ? s.startFolder : t("settings.general.startFolder.hint")}>
          <div className="flex items-center gap-2">
            <Select value={custom ? "custom" : s.startFolder} onChange={async (v) => {
              if (v !== "custom") return update({ startFolder: v });
              const dir = await openDialog({ directory: true, title: t("settings.general.startFolder.dialogTitle") });
              if (typeof dir === "string") update({ startFolder: dir });
            }} className="w-44">
              <option value="home">{t("settings.general.startFolder.home")}</option>
              <option value="last">{t("settings.general.startFolder.last")}</option>
              <option value="custom">{t("settings.general.startFolder.custom")}</option>
            </Select>
          </div>
        </Row>
      </Card>
      <Card title={t("settings.general.closing")}>
        <Row k="confirmClose" label={t("settings.general.confirmClose.label")} hint={t("settings.general.confirmClose.hint")}>
          <Toggle label={t("settings.general.confirmClose.toggle")} checked={s.confirmClose} onChange={(v) => update({ confirmClose: v })} />
        </Row>
      </Card>
      <VoiceCard />
      <Card title={t("settings.general.screenshots")}>
        <Row k="snipShortcut" label={t("settings.general.snipShortcut.label")} hint={t("settings.general.snipShortcut.hint")}>
          <ShortcutBox value={s.snipShortcut} onChange={(v) => update({ snipShortcut: v })} />
        </Row>
        <Row k="snipAutoCopy" label={t("settings.general.snipAutoCopy.label")} hint={t("settings.general.snipAutoCopy.hint")}>
          <Toggle label={t("settings.general.snipAutoCopy.toggle")} checked={s.snipAutoCopy} onChange={(v) => update({ snipAutoCopy: v })} />
        </Row>
      </Card>
    </>
  );
}

const HOLD_KEYS = ["Ctrl+Space", "Ctrl+Shift+Space", "Alt+Shift+Space", "F8", "F9", "F10"];

function VoiceCard() {
  const [s, update] = useSettings();
  const { status, progress, start, refresh } = useVoiceInstall();
  const [mics, setMics] = useState<string[]>([]);
  const phase = useVoice((v) => v.phase);
  const level = useVoice((v) => v.level);
  const testing = phase !== "idle" && isMicTesting();
  useEffect(() => void ipc.voiceMics().then(setMics), []);
  // Leaving Settings ends a mic test.
  useEffect(() => () => void (isMicTesting() && stopVoice(false)), []);
  const busy = !!status?.installing || progress?.stage === "downloading" || progress?.stage === "unpacking";
  const { t } = useTranslation();

  return (
    <Card title={t("settings.voice.title")}>
      <Row
        label={t("settings.voice.speech.label")}
        hint={
          status?.installed
            ? t("settings.voice.speech.hintInstalled", { size: status.sizeMb })
            : t("settings.voice.speech.hintDownload", { size: status?.downloadMb ?? 460 })
        }
      >
        {status?.installed ? (
          <button
            onClick={async () => {
              if (await ask(t("settings.voice.removeConfirm.message"), { title: t("settings.voice.removeConfirm.title"), kind: "warning", okLabel: t("common.delete"), cancelLabel: t("common.cancel") })) {
                await ipc.voiceRemove().catch((e) => showToast(String(e), "error"));
                refresh();
              }
            }}
            className="rounded-md border border-line px-3 py-1.5 text-[12.5px] hover:bg-hover"
          >
            {t("common.remove")}
          </button>
        ) : busy ? (
          <button onClick={() => void ipc.voiceCancelInstall()} className="rounded-md border border-line px-3 py-1.5 text-[12.5px] hover:bg-hover">
            {t("common.cancel")}
          </button>
        ) : (
          <button onClick={start} disabled={!status} className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-on-accent hover:opacity-90 disabled:opacity-40">
            {t("settings.voice.download")}
          </button>
        )}
      </Row>
      {busy && progress && (
        <div className="border-b border-line pb-3.5">
          <InstallProgress progress={progress} />
        </div>
      )}
      {progress?.stage === "error" && <p className="border-b border-line py-2 text-[12px] text-danger">{progress.error}</p>}
      <Row k="voiceMic" label={t("settings.voice.mic.label")} hint={t("settings.voice.mic.hint")}>
        <div className="flex items-center gap-2">
          {testing && <LevelBars level={level} bars={7} className="text-accent" />}
          <Select value={s.voiceMic} onChange={(v) => update({ voiceMic: v })} className="w-56">
            <option value="">{t("settings.voice.mic.windowsDefault")}</option>
            {mics.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            {s.voiceMic && !mics.includes(s.voiceMic) && <option value={s.voiceMic}>{t("settings.voice.mic.notConnected", { name: s.voiceMic })}</option>}
          </Select>
          <button
            onClick={() => (testing ? stopVoice(false) : void startMicTest(s.voiceMic))}
            disabled={phase !== "idle" && !testing}
            className="rounded-md border border-line px-3 py-1.5 text-[12.5px] hover:bg-hover disabled:opacity-40"
          >
            {testing ? t("settings.voice.mic.stop") : t("settings.voice.mic.test")}
          </button>
        </div>
      </Row>
      <Row k="voiceHoldKey" label={t("settings.voice.holdKey.label")} hint={t("settings.voice.holdKey.hint")}>
        <Select value={s.voiceHoldKey} onChange={(v) => update({ voiceHoldKey: v })} className="w-44">
          <option value="">{t("common.off")}</option>
          {HOLD_KEYS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </Select>
      </Row>
      <Row k="voiceButton" label={t("settings.voice.button.label")} hint={t("settings.voice.button.hint")}>
        <Toggle label={t("settings.voice.button.toggle")} checked={s.voiceButton} onChange={(v) => update({ voiceButton: v })} />
      </Row>
    </Card>
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
  const autoLanguage = LANGUAGES.find((l) => l.code === resolveLanguage("auto"))?.name;
  const mode = resolveTheme(s.theme);
  const micaSupported = windowsBuildNumber() >= 22000;
  const customFont = !TERMINAL_FONT_CHOICES.includes(s.fontFamily);
  const [fontDraft, setFontDraft] = useState(customFont ? s.fontFamily : "");
  const { t } = useTranslation();

  return (
    <>
      <Heading title={t("settings.nav.appearance")} hint={t("settings.appearance.hint")} />
      <Card title={t("settings.appearance.app")}>
        <Row k="language" label={t("settings.appearance.language.label")} hint={t("settings.appearance.language.hint")}>
          <Select value={s.language} onChange={(v) => update({ language: v })} className="w-56">
            <option value="auto">{autoLanguage ? t("settings.appearance.language.autoNamed", { language: autoLanguage }) : t("settings.appearance.language.auto")}</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </Select>
        </Row>
        <Row k="theme" label={t("settings.appearance.theme.label")} hint={t("settings.appearance.theme.hint")}>
          <Segmented<ThemeMode> value={s.theme} onChange={(v) => update({ theme: v })} options={[{ id: "dark", label: t("settings.appearance.theme.dark") }, { id: "light", label: t("settings.appearance.theme.light") }, { id: "system", label: t("settings.appearance.theme.system") }]} />
        </Row>
        <Row k="accent" label={t("settings.appearance.accent.label")} hint={t("settings.appearance.accent.hint")}>
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
        <Row k="uiFont" label={t("settings.appearance.uiFont.label")}>
          <Select value={s.uiFont} onChange={(v) => update({ uiFont: v as Settings["uiFont"] })} className="w-48">
            {Object.entries(UI_FONTS).map(([id, f]) => (
              <option key={id} value={id} style={{ fontFamily: uiFontStack(id) }}>
                {f.label}
              </option>
            ))}
          </Select>
        </Row>
        <Row k="uiScale" label={t("settings.appearance.uiScale.label")} hint={t("settings.appearance.uiScale.hint")}>
          <Slider value={s.uiScale} min={0.8} max={1.5} step={0.05} onChange={(v) => update({ uiScale: Math.round(v * 100) / 100 })} format={(v) => `${Math.round(v * 100)}%`} />
        </Row>
        <Row k="mica" label={t("settings.appearance.mica.label")} hint={micaSupported ? t("settings.appearance.mica.hint") : t("settings.appearance.mica.unsupported")} disabled={!micaSupported}>
          <Toggle label={t("settings.appearance.mica.toggle")} checked={s.mica && micaSupported} disabled={!micaSupported} onChange={(v) => update({ mica: v })} />
        </Row>
      </Card>

      <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">{t("settings.appearance.terminalColors")}</h2>
      <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {[{ id: "helm", label: t("settings.appearance.helmScheme"), theme: terminalTheme("helm", mode, s.accent) }, ...TERMINAL_SCHEMES].map((sc) => (
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

      <Card title={t("settings.appearance.terminalText")}>
        <Row k="fontFamily" label={t("settings.appearance.font.label")} hint={t("settings.appearance.font.hint")}>
          <div className="flex items-center gap-2">
            <Select
              value={customFont ? "custom" : s.fontFamily}
              onChange={(v) => (v === "custom" ? update({ fontFamily: fontDraft || "Cascadia Code" }) : update({ fontFamily: v }))}
              className="w-44"
            >
              {TERMINAL_FONT_CHOICES.map((f) => (
                <option key={f} value={f}>
                  {f === DEFAULT_FONT ? t("settings.appearance.font.defaultOption", { name: f }) : f}
                </option>
              ))}
              <option value="custom">{t("settings.appearance.font.other")}</option>
            </Select>
            {customFont && (
              <input
                value={fontDraft}
                onChange={(e) => setFontDraft(e.target.value)}
                onBlur={() => update({ fontFamily: fontDraft.trim() || DEFAULT_FONT })}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                placeholder={t("settings.appearance.font.placeholder")}
                className="w-40 rounded-lg border border-line bg-bg px-2.5 py-1.5 outline-none focus:border-accent"
              />
            )}
          </div>
        </Row>
        <Row k="fontSize" label={t("settings.appearance.fontSize.label")} hint={t("settings.appearance.fontSize.hint")}>
          <Stepper value={s.fontSize} min={8} max={32} onChange={(v) => update({ fontSize: v })} />
        </Row>
        <Row k="lineHeight" label={t("settings.appearance.lineHeight.label")}>
          <Slider value={s.lineHeight} min={1} max={1.6} step={0.05} onChange={(v) => update({ lineHeight: Math.round(v * 100) / 100 })} format={(v) => v.toFixed(2)} />
        </Row>
        <Row k="cursorStyle" label={t("settings.appearance.cursor.label")}>
          <div className="flex items-center gap-4">
            <Segmented value={s.cursorStyle} onChange={(v) => update({ cursorStyle: v })} options={[{ id: "bar", label: t("settings.appearance.cursor.bar") }, { id: "block", label: t("settings.appearance.cursor.block") }, { id: "underline", label: t("settings.appearance.cursor.underline") }]} />
            <label className="flex items-center gap-2 text-[12px] text-muted">
              <Toggle label={t("settings.appearance.cursor.blink")} checked={s.cursorBlink} onChange={(v) => update({ cursorBlink: v })} /> {t("settings.appearance.cursor.blink")}
            </label>
          </div>
        </Row>
      </Card>
    </>
  );
}

function Terminal() {
  const [s, update] = useSettings();
  const { t } = useTranslation();
  return (
    <>
      <Heading title={t("settings.nav.terminal")} hint={t("settings.terminal.hint")} />
      <Card title={t("settings.terminal.textAndClipboard")}>
        <Row k="scrollback" label={t("settings.terminal.scrollback.label")} hint={t("settings.terminal.scrollback.hint")}>
          <Select value={String(s.scrollback)} onChange={(v) => update({ scrollback: Number(v) })} className="w-36">
            {[1000, 5000, 10000, 50000, 100000].map((n) => (
              <option key={n} value={n}>
                {t("settings.terminal.scrollback.lines", { count: n, lines: n.toLocaleString(locale()) })}
              </option>
            ))}
          </Select>
        </Row>
        <Row k="copyOnSelect" label={t("settings.terminal.copyOnSelect.label")} hint={t("settings.terminal.copyOnSelect.hint")}>
          <Toggle label={t("settings.terminal.copyOnSelect.toggle")} checked={s.copyOnSelect} onChange={(v) => update({ copyOnSelect: v })} />
        </Row>
        <Row k="rightClick" label={t("settings.terminal.rightClick.label")}>
          <Segmented value={s.rightClick} onChange={(v) => update({ rightClick: v })} options={[{ id: "smart", label: t("settings.terminal.rightClick.smart") }, { id: "paste", label: t("settings.terminal.rightClick.paste") }]} />
        </Row>
        <Row k="pasteWarning" label={t("settings.terminal.pasteWarning.label")} hint={t("settings.terminal.pasteWarning.hint")}>
          <Toggle label={t("settings.terminal.pasteWarning.toggle")} checked={s.pasteWarning} onChange={(v) => update({ pasteWarning: v })} />
        </Row>
      </Card>
      <Card title={t("settings.terminal.bellAndRendering")}>
        <Row k="bell" label={t("settings.terminal.bell.label")} hint={t("settings.terminal.bell.hint")}>
          <Segmented value={s.bell} onChange={(v) => update({ bell: v })} options={[{ id: "none", label: t("common.off") }, { id: "flash", label: t("settings.terminal.bell.flash") }, { id: "sound", label: t("settings.terminal.bell.sound") }]} />
        </Row>
        <Row k="gpu" label={t("settings.terminal.gpu.label")} hint={t("settings.terminal.gpu.hint")}>
          <Toggle label={t("settings.terminal.gpu.label")} checked={s.gpu} onChange={(v) => update({ gpu: v })} />
        </Row>
      </Card>
    </>
  );
}

function Notifications() {
  const [s, update] = useSettings();
  const { t } = useTranslation();
  return (
    <>
      <Heading title={t("settings.nav.notifications")} hint={t("settings.notifications.hint")} />
      <Card>
        <Row k="notifications" label={t("settings.notifications.show.label")}>
          <Toggle label={t("settings.nav.notifications")} checked={s.notifications} onChange={(v) => update({ notifications: v })} />
        </Row>
        <Row k="notifyFinished" label={t("settings.notifications.finished.label")} disabled={!s.notifications}>
          <Toggle label={t("settings.notifications.finished.toggle")} checked={s.notifyFinished} disabled={!s.notifications} onChange={(v) => update({ notifyFinished: v })} />
        </Row>
        <Row k="notifyApproval" label={t("settings.notifications.approval.label")} hint={t("settings.notifications.approval.hint")} disabled={!s.notifications}>
          <Toggle label={t("settings.notifications.approval.toggle")} checked={s.notifyApproval} disabled={!s.notifications} onChange={(v) => update({ notifyApproval: v })} />
        </Row>
        <Row k="notifyUsage" label={t("settings.notifications.usage.label")} hint={t("settings.notifications.usage.hint")} disabled={!s.notifications}>
          <Toggle label={t("settings.notifications.usage.toggle")} checked={s.notifyUsage} disabled={!s.notifications} onChange={(v) => update({ notifyUsage: v })} />
        </Row>
        <Row k="notifySound" label={t("settings.notifications.sound.label")} disabled={!s.notifications}>
          <Toggle label={t("settings.notifications.sound.toggle")} checked={s.notifySound} disabled={!s.notifications} onChange={(v) => update({ notifySound: v })} />
        </Row>
      </Card>
      <Button onClick={() => void ipc.showToast(t("settings.notifications.test.title"), t("settings.notifications.test.body"), !s.notifySound)}>
        <Bell size={14} /> {t("settings.notifications.test.button")}
      </Button>
    </>
  );
}

function ClaudeInHelm() {
  const [s, update] = useSettings();
  const { t } = useTranslation();
  return (
    <>
      <Heading title={t("settings.nav.claudeInHelm")} hint={t("settings.claudeInHelm.hint")} />
      <Card>
        <Row k="approvals" label={t("settings.claudeInHelm.approvals.label")} hint={t("settings.claudeInHelm.approvals.hint")}>
          <Toggle label={t("settings.claudeInHelm.approvals.toggle")} checked={s.approvals} onChange={(v) => update({ approvals: v })} />
        </Row>
        <Row k="usageCockpit" label={t("settings.claudeInHelm.usageCockpit.label")} hint={t("settings.claudeInHelm.usageCockpit.hint")}>
          <Toggle label={t("settings.claudeInHelm.usageCockpit.toggle")} checked={s.usageCockpit} onChange={(v) => update({ usageCockpit: v })} />
        </Row>
        <Row k="autoOpenAgents" label={t("settings.claudeInHelm.autoOpenAgents.label")} hint={t("settings.claudeInHelm.autoOpenAgents.hint")}>
          <Toggle label={t("settings.claudeInHelm.autoOpenAgents.label")} checked={s.autoOpenAgents} onChange={(v) => update({ autoOpenAgents: v })} />
        </Row>
        <Row k="usageTips" label={t("settings.claudeInHelm.usageTips.label")} hint={t("settings.claudeInHelm.usageTips.hint")}>
          <Toggle label={t("settings.claudeInHelm.usageTips.label")} checked={s.usageTips} onChange={(v) => update({ usageTips: v })} />
        </Row>
        <Row k="openLinksIn" label={t("settings.claudeInHelm.openLinksIn.label")} hint={t("settings.claudeInHelm.openLinksIn.hint")}>
          <Segmented<Settings["openLinksIn"]> value={s.openLinksIn} onChange={(v) => update({ openLinksIn: v })} options={[{ id: "helm", label: "Helm" }, { id: "browser", label: t("settings.claudeInHelm.openLinksIn.browser") }]} />
        </Row>
        <Row k="devServerPrompt" label={t("settings.claudeInHelm.devServerPrompt.label")} hint={t("settings.claudeInHelm.devServerPrompt.hint")}>
          <Toggle label={t("settings.claudeInHelm.devServerPrompt.label")} checked={s.devServerPrompt} onChange={(v) => update({ devServerPrompt: v })} />
        </Row>
        <Row k="windowsHints" label={t("settings.claudeInHelm.windowsHints.label")} hint={t("settings.claudeInHelm.windowsHints.hint")}>
          <Toggle label={t("settings.claudeInHelm.windowsHints.toggle")} checked={s.windowsHints} onChange={(v) => update({ windowsHints: v })} />
        </Row>
      </Card>
    </>
  );
}

function Shortcuts() {
  const [filter, setFilter] = useState("");
  const list = SHORTCUTS.filter((s) => `${s.label} ${s.keys}`.toLowerCase().includes(filter.toLowerCase()));
  const { t } = useTranslation();
  return (
    <>
      <Heading title={t("settings.nav.shortcuts")} hint={t("settings.shortcuts.hint")} />
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-raised px-3 focus-within:border-accent">
        <Search size={14} className="text-faint" />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("settings.shortcuts.filter")} className="flex-1 bg-transparent py-2 outline-none placeholder:text-faint" />
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
        {list.length === 0 && <p className="p-4 text-center text-faint">{t("settings.shortcuts.empty")}</p>}
      </div>
    </>
  );
}

function Advanced() {
  const [s, update] = useSettings();
  const [args, setArgs] = useState(s.extraClaudeArgs);
  const [env, setEnv] = useState(s.extraEnv);
  const { t } = useTranslation();

  const exportSettings = async () => {
    const path = await saveDialog({ title: t("settings.advanced.export.dialogTitle"), defaultPath: "helm-settings.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path) return;
    const st = useStore.getState();
    const data = { app: "helm", version: 1, settings: st.settings, prompts: st.prompts, pinned: st.pinned };
    await ipc.writeTextFile(path, JSON.stringify(data, null, 2)).then(() => showToast(t("settings.advanced.export.done"), "success"), (e) => showToast(String(e), "error"));
  };
  const importSettings = async () => {
    const path = await openDialog({ title: t("settings.advanced.import.dialogTitle"), filters: [{ name: "JSON", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    try {
      const data = JSON.parse(await ipc.readTextFile(path));
      if (data?.app !== "helm" || typeof data.settings !== "object") throw new Error(t("settings.advanced.import.notHelmFile"));
      const st = useStore.getState();
      st.set({
        settings: { ...DEFAULT_SETTINGS, ...data.settings },
        ...(Array.isArray(data.prompts) ? { prompts: data.prompts } : {}),
        ...(Array.isArray(data.pinned) ? { pinned: data.pinned } : {}),
      });
      showToast(t("settings.advanced.import.done"), "success");
    } catch (e) {
      showToast(String(e), "error");
    }
  };
  const reset = async () => {
    const ok = await ask(t("settings.advanced.resetConfirm.message"), { title: t("settings.advanced.resetConfirm.title"), kind: "warning", okLabel: t("common.reset"), cancelLabel: t("common.cancel") });
    if (!ok) return;
    useStore.getState().set({ settings: { ...DEFAULT_SETTINGS } });
    showToast(t("settings.advanced.resetConfirm.done"), "success");
  };

  return (
    <>
      <Heading title={t("settings.nav.advanced")} hint={t("settings.advanced.hint")} />
      <Card title={t("settings.advanced.claude")}>
        <div className="py-3.5">
          <div className="text-[13px] text-fg">{t("settings.advanced.extraArgs.label")}</div>
          <div className="mt-0.5 mb-2 text-[12px] text-faint"><Trans i18nKey="settings.advanced.extraArgs.hint" components={{ 1: <code className="text-muted" /> }} /></div>
          <input
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            onBlur={() => update({ extraClaudeArgs: args })}
            placeholder="--model sonnet"
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[12px] outline-none focus:border-accent"
          />
        </div>
      </Card>
      <Card title={t("settings.advanced.environment")}>
        <div className="py-3.5">
          <div className="text-[13px] text-fg">{t("settings.advanced.env.label")}</div>
          <div className="mt-0.5 mb-2 text-[12px] text-faint"><Trans i18nKey="settings.advanced.env.hint" components={{ 1: <code className="text-muted" /> }} /></div>
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
      <Card title={t("settings.advanced.data")}>
        <Row label={t("settings.advanced.backup.label")} hint={t("settings.advanced.backup.hint")}>
          <div className="flex gap-2">
            <Button onClick={() => void exportSettings()}>
              <Download size={14} /> {t("settings.advanced.backup.export")}
            </Button>
            <Button onClick={() => void importSettings()}>
              <Upload size={14} /> {t("settings.advanced.backup.import")}
            </Button>
          </div>
        </Row>
        <Row label={t("settings.dataFolder")} hint={t("settings.advanced.dataFolderHint")}>
          <Button onClick={() => void ipc.dataDirPath().then((p) => openPath(p))}>
            <FolderOpen size={14} /> {t("common.open")}
          </Button>
        </Row>
        <Row label={t("settings.advanced.reset.label")} hint={t("settings.advanced.reset.hint")}>
          <Button tone="danger" onClick={() => void reset()}>
            <RotateCcw size={14} /> {t("common.reset")}
          </Button>
        </Row>
      </Card>
    </>
  );
}

function WhatsNew() {
  const [version, setVersion] = useState("");
  useEffect(() => void getVersion().then(setVersion), []);
  const { t } = useTranslation();
  return (
    <>
      <Heading title={t("settings.nav.whatsNew")} hint={t("settings.whatsNew.hint")} />
      <div className="relative space-y-8 border-l border-line pl-6">
        {CHANGELOG.map((r) => (
          <section key={r.version} className="relative">
            <span className={`absolute top-1.5 -left-[29px] size-2.5 rounded-full ring-4 ring-[var(--surface)] ${r.version === version ? "bg-accent" : "bg-line"}`} />
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="text-[15px] font-semibold text-fg">Helm {r.version}</h2>
              <span className="text-[12px] text-faint">{r.date}</span>
              {r.version === version && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">{t("settings.whatsNew.installed")}</span>}
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
  const { t } = useTranslation();

  const facts: [string, string][] = (["local", "network", "conversations", "status"] as const).map((id) => [t(`settings.privacy.facts.${id}.title`), t(`settings.privacy.facts.${id}.text`)]);

  return (
    <>
      <Heading title={t("settings.nav.privacy")} hint={t("settings.privacy.hint")} />
      <div className="mb-6 grid gap-2 sm:grid-cols-2">
        {facts.map(([title, text]) => (
          <div key={title} className="rounded-xl border border-line bg-raised p-3.5">
            <div className="text-[13px] font-medium text-fg">{title}</div>
            <div className="mt-1 text-[12px] leading-relaxed text-muted">{text}</div>
          </div>
        ))}
      </div>
      <Card title={t("settings.privacy.network")}>
        <Row k="autoUpdate" label={t("settings.autoUpdate")} hint={t("settings.privacy.autoUpdateHint")}>
          <Toggle label={t("settings.autoUpdate")} checked={s.autoUpdate} onChange={(v) => update({ autoUpdate: v })} />
        </Row>
      </Card>
      <Card title={t("settings.privacy.yourData")}>
        <Row label={t("settings.privacy.screenshots.label")} hint={shots ? t("settings.privacy.screenshots.hint", { count: shots[1], size: formatBytes(shots[0]) }) : "…"}>
          <Button
            onClick={async () => {
              const n = await ipc.clearScreenshots();
              showToast(t("settings.privacy.screenshots.deleted", { count: n }), "success");
              refresh();
            }}
          >
            {t("settings.privacy.screenshots.deleteNow")}
          </Button>
        </Row>
        <Row label={t("settings.privacy.closedTabs.label")} hint={t("settings.privacy.closedTabs.hint", { count: closed })}>
          <Button onClick={() => { useStore.getState().set({ closedTabs: [] }); showToast(t("settings.privacy.closedTabs.cleared"), "success"); }}>{t("settings.privacy.clear")}</Button>
        </Row>
        <Row label={t("settings.privacy.recentFolder.label")} hint={t("settings.privacy.recentFolder.hint")}>
          <Button onClick={() => { update({ lastFolder: undefined }); showToast(t("settings.privacy.recentFolder.cleared"), "success"); }}>{t("settings.privacy.clear")}</Button>
        </Row>
        <Row label={t("settings.dataFolder")} hint={t("settings.privacy.dataFolderHint")}>
          <Button onClick={() => void ipc.dataDirPath().then((p) => openPath(p))}>
            <FolderOpen size={14} /> {t("common.open")}
          </Button>
        </Row>
      </Card>
      <p className="text-[12px] text-faint">
        {t("settings.privacy.openSource")}{" "}
        <button className="text-accent hover:underline" onClick={() => void openUrl("https://www.anthropic.com/legal/privacy")}>
          {t("settings.privacy.anthropicPolicy")}
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
  const { t } = useTranslation();
  return (
    <>
      <div className="mb-6 flex items-center gap-4 text-accent">
        <HelmMark size={48} />
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-fg">Helm {version}</h1>
          <p className="text-muted">{t("settings.about.tagline")}</p>
        </div>
      </div>
      <Card title={t("settings.about.updates")}>
        <Row k="autoUpdate" label={t("settings.autoUpdate")} hint={t("settings.about.autoUpdateHint")}>
          <Toggle label={t("settings.autoUpdate")} checked={s.autoUpdate} onChange={(v) => update({ autoUpdate: v })} />
        </Row>
        <Row label={updateInfo ? t("settings.about.updateReady", { version: updateInfo.version }) : t("settings.about.upToDate")} hint={updateInfo ? t("settings.about.updateHint") : undefined}>
          {updateInfo ? (
            <Button tone="primary" onClick={() => void updateInfo.install()}>
              {t("settings.about.updateAndRestart")}
            </Button>
          ) : (
            <Button onClick={() => void checkForUpdate(true)}>{t("settings.about.checkNow")}</Button>
          )}
        </Row>
      </Card>
      <Card title={t("settings.about.project")}>
        <Row label={t("settings.about.source")} hint="github.com/sovanken/helm-term">
          <Button onClick={() => void openUrl("https://github.com/sovanken/helm-term")}>{t("settings.about.openGitHub")}</Button>
        </Row>
        <Row label={t("settings.about.notices.label")} hint={t("settings.about.notices.hint")}>
          <Button onClick={() => void openUrl("https://github.com/sovanken/helm-term#license")}>{t("settings.about.notices.view")}</Button>
        </Row>
      </Card>
      <p className="mt-2 text-[12px] text-faint">{t("settings.about.independent")}</p>
    </>
  );
}

// ---------- page ----------

export function SettingsPage() {
  const section = useStore((s) => s.settingsSection);
  const set = useStore.getState().set;
  const [query, setQuery] = useState("");
  const { t, i18n } = useTranslation();

  const q = query.trim().toLowerCase();
  const helm = useMemo(() => HELM_SECTIONS.filter((s) => !q || `${t(s.label)} ${s.keywords}`.toLowerCase().includes(q)), [q, i18n.language]);
  const claude = useMemo(() => CLAUDE_SECTIONS.filter((s) => !q || `${t(s.label)} ${t(s.hint)} ${CLAUDE_KEYWORDS[s.id] ?? ""}`.toLowerCase().includes(q)), [q, i18n.language]);
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
            placeholder={t("settings.page.search")}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] outline-none placeholder:text-faint"
          />
          {query && (
            <button aria-label={t("settings.page.clearSearch")} onClick={() => setQuery("")} className="text-faint hover:text-fg">
              <X size={12} />
            </button>
          )}
        </div>
        {helm.length > 0 && <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">Helm</div>}
        {helm.map((s) => navItem(s.id, t(s.label), s.icon))}
        {claude.length > 0 && <div className="px-2.5 pt-4 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">Claude Code</div>}
        {claude.map((s) => navItem(s.id, t(s.label), s.icon))}
        {helm.length === 0 && claude.length === 0 && <p className="px-2.5 py-3 text-[12px] text-faint">{t("settings.page.noMatch", { query })}</p>}
        <button
          onClick={() => void openSettingsJson()}
          title={t("settings.page.openJsonTitle")}
          className="mt-auto flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-muted hover:bg-hover hover:text-fg"
        >
          <FileJson size={15} />
          {t("settings.page.openJson")}
        </button>
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
