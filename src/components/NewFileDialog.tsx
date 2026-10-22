import { useEffect, useRef, useState } from "react";
import { FilePlus, X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { ipc } from "../lib/ipc";
import { folderName, useStore } from "../state/store";

/** `title` is a translation key. */
const KINDS: Record<string, { title: string; name: string }> = {
  md: { title: "dialogs.newFile.titleMarkdown", name: "notes.md" },
  txt: { title: "dialogs.newFile.titleText", name: "notes.txt" },
};

/** Asks for a name, creates the empty file in the current tab's folder and opens it for editing. */
export function NewFileDialog({ ext, dir }: { ext: string; dir: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  const kind = KINDS[ext] ?? { title: "dialogs.newFile.title", name: `untitled.${ext}` };
  const [name, setName] = useState(kind.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => useStore.getState().set({ newFile: null });

  useEffect(() => {
    dialog.current?.showModal();
    // Select the part before the extension, so typing replaces just the name.
    const el = input.current;
    if (el) {
      el.focus();
      el.setSelectionRange(0, kind.name.lastIndexOf("."));
    }
  }, [kind.name]);

  const create = async () => {
    let wanted = name.trim();
    if (!wanted || busy) return;
    // "plan" becomes "plan.md"; a name with its own extension is kept as typed.
    if (!/\.[^\\/.]+$/.test(wanted)) wanted += `.${ext}`;
    setBusy(true);
    try {
      const path = await ipc.createFile(dir, wanted);
      close();
      useStore.getState().openFile(path, dir, { edit: true });
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      onClose={close}
      onClick={(e) => e.target === dialog.current && close()}
      className="m-auto w-[440px] max-w-[calc(100vw-32px)] rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl shadow-black/30 backdrop:bg-black/40"
    >
      <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <FilePlus size={15} />
        </span>
        <h2 className="flex-1 text-[15px] font-semibold">{t(kind.title)}</h2>
        <button aria-label={t("common.close")} onClick={close} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <X size={15} />
        </button>
      </div>
      <div className="px-5 py-4">
        <label htmlFor="new-file-name" className="mb-1.5 block text-[12px] font-medium text-muted">
          {t("dialogs.newFile.name")}
        </label>
        <input
          id="new-file-name"
          ref={input}
          value={name}
          spellCheck={false}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && void create()}
          className={`w-full rounded-md border bg-bg px-3 py-2 outline-none ${error ? "border-danger" : "border-line focus:border-accent"}`}
        />
        <p className={`mt-2 truncate text-[12px] ${error ? "text-danger" : "text-faint"}`} title={dir}>
          {error ?? (
            <Trans i18nKey="dialogs.newFile.location" values={{ folder: folderName(dir), dir }} components={{ 1: <span className="text-muted" /> }} />
          )}
        </p>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button onClick={close} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover hover:text-fg">
          {t("common.cancel")}
        </button>
        <button
          onClick={() => void create()}
          disabled={!name.trim() || busy}
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
        >
          {t("dialogs.newFile.create")}
        </button>
      </div>
    </dialog>
  );
}
