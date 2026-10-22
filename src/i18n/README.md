# Helm's interface languages

Helm speaks the 11 languages Claude's own apps offer. English is the source; the other ten are
translations. Corrections from native speakers are very welcome.

## Files

```
locales/
  en/settings.json    ← English, one file per part of the app
  en/shell.json
  …
  fr/settings.json    ← same file names and keys, translated
```

All files of a language are merged at start-up, so each file holds its own top-level keys
(for example `settings.json` holds `{ "settings": { … }, "voice": { … } }`). Two files never use the
same top-level key.

## Keys

- `area.thing` or `area.section.thing`, camelCase: `settings.voice.micTest`, `sidebar.menu.rename`.
- Name keys by meaning, not by the English words, so a wording change doesn't need a new key.
- Shared words (OK, Cancel, Close, Save, Delete, Rename, Copy, Copied.) live in `common.*`
  (`locales/en/_base.json`) — use those instead of new keys.

## Writing strings

- Variables: `{{name}}` — `"Renamed to {{name}}."`.
- Plurals: a key with `_one` and `_other` (other languages add `_few`, `_many` … as they need);
  call with `{ count }`: `t("sidebar.chats", { count: n })`.
- Whole sentences only. Never glue pieces of a sentence together in code, because word order
  differs between languages. Inline elements (bold, links, <kbd>) use `<Trans>` with numbered tags.
- Keep product names as they are: Helm, Claude, Claude Code, Windows, File Explorer, Recycle Bin,
  GitHub, PowerShell, Git Bash, Markdown, JSON, MCP, CLAUDE.md.
- Keep keyboard keys as written: Ctrl, Shift, Alt, Enter, Esc.
- Don't translate text that is sent to Claude or the command line, settings.json key names and
  values, slash commands, file names, or code.

## In code

```tsx
import { useTranslation } from "react-i18next";
const { t } = useTranslation();
<button>{t("common.save")}</button>
```

Outside components (toasts, helpers): `import { t } from "../i18n";`.
Numbers and dates: pass `locale()` from `../i18n` to `Intl` / `toLocaleString`.
