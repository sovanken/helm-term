import { useEffect, useRef, useState } from "react";
import { Plus, Send, Trash2, X } from "lucide-react";
import { activePane, type SavedPrompt, useStore } from "../state/store";
import { insertText } from "../terminal/terminals";

export function PromptsDialog() {
  const prompts = useStore((s) => s.prompts);
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string | null>(prompts[0]?.id ?? null);
  const current = prompts.find((p) => p.id === selected);
  const set = useStore.getState().set;

  useEffect(() => dialog.current?.showModal(), []);
  const close = () => set({ promptsOpen: false });

  const save = (patch: Partial<SavedPrompt>) =>
    set({ prompts: useStore.getState().prompts.map((p) => (p.id === selected ? { ...p, ...patch } : p)) });
  const add = () => {
    const prompt = { id: crypto.randomUUID(), title: "New prompt", text: "" };
    set({ prompts: [...useStore.getState().prompts, prompt] });
    setSelected(prompt.id);
  };
  const remove = () => {
    const rest = useStore.getState().prompts.filter((p) => p.id !== selected);
    set({ prompts: rest });
    setSelected(rest[0]?.id ?? null);
  };
  const use = () => {
    const pane = activePane();
    if (!current || !pane) return;
    close();
    insertText(pane.id, current.text);
  };

  return (
    <dialog
      ref={dialog}
      onClose={close}
      onClick={(e) => e.target === dialog.current && close()}
      className="m-auto h-[520px] max-h-[calc(100vh-48px)] w-[760px] max-w-[calc(100vw-32px)] rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl shadow-black/30 backdrop:bg-black/40"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center border-b border-line px-5 py-3.5">
          <div className="flex-1">
            <h2 className="text-[15px] font-semibold">Saved prompts</h2>
            <p className="text-[12px] text-faint">Reuse prompts you type often. Find them with Ctrl+Shift+P.</p>
          </div>
          <button aria-label="Close" onClick={close} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
            <X size={15} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="flex w-56 shrink-0 flex-col border-r border-line">
            <div className="scroll-thin flex-1 overflow-y-auto p-2">
              {prompts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelected(p.id)}
                  className={`block w-full truncate rounded-md px-2.5 py-1.5 text-left ${p.id === selected ? "bg-hover text-fg" : "text-muted hover:bg-hover hover:text-fg"}`}
                >
                  {p.title || "Untitled"}
                </button>
              ))}
            </div>
            <div className="border-t border-line p-2">
              <button onClick={add} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-line py-1.5 text-fg hover:bg-hover">
                <Plus size={14} /> New prompt
              </button>
            </div>
          </div>

          {current ? (
            <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
              <input
                value={current.title}
                onChange={(e) => save({ title: e.target.value })}
                placeholder="Name"
                className="rounded-md border border-line bg-bg px-3 py-2 font-medium outline-none focus:border-accent"
              />
              <textarea
                value={current.text}
                onChange={(e) => save({ text: e.target.value })}
                placeholder="What should Claude do?"
                className="scroll-thin flex-1 resize-none rounded-md border border-line bg-bg px-3 py-2 leading-relaxed outline-none focus:border-accent"
              />
              <div className="flex items-center gap-2">
                <button onClick={remove} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-danger hover:bg-hover">
                  <Trash2 size={14} /> Delete
                </button>
                <span className="flex-1 text-[12px] text-faint">Saved automatically</span>
                <button
                  onClick={use}
                  disabled={!current.text.trim() || !activePane()}
                  className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
                >
                  <Send size={14} /> Insert into terminal
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-faint">No saved prompts yet.</div>
          )}
        </div>
      </div>
    </dialog>
  );
}
