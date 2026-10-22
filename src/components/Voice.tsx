// The mic button on Claude tabs, the listening pill (centred above the bottom of the tab, with a
// live waveform and the words as you say them), and the first-use dialog that downloads the
// voice model.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Check, Mic, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ipc, type VoiceStatus } from "../lib/ipc";
import { stopVoice, toggleVoice, useVoice } from "../lib/voice";
import { useStore } from "../state/store";

/** Speech peaks are small numbers; a square root makes quiet voices visible. */
const loudness = (level: number) => Math.min(1, Math.sqrt(level) * 1.5);

/** Bars that move with the microphone level (the mic test in Settings). */
export function LevelBars({ level, bars = 5, className = "" }: { level: number; bars?: number; className?: string }) {
  const v = loudness(level);
  return (
    <span className={`flex h-3.5 items-center gap-[2px] ${className}`} aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const centre = 1 - Math.abs(i - (bars - 1) / 2) / bars;
        return <span key={i} className="w-[3px] rounded-full bg-current transition-[height] duration-75" style={{ height: `${Math.max(18, v * centre * 100)}%` }} />;
      })}
    </span>
  );
}

const BARS = 28;

/**
 * The live waveform, drawn on a canvas every frame: bars mirrored around the middle line, taller
 * towards the centre, each one spring-eased towards the voice level with its own gentle ripple,
 * plus a slow breath so it never looks frozen in a quiet room. While the model loads, a soft
 * wave travels across instead.
 */
function Waveform({ loading }: { loading: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const height = new Array<number>(BARS).fill(0);
    const speed = new Array<number>(BARS).fill(0);
    let level = 0;
    let frame = 0;
    let color = getComputedStyle(el).color;
    let colorAt = 0;
    const draw = (t: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      // The theme can change while listening.
      if (t - colorAt > 500) {
        color = getComputedStyle(el).color;
        colorAt = t;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      level += (loudness(useVoice.getState().level) - level) * 0.18;
      const gap = w / BARS;
      const bar = Math.max(2, gap * 0.42);
      for (let i = 0; i < BARS; i++) {
        const x = (i - (BARS - 1) / 2) / ((BARS - 1) / 2); // -1 … 1
        const envelope = Math.cos((x * Math.PI) / 2) ** 1.5; // taller in the middle
        let target: number;
        if (loadingRef.current) {
          target = 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(t / 260 - i * 0.45)) * envelope;
        } else {
          const ripple = 0.55 + 0.45 * Math.sin(t / 140 + i * 1.7) * Math.sin(t / 330 - i * 0.6);
          const breath = 0.1 + 0.05 * Math.sin(t / 700 + i * 0.35);
          target = breath + level * envelope * ripple * 0.95;
        }
        if (reduce) height[i] = target;
        else {
          // A damped spring: quick to rise, settles without wobbling too long.
          speed[i] = speed[i] * 0.72 + (target - height[i]) * 0.28;
          height[i] += speed[i];
        }
        const bh = Math.max(bar, Math.min(1, height[i]) * h);
        const bx = i * gap + (gap - bar) / 2;
        ctx.globalAlpha = 0.45 + 0.55 * envelope;
        ctx.beginPath();
        ctx.roundRect(bx, (h - bh) / 2, bar, bh, bar / 2);
        ctx.fill();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={canvas} className="h-8 w-[112px] shrink-0 text-accent" aria-hidden />;
}

/** The words: what's typed already (quiet) and the phrase being spoken, each word fading in. */
function Words({ typed, partial, loading, holdKey }: { typed: string[]; partial: string; loading: boolean; holdKey: string }) {
  const { t } = useTranslation();
  if (!typed.length && !partial) {
    return <span className="voice-word truncate text-muted">{loading ? t("voice.pill.loading") : holdKey ? t("voice.pill.listeningHold", { key: holdKey }) : t("voice.pill.listening")}</span>;
  }
  return <WordLine typed={typed} words={partial.split(/\s+/).filter(Boolean)} />;
}

/** One line that keeps the newest words in view, fading the start once it overflows. */
function WordLine({ typed, words }: { typed: string[]; words: string[] }) {
  const line = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const el = line.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
    setOverflow(el.scrollWidth > el.clientWidth + 1);
  });
  return (
    <span ref={line} className={`block min-w-0 overflow-hidden whitespace-nowrap ${overflow ? "voice-text" : ""}`}>
      {typed.length > 0 && <span className="text-muted">{typed.join(" ")} </span>}
      {words.map((w, i) => (
        <span key={`${i}-${w}`}>
          <span className="voice-word inline-block text-fg">{w}</span>
          {i < words.length - 1 && " "}
        </span>
      ))}
    </span>
  );
}

function VoicePill({ paneId }: { paneId: string }) {
  const { phase, paneId: target, partial, typed, held } = useVoice();
  const key = useStore((s) => s.settings.voiceHoldKey);
  const holdKey = held ? key : "";
  const { t } = useTranslation();
  const active = target === paneId && phase !== "idle";
  // Stay on screen a moment after stopping, to animate out.
  const [shown, setShown] = useState(active);
  const last = useRef({ partial, typed });
  if (active) last.current = { partial, typed };
  useEffect(() => {
    if (active) return setShown(true);
    const t = setTimeout(() => setShown(false), 340);
    return () => clearTimeout(t);
  }, [active]);
  if (!shown) return null;
  const loading = phase === "loading";
  const view = active ? { partial, typed } : last.current;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-16 z-20 flex justify-center px-4">
      <div className={`pointer-events-auto flex w-[min(580px,100%)] flex-col items-center gap-2 ${active ? "voice-open" : "voice-close"}`}>
        {/* A thin light travels around the edge while listening. */}
        <div className={`voice-ring w-full rounded-full p-px ${loading ? "voice-ring-fast" : ""}`}>
          <div className="voice-shell flex w-full items-center gap-3 rounded-full bg-surface py-1.5 pr-1.5 pl-4 shadow-[0_10px_40px_-12px_rgb(0_0_0/0.35)]">
            <div className="voice-content flex min-w-0 flex-1 items-center gap-3">
              <span className="relative flex size-2.5 shrink-0" aria-hidden>
                {!loading && <span className="voice-ping absolute inset-0 rounded-full bg-danger" />}
                <span className={`relative size-2.5 rounded-full transition-colors duration-300 ${loading ? "bg-faint" : "bg-danger"}`} />
              </span>
              <Waveform loading={loading} />
              <div className="min-w-0 flex-1 text-[13.5px]" aria-live="polite">
                <Words typed={view.typed} partial={view.partial} loading={loading} holdKey={holdKey} />
              </div>
              <button
                aria-label={t("common.cancel")}
                title={t("voice.pill.cancelTitle")}
                onClick={() => stopVoice(false)}
                className="voice-btn flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-fg"
              >
                <X size={15} />
              </button>
              <button
                aria-label={t("common.done")}
                title={t("voice.pill.doneTitle")}
                onClick={() => stopVoice(true)}
                className="voice-btn flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent"
              >
                <Check size={17} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
        <span className="voice-hint text-[11px] text-faint">{t("voice.pill.hint")}</span>
      </div>
    </div>
  );
}

export function VoiceButton({ paneId }: { paneId: string }) {
  const show = useStore((s) => s.settings.voiceButton);
  const holdKey = useStore((s) => s.settings.voiceHoldKey);
  const claude = useStore((s) => !!s.panes[paneId] && (s.panes[paneId].claudeActive || s.panes[paneId].kind === "claude"));
  const mine = useVoice((v) => v.paneId === paneId && v.phase !== "idle");
  const { t } = useTranslation();
  if (!claude) return null;

  return (
    <>
      <VoicePill paneId={paneId} />
      {(show || mine) && (
        <button
          aria-label={mine ? t("voice.button.stopLabel") : t("voice.title")}
          title={mine ? t("voice.button.stopTitle") : holdKey ? t("voice.button.speakHold", { key: holdKey }) : t("voice.button.speak")}
          onClick={() => toggleVoice(paneId)}
          className={`absolute right-3 bottom-3 z-20 flex size-9 items-center justify-center rounded-full border transition-all duration-200 ${
            mine ? "scale-90 border-transparent bg-danger/15 text-danger" : "border-line bg-surface text-muted opacity-70 hover:text-fg hover:opacity-100"
          }`}
        >
          <Mic size={16} />
        </button>
      )}
    </>
  );
}

/** First use: explains the download and shows its progress. */
export function VoiceSetupDialog() {
  const open = useVoice((s) => s.setupOpen);
  if (!open) return null;
  return <SetupBody onClose={() => useVoice.setState({ setupOpen: false })} />;
}

export function useVoiceInstall() {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; stage: string; error?: string } | null>(null);
  const refresh = () => void ipc.voiceStatus().then(setStatus);
  useEffect(() => {
    refresh();
    const un = listen<{ done: number; total: number; stage: string; error?: string }>("voice-install", ({ payload }) => {
      setProgress(payload);
      if (["done", "error", "cancelled"].includes(payload.stage)) refresh();
    });
    return () => void un.then((f) => f());
  }, []);
  const start = () => {
    setProgress({ done: 0, total: 0, stage: "downloading" });
    setStatus((s) => (s ? { ...s, installing: true } : s));
    void ipc.voiceInstall().catch(() => {});
  };
  return { status, progress, start, refresh };
}

export function InstallProgress({ progress }: { progress: { done: number; total: number; stage: string } }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const { t } = useTranslation();
  return (
    <div>
      <div className="h-1.5 overflow-hidden rounded-full bg-hover">
        {progress.stage === "unpacking" ? <div className="progress-indeterminate h-full w-1/3 rounded-full bg-accent" /> : <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />}
      </div>
      <div className="mt-1.5 flex justify-between text-[11.5px] text-faint tabular-nums">
        <span>{progress.stage === "unpacking" ? t("voice.install.unpacking") : t("voice.install.downloading")}</span>
        {progress.stage !== "unpacking" && progress.total > 0 && (
          <span>{t("voice.install.progress", { done: Math.round(progress.done / 1048576), total: Math.round(progress.total / 1048576) })}</span>
        )}
      </div>
    </div>
  );
}

function SetupBody({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { status, progress, start } = useVoiceInstall();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const busy = !!status?.installing || progress?.stage === "downloading" || progress?.stage === "unpacking";
  const done = status?.installed;
  const { t } = useTranslation();
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="m-auto w-[460px] max-w-[calc(100vw-32px)] rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl shadow-black/30 backdrop:bg-black/40"
    >
      <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Mic size={15} />
        </span>
        <h2 className="flex-1 text-[15px] font-semibold">{t("voice.title")}</h2>
        <button aria-label={t("common.close")} onClick={onClose} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <X size={15} />
        </button>
      </div>
      <div className="flex flex-col gap-3 px-5 py-4 text-[13px] leading-relaxed">
        {done ? (
          <p>{useStore.getState().settings.voiceHoldKey ? t("voice.setup.readyKey", { key: useStore.getState().settings.voiceHoldKey }) : t("voice.setup.ready")}</p>
        ) : (
          <>
            <p>
              {t("voice.setup.intro")}
            </p>
            <p className="text-muted">{t("voice.setup.size", { size: status?.downloadMb ?? 460 })}</p>
            {busy && progress && <InstallProgress progress={progress} />}
            {progress?.stage === "error" && <p className="text-danger">{progress.error}</p>}
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        {busy ? (
          <button onClick={() => void ipc.voiceCancelInstall()} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover hover:text-fg">
            {t("voice.setup.cancelDownload")}
          </button>
        ) : (
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover hover:text-fg">
            {done ? t("common.close") : t("voice.setup.notNow")}
          </button>
        )}
        {!done && (
          <button onClick={start} disabled={busy || !status} className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:opacity-90 disabled:opacity-40">
            {busy ? t("voice.install.downloading") : t("voice.setup.download")}
          </button>
        )}
      </div>
    </dialog>
  );
}
