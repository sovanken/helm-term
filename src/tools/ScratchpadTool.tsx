import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Editor } from "../components/Editor";
import { ipc } from "../lib/ipc";
import { activePane, folderName, useStore } from "../state/store";
import { Hint } from "./ui";
import { ShimmerLines } from "../components/Shimmer";

const GENERAL = "";

/** File name for a project's notes in Helm's data folder (letters, digits and dashes only). */
function fileFor(project: string) {
  if (!project) return "scratch-general.md";
  const slug = project.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(-90);
  return `scratch-${slug}.md`;
}

function Pad({ project }: { project: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef("");

  useEffect(() => {
    ipc.toolDataRead(fileFor(project)).then(
      (saved) => setText((latest.current = saved ?? "")),
      () => setText(""),
    );
  }, [project]);

  const flush = () => {
    clearTimeout(timer.current);
    setState("saving");
    ipc.toolDataWrite(fileFor(project), latest.current).then(
      () => setState("saved"),
      () => setState("error"),
    );
  };

  // Save what's typed when leaving the tool or switching project.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => void (timer.current && (clearTimeout(timer.current), ipc.toolDataWrite(fileFor(project), latest.current))), [project]);

  if (text === null) return <ShimmerLines lines={10} className="p-5" />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Editor
        name="notes.md"
        initial={text}
        wrap
        onChange={(value) => {
          latest.current = value;
          setState("saving");
          clearTimeout(timer.current);
          timer.current = setTimeout(flush, 600);
        }}
        onSave={flush}
      />
      <div className="flex h-8 shrink-0 items-center border-t border-line px-4">
        <Hint error={state === "error"}>{state === "saving" ? t("common.saving") : state === "error" ? t("tools.scratchpad.saveFailed") : t("tools.scratchpad.savedAuto")}</Hint>
      </div>
    </div>
  );
}

export default function ScratchpadTool() {
  const { t } = useTranslation();
  const recent = useStore((s) => s.recent);
  const [project, setProject] = useState(() => activePane()?.cwd ?? GENERAL);
  const options = [...new Set([project, ...recent.map((r) => r.path)].filter(Boolean))];
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="text-[12px] text-muted">{t("tools.scratchpad.notesFor")}</span>
        <select value={project} onChange={(e) => setProject(e.target.value)} aria-label={t("tools.scratchpad.project")} className="h-7 max-w-80 rounded-md border border-line bg-bg px-2 text-[12px] text-fg">
          <option value={GENERAL}>{t("tools.scratchpad.general")}</option>
          {options.map((p) => (
            <option key={p} value={p}>
              {folderName(p)}
            </option>
          ))}
        </select>
        {project && <span className="truncate text-[12px] text-faint">{project}</span>}
      </div>
      <Pad key={project} project={project} />
    </div>
  );
}
