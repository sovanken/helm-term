import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, CornerDownLeft, Sparkles, Undo2, Wand2, X } from "lucide-react";
import { ipc } from "../lib/ipc";
import { activePane, folderName, showToast, useStore } from "../state/store";
import { focusTerminal, insertText } from "../terminal/terminals";

/**
 * Write a prompt in a roomy editor, optionally let Claude Haiku make it clearer, then send it to
 * the active Claude tab. Clearer prompts mean fewer back-and-forth turns, which saves usage.
 */
export function PromptComposer() {
  const dialog = useRef<HTMLDialogElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [original, setOriginal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pane = activePane();
  const claude = !!pane && (pane.claudeActive || pane.kind === "claude");
  const close = () => {
    useStore.getState().set({ composerOpen: false });
    if (pane) focusTerminal(pane.id);
  };

  useEffect(() => {
    dialog.current?.showModal();
    area.current?.focus();
  }, []);

  const improve = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const better = await ipc.improvePrompt(text, pane ? folderName(pane.cwd) : "");
      setOriginal(text);
      setText(better);
    } catch (e) {
      showToast(`Couldn't improve the prompt: ${String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const send = (submit: boolean) => {
    if (!pane || !text.trim()) return;
    useStore.getState().set({ composerOpen: false });
    insertText(pane.id, text);
    if (submit) setTimeout(() => void ipc.write(pane.id, "\r"), 150);
  };

  const save = () => {
    const title = text.trim().split("\n")[0].slice(0, 60);
    const st = useStore.getState();
    st.set({ prompts: [...st.prompts, { id: crypto.randomUUID(), title, text }] });
    showToast("Saved to your prompts (Ctrl+Shift+P)", "success");
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
          <h2 className="text-[15px] font-semibold">Write a prompt</h2>
          <p className="text-[12px] text-faint">
            {claude ? `For Claude in ${folderName(pane!.cwd)}` : "Open a Claude tab to send this prompt"} · a clear prompt saves back-and-forth (and usage)
          </p>
        </div>
        <button aria-label="Close" onClick={close} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
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
          placeholder="What should Claude do? e.g. fix the login bug that happens sometimes"
          className="scroll-thin w-full resize-y rounded-lg border border-line bg-bg px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-accent"
        />
        {busy && (
          <div className="anim-fade absolute inset-x-5 top-4 bottom-1.5 flex items-center justify-center gap-2 rounded-lg bg-surface/80 text-[13px] text-muted">
            <span className="status-working size-4 rounded-full border-2 border-accent border-t-transparent" /> Improving your prompt…
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 pt-2 pb-4">
        <button
          onClick={() => void improve()}
          disabled={!text.trim() || busy}
          title="Uses Claude Haiku once (a small amount of your usage). Takes about 10–20 seconds."
          className="flex items-center gap-1.5 rounded-lg border border-accent/50 px-3 py-1.5 text-[13px] font-medium text-accent hover:bg-accent-soft disabled:opacity-40"
        >
          <Sparkles size={14} /> Improve
        </button>
        {original !== null && (
          <button onClick={() => (setText(original), setOriginal(null))} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-fg">
            <Undo2 size={14} /> Use my original
          </button>
        )}
        <button onClick={save} disabled={!text.trim()} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-fg disabled:opacity-40">
          <BookmarkPlus size={14} /> Save
        </button>
        <span className="flex-1" />
        <button onClick={() => send(false)} disabled={!claude || !text.trim()} className="rounded-lg px-3 py-1.5 text-[13px] text-fg hover:bg-hover disabled:opacity-40">
          Insert
        </button>
        <button
          onClick={() => send(true)}
          disabled={!claude || !text.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
        >
          Send to Claude <CornerDownLeft size={13} /> <span className="text-[11px] opacity-70">Ctrl+Enter</span>
        </button>
      </div>
    </dialog>
  );
}
