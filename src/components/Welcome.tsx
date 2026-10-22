import { useId } from "react";
import { FolderOpen, Sparkles } from "lucide-react";
import { defaultFolder, folderName, useStore } from "../state/store";
import { chooseFolder } from "./TitleBar";
import { useTranslation } from "react-i18next";

/** Helm's logo: two stacked terminal panes, the front one showing a prompt. */
export function HelmMark({ size = 40 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden>
      <defs>
        <mask id={`${id}-back`} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
          <rect width="1024" height="1024" fill="#fff" />
          <rect x="74" y="394" width="672" height="522" rx="104" fill="#000" />
        </mask>
        <mask id={`${id}-front`} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
          <rect width="1024" height="1024" fill="#fff" />
          <polyline points="189,569 284,655 189,741" fill="none" stroke="#000" strokeWidth="64" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="339" y1="741" x2="451" y2="741" stroke="#000" strokeWidth="64" strokeLinecap="round" />
        </mask>
      </defs>
      <rect x="348" y="150" width="576" height="440" rx="78" fill="#b46c30" mask={`url(#${id}-back)`} />
      <rect x="100" y="420" width="620" height="470" rx="78" fill="#e7a85a" mask={`url(#${id}-front)`} />
    </svg>
  );
}

export function Welcome() {
  const { t } = useTranslation();
  const recent = useStore((s) => s.recent);
  const pinned = useStore((s) => s.pinned);
  const { openTab } = useStore.getState();
  const list = [...pinned.map((path) => ({ path })), ...recent.filter((r) => !pinned.includes(r.path))].slice(0, 6);

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3 text-accent">
          <HelmMark size={36} />
          <div>
            <h1 className="text-xl font-semibold text-fg">Helm</h1>
            <p className="text-muted">{t("welcome.tagline")}</p>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-2">
          <button
            onClick={() => void chooseFolder("claude")}
            className="flex items-center gap-2.5 rounded-lg bg-accent px-3 py-2.5 font-medium text-on-accent hover:opacity-90"
          >
            <FolderOpen size={16} /> {t("welcome.openFolder")}
          </button>
          <button
            onClick={() => openTab(defaultFolder(), "claude")}
            className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5 font-medium text-fg hover:bg-hover"
          >
            <Sparkles size={16} /> {t("common.newClaudeTab")}
          </button>
        </div>

        {list.length > 0 && (
          <>
            <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">{t("welcome.continueProject")}</h2>
            <div className="overflow-hidden rounded-lg border border-line">
              {list.map((p) => (
                <button
                  key={p.path}
                  onClick={() => openTab(p.path, "claude")}
                  className="flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left last:border-b-0 hover:bg-hover"
                >
                  <Sparkles size={14} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-fg">{folderName(p.path)}</span>
                    <span className="block truncate text-[11px] text-faint">{p.path}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        <p className="mt-6 text-[12px] leading-relaxed text-faint">
          {t("welcome.tips")}
        </p>
      </div>
    </div>
  );
}
