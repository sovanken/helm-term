import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../state/store";
import { groupLabel, TOOL_GROUPS, TOOLS, toolById } from "./registry";
import { ShimmerLines } from "../components/Shimmer";

/** The Tools tab: a list of developer tools on the left, the chosen one on the right. */
export function ToolsPage() {
  const { t } = useTranslation();
  const current = useStore((s) => s.tool);
  const tool = toolById(current);
  const View = tool.view;
  return (
    <div className="flex h-full">
      <nav aria-label={t("tools.page.navLabel")} className="scroll-thin flex w-56 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line p-2.5">
        {TOOL_GROUPS.map((group) => (
          <div key={group}>
            <h2 className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-faint uppercase">{groupLabel(group)}</h2>
            {TOOLS.filter((x) => x.group === group).map((x) => (
              <button
                key={x.id}
                onClick={() => useStore.getState().openTool(x.id)}
                aria-current={x.id === tool.id ? "page" : undefined}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${x.id === tool.id ? "bg-hover text-fg" : "text-muted hover:bg-hover hover:text-fg"}`}
              >
                <span className={x.id === tool.id ? "text-accent" : ""}>{x.icon(15)}</span>
                <span className="truncate font-medium">{x.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-5">
          <span className="text-accent">{tool.icon(16)}</span>
          <h1 className="text-[13px] font-semibold text-fg">{tool.label}</h1>
          <span className="truncate text-[12px] text-faint">{tool.blurb}</span>
        </header>
        <div className="min-h-0 flex-1">
          <Suspense fallback={<ShimmerLines lines={8} className="p-6" />}>
            <View key={tool.id} />
          </Suspense>
        </div>
      </section>
    </div>
  );
}
