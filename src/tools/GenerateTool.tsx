import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { FileUp, RefreshCw } from "lucide-react";
import { type HashAlgo, ipc } from "../lib/ipc";
import { Button, Card, CodeArea, CopyButton, Hint, Label, Segmented, ValueRow } from "./ui";
import { ShimmerLines } from "../components/Shimmer";

function uuidV7() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const ms = Date.now();
  for (let i = 0; i < 6; i++) b[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A uniformly random index below `n` (no modulo bias). */
function randomBelow(n: number) {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % n;
}

const SETS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/~",
};
const SIMILAR = /[Il1O0o|`'"]/g;

function UuidCard() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<"4" | "7">("4");
  const [count, setCount] = useState(5);
  const [upper, setUpper] = useState(false);
  const [dashes, setDashes] = useState(true);
  const [seed, setSeed] = useState(0);
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    setList(
      Array.from({ length: count }, () => {
        let id = version === "4" ? crypto.randomUUID() : uuidV7();
        if (!dashes) id = id.replace(/-/g, "");
        return upper ? id.toUpperCase() : id;
      }),
    );
  }, [version, count, upper, dashes, seed]);
  return (
    <Card>
      <Label right={<CopyButton text={list.join("\n")} label={t("tools.generate.copyAll")} />}>UUID</Label>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented value={version} onChange={setVersion} options={[{ value: "4", label: t("tools.generate.v4") }, { value: "7", label: t("tools.generate.v7") }]} />
        <select value={count} onChange={(e) => setCount(+e.target.value)} className="h-7 rounded-md border border-line bg-bg px-2 text-[12px]" aria-label={t("tools.shared.howMany")}>
          {[1, 5, 10, 25, 100].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input type="checkbox" checked={upper} onChange={(e) => setUpper(e.target.checked)} className="accent-[var(--accent)]" /> {t("tools.generate.uppercase")}
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input type="checkbox" checked={dashes} onChange={(e) => setDashes(e.target.checked)} className="accent-[var(--accent)]" /> {t("tools.generate.dashes")}
        </label>
        <Button onClick={() => setSeed((n) => n + 1)}>
          <RefreshCw size={13} /> {t("tools.shared.new")}
        </Button>
      </div>
      <pre className="scroll-thin max-h-56 overflow-auto rounded-md border border-line bg-bg p-3 font-mono text-[12.5px] leading-relaxed text-fg select-text">{list.join("\n")}</pre>
      {version === "7" && <div className="mt-2"><Hint>{t("tools.generate.v7Hint")}</Hint></div>}
    </Card>
  );
}

function PasswordCard() {
  const { t } = useTranslation();
  const [length, setLength] = useState(20);
  const [use, setUse] = useState({ lower: true, upper: true, digits: true, symbols: true });
  const [noSimilar, setNoSimilar] = useState(false);
  const [seed, setSeed] = useState(0);
  const [password, setPassword] = useState("");
  const pool = (Object.keys(use) as (keyof typeof SETS)[]).filter((k) => use[k]).map((k) => (noSimilar ? SETS[k].replace(SIMILAR, "") : SETS[k])).join("");
  useEffect(() => {
    setPassword(pool ? Array.from({ length }, () => pool[randomBelow(pool.length)]).join("") : "");
  }, [length, pool, seed]);
  const bits = pool ? Math.round(length * Math.log2(pool.length)) : 0;
  const strength = bits >= 100 ? [t("tools.generate.veryStrong"), "text-done"] : bits >= 70 ? [t("tools.generate.strong"), "text-done"] : bits >= 50 ? [t("tools.generate.ok"), "text-attention"] : [t("tools.generate.weak"), "text-danger"];
  return (
    <Card>
      <Label right={<CopyButton text={password} />}>{t("tools.generate.password")}</Label>
      <div className="mb-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-bg px-3 py-2 font-mono text-[14px] text-fg select-text">{password || " "}</code>
        <Button onClick={() => setSeed((n) => n + 1)} title={t("tools.generate.newPassword")}>
          <RefreshCw size={13} />
        </Button>
      </div>
      <div className="mb-3 flex items-center gap-3">
        <span className="w-24 text-[12px] text-muted">{t("tools.generate.lengthValue", { length })}</span>
        <input type="range" min={6} max={64} value={length} onChange={(e) => setLength(+e.target.value)} className="flex-1 accent-[var(--accent)]" aria-label={t("tools.generate.length")} />
      </div>
      <div className="flex flex-wrap gap-3">
        {(["lower", "upper", "digits", "symbols"] as const).map((k) => (
          <label key={k} className="flex items-center gap-1.5 text-[12px] text-muted">
            <input type="checkbox" checked={use[k]} onChange={(e) => setUse({ ...use, [k]: e.target.checked })} className="accent-[var(--accent)]" />
            {{ lower: "a–z", upper: "A–Z", digits: "0–9", symbols: "!@#" }[k]}
          </label>
        ))}
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input type="checkbox" checked={noSimilar} onChange={(e) => setNoSimilar(e.target.checked)} className="accent-[var(--accent)]" /> {t("tools.generate.noLookAlikes")}
        </label>
      </div>
      {pool && (
        <p className="mt-3 text-[12px] text-faint">
          <Trans i18nKey="tools.generate.randomness" count={bits} values={{ strength: strength[0] }} components={[<span className={`font-medium ${strength[1]}`} />]} />
        </p>
      )}
    </Card>
  );
}

const ALGOS: { algo: HashAlgo; label: string }[] = [
  { algo: "sha256", label: "SHA-256" },
  { algo: "sha512", label: "SHA-512" },
  { algo: "sha1", label: "SHA-1" },
  { algo: "md5", label: "MD5" },
];

function HashCard() {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    if (!file && !text) return setHashes({});
    setBusy(true);
    const timer = setTimeout(
      () =>
        void Promise.all(ALGOS.map(({ algo }) => (file ? ipc.hashFile(file, algo) : ipc.hashText(text, algo)).then((h) => [algo, h] as const)))
          .then((list) => alive && setHashes(Object.fromEntries(list)))
          .catch((e) => alive && setError(String(e)))
          .finally(() => alive && setBusy(false)),
      file ? 0 : 150,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text, file]);

  return (
    <Card className="lg:col-span-2">
      <Label
        right={
          file ? (
            <Button onClick={() => setFile(null)}>{t("tools.generate.hashTextInstead")}</Button>
          ) : (
            <Button
              onClick={async () => {
                const picked = await open({ multiple: false, directory: false, title: t("tools.generate.chooseFileTitle") });
                if (typeof picked === "string") setFile(picked);
              }}
            >
              <FileUp size={13} /> {t("tools.generate.chooseFile")}
            </Button>
          )
        }
      >
        {t("tools.generate.hash")}
      </Label>
      {file ? (
        <p className="mb-2 truncate rounded-md border border-line bg-bg px-3 py-2 font-mono text-[12.5px] text-fg" title={file}>
          {file}
        </p>
      ) : (
        <CodeArea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="mb-2 flex-none" placeholder={t("tools.generate.hashPlaceholder")} />
      )}
      {error && <Hint error>{error}</Hint>}
      {busy && file && <ShimmerLines lines={1} className="max-w-md" />}
      {ALGOS.map(({ algo, label }) => (
        <ValueRow key={algo} label={label} value={hashes[algo] ?? ""} />
      ))}
      <div className="mt-2">
        <Hint>{t("tools.generate.hashHint")}</Hint>
      </div>
    </Card>
  );
}

export default function GenerateTool() {
  return (
    <div className="scroll-thin h-full overflow-y-auto p-5">
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
        <UuidCard />
        <PasswordCard />
        <HashCard />
      </div>
    </div>
  );
}
