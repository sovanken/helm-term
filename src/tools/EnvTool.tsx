import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, Search } from "lucide-react";
import { ipc } from "../lib/ipc";
import { CopyButton, Hint, Segmented } from "./ui";
import { ShimmerRows } from "../components/Shimmer";

const SECRET = /(key|token|secret|password|passwd|pwd|credential|auth|private)/i;
const LISTS = /^(path|pathext|psmodulepath|classpath|pythonpath)$/i;

function Value({ name, value }: { name: string; value: string }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(!SECRET.test(name));
  if (!shown)
    return (
      <button onClick={() => setShown(true)} className="flex items-center gap-1.5 text-[12px] text-faint hover:text-fg">
        <Eye size={12} /> {t("tools.env.hidden")}
      </button>
    );
  if (LISTS.test(name))
    return (
      <ol className="flex flex-col gap-0.5">
        {value
          .split(";")
          .filter(Boolean)
          .map((part, i) => (
            <li key={i} className="flex gap-2 font-mono text-[12px] break-all text-fg select-text">
              <span className="w-5 shrink-0 text-right text-faint">{i + 1}</span>
              {part}
            </li>
          ))}
      </ol>
    );
  return <span className="font-mono text-[12px] break-all text-fg select-text">{value}</span>;
}

export default function EnvTool() {
  const { t } = useTranslation();
  const [vars, setVars] = useState<{ user: Record<string, string>; system: Record<string, string> } | null>(null);
  const [scope, setScope] = useState<"user" | "system">("user");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ipc.envVars().then(setVars, (e) => setError(String(e)));
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.entries(vars?.[scope] ?? {})
      .filter(([k, v]) => !q || k.toLowerCase().includes(q) || (!SECRET.test(k) && v.toLowerCase().includes(q)))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [vars, scope, query]);

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: "user", label: t("tools.env.user", { n: Object.keys(vars?.user ?? {}).length }) },
            { value: "system", label: t("tools.env.system", { n: Object.keys(vars?.system ?? {}).length }) },
          ]}
        />
        <div className="flex h-8 w-72 items-center gap-2 rounded-md border border-line bg-bg px-2.5 focus-within:border-accent">
          <Search size={14} className="text-faint" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("tools.env.searchPlaceholder")} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint" />
        </div>
      </div>
      {error && <Hint error>{error}</Hint>}
      <div className="scroll-thin min-h-0 flex-1 overflow-auto rounded-lg border border-line">
        {rows.map(([k, v]) => (
          <div key={k} className="group flex gap-4 border-b border-line px-4 py-2.5 last:border-b-0">
            <span className="w-56 shrink-0 font-mono text-[12px] font-semibold break-all text-fg select-text">{k}</span>
            <div className="min-w-0 flex-1">
              <Value name={k} value={v} />
            </div>
            <div className="opacity-0 group-hover:opacity-100">
              <CopyButton text={v} small label={t("tools.ui.copyValue", { label: k })} />
            </div>
          </div>
        ))}
        {!vars && !error && <ShimmerRows rows={8} icon={false} className="p-3" />}
        {vars && !rows.length && <p className="p-4 text-[12px] text-faint">{t("tools.shared.nothingMatches")}</p>}
      </div>
      <div className="mt-2">
        <Hint>
          {t("tools.env.note")}
        </Hint>
      </div>
    </div>
  );
}
