import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { useStore } from "../state/store";

export function ToastView() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  const icon =
    toast.kind === "success" ? (
      <CheckCircle2 size={15} className="shrink-0 text-done" />
    ) : toast.kind === "error" ? (
      <TriangleAlert size={15} className="shrink-0 text-danger" />
    ) : (
      <Info size={15} className="shrink-0 text-working" />
    );
  return (
    <div role="status" className="fixed bottom-9 left-1/2 z-50 flex max-w-[min(560px,calc(100vw-32px))] -translate-x-1/2 items-center gap-2.5 rounded-lg border border-line bg-raised py-2 pr-2 pl-3 text-fg shadow-lg shadow-black/20">
      {icon}
      <span className="min-w-0 flex-1 text-[13px] leading-snug">{toast.text}</span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.run();
            useStore.getState().set({ toast: null });
          }}
          className="shrink-0 rounded-md px-2 py-1 font-medium text-accent hover:bg-hover"
        >
          {toast.action.label}
        </button>
      )}
      <button aria-label="Dismiss" onClick={() => useStore.getState().set({ toast: null })} className="shrink-0 rounded p-1 text-faint hover:bg-hover hover:text-fg">
        <X size={13} />
      </button>
    </div>
  );
}
