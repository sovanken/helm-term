import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n";

/**
 * Keeps an error in one part of the window (status bar, a side panel…) from taking down the
 * rest. Shows a small "couldn't show" note with a retry, instead of the part.
 */
export class PartBoundary extends Component<{ name: string; /** Translated "Couldn't show the …" sentence. */ message?: string; children: ReactNode; className?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Helm: ${this.props.name} failed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 text-[12px] text-faint ${this.props.className ?? ""}`}>
        <span>{this.props.message ?? t("errors.partFailed", { name: this.props.name })}</span>
        <button onClick={() => this.setState({ error: null })} className="rounded px-1.5 py-0.5 text-accent hover:bg-hover">
          {t("common.retry")}
        </button>
      </div>
    );
  }
}

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
          <h1 className="text-[17px] font-semibold text-fg">{t("errors.crash.title")}</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            {t("errors.crash.body")}
          </p>
          <pre className="scroll-thin mt-4 max-h-40 overflow-auto rounded-lg bg-bg p-3 font-mono text-[11px] text-faint select-text">{details}</pre>
          <div className="mt-4 flex gap-2">
            <button onClick={() => location.reload()} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-on-accent hover:opacity-90">
              {t("errors.crash.reload")}
            </button>
            <button
              onClick={() => void navigator.clipboard.writeText(details)}
              className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-fg hover:bg-hover"
            >
              {t("errors.crash.copyDetails")}
            </button>
            <a
              href="https://github.com/sovanken/helm-term/issues/new"
              target="_blank"
              rel="noreferrer"
              className="ml-auto self-center text-[12px] text-accent hover:underline"
            >
              {t("errors.crash.report")}
            </a>
          </div>
        </div>
      </div>
    );
  }
}
