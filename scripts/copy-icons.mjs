// Copies the Material Icon Theme's file and folder icons (MIT) next to the app, with a small map
// of file names, extensions and folder names to icons for the project file tree. Runs before
// `dev` and `build`.
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "material-icon-theme");
const to = join(root, "public", "material-icons");

mkdirSync(to, { recursive: true });
cpSync(join(from, "icons"), to, { recursive: true });
copyFileSync(join(from, "LICENSE"), join(to, "LICENSE"));

// Keep only what the tree needs; icon names are the SVG file names without ".svg".
const m = JSON.parse(readFileSync(join(from, "dist", "material-icons.json"), "utf8"));
const icon = (id) => m.iconDefinitions[id]?.iconPath.split("/").pop().replace(/\.svg$/, "");
const mapOf = (obj = {}) => Object.fromEntries(Object.entries(obj).map(([k, id]) => [k.toLowerCase(), icon(id)]).filter(([, v]) => v));
const pick = (src) => ({
  fileNames: mapOf(src.fileNames),
  fileExtensions: mapOf(src.fileExtensions),
  folderNames: mapOf(src.folderNames),
  folderNamesExpanded: mapOf(src.folderNamesExpanded),
});
const manifest = {
  file: icon(m.file),
  folder: icon(m.folder),
  folderExpanded: icon(m.folderExpanded),
  ...pick(m),
  // VS Code maps these by language; the tree only has file names, so use the usual extensions.
  languages: Object.fromEntries(
    Object.entries({
      ts: "typescript", tsx: "typescriptreact", js: "javascript", jsx: "javascriptreact", mjs: "javascript", cjs: "javascript",
      json: "json", jsonc: "jsonc", md: "markdown", py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin",
      swift: "swift", dart: "dart", c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp", rb: "ruby",
      php: "php", html: "html", htm: "html", css: "css", scss: "scss", less: "less", yaml: "yaml", yml: "yaml",
      xml: "xml", sh: "shellscript", bash: "shellscript", ps1: "powershell", psm1: "powershell", sql: "sql",
      lua: "lua", r: "r", vue: "vue", svelte: "svelte", toml: "toml", ini: "ini", bat: "bat", cmd: "bat",
      dockerfile: "dockerfile", txt: "plaintext", log: "log", csv: "csv",
    })
      .map(([ext, lang]) => [ext, icon(m.languageIds?.[lang])])
      .filter(([, v]) => v),
  ),
  light: pick(m.light ?? {}),
};
writeFileSync(join(to, "manifest.json"), JSON.stringify(manifest));
