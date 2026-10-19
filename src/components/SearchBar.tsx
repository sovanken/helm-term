import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CaseSensitive, X } from "lucide-react";
import { focusTerminal, getSearch } from "../terminal/terminals";
import { useStore } from "../state/store";

export function SearchBar({ paneId }: { paneId: string }) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState<{ index: number; count: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const search = getSearch(paneId);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    const sub = search?.onDidChangeResults((r) => setResult(r.resultCount ? { index: r.resultIndex, count: r.resultCount } : null));
    return () => {
      sub?.dispose();
      search?.clearDecorations();
    };
  }, [search]);

  const opts = {
    caseSensitive,
    decorations: {
      matchBackground: "#e0a45840",
      matchOverviewRuler: "#e0a458",
      activeMatchBackground: "#e0a458",
      activeMatchColorOverviewRuler: "#e0a458",
    },
  };
  const find = (dir: 1 | -1, q = query, incremental = false) => {
    if (!q) {
      search?.clearDecorations();
      setResult(null);
      return;
    }
    if (dir === 1) search?.findNext(q, { ...opts, incremental });
    else search?.findPrevious(q, opts);
  };
  const close = () => {
    useStore.getState().set({ searchOpen: false });
    focusTerminal(paneId);
  };

  return (
    <div className="absolute top-2 right-4 z-20 flex items-center gap-1 rounded-lg border border-line bg-raised p-1 shadow-lg shadow-black/20">
      <input
        ref={input}
        value={query}
        placeholder="Find in output"
        onChange={(e) => {
          setQuery(e.target.value);
          find(1, e.target.value, true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") find(e.shiftKey ? -1 : 1);
          if (e.key === "Escape") close();
        }}
        className="w-52 rounded-md bg-transparent px-2 py-1 text-fg outline-none placeholder:text-faint"
      />
      <span className="min-w-14 text-center text-[11px] text-faint">
        {result ? `${result.index + 1} of ${result.count}` : query ? "No results" : ""}
      </span>
      <button
        aria-label="Match case"
        title="Match case"
        onClick={() => setCaseSensitive((c) => !c)}
        className={`flex size-6 items-center justify-center rounded ${caseSensitive ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover"}`}
      >
        <CaseSensitive size={15} />
      </button>
      <button aria-label="Previous match" title="Previous (Shift+Enter)" onClick={() => find(-1)} className="flex size-6 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg">
        <ArrowUp size={14} />
      </button>
      <button aria-label="Next match" title="Next (Enter)" onClick={() => find(1)} className="flex size-6 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg">
        <ArrowDown size={14} />
      </button>
      <button aria-label="Close search" title="Close (Esc)" onClick={close} className="flex size-6 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg">
        <X size={14} />
      </button>
    </div>
  );
}
