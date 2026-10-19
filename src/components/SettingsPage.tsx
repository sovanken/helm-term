import { type ReactNode, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Bell, Info, Keyboard, Palette } from "lucide-react";
import { SHORTCUTS } from "../lib/shortcuts";
import { DEFAULT_FONT, type ThemeMode } from "../lib/themes";
import { checkForUpdate } from "../lib/updater";
import { type SettingsSection, useStore } from "../state/store";
import { CLAUDE_SECTIONS, ClaudeSection, type ClaudeSectionId } from "./ClaudeSettings";
import { HelmMark } from "./Welcome";

const HELM_SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: "appearance", label: "Appearance", icon: <Palette size={15} /> },
  { id: "behavior", label: "Behavior", icon: <Bell size={15} /> },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: <Keyboard size={15} /> },
  { id: "about", label: "About & updates", icon: <Info size={15} /> },
];

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-6 border-b border-line py-4 last:border-b-0">
      <div className="flex-1">
        <div className="text-fg">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-faint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "border border-line bg-hover"}`}
    >
      <span className={`absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-white transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

function Heading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-4">
      <h1 className="text-[18px] font-semibold text-fg">{title}</h1>
      <p className="mt-0.5 text-muted">{hint}</p>
    </div>
  );
}

function Appearance() {
  const settings = useStore((s) => s.settings);
  const { updateSettings } = useStore.getState();
  return (
    <>
      <Heading title="Appearance" hint="How Helm and your terminals look." />
      <Row label="Theme" hint="System follows your Windows setting">
        <div className="flex rounded-md border border-line p-0.5">
          {(["dark", "light", "system"] as ThemeMode[]).map((t) => (
            <button
              key={t}
              onClick={() => updateSettings({ theme: t })}
              className={`rounded px-3 py-1 capitalize ${settings.theme === t ? "bg-hover text-fg" : "text-muted hover:text-fg"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Text size" hint="Ctrl+= and Ctrl+- also work in any terminal">
        <div className="flex items-center gap-2">
          <button onClick={() => updateSettings({ fontSize: Math.max(9, settings.fontSize - 1) })} className="size-7 rounded-md border border-line hover:bg-hover">
            −
          </button>
          <span className="w-8 text-center tabular-nums">{settings.fontSize}</span>
          <button onClick={() => updateSettings({ fontSize: Math.min(28, settings.fontSize + 1) })} className="size-7 rounded-md border border-line hover:bg-hover">
            +
          </button>
        </div>
      </Row>
      <Row label="Terminal font" hint="Any installed monospace font. Every language and emoji still renders.">
        <input
          key={settings.fontFamily}
          defaultValue={settings.fontFamily}
          onBlur={(e) => updateSettings({ fontFamily: e.target.value.trim() || DEFAULT_FONT })}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="w-52 rounded-md border border-line bg-bg px-2.5 py-1.5 outline-none focus:border-accent"
        />
      </Row>
    </>
  );
}

function Behavior() {
  const settings = useStore((s) => s.settings);
  const { updateSettings } = useStore.getState();
  return (
    <>
      <Heading title="Behavior" hint="How Helm works alongside Claude." />
      <Row label="Notify me" hint="When Claude finishes or needs approval in a tab you're not looking at">
        <Toggle label="Notifications" checked={settings.notifications} onChange={(v) => updateSettings({ notifications: v })} />
      </Row>
      <Row label="Reopen tabs on start" hint="Claude tabs continue the same conversation">
        <Toggle label="Reopen tabs" checked={settings.restoreTabs} onChange={(v) => updateSettings({ restoreTabs: v })} />
      </Row>
    </>
  );
}

function Shortcuts() {
  return (
    <>
      <Heading title="Keyboard shortcuts" hint="Helm uses Ctrl+Shift and Alt+Shift so Claude Code keeps all of its own keys." />
      <div className="overflow-hidden rounded-lg border border-line">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="flex items-center justify-between border-b border-line px-4 py-2.5 last:border-b-0">
            <span className="text-fg">{s.label}</span>
            <kbd className="rounded border border-line bg-bg px-1.5 py-0.5 font-sans text-[11px] text-muted">{s.keys}</kbd>
          </div>
        ))}
      </div>
    </>
  );
}

function About() {
  const [version, setVersion] = useState("");
  const update = useStore((s) => s.update);
  useEffect(() => void getVersion().then(setVersion), []);
  return (
    <>
      <div className="mb-6 flex items-center gap-4 text-accent">
        <HelmMark size={44} />
        <div>
          <h1 className="text-[18px] font-semibold text-fg">Helm {version}</h1>
          <p className="text-muted">A terminal made for Claude Code · free and open source (MIT)</p>
        </div>
      </div>
      <Row label="Updates" hint={update ? `Version ${update.version} is ready to install` : "Helm checks for new versions automatically"}>
        {update ? (
          <button onClick={() => void update.install()} className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:opacity-90">
            Update and restart
          </button>
        ) : (
          <button onClick={() => void checkForUpdate(true)} className="rounded-md border border-line px-3 py-1.5 hover:bg-hover">
            Check for updates
          </button>
        )}
      </Row>
      <Row label="Source code" hint="Report issues and contribute on GitHub">
        <button onClick={() => void openUrl("https://github.com/sovanken/helm-term")} className="rounded-md border border-line px-3 py-1.5 hover:bg-hover">
          Open GitHub
        </button>
      </Row>
      <p className="mt-6 text-[12px] text-faint">Helm is an independent community project and is not affiliated with Anthropic.</p>
    </>
  );
}

export function SettingsPage() {
  const section = useStore((s) => s.settingsSection);
  const set = useStore.getState().set;
  const navItem = (id: SettingsSection, label: string, icon: ReactNode) => (
    <button
      key={id}
      onClick={() => set({ settingsSection: id })}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left ${section === id ? "bg-hover font-medium text-fg" : "text-muted hover:bg-hover hover:text-fg"}`}
    >
      <span className={section === id ? "text-accent" : ""}>{icon}</span>
      {label}
    </button>
  );
  const isClaude = CLAUDE_SECTIONS.some((s) => s.id === section);

  return (
    <div className="flex h-full">
      <nav className="scroll-thin flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line p-3">
        <div className="px-2.5 pt-1 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">Helm</div>
        {HELM_SECTIONS.map((s) => navItem(s.id, s.label, s.icon))}
        <div className="px-2.5 pt-4 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">Claude Code</div>
        {CLAUDE_SECTIONS.map((s) => navItem(s.id, s.label, s.icon))}
      </nav>
      <div className="scroll-thin min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col px-8 py-7">
          {section === "appearance" && <Appearance />}
          {section === "behavior" && <Behavior />}
          {section === "shortcuts" && <Shortcuts />}
          {section === "about" && <About />}
          {isClaude && <ClaudeSection key={section} section={section as ClaudeSectionId} />}
        </div>
      </div>
    </div>
  );
}
