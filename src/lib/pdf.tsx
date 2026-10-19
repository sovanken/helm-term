// Export a report as a PDF: render it into a print-only container, have WebView2 print the
// window to a file (print styles hide everything else), then clean up.

import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { showToast, useStore } from "../state/store";

const frames = (n: number) => new Promise<void>((done) => {
  const step = (left: number) => (left <= 0 ? done() : requestAnimationFrame(() => step(left - 1)));
  step(n);
});

export function pdfName(...parts: string[]) {
  const safe = parts.map((p) => p.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "")).filter(Boolean);
  return `${safe.join("-")}.pdf`;
}

/** Asks where to save, then writes `report` to that PDF. Returns the path, or null if cancelled. */
export async function exportPdf(defaultName: string, report: ReactNode): Promise<string | null> {
  // Dev/test hook: a preset path skips the save dialog.
  const preset = import.meta.env.DEV ? (window as { __helmPdfPath?: string }).__helmPdfPath : undefined;
  const path = preset ?? (await save({ title: "Save as PDF", defaultPath: defaultName, filters: [{ name: "PDF", extensions: ["pdf"] }] }));
  if (!path) return null;

  const host = document.createElement("div");
  host.id = "print-root";
  host.dataset.theme = "light";
  document.body.append(host);
  const root = createRoot(host);
  try {
    root.render(report);
    await document.fonts.ready;
    await frames(3);
    document.documentElement.classList.add("printing");
    await frames(1);
    await invoke("print_pdf", { path });
    const name = path.split(/[\\/]/).pop() ?? path;
    showToast(`Saved ${name}`, "success", { label: "Open", run: () => useStore.getState().openFile(path) }, { label: "Show in folder", run: () => void revealItemInDir(path) });
    return path;
  } catch (e) {
    showToast(`Couldn't save the PDF: ${String(e)}`, "error");
    return null;
  } finally {
    document.documentElement.classList.remove("printing");
    root.unmount();
    host.remove();
  }
}
