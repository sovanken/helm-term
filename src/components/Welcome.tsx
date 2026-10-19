import { FolderOpen, Sparkles, SquareTerminal } from "lucide-react";
import { folderName, useStore } from "../state/store";
import { chooseFolder } from "./TitleBar";

export function HelmMark({ size = 40 }: { size?: number }) {
  // A ship's wheel: the helm you steer with.
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
      <circle cx="24" cy="24" r="12" />
      <circle cx="24" cy="24" r="3.5" />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return (
          <line key={i} x1={24 + Math.cos(a) * 3.5} y1={24 + Math.sin(a) * 3.5} x2={24 + Math.cos(a) * 19} y2={24 + Math.sin(a) * 19} />
        );
      })}
    </svg>
  );
}

export function Welcome() {
  const recent = useStore((s) => s.recent);
  const pinned = useStore((s) => s.pinned);
  const homeDir = useStore((s) => s.homeDir);
  const { openTab } = useStore.getState();
  const list = [...pinned.map((path) => ({ path })), ...recent.filter((r) => !pinned.includes(r.path))].slice(0, 6);

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3 text-accent">
          <HelmMark size={36} />
          <div>
            <h1 className="text-xl font-semibold text-fg">Helm</h1>
            <p className="text-muted">A terminal made for Claude Code</p>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-2">
          <button
            onClick={() => void chooseFolder("claude")}
            className="flex items-center gap-2.5 rounded-lg bg-accent px-3 py-2.5 font-medium text-on-accent hover:opacity-90"
          >
            <FolderOpen size={16} /> Open folder with Claude
          </button>
          <button
            onClick={() => openTab(homeDir, "shell")}
            className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5 font-medium text-fg hover:bg-hover"
          >
            <SquareTerminal size={16} /> New PowerShell tab
          </button>
        </div>

        {list.length > 0 && (
          <>
            <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">Continue a project</h2>
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
          Paste screenshots with Ctrl+V · drop files to insert their path · Shift+Enter for a new line · Ctrl+, for
          settings and all shortcuts
        </p>
      </div>
    </div>
  );
}
