import { type ReactNode, type TextareaHTMLAttributes, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import { ipc } from "../lib/ipc";

/** Copies `text`; shows a tick for a moment. */
export function CopyButton({ text, label: given, small }: { text: string; label?: string; small?: boolean }) {
  const { t } = useTranslation();
  const label = given ?? t("common.copy");
  const [done, setDone] = useState(false);
  return (
    <button
      disabled={!text}
      title={label}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className={`flex shrink-0 items-center gap-1.5 rounded-md border border-line text-[12px] text-muted hover:bg-hover hover:text-fg disabled:opacity-40 ${small ? "size-7 justify-center" : "h-7 px-2.5"}`}
    >
      {done ? <Check size={13} className="text-done" /> : <Copy size={13} />}
      {!small && (done ? t("common.copied") : label)}
    </button>
  );
}

export function Button({ children, onClick, primary, disabled, title }: { children: ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] disabled:opacity-40 ${
        primary ? "bg-accent font-medium text-on-accent hover:opacity-90" : "border border-line text-fg hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

/** A row of mutually exclusive choices. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex shrink-0 rounded-md border border-line p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-2.5 py-0.5 text-[12px] ${value === o.value ? "bg-hover font-medium text-fg" : "text-muted hover:text-fg"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Label({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-1.5 flex min-h-7 items-center gap-2">
      <span className="flex-1 text-[12px] font-medium text-muted">{children}</span>
      {right}
    </div>
  );
}

/** Monospace text box that fills its space. */
export function CodeArea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  const { invalid, className = "", ...rest } = props;
  return (
    <textarea
      spellCheck={false}
      {...rest}
      className={`scroll-thin min-h-0 w-full flex-1 resize-none rounded-md border bg-bg p-3 font-mono text-[12.5px] leading-relaxed text-fg outline-none placeholder:text-faint ${
        invalid ? "border-danger" : "border-line focus:border-accent"
      } ${className}`}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  const { mono, className = "", ...rest } = props;
  return (
    <input
      spellCheck={false}
      {...rest}
      className={`h-8 min-w-0 rounded-md border border-line bg-bg px-2.5 text-fg outline-none placeholder:text-faint focus:border-accent ${mono ? "font-mono text-[12.5px]" : ""} ${className}`}
    />
  );
}

/** A labelled value with a copy button, for result lists. */
export function ValueRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
      <span className="w-28 shrink-0 text-[12px] text-muted">{label}</span>
      <span className={`min-w-0 flex-1 truncate text-fg select-text ${mono ? "font-mono text-[12.5px]" : ""}`} title={value}>
        {value || <span className="text-faint">—</span>}
      </span>
      <CopyButton text={value} small label={t("tools.ui.copyValue", { label })} />
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line bg-surface p-4 ${className}`}>{children}</div>;
}

export function Hint({ children, error }: { children: ReactNode; error?: boolean }) {
  return <p className={`text-[12px] ${error ? "text-danger" : "text-faint"}`}>{children}</p>;
}

/** Reads and writes a small JSON value in Helm's data folder (tools/<name>.json). */
export async function loadData<T>(name: string, fallback: T): Promise<T> {
  try {
    const text = await ipc.toolDataRead(`${name}.json`);
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveData(name: string, value: unknown) {
  return ipc.toolDataWrite(`${name}.json`, JSON.stringify(value, null, 2)).catch(() => {});
}
