import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { stringify as toYaml } from "yaml";
import { locale, t } from "../i18n";
import { jsonErrorAt, jsonToTypes, lineCol } from "./jsonTypes";
import { CodeArea, CopyButton, Hint, Label, Segmented } from "./ui";

type Mode = "format" | "minify" | "yaml" | "types";

const SAMPLE = `{"name":"Helm","version":"1.0.1","tags":["terminal","claude"],"author":{"name":"Ada","site":null},"releases":[{"v":"1.0.0","date":"2026-10-19"},{"v":"1.0.1","date":"2026-10-19","notes":"History details"}]}`;

/** Where the JSON goes wrong, as "Line 3, column 8: …". */
function parseError(text: string, e: unknown) {
  const found = jsonErrorAt(text);
  if (found) {
    const { line, col } = lineCol(text, found.pos);
    return t("tools.json.errorAt", { line, col, message: found.message });
  }
  return e instanceof Error ? e.message : String(e);
}

export default function JsonTool() {
  const { t } = useTranslation();
  const [input, setInput] = useState(SAMPLE);
  const [mode, setMode] = useState<Mode>("format");
  const [indent, setIndent] = useState<"2" | "4" | "tab">("2");
  const [rootName, setRootName] = useState("Root");

  const result = useMemo(() => {
    if (!input.trim()) return { output: "", error: null as string | null };
    let value: unknown;
    try {
      value = JSON.parse(input);
    } catch (e) {
      return { output: "", error: parseError(input, e) };
    }
    const space = indent === "tab" ? "\t" : Number(indent);
    switch (mode) {
      case "format":
        return { output: JSON.stringify(value, null, space), error: null };
      case "minify":
        return { output: JSON.stringify(value), error: null };
      case "yaml":
        return { output: toYaml(value, { indent: indent === "4" ? 4 : 2 }), error: null };
      case "types":
        return { output: jsonToTypes(value, rootName || "Root"), error: null };
    }
  }, [input, mode, indent, rootName, t]);

  return (
    <div className="flex h-full gap-4 p-5">
      <div className="flex min-w-0 flex-1 flex-col">
        <Label right={<button onClick={() => setInput("")} className="text-[12px] text-faint hover:text-fg">{t("tools.shared.clear")}</button>}>JSON</Label>
        <CodeArea value={input} onChange={(e) => setInput(e.target.value)} invalid={!!result.error} placeholder={t("tools.json.inputPlaceholder")} />
        <div className="mt-2 min-h-5">
          {result.error ? <Hint error>{result.error}</Hint> : input.trim() ? <Hint>{t("tools.json.valid", { count: input.length, n: input.length.toLocaleString(locale()) })}</Hint> : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <Label
          right={
            <>
              {mode === "types" ? (
                <input
                  value={rootName}
                  onChange={(e) => setRootName(e.target.value)}
                  aria-label={t("tools.json.rootName")}
                  className="h-7 w-28 rounded-md border border-line bg-bg px-2 text-[12px] outline-none focus:border-accent"
                />
              ) : (
                mode !== "minify" && (
                  <Segmented
                    value={indent}
                    onChange={setIndent}
                    options={[
                      { value: "2", label: t("tools.json.spaces", { count: 2 }) },
                      { value: "4", label: t("tools.json.spaces", { count: 4 }) },
                      ...(mode === "format" ? [{ value: "tab" as const, label: t("tools.json.tabs") }] : []),
                    ]}
                  />
                )
              )}
              <CopyButton text={result.output} />
            </>
          }
        >
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "format", label: t("tools.json.formatted") },
              { value: "minify", label: t("tools.json.minified") },
              { value: "yaml", label: "YAML" },
              { value: "types", label: "TypeScript" },
            ]}
          />
        </Label>
        <CodeArea value={result.output} readOnly placeholder={t("tools.json.outputPlaceholder")} />
      </div>
    </div>
  );
}
