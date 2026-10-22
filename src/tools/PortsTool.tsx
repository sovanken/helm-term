import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ask } from "@tauri-apps/plugin-dialog";
import { Globe, RefreshCw, Search, Shield, Square } from "lucide-react";
import { ipc, type PortUse } from "../lib/ipc";
import { showToast, useStore } from "../state/store";
import { Button, Hint } from "./ui";
import { ShimmerRows } from "../components/Shimmer";

/** Ports dev servers commonly use, shown first. */
const DEV_PORTS = new Set([3000, 3001, 4173, 4200, 5000, 5173, 5174, 5432, 6379, 8000, 8080, 8081, 8888, 9000, 27017]);

export default function PortsTool() {
  const { t } = useTranslation();
  const [list, setList] = useState<PortUse[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(true);

  const load = useCallback(() => {
    ipc.portsInUse().then(
      (l) => (setList(l), setError(null)),
      (e) => setError(String(e)),
    );
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    // One row per port and program (a program often listens on both IPv4 and IPv6).
    const seen = new Map<string, PortUse & { addresses: string[] }>();
    for (const p of list ?? []) {
      const key = `${p.port}-${p.pid}`;
      const row = seen.get(key);
      if (row) row.addresses.push(p.address);
      else seen.set(key, { ...p, addresses: [p.address] });
    }
    return [...seen.values()]
      .filter((p) => !onlyMine || !p.protected || DEV_PORTS.has(p.port))
      .filter((p) => !q || String(p.port).includes(q) || p.name.toLowerCase().includes(q) || String(p.pid) === q)
      .sort((a, b) => Number(DEV_PORTS.has(b.port)) - Number(DEV_PORTS.has(a.port)) || a.port - b.port);
  }, [list, query, onlyMine]);

  const stop = async (p: PortUse) => {
    const ok = await ask(t("tools.ports.stopConfirm", { name: p.name, pid: p.pid, port: p.port }), {
      title: t("tools.ports.stopConfirmTitle", { name: p.name }),
      kind: "warning",
      okLabel: t("tools.ports.stop"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      await ipc.stopProcess(p.pid);
      showToast(t("tools.ports.stopped", { name: p.name, port: p.port }), "success");
    } catch (e) {
      showToast(String(e), "error");
    }
    load();
  };

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex h-8 w-72 items-center gap-2 rounded-md border border-line bg-bg px-2.5 focus-within:border-accent">
          <Search size={14} className="text-faint" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("tools.ports.searchPlaceholder")} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint" />
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input type="checkbox" checked={!onlyMine} onChange={(e) => setOnlyMine(!e.target.checked)} className="accent-[var(--accent)]" /> {t("tools.ports.showSystem")}
        </label>
        <span className="flex-1" />
        <Button onClick={load}>
          <RefreshCw size={13} /> {t("common.refresh")}
        </Button>
      </div>
      {error && <Hint error>{error}</Hint>}
      <div className="scroll-thin min-h-0 flex-1 overflow-auto rounded-lg border border-line">
        <table className="w-full text-left text-[12.5px]">
          <thead className="sticky top-0 border-b border-line bg-surface text-[11px] text-faint uppercase">
            <tr>
              <th className="px-4 py-2 font-semibold">{t("tools.ports.port")}</th>
              <th className="px-4 py-2 font-semibold">{t("tools.ports.program")}</th>
              <th className="px-4 py-2 font-semibold">{t("tools.ports.pid")}</th>
              <th className="px-4 py-2 font-semibold">{t("tools.ports.listeningOn")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={`${p.port}-${p.pid}`} className="group border-b border-line last:border-b-0 hover:bg-hover/50">
                <td className="px-4 py-2 font-mono font-semibold text-fg tabular-nums">{p.port}</td>
                <td className="max-w-72 px-4 py-2" title={p.path}>
                  <span className="flex items-center gap-1.5 truncate text-fg">
                    {p.protected && <Shield size={12} className="shrink-0 text-faint" />}
                    {p.name}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-muted tabular-nums">{p.pid}</td>
                <td className="px-4 py-2 font-mono text-[12px] text-faint">
                  {p.addresses.map((a) => (a === "0.0.0.0" || a === "[::]" ? t("tools.ports.allNetworks") : a === "127.0.0.1" || a === "[::1]" ? t("tools.ports.thisPcOnly") : a)).filter((v, i, all) => all.indexOf(v) === i).join(", ")}
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-1.5 opacity-60 group-hover:opacity-100">
                    <Button onClick={() => useStore.getState().openBrowser(`http://localhost:${p.port}`)} title={t("tools.ports.openTitle")}>
                      <Globe size={13} /> {t("common.open")}
                    </Button>
                    {!p.protected && (
                      <Button onClick={() => void stop(p)} title={t("tools.ports.stopTitle")}>
                        <Square size={11} className="fill-current" /> {t("tools.ports.stop")}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list && !rows.length && <p className="p-4 text-[12px] text-faint">{query ? t("tools.shared.nothingMatches") : t("tools.ports.empty")}</p>}
        {!list && !error && <ShimmerRows rows={6} className="p-4" />}
      </div>
      <div className="mt-2">
        <Hint>{t("tools.ports.hint")}</Hint>
      </div>
    </div>
  );
}
