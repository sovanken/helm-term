import { useEffect, useState } from "react";
import { ipc, type ShellInfo } from "./ipc";

let cache: Promise<ShellInfo[]> | null = null;

export function loadShells() {
  cache ??= ipc.listShells().catch(() => [{ id: "powershell", label: "Windows PowerShell", path: "powershell.exe" }]);
  return cache;
}

export function useShells() {
  const [shells, setShells] = useState<ShellInfo[]>([]);
  useEffect(() => void loadShells().then(setShells), []);
  return shells;
}

export function shellLabel(id: string | undefined, shells: ShellInfo[]) {
  return shells.find((s) => s.id === id)?.label ?? (id === "bash" ? "Git Bash" : "PowerShell");
}
