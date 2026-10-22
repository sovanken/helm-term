import { useSyncExternalStore } from "react";
import { useStore } from "../state/store";
import { resolveTheme } from "./themes";

/** File and folder icons from the Material Icon Theme (MIT), as VS Code shows them. */
interface IconMap {
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
}

interface Manifest extends IconMap {
  file: string;
  folder: string;
  folderExpanded: string;
  languages: Record<string, string>;
  light: IconMap;
}

let manifest: Manifest | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load() {
  loading ??= fetch("/material-icons/manifest.json")
    .then((r) => r.json() as Promise<Manifest>)
    .then((m) => {
      manifest = m;
      listeners.forEach((l) => l());
    })
    .catch(() => {});
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => listeners.delete(listener);
}

/** The icon's name (an SVG in public/material-icons) for a file or folder. */
export function iconName(m: Manifest, name: string, opts: { isDir?: boolean; open?: boolean; light?: boolean } = {}): string {
  const lower = name.toLowerCase();
  const maps = opts.light ? [m.light, m] : [m];
  if (opts.isDir) {
    for (const map of maps) {
      const hit = opts.open ? map.folderNamesExpanded[lower] : map.folderNames[lower];
      if (hit) return hit;
    }
    return opts.open ? m.folderExpanded : m.folder;
  }
  for (const map of maps) if (map.fileNames[lower]) return map.fileNames[lower];
  // Longest extension first, as VS Code does: "app.d.ts" tries "d.ts" before "ts".
  const parts = lower.split(".");
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join(".");
    for (const map of maps) if (map.fileExtensions[ext]) return map.fileExtensions[ext];
  }
  const last = parts.length > 1 ? parts[parts.length - 1] : lower;
  return m.languages[last] ?? m.file;
}

/** A file or folder icon in the VS Code Material style. Shows nothing until the map has loaded. */
export function MaterialIcon({ name, isDir, open, size = 16 }: { name: string; isDir?: boolean; open?: boolean; size?: number }) {
  const m = useSyncExternalStore(subscribe, () => manifest);
  const light = useStore((s) => resolveTheme(s.settings.theme) === "light");
  if (!m) return <span className="shrink-0" style={{ width: size, height: size }} />;
  const icon = iconName(m, name.split(/[\\/]/).pop() ?? name, { isDir, open, light });
  return <img src={`/material-icons/${icon}.svg`} alt="" width={size} height={size} draggable={false} className="shrink-0 select-none" />;
}
