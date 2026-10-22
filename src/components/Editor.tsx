import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { t } from "../i18n";

/** Colours come from Helm's theme variables; syntax colours from the .tok-* rules in styles.css. */
const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", color: "var(--text)", fontSize: "12.5px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: '"JetBrains Mono Variable", "Cascadia Mono", Consolas, monospace', lineHeight: "1.6" },
  ".cm-content": { padding: "10px 0 24px", caretColor: "var(--accent)" },
  ".cm-line": { paddingLeft: "6px", paddingRight: "24px" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--faint)" },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "3.5em", paddingRight: "0.5em", opacity: "0.7" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--hover)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--accent-soft) !important",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--accent-soft)" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--accent-soft)", outline: "1px solid var(--border)" },
  ".cm-placeholder": { color: "var(--faint)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--attention) 30%, transparent)" },
  ".cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--attention) 55%, transparent)" },
  ".cm-panels": { backgroundColor: "var(--surface)", color: "var(--text)" },
  ".cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panel.cm-search": { padding: "6px 10px", fontFamily: "var(--font-sans)", fontSize: "12px" },
  ".cm-panel.cm-search input, .cm-panel.cm-search button": {
    fontFamily: "inherit",
    fontSize: "12px",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    backgroundColor: "var(--bg)",
    color: "var(--text)",
    backgroundImage: "none",
    padding: "2px 8px",
  },
  ".cm-panel.cm-search input:focus": { outline: "none", borderColor: "var(--accent)" },
  ".cm-panel.cm-search label": { fontSize: "12px", color: "var(--muted)" },
  ".cm-panel.cm-search [name=close]": { border: "none", backgroundColor: "transparent", color: "var(--muted)", fontSize: "16px" },
  ".cm-tooltip": { backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text)", overflow: "hidden" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: '"JetBrains Mono Variable", Consolas, monospace', fontSize: "12px", maxHeight: "16em" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "3px 10px !important" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent-soft)", color: "var(--text)" },
  ".cm-completionInfo": { padding: "8px 10px", maxWidth: "360px", whiteSpace: "pre-wrap", fontFamily: "var(--font-sans)", fontSize: "12px", lineHeight: "1.5" },
  ".cm-settings-hover": { padding: "8px 10px", maxWidth: "380px", whiteSpace: "pre-wrap", fontSize: "12px", lineHeight: "1.5" },
  ".cm-diagnostic": { padding: "6px 10px", fontFamily: "var(--font-sans)", fontSize: "12px" },
  ".cm-diagnostic-error": { borderLeft: "3px solid var(--danger)" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--danger)", textUnderlineOffset: "3px" },
});

interface Props {
  /** File name, to pick the language. */
  name: string;
  initial: string;
  wrap: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
  /** Put the cursor on this line and scroll it into view. */
  line?: number;
  /** Extra editor behaviour (used for settings.json); replaces the language picked by file name. */
  extra?: Extension[];
}

/** A plain code editor (CodeMirror): line numbers, undo, find (Ctrl+F) and Ctrl+S to save. */
export function Editor({ name, initial, wrap, onChange, onSave, line, extra }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const wrapping = useRef(new Compartment());
  const language = useRef(new Compartment());
  const handlers = useRef({ onChange, onSave });
  handlers.current = { onChange, onSave };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          syntaxHighlighting(classHighlighter),
          placeholder(t("files.editorPlaceholder")),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (handlers.current.onSave(), true) },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          wrapping.current.of(wrap ? EditorView.lineWrapping : []),
          language.current.of(extra ?? []),
          theme,
          EditorView.updateListener.of((u) => u.docChanged && handlers.current.onChange(u.state.doc.toString())),
        ],
      }),
    });
    view.current = v;
    v.focus();
    // Language support is loaded on demand, by file name.
    const lang = extra ? null : LanguageDescription.matchFilename(languages, name);
    lang?.load().then(
      (support) => view.current === v && v.dispatch({ effects: language.current.reconfigure(support) }),
      () => {},
    );
    return () => {
      view.current = null;
      v.destroy();
    };
    // The editor is made once per file; later text changes come from typing (or a remount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);

  useEffect(() => {
    const v = view.current;
    if (!v || !line) return;
    const at = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines));
    v.dispatch({ selection: { anchor: at.from }, effects: EditorView.scrollIntoView(at.from, { y: "center" }) });
    v.focus();
  }, [line]);

  return <div ref={host} className="min-h-0 flex-1 overflow-hidden select-text" />;
}
