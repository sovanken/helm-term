import { useState } from "react";
import { Check, CheckCheck, ChevronDown, ChevronUp, ShieldQuestion, SquareTerminal, X } from "lucide-react";
import { answerApproval, describeSuggestions, toolVerb } from "../lib/agents";
import { paneIds } from "../lib/layout";
import { type Approval, cleanTitle, folderName, useStore } from "../state/store";

function showPane(paneId: string) {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => paneIds(t.root).includes(paneId));
  if (tab) {
    s.setActiveTab(tab.id);
    s.focusPane(paneId);
  }
}

/** One permission request with Allow / Always / Deny. */
export function ApprovalCard({ approval, compact = false }: { approval: Approval; compact?: boolean }) {
  const pane = useStore((s) => s.panes[approval.paneId]);
  const [open, setOpen] = useState(false);
  if (!pane) return null;
  const always = describeSuggestions(approval.suggestions);
  const title = cleanTitle(pane.title);

  return (
    <div className="rounded-lg border border-attention/40 bg-raised p-3">
      <div className="flex items-start gap-2.5">
        <ShieldQuestion size={16} className="mt-0.5 shrink-0 text-attention" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-fg">
            Claude wants to <span className="font-medium">{toolVerb(approval.tool)}</span>
          </div>
          <button onClick={() => showPane(approval.paneId)} className="block max-w-full truncate text-left text-[11px] text-faint hover:text-accent" title="Show this tab">
            {folderName(pane.cwd)}
            {title ? ` · ${title}` : ""}
          </button>
        </div>
        <button aria-label={open ? "Hide details" : "Show details"} onClick={() => setOpen((o) => !o)} className="rounded p-0.5 text-faint hover:bg-hover hover:text-fg">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {approval.summary && (
        <code className={`mt-2 block rounded-md bg-bg px-2 py-1.5 font-mono text-[12px] text-fg ${open ? "break-all whitespace-pre-wrap" : "truncate"}`}>
          {approval.summary}
        </code>
      )}
      {open && (
        <pre className="scroll-thin mt-2 max-h-48 overflow-auto rounded-md bg-bg p-2 font-mono text-[11px] text-muted">{JSON.stringify(approval.input, null, 2)}</pre>
      )}
      <div className={`mt-2.5 flex flex-wrap gap-1.5 ${compact ? "" : ""}`}>
        <button onClick={() => void answerApproval(approval, "allow")} className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-on-accent hover:opacity-90">
          <Check size={13} /> Allow
        </button>
        {approval.suggestions.length > 0 && (
          <button
            onClick={() => void answerApproval(approval, "always")}
            title={always ? `Allow and remember: ${always}` : "Allow and don't ask again for this"}
            className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-[12px] text-fg hover:bg-hover"
          >
            <CheckCheck size={13} /> Always allow
          </button>
        )}
        <button onClick={() => void answerApproval(approval, "deny")} className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-[12px] text-fg hover:bg-hover hover:text-danger">
          <X size={13} /> Deny
        </button>
        <button
          onClick={() => {
            void answerApproval(approval, "terminal");
            showPane(approval.paneId);
          }}
          title="Let Claude ask in its terminal instead"
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg"
        >
          <SquareTerminal size={13} /> In terminal
        </button>
      </div>
    </div>
  );
}

/** Floating stack of pending approvals over the terminal area. */
export function ApprovalBar() {
  const approvals = useStore((s) => s.approvals);
  const view = useStore((s) => s.view);
  if (approvals.length === 0 || view === "agents") return null;
  const shown = approvals.slice(0, 3);
  return (
    <div className="pointer-events-none absolute top-3 right-4 z-30 flex w-[380px] max-w-[calc(100%-32px)] flex-col gap-2">
      {shown.map((a) => (
        <div key={a.id} className="anim-slide-in pointer-events-auto shadow-lg shadow-black/20">
          <ApprovalCard approval={a} compact />
        </div>
      ))}
      {approvals.length > shown.length && (
        <button onClick={() => useStore.getState().openAgents()} className="pointer-events-auto self-end rounded-md bg-raised px-2.5 py-1 text-[12px] text-accent shadow-lg shadow-black/20 hover:bg-hover">
          {approvals.length - shown.length} more waiting · open Agents
        </button>
      )}
    </div>
  );
}
