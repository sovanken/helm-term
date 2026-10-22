import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownUp } from "lucide-react";
import { locale, t } from "../i18n";
import { Card, CodeArea, CopyButton, Hint, Label, Segmented, ValueRow } from "./ui";

type Kind = "base64" | "url" | "html" | "jwt";

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder("utf-8", { fatal: true });

function b64encode(text: string, urlSafe = false) {
  const bin = Array.from(utf8.encode(text), (b) => String.fromCharCode(b)).join("");
  const out = btoa(bin);
  return urlSafe ? out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : out;
}

function b64decode(text: string) {
  const clean = text.trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = clean + "=".repeat((4 - (clean.length % 4)) % 4);
  const bin = atob(padded);
  return fromUtf8.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const HTML: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function htmlDecode(text: string) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${text.replace(/</g, "&lt;")}`, "text/html");
  return doc.body.textContent ?? "";
}

function convert(kind: Exclude<Kind, "jwt">, decode: boolean, input: string, urlSafe: boolean): string {
  if (kind === "base64") return decode ? b64decode(input) : b64encode(input, urlSafe);
  if (kind === "url") return decode ? decodeURIComponent(input.replace(/\+/g, " ")) : encodeURIComponent(input);
  return decode ? htmlDecode(input) : input.replace(/[&<>"']/g, (c) => HTML[c]);
}

function when(seconds: unknown) {
  if (typeof seconds !== "number") return "";
  const d = new Date(seconds * 1000);
  const diff = seconds * 1000 - Date.now();
  const rel = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  const mins = Math.round(diff / 60000);
  const ago = Math.abs(mins) < 60 ? rel.format(mins, "minute") : Math.abs(mins) < 2880 ? rel.format(Math.round(mins / 60), "hour") : rel.format(Math.round(mins / 1440), "day");
  return t("tools.encode.dateWithRelative", { date: d.toLocaleString(locale()), relative: ago });
}

function Jwt({ token }: { token: string }) {
  const { t } = useTranslation();
  const parsed = useMemo(() => {
    const parts = token.trim().split(".");
    if (parts.length < 2) return { error: t("tools.encode.jwtParts") };
    try {
      return { header: JSON.parse(b64decode(parts[0])) as Record<string, unknown>, payload: JSON.parse(b64decode(parts[1])) as Record<string, unknown> };
    } catch {
      return { error: t("tools.encode.jwtUnreadable") };
    }
  }, [token, t]);
  if (!token.trim()) return <Hint>{t("tools.encode.pasteToken")}</Hint>;
  if ("error" in parsed) return <Hint error>{parsed.error}</Hint>;
  const { header, payload } = parsed;
  const exp = typeof payload.exp === "number" ? payload.exp : null;
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <Label>{t("tools.encode.summary")}</Label>
        {exp !== null && (
          <p className={`mb-2 text-[13px] font-medium ${exp * 1000 < Date.now() ? "text-danger" : "text-done"}`}>
            {exp * 1000 < Date.now() ? t("tools.encode.expired") : t("tools.encode.notExpired")}
          </p>
        )}
        <ValueRow label={t("tools.encode.algorithm")} value={String(header.alg ?? "")} />
        {"sub" in payload && <ValueRow label={t("tools.encode.subject")} value={String(payload.sub)} />}
        {"iss" in payload && <ValueRow label={t("tools.encode.issuer")} value={String(payload.iss)} />}
        {"iat" in payload && <ValueRow label={t("tools.encode.issued")} value={when(payload.iat)} mono={false} />}
        {exp !== null && <ValueRow label={t("tools.encode.expires")} value={when(exp)} mono={false} />}
      </Card>
      <Card>
        <Label right={<CopyButton text={JSON.stringify(payload, null, 2)} />}>{t("tools.encode.payload")}</Label>
        <pre className="scroll-thin max-h-72 overflow-auto font-mono text-[12.5px] text-fg select-text">{JSON.stringify(payload, null, 2)}</pre>
      </Card>
      <Card>
        <Label right={<CopyButton text={JSON.stringify(header, null, 2)} />}>{t("tools.encode.header")}</Label>
        <pre className="font-mono text-[12.5px] text-fg select-text">{JSON.stringify(header, null, 2)}</pre>
      </Card>
      <Hint>{t("tools.encode.jwtNote")}</Hint>
    </div>
  );
}

export default function EncodeTool() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Kind>("base64");
  const [decode, setDecode] = useState(false);
  const [urlSafe, setUrlSafe] = useState(false);
  const [input, setInput] = useState("");

  const result = useMemo(() => {
    if (kind === "jwt" || !input) return { output: "", error: null as string | null };
    try {
      return { output: convert(kind, decode, input, urlSafe), error: null };
    } catch {
      return { output: "", error: kind === "base64" ? t("tools.encode.invalidBase64") : t("tools.encode.cantDecode") };
    }
  }, [kind, decode, input, urlSafe, t]);

  return (
    <div className="scroll-thin flex h-full flex-col overflow-y-auto p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "base64", label: "Base64" },
            { value: "url", label: "URL" },
            { value: "html", label: "HTML" },
            { value: "jwt", label: "JWT" },
          ]}
        />
        {kind !== "jwt" && (
          <Segmented
            value={decode ? "decode" : "encode"}
            onChange={(v) => setDecode(v === "decode")}
            options={[
              { value: "encode", label: t("tools.encode.encode") },
              { value: "decode", label: t("tools.encode.decode") },
            ]}
          />
        )}
        {kind === "base64" && !decode && (
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            <input type="checkbox" checked={urlSafe} onChange={(e) => setUrlSafe(e.target.checked)} className="accent-[var(--accent)]" /> {t("tools.encode.urlSafe")}
          </label>
        )}
      </div>
      {kind === "jwt" ? (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
          <div className="flex min-h-48 flex-col">
            <Label>{t("tools.encode.token")}</Label>
            <CodeArea value={input} onChange={(e) => setInput(e.target.value)} placeholder="eyJhbGciOi…" className="break-all" />
          </div>
          <div>
            <Jwt token={input} />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-32 flex-1 flex-col">
            <Label>{decode ? t("tools.encode.encodedText") : t("tools.encode.text")}</Label>
            <CodeArea value={input} onChange={(e) => setInput(e.target.value)} placeholder={decode ? t("tools.encode.encodedPlaceholder") : t("tools.encode.textPlaceholder")} invalid={!!result.error} />
          </div>
          <div className="flex items-center justify-center">
            <button
              title={t("tools.encode.swapTitle")}
              aria-label={t("tools.shared.swap")}
              onClick={() => {
                if (result.output) setInput(result.output);
                setDecode(!decode);
              }}
              className="flex size-8 items-center justify-center rounded-md border border-line text-muted hover:bg-hover hover:text-fg"
            >
              <ArrowDownUp size={14} />
            </button>
          </div>
          <div className="flex min-h-32 flex-1 flex-col">
            <Label right={<CopyButton text={result.output} />}>{decode ? t("tools.encode.decoded") : t("tools.encode.encoded")}</Label>
            <CodeArea value={result.output} readOnly />
            {result.error && (
              <div className="mt-2">
                <Hint error>{result.error}</Hint>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
