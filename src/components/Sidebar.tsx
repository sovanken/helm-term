import { type ReactNode, useState } from "react";
import { ChevronRight, Search, X } from "lucide-react";
import { ipc } from "../lib/ipc";
import { ProjectTree } from "./ProjectTree";
import { useStore } from "../state/store";
import { useTranslation } from "react-i18next";

export async function refreshRecent() {
  const recent = await ipc.recentProjects().catch(() => []);
  useStore.getState().set({ recent });
}

/** Collapsible group with a small heading and optional actions. */
export function Section({ title, count, actions, children, defaultOpen = true }: { title: string; count?: number; actions?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-2">
      <div className="group/section flex items-center gap-1 px-1 pt-2 pb-1">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] font-semibold tracking-wide text-faint uppercase hover:text-muted">
          <ChevronRight size={12} className={`shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
          <span className="truncate">{title}</span>
          {count !== undefined && <span className="font-normal normal-case text-faint">{count}</span>}
        </button>
        {actions && <div className="flex items-center opacity-70 group-hover/section:opacity-100">{actions}</div>}
      </div>
      {open && <div className="anim-fade">{children}</div>}
    </section>
  );
}

export function SidebarSearch({ value, onChange, placeholder, busy }: { value: string; onChange: (v: string) => void; placeholder: string; busy?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="mx-2 mb-1 flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 transition-colors focus-within:border-accent">
      <Search size={13} className="shrink-0 text-faint" />
      <input
        id="sidebar-search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-fg outline-none placeholder:text-faint"
      />
      {busy && <span className="status-working size-3 shrink-0 rounded-full border border-faint border-t-transparent" />}
      {value && !busy && (
        <button aria-label={t("sidebarShell.clearSearch")} onClick={() => onChange("")} className="text-faint hover:text-fg">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="flex w-full min-w-0 flex-col bg-bg pt-1">
      <ProjectTree />
    </aside>
  );
}
