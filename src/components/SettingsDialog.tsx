import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { SHORTCUTS } from "../lib/shortcuts";
import { DEFAULT_FONT, type ThemeMode } from "../lib/themes";
import { useStore } from "../state/store";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-2.5">
      <div className="flex-1">
        <div className="text-fg">{label}</div>
        {hint && <div className="text-[12px] text-faint">{hint}</div>}
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
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-hover border border-line"}`}
    >
      <span className={`absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-white transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

export function SettingsDialog() {
  const settings = useStore((s) => s.settings);
  const { updateSettings, set } = useStore.getState();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => set({ settingsOpen: false });

  return (
    <dialog
      ref={dialog}
      onClose={close}
      onClick={(e) => e.target === dialog.current && close()}
      className="m-auto w-[560px] max-w-[calc(100vw-32px)] rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl shadow-black/30 backdrop:bg-black/40"
    >
      <div className="flex items-center border-b border-line px-5 py-3.5">
        <h2 className="flex-1 text-[15px] font-semibold">Settings</h2>
        <button aria-label="Close" onClick={close} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <X size={15} />
        </button>
      </div>

      <div className="scroll-thin max-h-[70vh] overflow-y-auto px-5 py-2">
        <h3 className="pt-2 text-[11px] font-semibold tracking-wide text-faint uppercase">Appearance</h3>
        <Row label="Theme">
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
        <Row label="Text size" hint="Ctrl+= and Ctrl+- also work">
          <div className="flex items-center gap-2">
            <button onClick={() => updateSettings({ fontSize: Math.max(9, settings.fontSize - 1) })} className="size-7 rounded-md border border-line hover:bg-hover">−</button>
            <span className="w-8 text-center tabular-nums">{settings.fontSize}</span>
            <button onClick={() => updateSettings({ fontSize: Math.min(28, settings.fontSize + 1) })} className="size-7 rounded-md border border-line hover:bg-hover">+</button>
          </div>
        </Row>
        <Row label="Font" hint="Any installed monospace font. Khmer falls back to Khmer UI.">
          <input
            defaultValue={settings.fontFamily.split(",")[0].replace(/"/g, "")}
            onBlur={(e) => {
              const name = e.target.value.trim();
              updateSettings({ fontFamily: name ? `"${name}", ${DEFAULT_FONT}` : DEFAULT_FONT });
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="w-44 rounded-md border border-line bg-bg px-2 py-1 outline-none focus:border-accent"
          />
        </Row>

        <h3 className="pt-4 text-[11px] font-semibold tracking-wide text-faint uppercase">Behavior</h3>
        <Row label="Notify me" hint="When Claude finishes or needs approval in a tab you're not looking at">
          <Toggle label="Notifications" checked={settings.notifications} onChange={(v) => updateSettings({ notifications: v })} />
        </Row>
        <Row label="Reopen tabs on start" hint="Claude tabs continue the same conversation">
          <Toggle label="Reopen tabs" checked={settings.restoreTabs} onChange={(v) => updateSettings({ restoreTabs: v })} />
        </Row>

        <h3 className="pt-4 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">Keyboard shortcuts</h3>
        <div className="pb-4">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between border-b border-line py-1.5 last:border-b-0">
              <span className="text-muted">{s.label}</span>
              <kbd className="rounded border border-line bg-bg px-1.5 py-0.5 font-sans text-[11px] text-fg">{s.keys}</kbd>
            </div>
          ))}
        </div>
      </div>
    </dialog>
  );
}
