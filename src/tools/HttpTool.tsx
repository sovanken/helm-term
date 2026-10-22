import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Loader2, Plus, Send, Trash2, X } from "lucide-react";
import { locale, t } from "../i18n";
import { type HttpResponse, ipc } from "../lib/ipc";
import { Button, CodeArea, CopyButton, Hint, Input, Label, loadData, saveData, Segmented } from "./ui";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

interface Saved {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
}

const blank = (): Saved => ({ id: crypto.randomUUID(), name: "", method: "GET", url: "http://localhost:3000/", headers: [["Accept", "application/json"]], body: "" });

function curl(r: Saved) {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const parts = [`curl -X ${r.method} ${q(r.url)}`];
  for (const [k, v] of r.headers) if (k.trim()) parts.push(`-H ${q(`${k}: ${v}`)}`);
  if (r.body && !["GET", "HEAD"].includes(r.method)) parts.push(`--data ${q(r.body)}`);
  return parts.join(" \\\n  ");
}

function prettyBody(res: HttpResponse) {
  if (res.binary) return t("tools.http.binaryBody", { count: res.size, size: res.size.toLocaleString(locale()) });
  const type = res.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
  if (type.includes("json") || /^\s*[[{]/.test(res.body)) {
    try {
      return JSON.stringify(JSON.parse(res.body), null, 2);
    } catch {
      // Not JSON after all.
    }
  }
  return res.body;
}

function size(n: number) {
  const one = (v: number) => v.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${one(n / 1024)} KB` : `${one(n / 1024 / 1024)} MB`;
}

export default function HttpTool() {
  const { t } = useTranslation();
  const [req, setReq] = useState<Saved>(blank);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [tab, setTab] = useState<"headers" | "body">("headers");
  const [resTab, setResTab] = useState<"body" | "headers">("body");
  const [res, setRes] = useState<HttpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadData<Saved[]>("requests", []).then(setSaved);
  }, []);

  const persist = (list: Saved[]) => {
    setSaved(list);
    void saveData("requests", list);
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setRes(await ipc.httpRequest({ method: req.method, url: req.url, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body }));
    } catch (e) {
      setRes(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const name = req.name || `${req.method} ${req.url.replace(/^https?:\/\//, "")}`;
    const item = { ...req, name };
    setReq(item);
    persist(saved.some((s) => s.id === item.id) ? saved.map((s) => (s.id === item.id ? item : s)) : [item, ...saved]);
  };

  const body = useMemo(() => (res ? prettyBody(res) : ""), [res]);
  const statusTone = !res ? "" : res.status < 300 ? "bg-done/15 text-done" : res.status < 400 ? "bg-attention/15 text-attention" : "bg-danger/15 text-danger";

  return (
    <div className="flex h-full">
      <aside className="scroll-thin flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line p-2.5">
        <Button onClick={() => (setReq(blank()), setRes(null), setError(null))}>
          <Plus size={13} /> {t("tools.http.newRequest")}
        </Button>
        <h3 className="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{t("tools.http.saved")}</h3>
        {saved.length === 0 && <p className="px-2 text-[12px] text-faint">{t("tools.http.savedEmpty")}</p>}
        {saved.map((s) => (
          <div key={s.id} className={`group flex items-center rounded-md ${s.id === req.id ? "bg-hover" : "hover:bg-hover"}`}>
            <button onClick={() => (setReq(s), setRes(null), setError(null))} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left">
              <span className="w-10 shrink-0 font-mono text-[10px] font-semibold text-accent">{s.method}</span>
              <span className="truncate text-[12px] text-fg">{s.name}</span>
            </button>
            <button aria-label={t("tools.http.deleteRequest", { name: s.name })} onClick={() => persist(saved.filter((x) => x.id !== s.id))} className="mr-1 hidden size-6 items-center justify-center rounded text-faint group-hover:flex hover:text-fg">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
        <div className="flex items-center gap-2">
          <select value={req.method} onChange={(e) => setReq({ ...req, method: e.target.value })} aria-label={t("tools.http.method")} className="h-8 rounded-md border border-line bg-bg px-2 font-mono text-[12.5px] font-semibold text-accent">
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <Input mono value={req.url} onChange={(e) => setReq({ ...req, url: e.target.value })} onKeyDown={(e) => e.key === "Enter" && void send()} placeholder="https://api.example.com/items" className="flex-1" aria-label={t("tools.http.address")} />
          <Button primary onClick={() => void send()} disabled={busy || !req.url.trim()}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {t("tools.http.send")}
          </Button>
          <Button onClick={save} title={t("tools.http.saveTitle")}>
            <Bookmark size={13} /> {t("common.save")}
          </Button>
          <CopyButton text={curl(req)} label={t("tools.http.copyCurl")} />
        </div>

        <div className="flex min-h-0 flex-[2] flex-col">
          <Label>
            <Segmented value={tab} onChange={setTab} options={[{ value: "headers", label: t("tools.http.headersCount", { n: req.headers.filter(([k]) => k.trim()).length }) }, { value: "body", label: t("tools.http.body") }]} />
          </Label>
          {tab === "headers" ? (
            <div className="scroll-thin flex flex-col gap-1.5 overflow-y-auto">
              {req.headers.map(([k, v], i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input mono value={k} placeholder={t("tools.http.headerName")} onChange={(e) => setReq({ ...req, headers: req.headers.map((h, j) => (j === i ? [e.target.value, h[1]] : h)) })} className="w-56" />
                  <Input mono value={v} placeholder={t("tools.http.headerValue")} onChange={(e) => setReq({ ...req, headers: req.headers.map((h, j) => (j === i ? [h[0], e.target.value] : h)) })} className="flex-1" />
                  <button aria-label={t("tools.http.removeHeader")} onClick={() => setReq({ ...req, headers: req.headers.filter((_, j) => j !== i) })} className="flex size-7 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg">
                    <X size={13} />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <Button onClick={() => setReq({ ...req, headers: [...req.headers, ["", ""]] })}>
                  <Plus size={13} /> {t("tools.http.addHeader")}
                </Button>
                {!req.headers.some(([k]) => k.toLowerCase() === "authorization") && (
                  <Button onClick={() => setReq({ ...req, headers: [...req.headers, ["Authorization", "Bearer "]] })}>{t("tools.http.addAuth")}</Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <CodeArea value={req.body} onChange={(e) => setReq({ ...req, body: e.target.value })} placeholder={'{\n  "name": "value"\n}'} />
              {["GET", "HEAD"].includes(req.method) && (
                <div className="mt-1.5">
                  <Hint>{t("tools.http.noBody")}</Hint>
                </div>
              )}
              {req.body.trim() && !req.headers.some(([k]) => k.toLowerCase() === "content-type") && (
                <div className="mt-1.5 flex items-center gap-2">
                  <Hint>{t("tools.http.noContentType")}</Hint>
                  <button onClick={() => setReq({ ...req, headers: [...req.headers, ["Content-Type", "application/json"]] })} className="text-[12px] text-accent hover:underline">
                    {t("tools.http.addJson")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex min-h-0 flex-[3] flex-col border-t border-line pt-3">
          <Label
            right={
              res && (
                <>
                  <span className={`rounded-md px-2 py-0.5 font-mono text-[12px] font-semibold ${statusTone}`}>
                    {res.status} {res.statusText}
                  </span>
                  <span className="text-[12px] text-faint">
                    {res.timeMs} ms · {size(res.size)}
                  </span>
                  <CopyButton text={resTab === "body" ? body : res.headers.map(([k, v]) => `${k}: ${v}`).join("\n")} />
                </>
              )
            }
          >
            <Segmented value={resTab} onChange={setResTab} options={[{ value: "body", label: t("tools.http.response") }, { value: "headers", label: res ? t("tools.http.headersCount", { n: res.headers.length }) : t("tools.http.headers") }]} />
          </Label>
          {error ? (
            <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-[12.5px] text-danger">{error}</div>
          ) : res ? (
            <CodeArea readOnly value={resTab === "body" ? body + (res.truncated ? `\n\n${t("tools.http.truncated")}` : "") : res.headers.map(([k, v]) => `${k}: ${v}`).join("\n")} />
          ) : (
            <Hint>{t("tools.http.empty")}</Hint>
          )}
        </div>
      </div>
    </div>
  );
}
