import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Last line of defence for UI errors: instead of a blank window, show what happened and a way back.
 * Terminals live outside React, and reloading restores every tab.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Helm UI error", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const details = `${error.name}: ${error.message}\n\n${error.stack ?? ""}`;
    return (
      <div className="flex h-full items-center justify-center bg-bg p-8">
        <div className="w-full max-w-lg rounded-xl border border-line bg-raised p-6">
          <h1 className="text-[17px] font-semibold text-fg">Something went wrong</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            Part of Helm's window hit an error. Your tabs and conversations are safe — reloading brings everything back.
          </p>
          <pre className="scroll-thin mt-4 max-h-40 overflow-auto rounded-lg bg-bg p-3 font-mono text-[11px] text-faint select-text">{details}</pre>
          <div className="mt-4 flex gap-2">
            <button onClick={() => location.reload()} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-on-accent hover:opacity-90">
              Reload Helm
            </button>
            <button
              onClick={() => void navigator.clipboard.writeText(details)}
              className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-fg hover:bg-hover"
            >
              Copy details
            </button>
            <a
              href="https://github.com/sovanken/helm-term/issues/new"
              target="_blank"
              rel="noreferrer"
              className="ml-auto self-center text-[12px] text-accent hover:underline"
            >
              Report this problem
            </a>
          </div>
        </div>
      </div>
    );
  }
}
