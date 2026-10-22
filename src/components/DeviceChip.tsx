import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Camera, Copy, Info, MonitorSmartphone, ScrollText, Smartphone, Unplug, Wifi, X } from "lucide-react";
import { readBuffer, typeCommand } from "../terminal/terminals";
import { activePane, defaultFolder, showToast, useStore } from "../state/store";
import { Menu, type MenuItem } from "./Menu";
import { useTranslation } from "react-i18next";
import { t as tr } from "../i18n";

interface Device {
  serial: string;
  name: string;
  model: string;
  state: "device" | "unauthorized" | "offline" | "usb";
  connection: "usb" | "wifi" | "emulator";
}

interface DeviceList {
  devices: Device[];
  hasAdb: boolean;
  hasScrcpy: boolean;
}

interface Details {
  manufacturer: string;
  model: string;
  android: string;
  sdk: string;
  battery: number | null;
  charging: boolean;
  ip: string | null;
}

/** One poll for the whole app (every 5 s), shared by every status bar. */
let current: DeviceList = { devices: [], hasAdb: false, hasScrcpy: false };
const listeners = new Set<(l: DeviceList) => void>();
let timer: number | undefined;
function poll() {
  void invoke<DeviceList>("devices_list").then(
    (l) => {
      if (JSON.stringify(l) !== JSON.stringify(current)) {
        current = l;
        listeners.forEach((f) => f(l));
      }
    },
    () => {},
  );
}
function useDevices() {
  const [list, setList] = useState(current);
  useEffect(() => {
    listeners.add(setList);
    if (!timer) {
      poll();
      timer = window.setInterval(poll, 5000);
    }
    return () => void listeners.delete(setList);
  }, []);
  return list;
}

const label = (d: Device) => (d.connection === "emulator" ? tr("device.emulatorName", { name: d.name }) : d.name);

/** How a device is connected or why it can't be used, in a word. */
const STATE_WORD: Record<string, string> = {
  usb: "device.state.usb",
  wifi: "device.state.wifi",
  emulator: "device.state.emulator",
  unauthorized: "device.state.unauthorized",
  offline: "device.state.offline",
  seen: "device.state.seenByWindows",
};

/** Opens a shell tab and runs `command` once the shell is ready. */
function runInNewTab(cwd: string, command: string) {
  const s = useStore.getState();
  s.openTab(cwd, "shell");
  const tab = useStore.getState().tabs.find((t) => t.id === useStore.getState().activeTabId);
  const paneId = tab?.activePaneId;
  if (!paneId) return;
  const started = Date.now();
  const wait = () => {
    if (readBuffer(paneId).trim() || Date.now() - started > 8000) typeCommand(paneId, command, true);
    else setTimeout(wait, 150);
  };
  setTimeout(wait, 300);
}

function DetailsDialog({ device, onClose }: { device: Device; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [d, setD] = useState<Details | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
    invoke<Details>("device_details", { serial: device.serial }).then(setD, (e) => showToast(String(e), "error"));
  }, [device.serial]);
  const row = (k: string, v: React.ReactNode, copy?: string) => (
    <div className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
      <span className="w-28 shrink-0 text-[12px] text-muted">{k}</span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg select-text">{v}</span>
      {copy && (
        <button aria-label={t("device.copyField", { field: k })} onClick={() => void navigator.clipboard.writeText(copy).then(() => showToast(t("common.copiedDot"), "success"))} className="flex size-6 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg">
          <Copy size={12} />
        </button>
      )}
    </div>
  );
  const wifi = async () => {
    if (!d?.ip) return;
    setBusy(true);
    try {
      const target = await invoke<string>("device_to_wifi", { serial: device.serial, ip: d.ip });
      showToast(t("device.wifiConnected", { target }), "success");
      onClose();
    } catch (e) {
      showToast(t("device.wifiFailed", { error: String(e) }), "error");
    } finally {
      setBusy(false);
      poll();
    }
  };
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[440px] max-w-[calc(100vw-32px)] rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl shadow-black/30 backdrop:bg-black/40"
    >
      <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Smartphone size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold">{label(device)}</h2>
          <p className="text-[12px] text-muted">{device.model && device.model !== device.name ? `${device.model} · ` : ""}{device.connection === "wifi" ? t("device.viaWifi") : device.connection === "emulator" ? t("device.emulator") : t("device.viaUsb")}</p>
        </div>
        <button aria-label={t("common.close")} onClick={onClose} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <X size={15} />
        </button>
      </div>
      <div className="px-5 py-2">
        {!d ? (
          <p className="py-3 text-[12px] text-faint">{t("device.asking")}</p>
        ) : (
          <>
            {row(t("device.details.device"), `${d.manufacturer} ${d.model}`.trim())}
            {row("Android", t("device.details.androidVersion", { version: d.android, sdk: d.sdk }))}
            {d.battery !== null && row(t("device.details.battery"), d.charging ? t("device.details.batteryCharging", { pct: d.battery }) : t("device.details.batteryLevel", { pct: d.battery }))}
            {row(t("device.details.serial"), <code className="font-mono">{device.serial}</code>, device.serial)}
            {row(t("device.details.runFlutter"), <code className="font-mono text-[11.5px]">flutter run -d {device.serial}</code>, `flutter run -d ${device.serial}`)}
            {d.ip && row(t("device.details.wifiAddress"), <code className="font-mono">{d.ip}</code>, d.ip)}
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        {device.connection === "wifi" ? (
          <button
            onClick={() => void invoke("device_disconnect", { serial: device.serial }).then(() => (poll(), onClose()))}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12.5px] text-fg hover:bg-hover"
          >
            <Unplug size={13} /> {t("device.disconnectWifi")}
          </button>
        ) : (
          device.connection === "usb" &&
          d?.ip && (
            <button onClick={() => void wifi()} disabled={busy} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12.5px] text-fg hover:bg-hover disabled:opacity-50">
              <Wifi size={13} /> {busy ? t("device.switching") : t("device.switchWifi")}
            </button>
          )
        )}
        <button onClick={onClose} className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-on-accent hover:opacity-90">
          {t("common.done")}
        </button>
      </div>
    </dialog>
  );
}

/** Status bar chip: the connected phone (or how many), with screenshot, mirror, logs and details. */
export function DeviceChip() {
  const { t } = useTranslation();
  const { devices, hasScrcpy } = useDevices();
  const [menu, setMenu] = useState(false);
  const [details, setDetails] = useState<Device | null>(null);
  const [appId, setAppId] = useState<string | null>(null);
  /** The project's app as installed on each device (exact id, or flavour builds like ".dev"). */
  const [variants, setVariants] = useState<Record<string, string[]>>({});
  const cwd = activePane()?.cwd ?? defaultFolder();

  useEffect(() => {
    if (!menu) return;
    void invoke<string | null>("android_app_id", { project: cwd }).then(
      (id) => {
        setAppId(id);
        if (!id) return setVariants({});
        for (const d of current.devices.filter((x) => x.state === "device"))
          void invoke<string[]>("device_app_variants", { serial: d.serial, app: id }).then((list) => setVariants((v) => ({ ...v, [d.serial]: list })), () => {});
      },
      () => setAppId(null),
    );
  }, [menu, cwd]);

  if (!devices.length) return null;
  const ready = devices.filter((d) => d.state === "device");
  const waiting = devices.find((d) => d.state === "unauthorized");
  const first = ready[0] ?? devices[0];

  const actions = (d: Device): MenuItem[] => {
    if (d.state === "unauthorized")
      return [{ label: t("device.allowUsbDebugging"), icon: <Info size={14} />, onSelect: () => {} }];
    if (d.state === "offline") return [{ label: t("device.offlineHelp"), icon: <Info size={14} />, onSelect: () => {} }];
    if (d.state === "usb")
      return [
        {
          label: d.name.toLowerCase().includes("iphone") || d.name.toLowerCase().includes("ipad") ? t("device.iphoneSeen") : t("device.turnOnUsbDebugging"),
          icon: <Info size={14} />,
          onSelect: () => !d.name.toLowerCase().includes("iphone") && void openUrl("https://developer.android.com/studio/debug/dev-options#enable"),
        },
      ];
    const powershell = (activePane()?.shell ?? useStore.getState().settings.shell) !== "bash";
    const logs = (app: string | null) =>
      void invoke<string>("device_logcat_command", { serial: d.serial, app, powershell }).then(
        (cmd) => runInNewTab(cwd, cmd),
        (e) => showToast(String(e), "error"),
      );
    return [
      {
        label: t("device.screenshot"),
        icon: <Camera size={14} />,
        onSelect: () => void invoke("device_screenshot", { serial: d.serial }).catch((e) => showToast(String(e), "error")),
      },
      {
        label: t("device.mirror"),
        hint: hasScrcpy ? undefined : t("device.needsScrcpy"),
        icon: <MonitorSmartphone size={14} />,
        onSelect: () =>
          void invoke("device_mirror", { serial: d.serial, title: label(d) }).catch(() =>
            showToast(t("device.scrcpyMissing", { command: "winget install Genymobile.scrcpy" }), "info", {
              label: t("device.getScrcpy"),
              run: () => void openUrl("https://github.com/Genymobile/scrcpy/releases/latest"),
            }),
          ),
      },
      { label: t("device.logs"), icon: <ScrollText size={14} />, onSelect: () => logs(null), separatorBefore: true },
      ...(variants[d.serial] ?? []).map((pkg) => ({ label: t("device.logsFor", { app: pkg }), icon: <ScrollText size={14} />, onSelect: () => logs(pkg) })),
      ...(appId && variants[d.serial]?.length === 0 ? [{ label: t("device.notInstalled", { app: appId }), icon: <Info size={14} />, onSelect: () => {} }] : []),
      { label: t("device.detailsMenu"), icon: <Info size={14} />, onSelect: () => setDetails(d), separatorBefore: true },
      { label: t("device.copyId"), hint: d.serial.length > 18 ? `${d.serial.slice(0, 16)}…` : d.serial, icon: <Copy size={14} />, onSelect: () => void navigator.clipboard.writeText(d.serial).then(() => showToast(t("device.idCopied"), "success")) },
    ];
  };

  const items: MenuItem[] =
    devices.length === 1
      ? actions(devices[0])
      : devices.map((d) => ({ label: label(d), hint: d.state === "unauthorized" ? t("device.allowOnPhoneHint") : t(STATE_WORD[d.connection]), icon: <Smartphone size={14} />, onSelect: () => {}, submenu: actions(d) }));

  const text = ready.length > 1 ? t("device.count", { count: ready.length }) : label(first);
  const tone = waiting && !ready.length ? "text-attention" : ready.length ? "text-done" : "text-muted";
  const title = devices.map((d) => `${label(d)}${d.model && d.model !== d.name ? ` (${d.model})` : ""} · ${t(STATE_WORD[d.state === "device" ? d.connection : d.state === "usb" ? "seen" : d.state])}`).join("\n");

  return (
    <div className="relative">
      <button
        onClick={() => setMenu((m) => !m)}
        title={title}
        className="flex h-[22px] shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[12px] leading-none whitespace-nowrap hover:border-faint hover:bg-raised"
      >
        <span className={`flex items-center ${tone}`}>{first.connection === "wifi" ? <Wifi size={12} /> : <Smartphone size={12} />}</span>
        <span className="font-semibold text-fg">{text}</span>
        {waiting && !ready.length && <span className="text-attention">{t("device.allowOnPhone")}</span>}
      </button>
      {menu && <Menu items={items} onClose={() => setMenu(false)} />}
      {details && <DetailsDialog device={details} onClose={() => setDetails(null)} />}
    </div>
  );
}
