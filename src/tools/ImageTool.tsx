import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ClipboardPaste, Download, ImageUp, Link2, Lock, LockOpen } from "lucide-react";
import { locale, t } from "../i18n";
import { ipc } from "../lib/ipc";
import { showToast } from "../state/store";
import { Button, Card, CopyButton, Hint, Label, Segmented } from "./ui";

type Format = "png" | "jpeg" | "webp";
const MIME: Record<Format, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

interface Source {
  name: string;
  url: string;
  bytes: number;
  width: number;
  height: number;
}

function size(n: number) {
  const fixed = (v: number, d: number) => v.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${fixed(n / 1024, 1)} KB` : `${fixed(n / 1024 / 1024, 2)} MB`;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t("tools.image.notImage")));
    img.src = url;
  });
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });

export default function ImageTool() {
  const { t } = useTranslation();
  const [src, setSrc] = useState<Source | null>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [lock, setLock] = useState(true);
  const [format, setFormat] = useState<Format>("webp");
  const [quality, setQuality] = useState(82);
  const [out, setOut] = useState<{ blob: Blob; url: string } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const take = async (name: string, url: string, bytes: number) => {
    try {
      const img = await loadImage(url);
      imgRef.current = img;
      setSrc({ name, url, bytes, width: img.naturalWidth, height: img.naturalHeight });
      setWidth(img.naturalWidth);
      setHeight(img.naturalHeight);
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e), "error");
    }
  };

  const choose = async () => {
    const path = await open({ multiple: false, title: t("tools.image.chooseTitle"), filters: [{ name: t("tools.image.imagesFilter"), extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "svg", "ico"] }] });
    if (typeof path !== "string") return;
    const p = await ipc.previewFile(path).catch((e) => (showToast(String(e), "error"), null));
    if (p?.kind === "image") void take(path.split(/[\\/]/).pop() ?? "image", p.dataUrl, p.size);
    else if (p?.kind === "tooLarge") showToast(t("tools.image.tooLarge"), "error");
    else if (p) showToast(t("tools.image.notImage"), "error");
  };

  // Ctrl+V with an image on the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      void take(t("tools.image.pastedName"), URL.createObjectURL(file), file.size);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // Re-encode whenever a setting changes.
  useEffect(() => {
    const img = imgRef.current;
    if (!src || !img || width < 1 || height < 1) return setOut(null);
    let made: string | null = null;
    let alive = true;
    const timer = setTimeout(() => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      if (format === "jpeg") {
        // JPEG has no transparency: put it on white instead of black.
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob || !alive) return;
          made = URL.createObjectURL(blob);
          setOut({ blob, url: made });
        },
        MIME[format],
        quality / 100,
      );
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
      if (made) URL.revokeObjectURL(made);
    };
  }, [src, width, height, format, quality]);

  const setW = (w: number) => {
    setWidth(w);
    if (lock && src) setHeight(Math.max(1, Math.round((w * src.height) / src.width)));
  };
  const setH = (h: number) => {
    setHeight(h);
    if (lock && src) setWidth(Math.max(1, Math.round((h * src.width) / src.height)));
  };

  const saveAs = async () => {
    if (!out || !src) return;
    const base = src.name.replace(/\.[^.]+$/, "");
    const path = await save({ title: t("tools.image.saveTitle"), defaultPath: `${base}-${width}x${height}.${format === "jpeg" ? "jpg" : format}`, filters: [{ name: format.toUpperCase(), extensions: [format === "jpeg" ? "jpg" : format] }] });
    if (!path) return;
    const data = (await toBase64(out.blob)).split(",")[1];
    await ipc.writeFileBase64(path, data).then(
      () => showToast(t("tools.shared.savedFile", { name: path.split(/[\\/]/).pop() }), "success"),
      (e) => showToast(String(e), "error"),
    );
  };

  const copyImage = async () => {
    if (!out) return;
    try {
      // The clipboard takes PNG only.
      const png = format === "png" ? out.blob : await new Promise<Blob>((resolve) => {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        c.getContext("2d")!.drawImage(imgRef.current!, 0, 0, width, height);
        c.toBlob((b) => resolve(b!), "image/png");
      });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      showToast(t("tools.image.copied"), "success");
    } catch (e) {
      showToast(t("tools.image.copyFailed", { error: String(e) }), "error");
    }
  };

  const [dataUri, setDataUri] = useState("");
  useEffect(() => {
    if (out) void toBase64(out.blob).then(setDataUri);
    else setDataUri("");
  }, [out]);

  if (!src)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center">
        <ImageUp size={28} className="text-faint" />
        <p className="text-[13px] text-muted">{t("tools.image.empty")}</p>
        <Button primary onClick={() => void choose()}>
          {t("tools.image.chooseButton")}
        </Button>
      </div>
    );

  const saved = out ? 1 - out.blob.size / src.bytes : 0;
  return (
    <div className="scroll-thin flex h-full gap-4 overflow-y-auto p-5">
      <div className="flex w-80 shrink-0 flex-col gap-4">
        <Card>
          <Label right={<Button onClick={() => void choose()}>{t("tools.image.change")}</Button>}>{t("tools.image.original")}</Label>
          <p className="truncate text-[13px] text-fg" title={src.name}>
            {src.name}
          </p>
          <p className="text-[12px] text-faint">
            {src.width} × {src.height} · {size(src.bytes)}
          </p>
        </Card>
        <Card>
          <Label>{t("tools.image.size")}</Label>
          <div className="flex items-center gap-2">
            <input type="number" min={1} max={16384} value={width} onChange={(e) => setW(Math.min(16384, +e.target.value || 1))} aria-label={t("tools.image.width")} className="h-8 w-24 rounded-md border border-line bg-bg px-2 font-mono text-[12.5px]" />
            <button aria-label={lock ? t("tools.image.unlock") : t("tools.image.lock")} title={lock ? t("tools.image.locked") : t("tools.image.unlocked")} onClick={() => setLock(!lock)} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
              {lock ? <Lock size={13} /> : <LockOpen size={13} />}
            </button>
            <input type="number" min={1} max={16384} value={height} onChange={(e) => setH(Math.min(16384, +e.target.value || 1))} aria-label={t("tools.image.height")} className="h-8 w-24 rounded-md border border-line bg-bg px-2 font-mono text-[12.5px]" />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[25, 50, 75, 100].map((p) => (
              <button key={p} onClick={() => (setWidth(Math.round((src.width * p) / 100)), setHeight(Math.round((src.height * p) / 100)))} className="rounded-md border border-line px-2 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-fg">
                {p}%
              </button>
            ))}
          </div>
        </Card>
        <Card>
          <Label>{t("tools.image.format")}</Label>
          <Segmented value={format} onChange={setFormat} options={[{ value: "webp", label: "WebP" }, { value: "jpeg", label: "JPG" }, { value: "png", label: "PNG" }]} />
          {format !== "png" && (
            <div className="mt-3 flex items-center gap-3">
              <span className="w-20 text-[12px] text-muted">{t("tools.image.qualityValue", { quality })}</span>
              <input type="range" min={10} max={100} value={quality} onChange={(e) => setQuality(+e.target.value)} className="flex-1 accent-[var(--accent)]" aria-label={t("tools.image.quality")} />
            </div>
          )}
          <div className="mt-2">
            <Hint>{format === "png" ? t("tools.image.hintPng") : format === "jpeg" ? t("tools.image.hintJpg") : t("tools.image.hintWebp")}</Hint>
          </div>
        </Card>
        <Card>
          <Label>{t("tools.image.result")}</Label>
          {out && (
            <p className="mb-3 text-[13px] text-fg">
              {size(out.blob.size)}{" "}
              <span className={saved > 0 ? "text-done" : "text-attention"}>
                {saved > 0 ? t("tools.image.smaller", { count: Math.round(saved * 100) }) : t("tools.image.larger", { count: Math.round(-saved * 100) })}
              </span>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button primary onClick={() => void saveAs()} disabled={!out}>
              <Download size={13} /> {t("tools.shared.saveAs")}
            </Button>
            <Button onClick={() => void copyImage()} disabled={!out}>
              <ClipboardPaste size={13} /> {t("tools.image.copyImage")}
            </Button>
            <CopyButton text={dataUri} label={t("tools.image.copyDataUri")} />
          </div>
          {dataUri.length > 200_000 && (
            <div className="mt-2 flex items-center gap-1.5">
              <Link2 size={12} className="text-faint" />
              <Hint>{t("tools.image.dataUriLarge", { size: size(dataUri.length) })}</Hint>
            </div>
          )}
        </Card>
      </div>
      <div className="checker flex min-w-0 flex-1 items-center justify-center rounded-lg border border-line p-4">
        {out && <img src={out.url} alt={t("tools.image.result")} className="max-h-full max-w-full object-contain" />}
      </div>
    </div>
  );
}
