import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { locale } from "../i18n";
import { Button, Card, Hint, Input, Label, loadData, saveData, ValueRow } from "./ui";

const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const ALL_ZONES: string[] = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? ["UTC"];

/** Reads a Unix time (seconds or milliseconds, guessed by size) or any date text. */
function parseTime(input: string): Date | null {
  const s = input.trim();
  if (!s) return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    // 10 digits ≈ seconds, 13 ≈ milliseconds, 16 ≈ microseconds.
    const ms = Math.abs(n) >= 1e14 ? n / 1000 : Math.abs(n) >= 1e11 ? n : n * 1000;
    return new Date(ms);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function relative(d: Date) {
  const diff = d.getTime() - Date.now();
  const rel = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60_000) return rel.format(Math.round(diff / 1000), "second");
  if (abs < 3_600_000) return rel.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rel.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return rel.format(Math.round(diff / 86_400_000), "day");
  if (abs < 365 * 86_400_000) return rel.format(Math.round(diff / (30 * 86_400_000)), "month");
  return rel.format(Math.round(diff / (365 * 86_400_000)), "year");
}

function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - start.getTime()) / 86_400_000 + 1) / 7);
}

function inZone(d: Date, zone: string) {
  return new Intl.DateTimeFormat(locale(), { timeZone: zone, dateStyle: "medium", timeStyle: "long" }).format(d);
}

export default function TimeTool() {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  const [input, setInput] = useState(() => String(Math.floor(Date.now() / 1000)));
  const [zones, setZones] = useState<string[]>(["UTC"]);
  const [adding, setAdding] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    void loadData<string[]>("time-zones", ["UTC", "America/New_York", "Europe/London", "Asia/Tokyo"]).then(setZones);
    return () => clearInterval(timer);
  }, []);

  const date = useMemo(() => parseTime(input), [input]);
  const setZoneList = (list: string[]) => {
    setZones(list);
    void saveData("time-zones", list);
  };

  return (
    <div className="scroll-thin h-full overflow-y-auto p-5">
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <Label right={<Button onClick={() => setInput(String(Math.floor(Date.now() / 1000)))}>{t("tools.time.now")}</Button>}>{t("tools.time.inputLabel")}</Label>
          <Input mono value={input} onChange={(e) => setInput(e.target.value)} placeholder="1792476158, 1792476158253, 2026-10-20T13:01:00Z, Oct 20 2026 1pm" className="w-full" />
          <div className="mt-2">
            <Hint error={!date && !!input.trim()}>
              {!input.trim()
                ? t("tools.time.typeHint")
                : date
                  ? /^-?\d+(\.\d+)?$/.test(input.trim())
                    ? Math.abs(+input) >= 1e14
                      ? t("tools.time.readAsMicroseconds")
                      : Math.abs(+input) >= 1e11
                        ? t("tools.time.readAsMilliseconds")
                        : t("tools.time.readAsSeconds")
                    : t("tools.time.readAsDate")
                  : t("tools.time.unreadable")}
            </Hint>
          </div>
        </Card>

        {date && (
          <Card>
            <Label>{relative(date)}</Label>
            <ValueRow label={t("tools.time.yourTime")} value={inZone(date, LOCAL_ZONE)} mono={false} />
            <ValueRow label="ISO 8601" value={date.toISOString()} />
            <ValueRow label="Unix (s)" value={String(Math.floor(date.getTime() / 1000))} />
            <ValueRow label="Unix (ms)" value={String(date.getTime())} />
            <ValueRow label="RFC 2822" value={date.toUTCString()} />
            <ValueRow label={t("tools.time.day")} value={t("tools.time.dayValue", { weekday: date.toLocaleDateString(locale(), { weekday: "long" }), week: isoWeek(date) })} mono={false} />
          </Card>
        )}

        {date && (
          <Card>
            <Label>{t("tools.time.timeZones")}</Label>
            <ValueRow label={t("tools.time.yourZone", { zone: LOCAL_ZONE.split("/").pop()!.replace(/_/g, " ") })} value={inZone(date, LOCAL_ZONE)} mono={false} />
            {zones
              .filter((z) => z !== LOCAL_ZONE)
              .map((z) => (
                <div key={z} className="group relative">
                  <ValueRow label={z === "UTC" ? "UTC" : z.split("/").pop()!.replace(/_/g, " ")} value={inZone(date, z)} mono={false} />
                  <button
                    aria-label={t("tools.time.removeZone", { zone: z })}
                    onClick={() => setZoneList(zones.filter((x) => x !== z))}
                    className="absolute top-1/2 -left-3 hidden size-5 -translate-y-1/2 items-center justify-center rounded text-faint group-hover:flex hover:text-fg"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            <div className="mt-3 flex items-center gap-2">
              <input
                list="helm-time-zones"
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                placeholder={t("tools.time.addZonePlaceholder")}
                className="h-7 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 text-[12px] outline-none focus:border-accent"
              />
              <datalist id="helm-time-zones">
                {ALL_ZONES.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
              <Button
                disabled={!ALL_ZONES.includes(adding) || zones.includes(adding)}
                onClick={() => {
                  setZoneList([...zones, adding]);
                  setAdding("");
                }}
              >
                <Plus size={13} /> {t("tools.time.add")}
              </Button>
            </div>
          </Card>
        )}

        <Card className="lg:col-span-2">
          <Label>{t("tools.time.rightNow")}</Label>
          <div className="grid gap-x-6 sm:grid-cols-3">
            <ValueRow label="Unix (s)" value={String(Math.floor(now.getTime() / 1000))} />
            <ValueRow label="Unix (ms)" value={String(now.getTime())} />
            <ValueRow label="ISO" value={now.toISOString().replace(/\.\d+Z$/, "Z")} />
          </div>
        </Card>
      </div>
    </div>
  );
}
