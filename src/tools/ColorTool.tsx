import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, Check, Pipette, X } from "lucide-react";
import { contrast, formats, parseColor, type RGBA, toHex } from "./color";
import { Button, Card, Hint, Input, Label, loadData, saveData, ValueRow } from "./ui";

interface EyeDropperResult {
  sRGBHex: string;
}
declare global {
  interface Window {
    EyeDropper?: new () => { open: () => Promise<EyeDropperResult> };
  }
}

function Swatch({ color, size = 28, onClick, title }: { color: string; size?: number; onClick?: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title ?? color}
      className="checker shrink-0 overflow-hidden rounded-md border border-line"
      style={{ width: size, height: size }}
    >
      <span className="block size-full" style={{ background: color }} />
    </button>
  );
}

function Pass({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] ${ok ? "bg-done/15 text-done" : "bg-danger/15 text-danger"}`}>
      {ok ? <Check size={12} /> : <X size={12} />} {label}
    </span>
  );
}

export default function ColorTool() {
  const { t } = useTranslation();
  const [text, setText] = useState("#e7a85a");
  const [bgText, setBgText] = useState("#16171b");
  const [recent, setRecent] = useState<string[]>([]);
  const color = useMemo(() => parseColor(text), [text]);
  const bg = useMemo(() => parseColor(bgText), [bgText]);
  const canPick = typeof window.EyeDropper === "function";

  useEffect(() => {
    void loadData<string[]>("colors", []).then(setRecent);
  }, []);

  const remember = (c: RGBA) => {
    const hex = toHex(c);
    setRecent((list) => {
      const next = [hex, ...list.filter((x) => x !== hex)].slice(0, 24);
      void saveData("colors", next);
      return next;
    });
  };

  const pick = async () => {
    if (!window.EyeDropper) return;
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      setText(sRGBHex);
      const c = parseColor(sRGBHex);
      if (c) remember(c);
    } catch {
      // Esc cancels the picker.
    }
  };

  const ratio = color && bg ? contrast(color, bg) : null;

  return (
    <div className="scroll-thin h-full overflow-y-auto p-5">
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <Label>{t("tools.color.color")}</Label>
          <div className="flex items-center gap-2">
            <label className="checker relative size-10 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-line" title={t("tools.color.choose")}>
              <span className="block size-full" style={{ background: color ? toHex(color) : "transparent" }} />
              <input
                type="color"
                value={color ? toHex(color, false) : "#000000"}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => color && remember(color)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
            <Input
              mono
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => color && remember(color)}
              placeholder="#ff8800, rgb(255 136 0), hsl(32 100% 50%), oklch(…), tomato"
              className="flex-1"
            />
            {canPick && (
              <Button onClick={() => void pick()} primary title={t("tools.color.pickTitle")}>
                <Pipette size={13} /> {t("tools.color.pick")}
              </Button>
            )}
          </div>
          {!color && text.trim() && <div className="mt-2"><Hint error>{t("tools.color.invalid")}</Hint></div>}
          <div className="mt-3">
            {(color ? formats(color) : []).map((f) => (
              <ValueRow key={f.label} label={f.label} value={f.value} />
            ))}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <Label>{t("tools.color.contrast")}</Label>
            <div className="mb-3 flex items-center gap-2">
              <Swatch color={color ? toHex(color) : "transparent"} title={t("tools.color.textColor")} />
              <span className="w-20 text-[12px] text-muted">{t("tools.color.text")}</span>
              <button
                aria-label={t("tools.color.swapLabel")}
                title={t("tools.shared.swap")}
                onClick={() => {
                  setText(bgText);
                  setBgText(text);
                }}
                className="ml-auto flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
              >
                <ArrowLeftRight size={14} />
              </button>
            </div>
            <div className="mb-3 flex items-center gap-2">
              <Swatch color={bg ? toHex(bg) : "transparent"} title={t("tools.color.background")} />
              <span className="w-20 shrink-0 text-[12px] text-muted">{t("tools.color.background")}</span>
              <Input mono value={bgText} onChange={(e) => setBgText(e.target.value)} className="flex-1" />
            </div>
            <div className="rounded-lg border border-line p-4" style={{ background: bg ? toHex(bg) : undefined, color: color ? toHex(color) : undefined }}>
              <p className="text-[18px] font-semibold">{t("tools.color.sampleHeading")}</p>
              <p className="text-[13px]">{t("tools.color.sampleBody")}</p>
            </div>
            {ratio !== null && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="mr-1 text-[20px] font-semibold text-fg tabular-nums">{ratio.toFixed(2)}:1</span>
                <Pass ok={ratio >= 4.5} label={t("tools.color.passBody")} />
                <Pass ok={ratio >= 3} label={t("tools.color.passLarge")} />
                <Pass ok={ratio >= 7} label={t("tools.color.passBest")} />
              </div>
            )}
            <div className="mt-2">
              <Hint>{t("tools.color.contrastHint")}</Hint>
            </div>
          </Card>

          <Card>
            <Label right={recent.length > 0 && <button onClick={() => (setRecent([]), void saveData("colors", []))} className="text-[12px] text-faint hover:text-fg">{t("tools.shared.clear")}</button>}>
              {t("tools.color.recent")}
            </Label>
            {recent.length ? (
              <div className="flex flex-wrap gap-1.5">
                {recent.map((c) => (
                  <Swatch key={c} color={c} onClick={() => setText(c)} />
                ))}
              </div>
            ) : (
              <Hint>{t("tools.color.recentEmpty")}</Hint>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
