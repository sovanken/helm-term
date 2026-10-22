import { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ask, save } from "@tauri-apps/plugin-dialog";
import {
  ArrowUpRight,
  Camera,
  ChevronDown,
  Circle,
  Copy,
  Crop as CropIcon,
  Download,
  EyeOff,
  Grid2x2,
  Hash,
  Highlighter,
  Minus,
  Pencil,
  Redo2,
  Send,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { locale } from "../i18n";
import { ipc } from "../lib/ipc";
import { paneIds } from "../lib/layout";
import { insertText } from "../terminal/terminals";
import { quotePath } from "../lib/ipc";
import { cleanTitle, folderName, showToast, useStore } from "../state/store";
import { Menu, type MenuItem } from "../components/Menu";
import { box, COLORS, type Crop, exportPng, type Pt, render, type Shape, type Tool } from "./annotate";
import { type SnipFile, snipApi, startSnip } from "./snip";
import { ShimmerBlock } from "../components/Shimmer";

/** Labels are translated where shown (snip.editor.tools.<id>). */
const TOOLS: { id: Tool; icon: React.ReactNode; key: string }[] = [
  { id: "arrow", icon: <ArrowUpRight size={16} />, key: "a" },
  { id: "rect", icon: <Square size={15} />, key: "r" },
  { id: "ellipse", icon: <Circle size={15} />, key: "o" },
  { id: "line", icon: <Minus size={16} />, key: "l" },
  { id: "pen", icon: <Pencil size={15} />, key: "p" },
  { id: "highlight", icon: <Highlighter size={15} />, key: "h" },
  { id: "text", icon: <Type size={15} />, key: "t" },
  { id: "step", icon: <Hash size={15} />, key: "n" },
  { id: "blur", icon: <Grid2x2 size={15} />, key: "b" },
  { id: "redact", icon: <EyeOff size={15} />, key: "x" },
  { id: "crop", icon: <CropIcon size={15} />, key: "c" },
];

/** Labels under snip.editor.widths.<key>. */
const WIDTHS = [
  { id: 1, key: "thin" },
  { id: 2, key: "medium" },
  { id: 3, key: "thick" },
];

const notesPath = (png: string) => png.replace(/\.png$/i, ".json");
const editedPath = (png: string) => png.replace(/\.png$/i, ".edited.png");

function when(ms: number) {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString(locale(), { month: "short", day: "numeric" });
}

function Thumb({ file, active, onClick }: { file: SnipFile; active: boolean; onClick: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    ipc.previewFile(file.path).then((p) => alive && p.kind === "image" && setSrc(p.dataUrl), () => {});
    return () => {
      alive = false;
    };
  }, [file.path, file.modified]);
  return (
    <button onClick={onClick} className={`group w-full rounded-lg border p-1.5 text-left ${active ? "border-accent bg-accent-soft" : "border-transparent hover:bg-hover"}`}>
      <div className="checker flex h-20 items-center justify-center overflow-hidden rounded-md border border-line">
        {src && <img src={src} alt="" className="max-h-full max-w-full object-contain" />}
      </div>
      <p className="mt-1 truncate px-0.5 text-[11px] text-faint">{when(file.modified)}</p>
    </button>
  );
}

/** One snip open for marking up. Shapes are kept next to the image (<name>.json). */
function Editor({ path, onDeleted }: { path: string; onDeleted: () => void }) {
  const { t } = useTranslation();
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [hist, setHist] = useState<{ shapes: Shape[]; redo: Shape[] }>({ shapes: [], redo: [] });
  const { shapes, redo } = hist;
  const setShapes = (shapes: Shape[]) => setHist({ shapes, redo: [] });
  const [crop, setCrop] = useState<Crop | null>(null);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(2);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [cropDraft, setCropDraft] = useState<Crop | null>(null);
  const [typing, setTyping] = useState<{ at: Pt; text: string } | null>(null);
  const [sendMenu, setSendMenu] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const loaded = useRef(false);

  // Scale for line widths and text, so marks look the same on small and large snips.
  const unit = image ? Math.max(1, Math.max(image.naturalWidth, image.naturalHeight) / 1400) : 1;
  const stroke = [3, 5, 8][width - 1] * unit;

  useEffect(() => {
    loaded.current = false;
    setHist({ shapes: [], redo: [] });
    setCrop(null);
    let alive = true;
    ipc.previewFile(path).then(async (p) => {
      if (!alive || p.kind !== "image") return;
      const img = new Image();
      img.src = p.dataUrl;
      await img.decode();
      const notes = await ipc.readTextFile(notesPath(path)).catch(() => null);
      if (!alive) return;
      if (notes) {
        try {
          const saved = JSON.parse(notes) as { shapes: Shape[]; crop: Crop | null };
          setShapes(saved.shapes ?? []);
          setCrop(saved.crop ?? null);
        } catch {
          // Unreadable notes: start clean.
        }
      }
      setImage(img);
      loaded.current = true;
    });
    return () => {
      alive = false;
    };
  }, [path]);

  // Keep the marks next to the image so reopening shows them.
  useEffect(() => {
    if (!loaded.current) return;
    const timer = setTimeout(() => void ipc.writeTextFile(notesPath(path), JSON.stringify({ shapes, crop })).catch(() => {}), 400);
    return () => clearTimeout(timer);
  }, [shapes, crop, path]);

  // Fit the picture in the space available.
  useEffect(() => {
    const el = wrap.current;
    if (!el || !image) return;
    const measure = () => {
      const w = crop?.w ?? image.naturalWidth;
      const h = crop?.h ?? image.naturalHeight;
      setFit(Math.min(1, (el.clientWidth - 48) / w, (el.clientHeight - 48) / h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [image, crop]);

  const paint = useCallback(() => {
    const c = canvas.current;
    if (!c || !image) return;
    const dpr = window.devicePixelRatio || 1;
    const view = crop ?? { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight };
    const showCrop = tool === "crop";
    const area = showCrop ? { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight } : view;
    c.width = Math.round(area.w * fit * dpr);
    c.height = Math.round(area.h * fit * dpr);
    c.style.width = `${area.w * fit}px`;
    c.style.height = `${area.h * fit}px`;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(fit * dpr, 0, 0, fit * dpr, -area.x * fit * dpr, -area.y * fit * dpr);
    render(ctx, image, draft ? [...shapes, draft] : shapes, unit);
    if (showCrop) {
      // Dim what's outside the crop.
      const r = cropDraft ?? crop;
      if (r) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.beginPath();
        ctx.rect(0, 0, image.naturalWidth, image.naturalHeight);
        ctx.rect(r.x, r.y + r.h, r.w, -r.h);
        ctx.fill("evenodd");
        ctx.strokeStyle = "#e7a85a";
        ctx.lineWidth = 2 / fit;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
    }
  }, [image, shapes, draft, crop, cropDraft, fit, tool, unit]);

  useEffect(paint, [paint]);

  const toImage = (e: React.PointerEvent): Pt => {
    const rect = canvas.current!.getBoundingClientRect();
    const origin = tool === "crop" || !crop ? { x: 0, y: 0 } : crop;
    return { x: (e.clientX - rect.left) / fit + origin.x, y: (e.clientY - rect.top) / fit + origin.y };
  };

  const add = (s: Shape) => setHist((h) => ({ shapes: [...h.shapes, s], redo: [] }));

  const undo = () => setHist((h) => (h.shapes.length ? { shapes: h.shapes.slice(0, -1), redo: [...h.redo, h.shapes[h.shapes.length - 1]] } : h));
  const redoOne = () => setHist((h) => (h.redo.length ? { shapes: [...h.shapes, h.redo[h.redo.length - 1]], redo: h.redo.slice(0, -1) } : h));

  const commitText = () => {
    if (typing?.text.trim()) add({ kind: "text", at: typing.at, text: typing.text, color, size: [22, 32, 46][width - 1] * unit });
    setTyping(null);
  };

  /** The finished picture as a file: the original if nothing was marked, else an edited copy. */
  const output = async () => {
    if (!image) throw new Error(t("snip.editor.notLoaded"));
    if (!shapes.length && !crop) return path;
    const blob = await exportPng(image, shapes, crop, unit);
    const data = await new Promise<string>((r) => {
      const fr = new FileReader();
      fr.onload = () => r(String(fr.result).split(",")[1]);
      fr.readAsDataURL(blob);
    });
    await ipc.writeFileBase64(editedPath(path), data);
    return editedPath(path);
  };

  const copy = async () => {
    try {
      await snipApi.copy(await output());
      showToast(t("snip.toast.copied"), "success");
    } catch (e) {
      showToast(t("snip.editor.copyFailed", { error: String(e) }), "error");
    }
  };

  const saveAs = async () => {
    const name = path.split(/[\\/]/).pop()!.replace(/^snip-/, "Screenshot ");
    const to = await save({ title: t("snip.editor.saveTitle"), defaultPath: name, filters: [{ name: t("snip.editor.pngFilter"), extensions: ["png"] }] });
    if (!to) return;
    try {
      const from = await output();
      const p = await ipc.previewFile(from);
      if (p.kind !== "image") throw new Error(t("snip.editor.unreadable"));
      await ipc.writeFileBase64(to, p.dataUrl.split(",")[1]);
      showToast(t("tools.shared.savedFile", { name: to.split(/[\\/]/).pop() }), "success");
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const claudePanes = Object.values(useStore((s) => s.panes)).filter((p) => p.kind !== "browser" && (p.claudeActive || p.kind === "claude"));
  const sendTo = async (paneId: string) => {
    try {
      const file = await output();
      const s = useStore.getState();
      const tab = s.tabs.find((x) => paneIds(x.root).includes(paneId));
      s.set({ view: "terminal" });
      if (tab) s.setActiveTab(tab.id);
      s.focusPane(paneId);
      // The image path must be its own paste for Claude Code to attach it.
      insertText(paneId, quotePath(file));
      insertText(paneId, " ");
      showToast(t("snip.editor.sentToClaude"), "success");
    } catch (e) {
      showToast(String(e), "error");
    }
  };
  const sendItems: MenuItem[] = claudePanes.map((p) => ({
    label: cleanTitle(p.title) || folderName(p.cwd),
    hint: folderName(p.cwd),
    onSelect: () => void sendTo(p.id),
  }));

  const remove = async () => {
    const yes = await ask(t("snip.editor.deleteConfirm"), { title: t("snip.editor.deleteTitle"), kind: "warning", okLabel: t("common.delete"), cancelLabel: t("common.cancel") });
    if (!yes) return;
    await snipApi.remove(path).catch((e) => showToast(String(e), "error"));
    onDeleted();
  };

  // Shortcuts: tool letters, Ctrl+Z / Ctrl+Y, Ctrl+C copy, Ctrl+S save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing || (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === "z") (e.preventDefault(), e.shiftKey ? redoOne() : undo());
      else if (e.ctrlKey && k === "y") (e.preventDefault(), redoOne());
      else if (e.ctrlKey && k === "c") (e.preventDefault(), void copy());
      else if (e.ctrlKey && k === "s") (e.preventDefault(), void saveAs());
      else if (!e.ctrlKey && !e.altKey) {
        const found = TOOLS.find((x) => x.key === k);
        if (found) setTool(found.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const nextStep = shapes.filter((s) => s.kind === "step").length + 1;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-3 py-1.5">
        {TOOLS.map((x) => (
          <button
            key={x.id}
            title={t("snip.withKey", { label: t(`snip.editor.tools.${x.id}`), key: x.key.toUpperCase() })}
            aria-label={t(`snip.editor.tools.${x.id}`)}
            aria-pressed={tool === x.id}
            onClick={() => setTool(x.id)}
            className={`flex size-8 items-center justify-center rounded-md ${tool === x.id ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-fg"}`}
          >
            {x.icon}
          </button>
        ))}
        <span className="mx-1.5 h-5 w-px bg-line" />
        {COLORS.map((c) => (
          <button
            key={c}
            aria-label={t("snip.editor.colorLabel", { color: c })}
            onClick={() => setColor(c)}
            className={`size-5 rounded-full border ${color === c ? "ring-2 ring-accent ring-offset-1 ring-offset-[var(--surface)]" : ""} border-line`}
            style={{ background: c }}
          />
        ))}
        <label className="relative size-5 cursor-pointer overflow-hidden rounded-full border border-line" title={t("snip.editor.otherColor")} style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute inset-0 opacity-0" />
        </label>
        <span className="mx-1.5 h-5 w-px bg-line" />
        {WIDTHS.map((w) => (
          <button
            key={w.id}
            title={t(`snip.editor.widths.${w.key}`)}
            aria-label={t(`snip.editor.widthLines.${w.key}`)}
            onClick={() => setWidth(w.id)}
            className={`flex size-8 items-center justify-center rounded-md ${width === w.id ? "bg-hover" : "hover:bg-hover"}`}
          >
            <span className="rounded-full bg-fg" style={{ width: 16, height: w.id * 2 }} />
          </button>
        ))}
        <span className="mx-1.5 h-5 w-px bg-line" />
        <button title={t("snip.editor.undoTitle")} aria-label={t("snip.editor.undo")} disabled={!shapes.length} onClick={undo} className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-30">
          <Undo2 size={15} />
        </button>
        <button title={t("snip.editor.redoTitle")} aria-label={t("snip.editor.redo")} disabled={!redo.length} onClick={redoOne} className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-30">
          <Redo2 size={15} />
        </button>
        {crop && (
          <button onClick={() => setCrop(null)} className="ml-1 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg">
            {t("snip.editor.undoCrop")}
          </button>
        )}
        <span className="flex-1" />
        <button title={t("snip.editor.deleteThis")} aria-label={t("common.delete")} onClick={() => void remove()} className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-danger">
          <Trash2 size={15} />
        </button>
        <button onClick={() => void saveAs()} title={t("snip.editor.saveAsTitle")} className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12.5px] text-fg hover:bg-hover">
          <Download size={14} /> {t("tools.shared.saveAs")}
        </button>
        <button onClick={() => void copy()} title={t("snip.editor.copyTitle")} className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12.5px] text-fg hover:bg-hover">
          <Copy size={14} /> {t("common.copy")}
        </button>
        <div className="relative">
          <button
            onClick={() => (claudePanes.length === 1 ? void sendTo(claudePanes[0].id) : claudePanes.length ? setSendMenu(!sendMenu) : showToast(t("snip.editor.needClaude"), "error"))}
            className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[12.5px] font-medium text-on-accent hover:opacity-90"
          >
            <Send size={14} /> {t("snip.editor.send")} {claudePanes.length > 1 && <ChevronDown size={13} />}
          </button>
          {sendMenu && <Menu align="right" items={sendItems} onClose={() => setSendMenu(false)} />}
        </div>
      </div>

      <div ref={wrap} className="checker relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
        {image ? (
          <div className="relative shadow-lg shadow-black/20">
            <canvas
              ref={canvas}
              className={tool === "text" ? "cursor-text" : "cursor-crosshair"}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                const p = toImage(e);
                if (typing) return commitText();
                // Text boxes open on click (after the mouse is released), so the click can't take focus away from them.
                if (tool === "text") return;
                if (tool === "step") return add({ kind: "step", at: p, n: nextStep, color, size: [14, 18, 24][width - 1] * unit });
                e.currentTarget.setPointerCapture(e.pointerId);
                if (tool === "crop") return setCropDraft({ x: p.x, y: p.y, w: 0, h: 0 });
                if (tool === "pen" || tool === "highlight") setDraft({ kind: tool, points: [p], color, width: stroke });
                else setDraft({ kind: tool, a: p, b: p, color, width: stroke } as Shape);
              }}
              onPointerMove={(e) => {
                const p = toImage(e);
                if (tool === "crop" && cropDraft && e.buttons) {
                  setCropDraft((c) => (c ? { ...c, w: p.x - c.x, h: p.y - c.y } : c));
                  return;
                }
                if (!draft) return;
                if (draft.kind === "pen" || draft.kind === "highlight") setDraft({ ...draft, points: [...draft.points, p] });
                else if ("b" in draft) setDraft({ ...draft, b: e.shiftKey && (draft.kind === "rect" || draft.kind === "ellipse") ? { x: p.x, y: draft.a.y + Math.sign(p.y - draft.a.y) * Math.abs(p.x - draft.a.x) } : p });
              }}
              onClick={(e) => {
                if (tool === "text" && !typing) setTyping({ at: toImage(e as unknown as React.PointerEvent), text: "" });
              }}
              onPointerUp={() => {
                if (tool === "crop" && cropDraft) {
                  const r = box({ x: cropDraft.x, y: cropDraft.y }, { x: cropDraft.x + cropDraft.w, y: cropDraft.y + cropDraft.h });
                  const clamped = image && { x: Math.max(0, r.x), y: Math.max(0, r.y), w: Math.min(image.naturalWidth, r.x + r.w) - Math.max(0, r.x), h: Math.min(image.naturalHeight, r.y + r.h) - Math.max(0, r.y) };
                  if (clamped && clamped.w > 8 && clamped.h > 8) {
                    setCrop(clamped);
                    setTool("arrow");
                  }
                  setCropDraft(null);
                  return;
                }
                if (!draft) return;
                const big = "b" in draft ? Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y) > 3 : draft.kind === "pen" || draft.kind === "highlight" ? draft.points.length > 1 : true;
                if (big) add(draft);
                setDraft(null);
              }}
            />
            {typing && (
              <textarea
                autoFocus
                value={typing.text}
                onChange={(e) => setTyping({ ...typing, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), commitText());
                  if (e.key === "Escape") setTyping(null);
                }}
                onBlur={commitText}
                placeholder={t("snip.editor.textPlaceholder")}
                rows={1}
                className="absolute min-w-40 resize-none rounded border border-dashed border-accent bg-black/20 px-1 font-semibold outline-none"
                style={{
                  left: (typing.at.x - (crop?.x ?? 0)) * fit,
                  top: (typing.at.y - (crop?.y ?? 0)) * fit,
                  color,
                  fontSize: [22, 32, 46][width - 1] * unit * fit,
                  lineHeight: 1.25,
                }}
              />
            )}
          </div>
        ) : (
          <ShimmerBlock className="aspect-video w-full max-w-3xl" />
        )}
      </div>
      {image && (
        <p className="shrink-0 border-t border-line px-4 py-1.5 text-[11.5px] text-faint">
          {t(tool === "crop" ? "snip.editor.footer.crop" : tool === "text" ? "snip.editor.footer.text" : tool === "step" ? "snip.editor.footer.step" : "snip.editor.footer.other", {
            w: Math.round(crop?.w ?? image.naturalWidth),
            h: Math.round(crop?.h ?? image.naturalHeight),
            n: nextStep,
          })}
        </p>
      )}
    </div>
  );
}

/** The Screenshots tab: past snips on the left, the open one in the editor. */
export function SnipsPage() {
  const { t } = useTranslation();
  const current = useStore((s) => s.snipPath);
  const [files, setFiles] = useState<SnipFile[] | null>(null);
  const [delayMenu, setDelayMenu] = useState(false);

  const refresh = useCallback(() => {
    void snipApi.list().then((list) => {
      setFiles(list);
      const s = useStore.getState();
      if (!s.snipPath || !list.some((f) => f.path === s.snipPath)) s.set({ snipPath: list[0]?.path ?? null });
    });
  }, []);
  useEffect(refresh, [refresh, current]);

  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col border-r border-line">
        <div className="flex gap-1 p-2.5">
          <button onClick={() => startSnip(0)} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-accent text-[12.5px] font-medium text-on-accent hover:opacity-90">
            <Camera size={14} /> {t("snip.page.newScreenshot")}
          </button>
          <div className="relative">
            <button aria-label={t("snip.page.delay")} title={t("snip.page.delay")} onClick={() => setDelayMenu(!delayMenu)} className="flex size-8 items-center justify-center rounded-md border border-line text-muted hover:bg-hover hover:text-fg">
              <ChevronDown size={14} />
            </button>
            {delayMenu && (
              <Menu
                align="right"
                onClose={() => setDelayMenu(false)}
                items={[3, 5, 10].map((n) => ({ label: t("snip.page.delayItem", { count: n }), onSelect: () => startSnip(n) }))}
              />
            )}
          </div>
        </div>
        <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-3">
          {files?.map((f) => (
            <Thumb key={f.path} file={f} active={f.path === current} onClick={() => useStore.getState().set({ snipPath: f.path })} />
          ))}
          {files?.length === 0 && <p className="px-1 text-[12px] text-faint">{t("snip.page.empty")}</p>}
        </div>
      </aside>
      {current ? (
        <Editor key={current} path={current} onDeleted={refresh} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Camera size={28} className="text-faint" />
          <p className="max-w-sm text-[13px] text-muted">
            <Trans
              i18nKey="snip.page.intro"
              values={{ keys: useStore.getState().settings.snipShortcut || t("snip.page.shortcutOff") }}
              components={[<kbd className="rounded border border-line px-1 text-[11.5px]" />]}
            />
          </p>
          <button onClick={() => startSnip(0)} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-on-accent hover:opacity-90">
            <Camera size={14} /> {t("snip.page.newScreenshot")}
          </button>
        </div>
      )}
    </div>
  );
}
