// A browser pane: toolbar, device frame and the real page (a native view Helm keeps lined up
// with the frame), plus the start page and the problems list.

import { type ReactNode, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  Camera,
  Check,
  ExternalLink,
  Globe,
  Lock,
  Monitor,
  MousePointerClick,
  RotateCw,
  RotateCwSquare,
  Send,
  Smartphone,
  Tablet,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import { browser, displayUrl, sendProblemsToClaude, sendScreenshotToClaude } from "../lib/browser";
import { DEVICES, deviceById, screenSize } from "../lib/devices";
import { type PageProblem, showToast, useStore } from "../state/store";
import { Menu, type MenuItem } from "./Menu";
import { bezelFor, DeviceFrame } from "./DeviceFrame";
import { useTranslation } from "react-i18next";
import { locale } from "../i18n";

const GROUP_LABEL: Record<string, string> = { Phones: "browser.groups.phones", Tablets: "browser.groups.tablets", Computers: "browser.groups.computers" };

const OVERLAYS = '[role="menu"],[role="dialog"],[role="alertdialog"],[role="listbox"],dialog[open],[data-overlay]';

/** True when a menu, dialog or approval card overlaps the page (native views draw above them). */
function covered(r: DOMRect) {
  // A modal dialog dims the whole window, so every page steps aside while it's open.
  if (document.querySelector("dialog[open]:modal")) return true;
  for (const el of document.querySelectorAll(OVERLAYS)) {
    const o = el.getBoundingClientRect();
    if (o.width && o.height && o.left < r.right && o.right > r.left && o.top < r.bottom && o.bottom > r.top) return true;
  }
  return false;
}

function ToolButton({ label, onClick, disabled, active, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-7 shrink-0 items-center justify-center rounded-md disabled:opacity-35 enabled:hover:bg-hover enabled:hover:text-fg ${active ? "bg-accent-soft text-accent" : "text-muted"}`}
    >
      {children}
    </button>
  );
}

function StartPage({ onOpen }: { onOpen: (url: string) => void }) {
  const { t } = useTranslation();
  const servers = useStore((s) => s.devServers);
  const [value, setValue] = useState("");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Globe size={20} />
        </span>
        <h2 className="text-[15px] font-semibold text-fg">{t("browser.start.title")}</h2>
        <p className="max-w-sm text-[12.5px] leading-relaxed text-muted">{t("browser.start.body")}</p>
      </div>
      <form
        className="flex w-full max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onOpen(value.trim());
        }}
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("browser.start.placeholder")}
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 text-[13px] text-fg placeholder:text-faint focus:border-accent"
        />
        <button className="h-9 rounded-lg bg-accent px-3.5 text-[13px] font-medium text-on-accent hover:opacity-90">{t("common.open")}</button>
      </form>
      {servers.length > 0 && (
        <div className="w-full max-w-md">
          <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-faint uppercase">{t("browser.start.running")}</div>
          <div className="overflow-hidden rounded-lg border border-line bg-raised">
            {servers.map((u) => (
              <button key={u} onClick={() => onOpen(u)} className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left text-[13px] last:border-b-0 hover:bg-hover">
                <span className="size-1.5 rounded-full bg-done" />
                <span className="truncate font-mono text-[12.5px] text-fg">{displayUrl(u)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProblemsPanel({ problems, onSend, onSendOne, onClear, onClose }: { problems: PageProblem[]; onSend: () => void; onSendOne: (p: PageProblem) => void; onClear: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="dialog" aria-label={t("browser.problems.label")} className="anim-pop absolute top-11 right-2 z-30 flex max-h-[min(460px,70vh)] w-[min(460px,calc(100%-16px))] flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-lg shadow-black/20">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[13px] font-semibold text-fg">{t("browser.problems.title")}</span>
        <span className="text-[12px] text-faint">{problems.length}</span>
        <button onClick={onClose} aria-label={t("common.close")} className="ml-auto flex size-6 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-fg">
          <X size={13} />
        </button>
      </div>
      {problems.length === 0 ? (
        <p className="px-3 py-6 text-center text-[12.5px] text-faint">{t("browser.problems.empty")}</p>
      ) : (
        <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {[...problems].reverse().map((p, i) => (
            <li key={i} className="group flex items-start gap-2 border-b border-line px-3 py-2 last:border-b-0">
              <TriangleAlert size={13} className={`mt-0.5 shrink-0 ${p.level === "error" ? "text-danger" : "text-attention"}`} />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-3 font-mono text-[11.5px] leading-relaxed break-words text-fg select-text">{p.text}</div>
                <div className="mt-0.5 truncate text-[11px] text-faint">
                  {p.source === "network" ? t("browser.problems.request") : p.source === "exception" ? t("browser.problems.uncaught") : p.source === "console" ? t("browser.problems.console") : t("statusBar.browser")}
                  {p.at && ` · ${p.at}`}
                </div>
              </div>
              <button onClick={() => onSendOne(p)} title={t("browser.problems.sendOne")} className="shrink-0 rounded-md p-1 text-faint opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-fg">
                <Send size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          <button onClick={onClear} className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg">
            <Trash2 size={12} /> {t("browser.problems.clear")}
          </button>
          <button onClick={onSend} className="ml-auto flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent hover:opacity-90">
            <Send size={12} /> {t("browser.problems.sendAll")}
          </button>
        </div>
      )}
    </div>
  );
}

function CustomSize({ onApply, onClose }: { onApply: (w: number, h: number) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [w, setW] = useState("390");
  const [h, setH] = useState("844");
  const ok = (v: string) => Number(v) >= 200 && Number(v) <= 4000;
  return (
    <form
      role="dialog"
      aria-label={t("browser.customSize")}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok(w) && ok(h)) onApply(Number(w), Number(h));
      }}
      className="anim-pop absolute top-11 right-24 z-30 flex items-center gap-2 rounded-xl border border-line bg-raised p-2.5 shadow-lg shadow-black/20"
    >
      <input autoFocus value={w} onChange={(e) => setW(e.target.value.replace(/\D/g, ""))} aria-label={t("browser.width")} className="h-8 w-16 rounded-md border border-line bg-bg px-2 text-center text-[12.5px] tabular-nums focus:border-accent" />
      <span className="text-faint">×</span>
      <input value={h} onChange={(e) => setH(e.target.value.replace(/\D/g, ""))} aria-label={t("browser.height")} className="h-8 w-16 rounded-md border border-line bg-bg px-2 text-center text-[12.5px] tabular-nums focus:border-accent" />
      <button disabled={!ok(w) || !ok(h)} className="h-8 rounded-md bg-accent px-3 text-[12.5px] font-medium text-on-accent disabled:opacity-40">{t("browser.apply")}</button>
      <button type="button" onClick={onClose} aria-label={t("common.cancel")} className="flex size-7 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-fg">
        <X size={13} />
      </button>
    </form>
  );
}

export function BrowserView({ paneId, visible }: { paneId: string; visible: boolean }) {
  const { t } = useTranslation();
  const pane = useStore((s) => s.panes[paneId]);
  const { updatePage, updatePane } = useStore.getState();
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const [created, setCreated] = useState(false);
  const [hiddenByOverlay, setHiddenByOverlay] = useState(false);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [address, setAddress] = useState(displayUrl(pane?.url));
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<"device" | "custom" | "problems" | null>(null);

  const url = pane?.url;
  const blank = !url || url === "about:blank";
  const page = pane?.page ?? {};
  const device = deviceById(page.device);
  const size = device ? screenSize(device, page.rotated) : null;
  const showFrame = useStore((s) => s.settings.deviceFrame);
  // Scale the screen (plus its device outline) to fit the panel; the outline's size depends on
  // the scale, so settle it in two passes.
  // A laptop's base sticks out 7% on each side of the screen.
  const overhang = showFrame && device?.group === "Computers" && !page.rotated ? 1.14 : 1;
  const fitWith = (extraW: number, extraH: number) =>
    size ? Math.max(0.1, Math.min(1, (stageSize.w - 32) / ((size.width + extraW) * overhang), (stageSize.h - 52 - extraH) / size.height)) : 1;
  let fit = fitWith(0, 0);
  let bezel = device && showFrame ? bezelFor(device, !!page.rotated, fit) : null;
  if (bezel) {
    fit = fitWith(bezel.left + bezel.right + 12, bezel.top + bezel.bottom + bezel.base + 8);
    bezel = bezelFor(device!, !!page.rotated, fit);
  }
  const problems = page.problems ?? [];
  const errors = problems.filter((p) => p.level === "error").length;

  useEffect(() => {
    if (!editing) setAddress(displayUrl(url));
  }, [url, editing]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Create the page view once there's an address (lib/browser closes it with the pane).
  useEffect(() => {
    if (blank || created) return;
    const el = frame.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const z = useStore.getState().settings.uiScale;
    browser
      .open(paneId, url!, { x: r.left * z, y: r.top * z, width: Math.max(1, r.width * z), height: Math.max(1, r.height * z) })
      .then(
        () => setCreated(true),
        (e) => showToast(t("browser.openFailed", { error: String(e) }), "error"),
      );
  }, [blank, created, paneId, url]);

  // Keep the native page exactly over its frame; hide it when the tab is hidden or covered.
  useEffect(() => {
    if (!created) return;
    let raf = 0;
    let last = "";
    const tick = () => {
      const el = frame.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const isCovered = covered(r);
        const show = visibleRef.current && r.width > 2 && r.height > 2 && !isCovered;
        const z = useStore.getState().settings.uiScale;
        const b = { x: Math.round(r.left * z), y: Math.round(r.top * z), width: Math.round(r.width * z), height: Math.round(r.height * z) };
        const key = show ? `${b.x},${b.y},${b.width},${b.height}` : "hidden";
        if (key !== last) {
          if (!show) void browser.visible(paneId, false).catch(() => {});
          else {
            void browser.bounds(paneId, b).catch(() => {});
            if (last === "hidden" || last === "") void browser.visible(paneId, true).catch(() => {});
          }
          last = key;
          setHiddenByOverlay(visibleRef.current && isCovered);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [created, paneId]);

  // Device emulation follows the chosen device, rotation and how much it's scaled to fit.
  const lastDevice = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!created) return;
    const z = useStore.getState().settings.uiScale;
    const prev = lastDevice.current;
    const current = page.device ?? "";
    lastDevice.current = current;
    if (prev === undefined && !current) return; // never emulated: nothing to undo
    const spec = device && size ? { width: size.width, height: size.height, scaleFactor: device.scaleFactor, mobile: device.mobile, touch: device.touch, userAgent: device.userAgent, fit: fit * z } : null;
    void browser.emulate(paneId, spec).then(
      // A different phone or tablet identity only reaches the site on the next load.
      () => prev !== current && void browser.go(paneId, "reload"),
      () => {},
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created, paneId, page.device, page.rotated, Math.round(fit * 1000)]);

  if (!pane) return null;

  const go = async (input: string) => {
    setEditing(false);
    if (!created) {
      updatePane(paneId, { url: input.includes("://") ? input : `${/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(input) ? "http" : "https"}://${input}` });
      return;
    }
    try {
      const target = await browser.navigate(paneId, input);
      updatePane(paneId, { url: target });
    } catch (e) {
      showToast(String(e), "error");
      setAddress(displayUrl(url));
    }
  };

  const deviceItems: MenuItem[] = [
    { label: t("browser.fillPane"), icon: <Monitor size={14} />, current: !device, onSelect: () => updatePage(paneId, { device: undefined, rotated: false }) },
    ...DEVICES.map((d, i) => ({
      label: d.label,
      hint: `${d.width}×${d.height}`,
      heading: i === 0 || DEVICES[i - 1].group !== d.group ? t(GROUP_LABEL[d.group] ?? d.group) : undefined,
      separatorBefore: i === 0 || DEVICES[i - 1].group !== d.group,
      icon: d.group === "Phones" ? <Smartphone size={14} /> : d.group === "Tablets" ? <Tablet size={14} /> : <Monitor size={14} />,
      current: page.device === d.id,
      onSelect: () => updatePage(paneId, { device: d.id, rotated: false }),
    })),
    { label: t("browser.customSizeMenu"), separatorBefore: true, current: page.device?.startsWith("custom:"), onSelect: () => setMenu("custom") },
    { label: t("browser.showFrame"), checked: showFrame, keepOpen: true, onSelect: () => useStore.getState().updateSettings({ deviceFrame: !showFrame }) },
  ];
  const DeviceIcon = !device ? Monitor : device.group === "Phones" ? Smartphone : device.group === "Tablets" ? Tablet : Monitor;
  const secure = url?.startsWith("https://");

  return (
    <div className="relative flex h-full flex-col bg-surface">
      <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-line px-1.5">
        <ToolButton label={t("common.back")} disabled={!page.canBack} onClick={() => void browser.go(paneId, "back")}>
          <ArrowLeft size={15} />
        </ToolButton>
        <ToolButton label={t("browser.forward")} disabled={!page.canForward} onClick={() => void browser.go(paneId, "forward")}>
          <ArrowRight size={15} />
        </ToolButton>
        <ToolButton label={page.loading ? t("browser.stop") : t("browser.reload")} disabled={!created} onClick={() => void browser.go(paneId, page.loading ? "stop" : "reload")}>
          {page.loading ? <X size={15} /> : <RotateCw size={14} />}
        </ToolButton>
        <form
          className="relative mx-1 flex h-7 min-w-0 flex-1 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            if (address.trim()) void go(address.trim());
          }}
        >
          <span className="pointer-events-none absolute left-2.5 text-faint">{secure ? <Lock size={11} /> : <Globe size={12} />}</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => {
              setEditing(true);
              e.target.select();
            }}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => e.key === "Escape" && (e.currentTarget.blur(), setAddress(displayUrl(url)))}
            placeholder={t("browser.addressPlaceholder")}
            spellCheck={false}
            className="h-7 w-full rounded-md border border-transparent bg-hover/70 pr-2 pl-7 font-mono text-[12px] text-fg placeholder:font-sans placeholder:text-faint focus:border-accent focus:bg-raised"
          />
          {page.loading && <span className="absolute right-0 bottom-0 left-0 h-0.5 overflow-hidden rounded-full"><span className="block h-full w-1/3 animate-[helm-sweep_1.2s_ease-in-out_infinite] bg-accent" /></span>}
        </form>

        <div className="relative flex shrink-0 items-center">
          <button
            onClick={() => setMenu((m) => (m === "device" ? null : "device"))}
            title={t("browser.sizeHint")}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] hover:bg-hover hover:text-fg ${device ? "bg-accent-soft text-accent" : "text-muted"}`}
          >
            <DeviceIcon size={14} />
            <span className="max-w-28 truncate">{device ? device.label : t("browser.size")}</span>
          </button>
          {menu === "device" && <Menu items={deviceItems} onClose={() => setMenu(null)} align="right" />}
        </div>
        {device && (
          <ToolButton label={t("browser.rotate")} onClick={() => updatePage(paneId, { rotated: !page.rotated })} active={page.rotated}>
            <RotateCwSquare size={15} />
          </ToolButton>
        )}
        <span className="mx-1 h-4 w-px shrink-0 bg-line" />
        <ToolButton
          label={page.picking ? t("browser.stopPicking") : t("browser.pick")}
          disabled={!created}
          active={page.picking}
          onClick={() => {
            const on = !page.picking;
            updatePage(paneId, { picking: on });
            void browser.pick(paneId, on).catch(() => updatePage(paneId, { picking: false }));
          }}
        >
          <MousePointerClick size={15} />
        </ToolButton>
        <ToolButton label={t("browser.sendScreenshot")} disabled={!created} onClick={() => void sendScreenshotToClaude(pane)}>
          <Camera size={15} />
        </ToolButton>
        <button
          onClick={() => setMenu((m) => (m === "problems" ? null : "problems"))}
          title={problems.length ? t("browser.problemCount", { count: problems.length }) : t("browser.noProblems")}
          className={`flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] hover:bg-hover ${errors ? "text-danger" : problems.length ? "text-attention" : "text-muted"} ${menu === "problems" ? "bg-hover" : ""}`}
        >
          {problems.length ? <TriangleAlert size={14} /> : <Check size={14} />}
          {problems.length > 0 && <span className="font-medium tabular-nums">{problems.length > 99 ? "99+" : problems.length}</span>}
        </button>
        <ToolButton label={t("titleBar.devTools")} disabled={!created} onClick={() => void browser.devtools(paneId)}>
          <Bug size={15} />
        </ToolButton>
        <ToolButton label={t("browser.openExternal")} disabled={blank} onClick={() => url && void openUrl(url)}>
          <ExternalLink size={14} />
        </ToolButton>
      </div>

      {page.picking && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-accent-soft px-3 py-1 text-[12px] text-accent">
          <MousePointerClick size={13} /> {t("browser.pickingBanner")}
          <button
            onClick={() => {
              updatePage(paneId, { picking: false });
              void browser.pick(paneId, false);
            }}
            className="ml-auto rounded px-1.5 font-medium hover:bg-accent/15"
          >
            {t("common.cancel")}
          </button>
        </div>
      )}

      <div ref={stage} className={`relative min-h-0 flex-1 overflow-hidden ${device ? "checker" : ""}`}>
        {blank ? (
          <StartPage onOpen={(u) => void go(u)} />
        ) : device && size ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
            <div className="text-[11.5px] text-muted tabular-nums">
              {device.label} · {size.width} × {size.height} · {(fit).toLocaleString(locale(), { style: "percent", maximumFractionDigits: 0 })}
            </div>
            {bezel ? (
              <DeviceFrame device={device} rotated={!!page.rotated} scale={fit}>
                <div ref={frame} data-browser-frame className="bg-white" style={{ width: Math.round(size.width * fit), height: Math.round(size.height * fit) }} />
              </DeviceFrame>
            ) : (
              <div className="rounded-[10px] border border-line bg-raised p-px">
                <div ref={frame} data-browser-frame className="bg-white" style={{ width: Math.round(size.width * fit), height: Math.round(size.height * fit) }} />
              </div>
            )}
          </div>
        ) : (
          <div ref={frame} data-browser-frame className="absolute inset-0 bg-white" />
        )}
        {hiddenByOverlay && !blank && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-surface/80 text-[12px] text-faint">{t("browser.paused")}</div>
        )}
      </div>

      {menu === "custom" && (
        <CustomSize
          onApply={(w, h) => {
            updatePage(paneId, { device: `custom:${w}x${h}`, rotated: false });
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {menu === "problems" && (
        <ProblemsPanel
          problems={problems}
          onClose={() => setMenu(null)}
          onClear={() => updatePage(paneId, { problems: [] })}
          onSend={() => {
            setMenu(null);
            sendProblemsToClaude(pane, problems);
          }}
          onSendOne={(p) => {
            setMenu(null);
            sendProblemsToClaude(pane, [p]);
          }}
        />
      )}
    </div>
  );
}
