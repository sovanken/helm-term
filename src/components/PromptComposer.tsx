import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, CornerDownLeft, Sparkles, Undo2, Wand2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ipc } from "../lib/ipc";
import { paneIds } from "../lib/layout";
import { activePane, folderName, type Pane, showToast, useStore } from "../state/store";
import { focusTerminal, insertText } from "../terminal/terminals";

/**
 * Write a prompt in a roomy editor, optionally let Claude Haiku make it clearer, then send it to
 * the active Claude tab. Clearer prompts mean fewer back-and-forth turns, which saves usage.
 */
const isClaude = (p?: Pane) => !!p && p.kind !== "browser" && (p.claudeActive || p.kind === "claude");

/** The Claude pane to write to: the active pane, or the Claude pane beside it (e.g. next to a browser). */
function claudeTarget(): Pane | undefined {
  const s = useStore.getState();
  const active = activePane();
  if (isClaude(active)) return active;
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  return tab ? paneIds(tab.root).map((id) => s.panes[id]).find(isClaude) : undefined;
}

export function PromptComposer() {
  const dialog = useRef<HTMLDialogElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [original, setOriginal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pane] = useState(claudeTarget);
  const claude = !!pane;
  const { t } = useTranslation();
  const close = () => {
    useStore.getState().set({ composerOpen: false });
    const back = pane ?? activePane();
    if (back) focusTerminal(back.id);
  };

  useEffect(() => {
    dialog.current?.showModal();
    area.current?.focus();
  }, []);

  const improve = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const better = await ipc.improvePrompt(text, folderName((pane ?? activePane())?.cwd ?? ""));
      setOriginal(text);
      setText(better);
    } catch (e) {
      showToast(t("prompts.composer.improveFailed", { error: String(e) }), "error");
    } finally {
      setBusy(false);
    }
  };

  const send = (submit: boolean) => {
    // Only ever into a Claude pane: a shell would run the text as a command.
    if (!pane || !text.trim() || busy) return;
    useStore.getState().set({ composerOpen: false });
    useStore.getState().focusPane(pane.id);
    insertText(pane.id, text);
    if (submit) setTimeout(() => void ipc.write(pane.id, "\r"), 150);
  };

  const save = () => {
    const title = text.trim().split("\n")[0].slice(0, 60);
    const st = useStore.getState();
    st.set({ prompts: [...st.prompts, { id: crypto.randomUUID(), title, text }] });
    showToast(t("prompts.composer.savedToast"), "success");
  };

  return (
    <dialog
      ref={dialog}
      onClose={close}
      onClick={(e) => e.target === dialog.current && close()}
      className="m-auto w-[720px] max-w-[calc(100vw-32px)] rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl shadow-black/30 backdrop:bg-black/40"
    >
      <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Wand2 size={16} />
        </span>
        <div className="flex-1">
          <h2 className="text-[15px] font-semibold">{t("prompts.composer.title")}</h2>
          <p className="text-[12px] text-faint">
            {claude ? t("prompts.composer.subtitleFor", { folder: folderName(pane!.cwd) }) : t("prompts.composer.subtitleNoTab")}
          </p>
        </div>
        <button aria-label={t("common.close")} onClick={close} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <X size={15} />
        </button>
      </div>

      <div className="relative px-5 pt-4">
        <textarea
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.ctrlKey) {
              e.preventDefault();
              send(true);
            }
          }}
          rows={10}
          placeholder={t("prompts.composer.placeholder")}
          className="scroll-thin w-full resize-y rounded-lg border border-line bg-bg px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-accent"
        />
        {busy && (
          <div className="anim-fade absolute inset-x-5 top-4 bottom-1.5 flex items-center justify-center gap-2 rounded-lg bg-surface/80 text-[13px] text-muted">
            <span className="status-working size-4 rounded-full border-2 border-accent border-t-transparent" /> {t("prompts.composer.improving")}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 pt-2 pb-4">
        <button
          onClick={() => void improve()}
          disabled={!text.trim() || busy}
          title={t("prompts.composer.improveTitle")}
          className="flex items-center gap-1.5 rounded-lg border border-accent/50 px-3 py-1.5 text-[13px] font-medium text-accent hover:bg-accent-soft disabled:opacity-40"
        >
          <Sparkles size={14} /> {t("prompts.composer.improve")}
        </button>
        {original !== null && (
          <button onClick={() => (setText(original), setOriginal(null))} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-fg">
            <Undo2 size={14} /> {t("prompts.composer.useOriginal")}
          </button>
        )}
        <button onClick={save} disabled={!text.trim()} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-fg disabled:opacity-40">
          <BookmarkPlus size={14} /> {t("common.save")}
        </button>
        <span className="flex-1" />
        <button onClick={() => send(false)} disabled={!claude || !text.trim()} className="rounded-lg px-3 py-1.5 text-[13px] text-fg hover:bg-hover disabled:opacity-40">
          {t("prompts.composer.insert")}
        </button>
        <button
          onClick={() => send(true)}
          disabled={!claude || !text.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
        >
          {t("prompts.composer.send")} <CornerDownLeft size={13} /> <span className="text-[11px] opacity-70">Ctrl+Enter</span>
        </button>
      </div>
    </dialog>
  );
}
