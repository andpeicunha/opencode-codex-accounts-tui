# opencode-codex-accounts-tui

OpenCode TUI sidebar panel for [`oc-codex-multi-account`](https://www.npmjs.com/package/oc-codex-multi-account) accounts.

It reads the local multi-account store and shows each Codex account alias, active account, token expiry, usage count, and 5h/7d limits in the OpenCode sidebar.

No tokens or secrets are displayed.

## Screenshot-style output

```text
Codex Accounts
● andrepeixoto · ok
  andrepeixoto@example.com
  5h 53% used · 47/100 left
  7d 43% used · 57/100 left
  exp 10d · uses 52
○ work · ok
  andre.peix…@example.com
  5h ?
  7d ?
  exp 10d · uses 0
```

Color thresholds:

- green: less than 50% used
- yellow: 50% or more used
- red: 80% or more used, auth error, or limit error

`exp 10d` means the saved OAuth token expires or needs refresh in around 10 days. It is not quota.

## Install from GitHub clone

```bash
git clone https://github.com/<your-user>/opencode-codex-accounts-tui.git
cd opencode-codex-accounts-tui
npm install
```

Then add the plugin path to `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "theme": "system",
  "plugin": [
    "/absolute/path/to/opencode-codex-accounts-tui/src/index.tsx"
  ]
}
```

Restart OpenCode after changing `tui.json`.

## Configuration

Optional environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `OPENCODE_CODEX_ACCOUNTS_STORE_PATH` | `~/.config/opencode/codex-multi-account-accounts.json` | Path to the `oc-codex-multi-account` store. |
| `OPENCODE_CODEX_ACCOUNTS_REFRESH_MS` | `60000` | Sidebar refresh interval. |
| `OPENCODE_CODEX_ACCOUNTS_SIDEBAR_ORDER` | `145` | OpenCode sidebar slot order. |
| `OPENCODE_CODEX_ACCOUNTS_COLOR_OK` | `#22c55e` | Color for low usage. |
| `OPENCODE_CODEX_ACCOUNTS_COLOR_WARN` | `#f59e0b` | Color for medium usage. |
| `OPENCODE_CODEX_ACCOUNTS_COLOR_DANGER` | `#ef4444` | Color for high usage/errors. |

## Notes

- This plugin only reads the account store.
- It does not manage login, reauth, rotation, or token refresh.
- Use `oc-codex-multi-account status` for the source-of-truth CLI view.
