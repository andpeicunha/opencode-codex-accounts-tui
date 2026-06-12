# opencode-providers-tui

OpenCode TUI sidebar panel and server-side monitor for **all** AI providers
in active use, not just Codex.

It writes a unified state file polled from:

- **Codex** — read from the existing `oc-codex-multi-account` store
  (5h / 7d rate windows, OAuth token expiry, active alias)
- **DeepSeek** — `GET https://api.deepseek.com/user/balance`
  (USD/CNY balance, granted vs topped-up)
- **MiniMax** — Token Plan quota endpoint when a `MINIMAX_CODING_PLAN_API_KEY`
  or `MINIMAX_CHINA_CODING_PLAN_API_KEY` is set, otherwise just acknowledges
  the standard `MINIMAX_API_KEY`

The TUI panel renders all three with billing-model-aware color thresholds
and warnings for accounts whose OAuth token expires within 30 days.

No tokens or secrets are ever displayed in the TUI.

## Screenshot-style output

```text
Providers
● codex · subscription
○ andrepeixoto · ok · exp:8d
  5h 100% (now) · 7d 88% (now)
● work · ok · exp:8d
  5h 100% (now) · 7d 24% (6d)

● deepseek · pay-per-token
  Restante 0.7500 USD

● minimax · token-plan
  5h 54% (2h) · 7d 6% (3d)
```

## Color thresholds

### Codex (subscription)

- green: less than 50% used
- yellow: 50% or more used
- red: 80% or more used, auth error, or limit error
- yellow warning: token expires in <30 days

### DeepSeek (pay-per-token)

- green: balance ≥ $20
- yellow: balance $5–$19
- red: balance < $5, rate-limited, or auth error
- muted: `DEEPSEEK_API_KEY` not set

### MiniMax

- green / yellow / red: same 5h/weekly windows as Codex when a Token Plan
  key is configured
- muted: standard API key only (no live balance endpoint)
- red: rate-limited, auth error, or upstream error

## Install

The repo is a self-contained TypeScript plugin. From the project root:

```bash
npm install
```

## Register the plugins

The plugin has three entry points and all of them should be registered:

### TUI sidebar (in `~/.config/opencode/tui.json`)

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "theme": "system",
  "plugin": [
    "oh-my-opencode-slim",
    "/Users/andpeicunha/Apps/opencode-codex-accounts-tui/src/index.tsx",
    "@slkiser/opencode-quota"
  ]
}
```

### Server monitor (in `~/.config/opencode/opencode.json`)

```json
{
  "plugin": [
    "oc-codex-multi-account",
    "/Users/andpeicunha/Apps/opencode-codex-accounts-tui/src/last-session-monitor.ts",
    "/Users/andpeicunha/Apps/opencode-codex-accounts-tui/src/providers-monitor.ts"
  ]
}
```

Restart OpenCode after each config change.

## Configuration

Optional environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `OPENCODE_PROVIDERS_STATE_PATH` | `~/.config/opencode/providers-state.json` | Where the monitor writes the unified state. |
| `OPENCODE_PROVIDERS_REFRESH_MS` | `30000` | Monitor poll interval. |
| `OPENCODE_PROVIDERS_TUI_REFRESH_MS` | `15000` | Sidebar refresh interval. |
| `OPENCODE_PROVIDERS_TUI_SIDEBAR_ORDER` | `145` | OpenCode sidebar slot order. |
| `OPENCODE_PROVIDERS_TUI_COLOR_OK` | `#22c55e` | Low-usage / healthy color. |
| `OPENCODE_PROVIDERS_TUI_COLOR_WARN` | `#f59e0b` | Medium-usage / expiring color. |
| `OPENCODE_PROVIDERS_TUI_COLOR_DANGER` | `#ef4444` | High-usage / error color. |
| `OPENCODE_PROVIDERS_TUI_COLOR_MUTED` | `#6b7280` | No-data / not-configured color. |
| `OPENCODE_CODEX_ACCOUNTS_STORE_PATH` | `~/.config/opencode/codex-multi-account-accounts.json` | Codex source file. |

## Notes

- This plugin only reads provider state. It does not manage login, reauth,
  rotation, or token refresh.
- Use `oc-codex-multi-account status` for the authoritative Codex CLI view.
- For DeepSeek billing, the panel reflects the live balance; topped-up vs
  granted breakdown is shown when both are non-zero.
- For MiniMax, the panel detects the first available key in the order
  `MINIMAX_CHINA_CODING_PLAN_API_KEY` → `MINIMAX_CODING_PLAN_API_KEY` →
  `MINIMAX_API_KEY`. Token Plan keys expose 5h/weekly windows; the standard
  key shows "pay-per-token" with a note that no live balance endpoint is
  available.

## Helper: reopen last OpenCode session

This repo also includes `bin/opencode-ls.mjs`.

```bash
cp bin/opencode-ls.mjs ~/.local/bin/opencode-ls
chmod +x ~/.local/bin/opencode-ls
```

Behavior:

- uses the current directory as the stable key
- if a saved session exists, reopens that exact `sessionId`
- always refreshes the saved title from `opencode session list --format json`
- if multiple sessions exist for the directory and none is saved yet, asks
  you to choose once
- after you choose, future `opencode-ls` calls reopen the saved session
  directly
