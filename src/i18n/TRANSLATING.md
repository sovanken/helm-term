# Translating Helm

Source: the English files in `locales/en/` (`_base.json`, `settings.json`, `shell.json`,
`projects.json`, `agents.json`, `tools.json`, `core.json`). For each language write the same file
names in `locales/<code>/` with the same structure and keys.

## Rules

1. Keep every key. Don't add, drop or rename keys (except plural forms, below).
2. Keep `{{variables}}` exactly, and keep `<1>…</1>`, `<2>…</2>` tags around the matching words.
   Word order may change; the placeholders move with it.
3. Plurals: English has `x_one` / `x_other`. Write the forms your language uses, as named by
   `new Intl.PluralRules(code).resolvedOptions().pluralCategories`:
   - ja, ko, id: only `_other`
   - de, hi: `_one`, `_other`
   - fr, it, es-ES, es-419, pt-BR: `_one`, `_many`, `_other` (`_many` is for large round numbers
     like 1 000 000; usually the same text as `_other`)
4. Don't translate: Helm, Claude, Claude Code, Windows, File Explorer (use the name Windows uses in
   that language, e.g. "Explorateur de fichiers", "Explorer"), Recycle Bin (use Windows' own name:
   "Corbeille", "Papierkorb", "ごみ箱" …), GitHub, GitLab, Git, PowerShell, Git Bash, MCP,
   CLAUDE.md, Markdown, JSON, PDF, URLs, file names, slash commands (/compact), keyboard keys (Ctrl,
   Shift, Alt, Enter, Esc — keep as written), code in `<code>` tags, model names.
5. Use the words Windows 11 and VS Code use in that language for standard UI terms (Settings,
   Cancel, Rename, Delete, Copy path, Show in File Explorer, tab, pane, terminal …).
6. Plain, friendly product language. No jargon. Short labels stay short (buttons, menu items,
   tabs). Match the English punctuation habits: labels without a final period, messages with one.
   Keep "…" where English has it.
7. Glossary (keep consistent): conversation (a saved Claude chat), project (a folder in the
   sidebar), tab, pane, side panel, sidebar, Background (side-panel tab of subagents and background
   commands), subagent, background command, approval, permissions, screenshot, usage limit,
   context, compact (Claude's /compact), worktree → "its own copy of the project".
8. Formal or informal "you": use what Windows uses in that language (fr: vous, de: Sie,
   es: tú, it: tu, pt-BR: você, id: Anda, hi: आप, ja/ko: polite form without a pronoun).
