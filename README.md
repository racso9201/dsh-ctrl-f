# dsh-ctrl-f

Press **Ctrl+F** in the [DeepSeek Harness](https://github.com/deepseek-ai) Web client and search your conversation — the browser's own find cannot help here, because the transcript is virtualized: only the messages near the viewport exist in the DOM, so native find-in-page silently misses everything else.

`dsh-ctrl-f` adds a proper find bar to the app: it searches inside the rendered conversation, jumps between matches, and — the part that matters — **only searches the assistant's answers**, skipping the model's reasoning, tool calls, tool output and collapsed process blocks.

## Features

- **Ctrl+F** opens the find bar (the browser's find bar is suppressed while the app has focus).
- **Enter** / **↓** next match, **Shift+Enter** / **↑** previous match, **F3** / **Shift+F3** as well, **Esc** closes.
- **Answers only by default.** Rows are filtered by the transcript's own markers, so thinking text and tool output never pollute the result count.
- **含過程 (include process)** checkbox to opt into searching everything, including reasoning, tool output and your own messages.
- Match counter (`3/17`) plus a live title tooltip showing how many answer rows the current scan covered — handy when a DSH update changes the DOM.
- Re-scans (debounced) when you scroll or when the transcript grows, so streaming answers stay searchable.
- Highlighting uses the **CSS Custom Highlight API**, so no `<mark>` wrappers are injected into React's DOM.
- Colors come only from the app's theme tokens (`--dsw-alias-*`), so light and dark themes both look right.

## Install

From GitHub:

```bash
dsh plugin --profile desktop add github:racso9201/dsh-ctrl-f
```

From a local checkout (development):

```bash
git clone https://github.com/racso9201/dsh-ctrl-f.git
dsh plugin --profile desktop add link:/absolute/path/to/dsh-ctrl-f
```

Restart DeepSeek Harness (or reload the Web client) after installing — a new bundle is only served after the host reloads.

Remove it with:

```bash
dsh plugin --profile desktop remove dsh-ctrl-f
```

## Usage

| Key | Action |
| --- | --- |
| `Ctrl+F` (macOS: `Cmd+F`) | Open the find bar (again: select the query) |
| `Enter` / `↓` | Next match |
| `Shift+Enter` / `↑` | Previous match |
| `F3` / `Shift+F3` | Next / previous match |
| `Esc` | Close |

## How it works

The client half registers a component into the `shell.overlay` slot and a capture-phase `keydown` listener:

- Transcript rows are selected with `[data-chat-flow-kind]`. A row counts as an answer when it is `assistant-step` with a group part other than `reasoning`, or when it carries `data-turn-process-answer` (the compact answer kept outside a folded process block).
- `turn-process` rows, `reasoning` parts and `data-turn-process-hidden` members are skipped by default.
- Text nodes are collected with a `TreeWalker` and matched case-insensitively, capped at 400 matches.
- Matches are painted with `::highlight()`; the active match gets a second, stronger highlight.
- Scroll and mutation events schedule a debounced rescan, so virtualization and streaming do not break the match list.
- If a future DSH build renames the row markers, no answer rows are found and the search falls back to the whole transcript scope instead of returning nothing — the tooltip tells you which case you are in.

## Requirements

- DeepSeek Harness with the Web client (`platform: web`).
- A Chromium-based browser or the desktop shell (Electron) for the CSS Custom Highlight API. Where it is unavailable, matching and jumping still work — only the highlight colors are missing.

## Platforms

There is no Windows-only code: the bundle is plain client-side JavaScript. It touches the DOM, `keydown` and the CSS Custom Highlight API — no native modules, no Node APIs, no `process.platform` branches — so the same package runs anywhere the DSH Web client runs.

| Platform | Shortcut | Notes |
| --- | --- | --- |
| Windows | `Ctrl+F` | desktop shell or any Chromium-based browser |
| macOS | `Cmd+F` | the handler accepts both `metaKey` and `ctrlKey`; the hint text switches to `Cmd+F` |
| Linux | `Ctrl+F` | same as Windows |

Two macOS caveats worth knowing:

- If a future DSH build binds `Cmd+F` as a native application-menu accelerator, the menu wins over renderer key handling. `F3` / `Shift+F3` still work as a fallback.
- Safari before 17.2 has no Custom Highlight API: matches still jump, but nothing is painted.

## Limitations

- Only materialized (rendered) rows can be searched; scroll to load older history first.
- Match cap is 400 per scan.
- The row filtering depends on DeepSeek Harness internal DOM attributes; those are not a public contract.
- Currently Traditional Chinese UI strings (`含過程`, placeholders). Pull requests for locale files are welcome.

## Development

The bundle is a link install, so editing `client.js` and reloading the page is enough; the host only has to restart when `package.json`, `cordis.patch.yml` or the bundle list changes.

```bash
node --check client.js
node --check index.js
```

## License

MIT — see [LICENSE](./LICENSE).

## Changelog

- **1.1.0** — platform-aware hint (`Cmd+F` on macOS, `Ctrl+F` elsewhere); documented Windows/macOS/Linux support.
- **1.0.0** — first release: Ctrl+F find bar over assistant answers only.
