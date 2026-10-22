import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderPlus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ipc } from "../lib/ipc";
import { useStore } from "../state/store";

/** Makes a new project folder (in a chosen place) and starts a Claude tab in it. */
export function NewProjectDialog({ parent: initial, onClose }: { parent: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [parent, setParent] = useState(initial);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const pick = async () => {
    const dir = await open({ directory: true, title: t("dialogs.newProject.pickTitle"), defaultPath: parent || undefined });
    if (typeof dir === "string") {
      setParent(dir);
      setError(null);
    }
  };

  const create = async () => {
    const wanted = name.trim();
    if (!wanted || !parent || busy) return;
    setBusy(true);
    try {
      const path = await ipc.createDir(parent, wanted);
      onClose();
      useStore.getState().openTab(path, "claude");
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      className="m-auto w-[460px] max-w-[calc(100vw-32px)] rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl shadow-black/30 backdrop:bg-black/40"
    >
      <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <FolderPlus size={15} />
        </span>
        <h2 className="flex-1 text-[15px] font-semibold">{t("dialogs.newProject.title")}</h2>
        <button aria-label={t("common.close")} onClick={onClose} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <X size={15} />
        </button>
      </div>
      <div className="flex flex-col gap-4 px-5 py-4">
        <div>
          <label htmlFor="new-project-name" className="mb-1.5 block text-[12px] font-medium text-muted">
            {t("dialogs.newProject.name")}
          </label>
          <input
            id="new-project-name"
            autoFocus
            value={name}
            spellCheck={false}
            placeholder="my-new-app"
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && void create()}
            className={`w-full rounded-md border bg-bg px-3 py-2 outline-none placeholder:text-faint ${error ? "border-danger" : "border-line focus:border-accent"}`}
          />
        </div>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-muted">{t("dialogs.newProject.inside")}</div>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate rounded-md border border-line bg-bg px-3 py-2 text-[12.5px] text-muted" title={parent}>
              {parent || t("dialogs.newProject.chooseFolder")}
            </span>
            <button onClick={() => void pick()} className="shrink-0 rounded-md border border-line px-3 py-2 text-[12.5px] hover:bg-hover">
              {t("dialogs.newProject.change")}
            </button>
          </div>
        </div>
        <p className={`text-[12px] ${error ? "text-danger" : "text-faint"}`}>{error ?? t("dialogs.newProject.hint")}</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button onClick={onClose} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover hover:text-fg">
          {t("common.cancel")}
        </button>
        <button
          onClick={() => void create()}
          disabled={!name.trim() || !parent || busy}
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
        >
          {t("dialogs.newProject.create")}
        </button>
      </div>
    </dialog>
  );
}
