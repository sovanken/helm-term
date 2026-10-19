// Copies pdf.js's font and character-map data next to the app, so PDFs that use standard
// fonts or Asian text render without any network access. Runs before `dev` and `build`.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "pdfjs-dist");
const to = join(root, "public", "pdfjs");

mkdirSync(to, { recursive: true });
for (const dir of ["standard_fonts", "cmaps", "wasm"]) {
  if (existsSync(join(from, dir))) cpSync(join(from, dir), join(to, dir), { recursive: true });
}
