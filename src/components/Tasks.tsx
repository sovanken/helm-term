import { useCallback, useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { Trans, useTranslation } from "react-i18next";
import { GitBranch, GitMerge, Layers, MoreHorizontal, Plus, Sparkles, SquareTerminal, Trash2, X } from "lucide-react";
import { ipc, type WorktreeList } from "../lib/ipc";
import { activePane, folderName, showToast, useStore } from "../state/store";
import { Menu } from "./Menu";
import { Section } from "./Sidebar";

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
  const { t } = useTranslation();

  useEffect(() => {
    dialog.current?.showModal();
    // showModal focuses the first button (the ✕); put the cursor in the task field instead.
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    void ipc.worktreeList(cwd).then(setRepo).catch(() => setRepo({ isRepo: false, worktrees: [] }));
  }, []);

  const id = slug(name);
  const create = () => {
    if (!id || !repo?.mainPath) return;
    close();
    useStore.getState().openTab(repo.mainPath, "claude", { worktree: id });
    showToast(t("tasks.started", { id }), "success");
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
          <h2 className="text-[15px] font-semibold">{t("tasks.newTask")}</h2>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{t("tasks.intro")}</p>
        </div>
        <button aria-label={t("common.close")} onClick={close} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <X size={15} />
        </button>
      </div>
      <div className="px-5 py-4">
        {repo && !repo.isRepo ? (
          <p className="text-[13px] leading-relaxed text-muted">
            <Trans
              i18nKey="tasks.notRepo"
              values={{ name: folderName(cwd) }}
              components={[<span key="0" className="font-medium text-fg" />, <code key="1" className="text-fg" />]}
            />
          </p>
        ) : (
          <>
            <label className="mb-1.5 block text-[12px] font-medium text-muted">{t("tasks.whatTask")}</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder={t("tasks.placeholder")}
              className="w-full rounded-md border border-line bg-bg px-3 py-2 outline-none focus:border-accent"
            />
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-faint">
              <GitBranch size={12} />
              {id ? (
                <span>
                  <Trans i18nKey="tasks.branchAndFolder" values={{ id, folder: folderName(repo?.mainPath ?? cwd) }} components={[<code key="0" className="text-muted" />]} />
                </span>
              ) : (
                t("tasks.giveName")
              )}
            </p>
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button onClick={close} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover hover:text-fg">
          {t("common.cancel")}
        </button>
        <button
          onClick={create}
          disabled={!id || !repo?.isRepo}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
        >
          <Sparkles size={14} /> {t("tasks.start")}
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
  const { t } = useTranslation();

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
    const ok = await ask(t("tasks.merge.message", { branch, main: list.mainBranch ?? "main" }), {
      title: t("tasks.merge.title"),
      okLabel: t("tasks.merge.ok"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    setBusy(branch);
    try {
      await ipc.worktreeMerge(main, branch);
      showToast(t("tasks.merge.done", { branch, main: list.mainBranch ?? "main" }), "success");
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
        ? `\n\n${t("tasks.remove.dirty", { count: dirty })}`
        : ahead > 0
          ? `\n\n${t("tasks.remove.ahead", { count: ahead, branch })}`
          : "";
    const ok = await ask(`${t("tasks.remove.message", { name: folderName(path) })}${warn}`, {
      title: t("tasks.remove.title"),
      kind: "warning",
      okLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    // Close tabs still working in that folder first.
    for (const p of Object.values(useStore.getState().panes)) {
      if (p.cwd.toLowerCase().startsWith(path.toLowerCase())) useStore.getState().closePane(p.id);
    }
    try {
      await ipc.worktreeRemove(main, path, branch, dirty > 0, ahead === 0);
      showToast(t("tasks.remove.done", { name: folderName(path) }), "success");
    } catch (e) {
      showToast(String(e), "error");
    }
    load();
  };

  return (
    <Section
      title={t("tasks.sectionTitle", { name: folderName(main) })}
      count={tasks.length || undefined}
      actions={
        <button
          aria-label={t("tasks.newTask")}
          title={t("tasks.newTask")}
          onClick={() => set({ newTaskOpen: true })}
          className="flex size-5 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg"
        >
          <Plus size={13} />
        </button>
      }
    >
      {tasks.length === 0 && (
        <button
          onClick={() => set({ newTaskOpen: true })}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12px] text-faint hover:bg-hover hover:text-fg"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-dashed border-line">
            <Layers size={13} />
          </span>
          {t("tasks.empty")}
        </button>
      )}
      {tasks.map((w) => {
        const name = folderName(w.path);
        return (
          <div key={w.path} className="group relative">
            <button
              onClick={() => openTab(w.path, "claude")}
              title={t("tasks.tooltip", { path: w.path, branch: w.branch ?? t("tasks.noBranch") })}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover"
            >
              <span className={`flex size-6 shrink-0 items-center justify-center rounded-md ${openPaneIn(w.path) ? "bg-accent-soft text-accent" : "bg-hover text-muted"}`}>
                <Layers size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-fg">{name}</span>
                <span className="flex items-center gap-1.5 truncate text-[11px] text-faint">
                  {busy === w.branch ? (
                    t("tasks.merging")
                  ) : (
                    <>
                      {w.dirty > 0 && <span className="text-attention">{t("tasks.uncommitted", { count: w.dirty })}</span>}
                      {w.ahead > 0 && <span className="text-done">{t("tasks.toMerge", { count: w.ahead })}</span>}
                      {w.dirty === 0 && w.ahead === 0 && <span>{t("tasks.noChanges")}</span>}
                    </>
                  )}
                </span>
              </span>
            </button>
            <div className={`absolute top-1/2 right-1 -translate-y-1/2 ${menu === w.path ? "block" : "hidden group-hover:block"}`}>
              <div className="relative">
                <button
                  aria-label={t("tasks.actions")}
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
                      { label: t("sidebar.newClaudeTabHere"), icon: <Sparkles size={14} />, onSelect: () => openTab(w.path, "claude") },
                      { label: t("sidebar.newTerminalTabHere"), icon: <SquareTerminal size={14} />, onSelect: () => openTab(w.path, "shell") },
                      ...(w.branch
                        ? [
                            {
                              label: w.ahead > 0 ? t("tasks.mergeInto", { branch: list.mainBranch ?? "main" }) : t("tasks.nothingToMerge"),
                              icon: <GitMerge size={14} />,
                              onSelect: () => (w.ahead > 0 ? void merge(w.branch!) : showToast(t("tasks.commitFirst"))),
                              separatorBefore: true,
                            },
                          ]
                        : []),
                      { label: t("tasks.delete"), icon: <Trash2 size={14} />, onSelect: () => void remove(w.path, w.branch, w.dirty, w.ahead) },
                    ]}
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </Section>
  );
}
