import type { PaneStatus } from "../state/store";

const LABELS: Record<PaneStatus, string> = {
  idle: "",
  working: "Claude is working",
  attention: "Claude needs your approval",
  done: "Claude finished",
};

export function StatusDot({ status, claude }: { status: PaneStatus; claude: boolean }) {
  if (status === "working") {
    return (
      <span
        title={LABELS.working}
        className="status-working inline-block size-2.5 shrink-0 rounded-full border-[1.5px] border-working border-t-transparent"
      />
    );
  }
  if (status === "attention") {
    return <span title={LABELS.attention} className="status-attention inline-block size-2 shrink-0 rounded-full bg-attention" />;
  }
  if (status === "done") {
    return <span title={LABELS.done} className="inline-block size-2 shrink-0 rounded-full bg-done" />;
  }
  return claude ? (
    <span title="Claude is ready" className="inline-block size-2 shrink-0 rounded-full border border-faint" />
  ) : null;
}
