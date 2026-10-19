import { useCallback, useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { GitBranch, GitMerge, Layers, MoreHorizontal, Plus, Sparkles, SquareTerminal, Trash2, X } from "lucide-react";
import { ipc, type WorktreeList } from "../lib/ipc";
import { activePane, folderName, showToast, useStore } from "../state/store";
import { Menu } from "./Menu";

/** Lowercase words joined by dashes, safe as a folder and branch name. */
function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function NewTaskDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [repo, setRepo] = useState<WorktreeList | null>(null);
  const cwd = activePane()?.cwd ?? useStore.getState().homeDir;
  const close = () => useStore.getState().set({ newTaskOpen: false });

  useEffect(() => {
    dialog.current?.showModal();
    void ipc.worktreeList(cwd).then(setRepo).catch(() => setRepo({ isRepo: false, worktrees: [] }));
  }, []);

  const id = slug(name);
  const create = () => {
    if (!id || !repo?.mainPath) return;
    close();
    useStore.getState().openTab(repo.mainPath, "claude", { worktree: id });
    showToast(`Started parallel task “${id}” on its own branch`, "success");
  };

  return (
    <dialog
      ref={dialog}
      onClose={close}
      onClick={(e) => e.target === dialog.current && close()}
      className="m-auto w-[520px] max-w-[calc(100vw-32px)] rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl shadow-black/30 backdrop:bg-black/40"
    >
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Layers size={16} />
        </span>
        <div className="flex-1">
          <h2 className="text-[15px] font-semibold">New parallel task</h2>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
            Claude works in its own copy of the project on a new branch, so several tasks can run at once without
            touching each other. Merge the result back when it's done.
          </p>
        </div>
        <button aria-label="Close" onClick={close} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <X size={15} />
        </button>
      </div>
      <div className="px-5 py-4">
        {repo && !repo.isRepo ? (
          <p className="text-[13px] leading-relaxed text-muted">
            <span className="font-medium text-fg">{folderName(cwd)}</span> isn't a git repository. Parallel tasks need
            git — run <code className="text-fg">git init</code> and make a first commit, then try again.
          </p>
        ) : (
          <>
            <label className="mb-1.5 block text-[12px] font-medium text-muted">What's the task?</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="e.g. Add dark mode to settings"
              className="w-full rounded-md border border-line bg-bg px-3 py-2 outline-none focus:border-accent"
            />
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-faint">
              <GitBranch size={12} />
              {id ? (
                <>
                  Branch and folder: <code className="text-muted">{id}</code> in {folderName(repo?.mainPath ?? cwd)}
                </>
              ) : (
                "Give it a short name"
              )}
            </p>
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button onClick={close} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover hover:text-fg">
          Cancel
        </button>
        <button
          onClick={create}
          disabled={!id || !repo?.isRepo}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
        >
          <Sparkles size={14} /> Start task
        </button>
      </div>
    </dialog>
  );
}

/** Parallel tasks (git worktrees) of the active tab's repository, shown in the Projects sidebar. */
export function TasksSection() {
  const activeTabId = useStore((s) => s.activeTabId);
  const panes = useStore((s) => s.panes);
  const activity = useStore((s) => s.activity);
  const cwd = activePane()?.cwd;
  const [list, setList] = useState<WorktreeList | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!cwd) return setList(null);
    void ipc.worktreeList(cwd).then(setList).catch(() => setList(null));
  }, [cwd]);

  useEffect(load, [load, activity, activeTabId]);
  useEffect(() => {
    const t = setInterval(() => document.hasFocus() && load(), 6000);
    return () => clearInterval(t);
  }, [load]);

  if (!list?.isRepo || !list.mainPath) return null;
  const main = list.mainPath;
  const tasks = list.worktrees.filter((w) => !w.isMain);
  const { openTab, set } = useStore.getState();
  const openPaneIn = (path: string) => Object.values(panes).some((p) => p.cwd.toLowerCase() === path.toLowerCase());

  const merge = async (branch: string) => {
    const ok = await ask(`Merge the task branch “${branch}” into “${list.mainBranch ?? "main"}”?`, {
      title: "Merge task",
      okLabel: "Merge",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    setBusy(branch);
    try {
      await ipc.worktreeMerge(main, branch);
      showToast(`Merged ${branch} into ${list.mainBranch ?? "main"}`, "success");
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setBusy(null);
      load();
    }
  };

  const remove = async (path: string, branch: string | undefined, dirty: number, ahead: number) => {
    const warn =
      dirty > 0
        ? `\n\nIt has ${dirty} uncommitted ${dirty === 1 ? "change" : "changes"} that will be lost.`
        : ahead > 0
          ? `\n\nIts ${ahead} unmerged ${ahead === 1 ? "commit stays" : "commits stay"} on branch “${branch}”.`
          : "";
    const ok = await ask(`Remove the task folder ${folderName(path)}?${warn}`, {
      title: "Remove task",
      kind: "warning",
      okLabel: "Remove",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    // Close tabs still working in that folder first.
    for (const p of Object.values(useStore.getState().panes)) {
      if (p.cwd.toLowerCase().startsWith(path.toLowerCase())) useStore.getState().closePane(p.id);
    }
    try {
      await ipc.worktreeRemove(main, path, branch, dirty > 0, ahead === 0);
      showToast(`Removed task ${folderName(path)}`, "success");
    } catch (e) {
      showToast(String(e), "error");
    }
    load();
  };

  return (
    <section className="mb-3">
      <div className="flex items-center px-2 pt-2 pb-1">
        <h2 className="flex-1 truncate text-[11px] font-semibold tracking-wide text-faint uppercase" title={main}>
          Tasks in {folderName(main)}
        </h2>
        <button
          aria-label="New parallel task"
          title="New parallel task"
          onClick={() => set({ newTaskOpen: true })}
          className="flex size-5 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg"
        >
          <Plus size={13} />
        </button>
      </div>
      {tasks.length === 0 && (
        <button
          onClick={() => set({ newTaskOpen: true })}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-faint hover:bg-hover hover:text-fg"
        >
          <Layers size={13} /> Run Claude on a second task in parallel
        </button>
      )}
      {tasks.map((w) => {
        const name = folderName(w.path);
        return (
          <div key={w.path} className="group relative">
            <button
              onClick={() => openTab(w.path, "claude")}
              title={`${w.path}\nBranch: ${w.branch ?? "detached"}\nClick to open Claude in this task`}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover"
            >
              <span className={`flex size-6 shrink-0 items-center justify-center rounded-md ${openPaneIn(w.path) ? "bg-accent-soft text-accent" : "bg-hover text-muted"}`}>
                <Layers size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-fg">{name}</span>
                <span className="flex items-center gap-1.5 truncate text-[11px] text-faint">
                  {busy === w.branch ? (
                    "Merging…"
                  ) : (
                    <>
                      {w.dirty > 0 && <span className="text-attention">{w.dirty} uncommitted</span>}
                      {w.ahead > 0 && <span className="text-done">{w.ahead} to merge</span>}
                      {w.dirty === 0 && w.ahead === 0 && <span>No changes yet</span>}
                    </>
                  )}
                </span>
              </span>
            </button>
            <div className={`absolute top-1/2 right-1 -translate-y-1/2 ${menu === w.path ? "block" : "hidden group-hover:block"}`}>
              <div className="relative">
                <button
                  aria-label="Task actions"
                  onClick={() => setMenu(menu === w.path ? null : w.path)}
                  className="flex size-6 items-center justify-center rounded bg-hover text-muted hover:text-fg"
                >
                  <MoreHorizontal size={14} />
                </button>
                {menu === w.path && (
                  <Menu
                    align="right"
                    onClose={() => setMenu(null)}
                    items={[
                      { label: "Open Claude here", icon: <Sparkles size={14} />, onSelect: () => openTab(w.path, "claude") },
                      { label: "Open PowerShell here", icon: <SquareTerminal size={14} />, onSelect: () => openTab(w.path, "shell") },
                      ...(w.branch
                        ? [
                            {
                              label: w.ahead > 0 ? `Merge into ${list.mainBranch ?? "main"}` : "Nothing to merge yet",
                              icon: <GitMerge size={14} />,
                              onSelect: () => (w.ahead > 0 ? void merge(w.branch!) : showToast("Ask Claude in the task to commit its work first.")),
                              separatorBefore: true,
                            },
                          ]
                        : []),
                      { label: "Remove task", icon: <Trash2 size={14} />, onSelect: () => void remove(w.path, w.branch, w.dirty, w.ahead) },
                    ]}
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
