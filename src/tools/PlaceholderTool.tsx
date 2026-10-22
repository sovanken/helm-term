import { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { Button, CodeArea, CopyButton, Label, Segmented } from "./ui";

const WORDS =
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum".split(" ");
const FIRST = ["Ada", "Grace", "Linus", "Sophie", "Kenji", "Amara", "Mateo", "Priya", "Noah", "Lena", "Omar", "Chloe", "Ivan", "Mei", "Lucas", "Zara", "Dara", "Sokha", "Elena", "Tom"];
const LAST = ["Lovelace", "Hopper", "Nguyen", "Okafor", "Silva", "Tanaka", "Müller", "Patel", "Kim", "Rossi", "Haddad", "Johnson", "Novak", "Chen", "Garcia", "Sok", "Dubois", "Larsen", "Costa", "Ali"];
const CITIES: [string, string][] = [
  ["Lisbon", "Portugal"], ["Osaka", "Japan"], ["Austin", "United States"], ["Nairobi", "Kenya"], ["Phnom Penh", "Cambodia"], ["Lyon", "France"],
  ["Toronto", "Canada"], ["Melbourne", "Australia"], ["Seoul", "South Korea"], ["Munich", "Germany"], ["Bogotá", "Colombia"], ["Pune", "India"],
];
const STREETS = ["Oak Street", "Harbor Road", "Maple Avenue", "Riverside Drive", "Station Lane", "Hill Street", "Park Avenue", "Market Street"];
const COMPANIES = ["Northwind", "Acme Labs", "Blue Harbor", "Pixel & Co", "Greenfield", "Atlas Systems", "Brightline", "Copperleaf"];
const DOMAINS = ["example.com", "example.org", "example.net"];

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const int = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function sentence(first: boolean) {
  const words = Array.from({ length: int(8, 16) }, () => pick(WORDS));
  if (first) words.splice(0, 5, "lorem", "ipsum", "dolor", "sit", "amet");
  return `${cap(words.join(" "))}.`;
}

function lorem(unit: "paragraphs" | "sentences" | "words", count: number) {
  if (unit === "words") return cap(["lorem", "ipsum", ...Array.from({ length: Math.max(0, count - 2) }, () => pick(WORDS))].slice(0, count).join(" "));
  if (unit === "sentences") return Array.from({ length: count }, (_, i) => sentence(i === 0)).join(" ");
  return Array.from({ length: count }, (_, p) => Array.from({ length: int(4, 7) }, (_, i) => sentence(p === 0 && i === 0)).join(" ")).join("\n\n");
}

const FIELDS = ["id", "name", "email", "phone", "company", "address", "city", "country", "birthday", "active"] as const;
type Field = (typeof FIELDS)[number];

function person(i: number): Record<Field, string | number | boolean> {
  const first = pick(FIRST);
  const last = pick(LAST);
  const [city, country] = pick(CITIES);
  const plain = (s: string) => s.normalize("NFD").replace(/[^a-zA-Z]/g, "").toLowerCase();
  return {
    id: i + 1,
    name: `${first} ${last}`,
    email: `${plain(first)}.${plain(last)}@${pick(DOMAINS)}`,
    phone: `+1 555 ${String(int(100, 999))} ${String(int(1000, 9999))}`,
    company: pick(COMPANIES),
    address: `${int(1, 999)} ${pick(STREETS)}`,
    city,
    country,
    birthday: `${int(1960, 2005)}-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`,
    active: Math.random() > 0.3,
  };
}

function render(rows: Record<string, unknown>[], format: "json" | "csv" | "sql") {
  if (format === "json") return JSON.stringify(rows, null, 2);
  const cols = Object.keys(rows[0] ?? {});
  if (format === "csv") {
    const cell = (v: unknown) => (typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v));
    return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
  }
  const sql = (v: unknown) => (typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v));
  return rows.map((r) => `INSERT INTO people (${cols.join(", ")}) VALUES (${cols.map((c) => sql(r[c])).join(", ")});`).join("\n");
}

export default function PlaceholderTool() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<"text" | "data">("text");
  const [unit, setUnit] = useState<"paragraphs" | "sentences" | "words">("paragraphs");
  const [count, setCount] = useState(3);
  const [rows, setRows] = useState(10);
  const [fields, setFields] = useState<Field[]>(["id", "name", "email", "city", "country"]);
  const [format, setFormat] = useState<"json" | "csv" | "sql">("json");
  const [seed, setSeed] = useState(0);

  const output = useMemo(() => {
    void seed;
    if (kind === "text") return lorem(unit, count);
    const people = Array.from({ length: rows }, (_, i) => {
      const p = person(i);
      return Object.fromEntries(fields.map((f) => [f, p[f]]));
    });
    return fields.length ? render(people, format) : "";
  }, [kind, unit, count, rows, fields, format, seed]);

  return (
    <div className="flex h-full flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={kind} onChange={setKind} options={[{ value: "text", label: "Lorem ipsum" }, { value: "data", label: t("tools.placeholder.testData") }]} />
        {kind === "text" ? (
          <>
            <input type="number" min={1} max={200} value={count} onChange={(e) => setCount(Math.min(200, Math.max(1, +e.target.value || 1)))} aria-label={t("tools.shared.howMany")} className="h-7 w-16 rounded-md border border-line bg-bg px-2 text-[12px]" />
            <Segmented value={unit} onChange={setUnit} options={[{ value: "paragraphs", label: t("tools.placeholder.paragraphs") }, { value: "sentences", label: t("tools.placeholder.sentences") }, { value: "words", label: t("tools.placeholder.words") }]} />
          </>
        ) : (
          <>
            {/* "10 rows as JSON": one sentence, so languages can reorder the parts. */}
            <Trans
              i18nKey="tools.placeholder.rowsAs"
              components={[
                <input type="number" min={1} max={1000} value={rows} onChange={(e) => setRows(Math.min(1000, Math.max(1, +e.target.value || 1)))} aria-label={t("tools.placeholder.rows")} className="h-7 w-20 rounded-md border border-line bg-bg px-2 text-[12px]" />,
                <span className="text-[12px] text-muted" />,
                <Segmented value={format} onChange={setFormat} options={[{ value: "json", label: "JSON" }, { value: "csv", label: "CSV" }, { value: "sql", label: "SQL" }]} />,
              ]}
            />
          </>
        )}
        <Button onClick={() => setSeed((n) => n + 1)}>
          <RefreshCw size={13} /> {t("tools.shared.new")}
        </Button>
      </div>
      {kind === "data" && (
        <div className="flex flex-wrap gap-3">
          {FIELDS.map((f) => (
            <label key={f} className="flex items-center gap-1.5 text-[12px] text-muted">
              <input
                type="checkbox"
                checked={fields.includes(f)}
                onChange={(e) => setFields(e.target.checked ? FIELDS.filter((x) => x === f || fields.includes(x)) : fields.filter((x) => x !== f))}
                className="accent-[var(--accent)]"
              />
              {f}
            </label>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <Label right={<CopyButton text={output} />}>{kind === "text" ? t("tools.placeholder.text") : t("tools.placeholder.data")}</Label>
        <CodeArea value={output} readOnly className={kind === "text" ? "font-sans text-[13px]" : ""} />
      </div>
    </div>
  );
}
