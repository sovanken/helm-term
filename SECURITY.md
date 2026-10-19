# Security policy

## Supported versions

Only the latest release receives security fixes. Helm updates itself, so most users are on it.

## Reporting a vulnerability

Please report security problems **privately** through
[GitHub Security Advisories](https://github.com/sovanken/helm-term/security/advisories/new)
rather than a public issue. Include the steps to reproduce and the impact you see. You can expect a
reply within a few days, and credit in the release notes if you'd like it.

## How Helm is designed to stay safe

- **Local only.** Helm has no account, server or telemetry. The only network request is the update
  check against GitHub Releases, and it can be turned off.
- **Signed updates.** Updates are verified against a public key built into the app before installing.
- **Local bridge.** Claude Code reports status and permission requests to Helm over HTTP bound to
  `127.0.0.1` only. Every request must carry a random key generated each time Helm starts, and the
  hook files containing it live in Helm's own data folder.
- **Approvals.** When Helm doesn't answer a permission request, Claude falls back to asking in its
  terminal; nothing is approved by default. Claude Code's deny rules still apply to anything Helm allows.
- **Your Claude Code settings** are only changed when you edit them in Helm's Settings screen, and
  Helm touches only the `permissions` and `hooks` keys (with a one-time backup).
- **No shell interpolation** of file names when opening files in your editor.
