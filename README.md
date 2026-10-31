# dsh-ctrl-f

[English](#english) · [繁體中文](#繁體中文)

A find bar for the [DeepSeek Harness](https://github.com/deepseek-ai) Web client: **Ctrl+F** loads the whole transcript, then searches **only the assistant's answers** — never the model's reasoning or tool output.

---

## English

The browser's own find cannot help inside the DSH conversation: the transcript is virtualized, so only the messages near the viewport exist in the DOM and everything else is silently skipped. `dsh-ctrl-f` replaces that with a find bar that is aware of the app's structure.

On the first **Ctrl+F** it clicks the chat view's own *Load earlier* pager until history is fully materialized, then searches it. Matches are filtered to the assistant's answers, jumped to one by one, and painted with the CSS Custom Highlight API.

The UI follows the app's language (`<html lang>`, falling back to the browser locale): English UI gets English strings, Chinese UI gets Chinese ones.

### Features

- **Ctrl+F** opens the find bar; the browser's find bar is suppressed while the app has focus.
- **Loads the whole transcript once, on open** — no manual scrolling to materialize history before searching.
- **Answers only by default.** Thinking text, tool calls, tool output and collapsed process blocks never pollute the result count.
- **Agent reasoning** checkbox to opt into searching reasoning, tool output and your own messages as well.
- **Enter** next match, **Shift+Enter** previous, **↑** / **↓** step through matches too, **F3** / **Shift+F3** as well, **Esc** closes.
- While the bar is open the arrow keys are captured, so they step matches instead of scrolling the page.
- Match counter (`3/17`) plus a live tooltip showing how many answer rows the current scan covered — useful when a DSH update changes the DOM.
- Debounced rescans while streaming, so new answers stay searchable.
- No `<mark>` wrappers: highlighting uses `::highlight()` only.
- Colors come from the app's theme tokens (`--dsw-alias-*`), so light and dark themes both look right.

### Install

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

### Usage

| Key | Action |
| --- | --- |
| `Ctrl+F` (macOS: `Cmd+F`) | Open the find bar (again: select the query) |
| `Enter` | Next match |
| `Shift+Enter` | Previous match |
| `↓` / `↑` | Next / previous match (captured while the bar is open) |
| `F3` / `Shift+F3` | Next / previous match |
| `Esc` | Close |

The first `Ctrl+F` in a long conversation shows `Loading N pages…` while history is paged in; when the counter turns into `0/0` the whole transcript is searchable.

### How it works

The client half registers a component into the `shell.overlay` slot plus a capture-phase `keydown` listener on `document`:

- **Paging.** It finds the chat view's own pager button (label `Load earlier` / `加载更早` / `載入更早`, count suffix tolerated), clicks it, waits until the row count and scroll height stop changing, and repeats until the button is gone — capped at 240 pages and 90 s. Closing the bar cancels it.
- **Row filtering.** Rows are selected with `[data-chat-flow-kind]`. A row counts as an answer when it is `assistant-step` with a group part other than `reasoning`, or when it carries `data-turn-process-answer` (the compact answer kept outside a folded process block). `turn-process` rows, `reasoning` parts and `data-turn-process-hidden` members are skipped unless the checkbox is on.
- **Matching.** Text nodes are collected with a `TreeWalker` and matched case-insensitively, capped at 400 matches per scan.
- **Painting.** Matches go into `::highlight(dsh-find-all)`; the active one gets a second, stronger highlight.
- **Jumping.** The active match's element is scrolled into view (`block: 'center'`).
- **Keyboard.** `Ctrl/Cmd+F`, `F3`, `Shift+F3`, `↑`, `↓`, `Enter`, `Shift+Enter` and `Esc` are handled in the capture phase, so the transcript never sees them; with zero matches the arrows are left alone and scroll the page as usual.
- If a future DSH build renames the row markers, no answer rows are found and the search falls back to the whole transcript scope instead of returning nothing — the tooltip tells you which case you are in.

### Requirements

- DeepSeek Harness with the Web client (`platform: web`).
- A Chromium-based browser or the desktop shell (Electron) for the CSS Custom Highlight API. Where it is unavailable, matching and jumping still work — only the highlight colors are missing.

### Platforms

There is no Windows-only code: the bundle is plain client-side JavaScript — DOM, `keydown`, CSS Custom Highlight API, no native modules, no Node APIs, no `process.platform` branches.

| Platform | Shortcut | Notes |
| --- | --- | --- |
| Windows | `Ctrl+F` | desktop shell or any Chromium-based browser |
| macOS | `Cmd+F` | the handler accepts both `metaKey` and `ctrlKey`; the hint switches to `Cmd+F` |
| Linux | `Ctrl+F` | same as Windows |

Two macOS caveats:

- If a future DSH build binds `Cmd+F` as a native menu accelerator, the menu wins over renderer key handling. `F3` / `Shift+F3` remain as a fallback.
- Safari before 17.2 has no Custom Highlight API: matches still jump, but nothing is painted.

### Limitations

- The first `Ctrl+F` in a long conversation takes a few seconds while history loads.
- The pager load is capped at 240 pages / 90 s per open; past that the bar says so and searches whatever is loaded.
- Match cap is 400 per scan.
- Row filtering depends on internal DOM attributes, which are not a public contract.
- Only English and Traditional Chinese are translated; unknown locales fall back to Chinese.

### Development

The bundle is a link install, so editing `client.js` and reloading the page is enough; the host only restarts when `package.json`, `cordis.patch.yml` or the bundle list changes.

```bash
node --check client.js
node --check index.js
node test/harness.cjs                 # fake DOM: paging, search, ↑/↓, labels
HARNESS_LANG=en-US node test/harness.cjs   # same, in English
```

The harness runs the real `client.js` against a fake DOM (36 rows across 3 pager pages) and prints one line per check.

### License

MIT — see [LICENSE](./LICENSE).

### Changelog

See [CHANGELOG.md](./CHANGELOG.md). Releases are tagged `vMAJOR.MINOR.PATCH` on `main`;
`package.json`, the tag and the top changelog entry always agree.

### Releasing

1. Bump `version` in `package.json` — SemVer: breaking change → major, new user-visible
   feature → minor, fix/docs only → patch.
2. Move the `Unreleased` items in `CHANGELOG.md` into a `## [x.y.z] — YYYY-MM-DD` section
   and refresh its two compare links.
3. Run `node --check client.js`, `node --check index.js`, `node test/harness.cjs` and
   `HARNESS_LANG=en-US node test/harness.cjs`.
4. Publish with `python publish_github.py .gh-token` — it commits the whole tree to
   `main` and creates or moves the `v<x.y.z>` tag onto that commit.
5. Pin an install to a release with
   `dsh plugin --profile desktop add github:racso9201/dsh-ctrl-f#v<x.y.z>`.

---

## 繁體中文

DSH 對話視窗裡，瀏覽器內建的尋找幫不上忙：對話是虛擬滾動的，只有視口附近的訊息真的存在於 DOM，其餘全部略過。`dsh-ctrl-f` 換掉那套做法，改用一個懂這個應用程式結構的尋找列。

第一次按 **Ctrl+F** 時，它會去點聊天視窗自己的「載入更早」，直到整段歷史都實際掛進 DOM，然後才搜尋；結果只保留助手的回覆，可以逐筆跳轉，並用 CSS Custom Highlight API 上色。

介面文字跟隨應用程式語言（`<html lang>`，取不到時看瀏覽器語系）：英文介面顯示英文，中文介面顯示中文。

### 功能

- 按 **Ctrl+F** 開啟尋找列；應用程式有焦點時，瀏覽器自己的尋找列會被抑制。
- **開啟時先載入整段對話**，不必手動往上滑去讓歷史「渲染出來」。
- **預設只搜助手回覆**：思考內容、工具呼叫、工具輸出、折疊的過程區塊都不會汙染結果計數。
- **含agent 思考過程** 勾選框可把思考、工具輸出與你自己的訊息也納入搜尋。
- `Enter` 下一筆、`Shift+Enter` 上一筆、`↑` / `↓` 也能逐筆跳、`F3` / `Shift+F3` 同樣可用、`Esc` 關閉。
- 尋找列開啟期間方向鍵被攔截，改成逐筆跳結果，而不是捲動頁面。
- 計數器（`3/17`）與即時 tooltip，顯示本次掃描涵蓋多少「回覆列」——DSH 改版時可據此判斷 DOM 是否變了。
- 串流回覆期間會 debounce 重掃，新內容保持可搜。
- 不插入 `<mark>`：只用 `::highlight()` 上色。
- 顏色只取自主題 token（`--dsw-alias-*`），亮色／暗色主題都正常。

### 安裝

從 GitHub：

```bash
dsh plugin --profile desktop add github:racso9201/dsh-ctrl-f
```

從本機目錄（開發用）：

```bash
git clone https://github.com/racso9201/dsh-ctrl-f.git
dsh plugin --profile desktop add link:/absolute/path/to/dsh-ctrl-f
```

安裝後重啟 DeepSeek Harness（或重新整理 Web 用戶端）——新的 bundle 要在 host 重載後才會被供應。

移除：

```bash
dsh plugin --profile desktop remove dsh-ctrl-f
```

### 使用方式

| 按鍵 | 動作 |
| --- | --- |
| `Ctrl+F`（macOS：`Cmd+F`） | 開啟尋找列（再按一次：選取輸入內容） |
| `Enter` | 下一個結果 |
| `Shift+Enter` | 上一個結果 |
| `↓` / `↑` | 下一個／上一個結果（開啟期間由外掛攔截） |
| `F3` / `Shift+F3` | 下一個／上一個結果 |
| `Esc` | 關閉 |

長對話第一次按 `Ctrl+F` 時，計數器會顯示 `載入 N 頁…`；變成 `0/0` 後就代表整段對話都可搜。

### 運作方式

用戶端半邊在 `shell.overlay` 插槽註冊一個元件，並在 `document` 上掛 capture 階段的 `keydown` 監聽：

- **分頁載入**：找到聊天視窗自己的分頁按鈕（`Load earlier` / `加载更早` / `載入更早`，容許附加頁數），點擊後等「列數 + scrollHeight」不再變動，再點下一頁，直到按鈕消失——上限 240 頁、90 秒；關閉尋找列會中止。
- **列過濾**：以 `[data-chat-flow-kind]` 選列。「回覆列」的判定是 `assistant-step` 且 group part 不是 `reasoning`，或帶 `data-turn-process-answer`（折疊過程外露的精簡答案）；`turn-process`、`reasoning`、`data-turn-process-hidden` 預設跳過，勾選後才納入。
- **比對**：用 `TreeWalker` 收集文字節點，不分大小寫，每次掃描上限 400 筆。
- **上色**：全部匹配進 `::highlight(dsh-find-all)`，當前匹配再加一層較強的高亮。
- **跳轉**：對當前匹配的元素 `scrollIntoView({ block: 'center' })`。
- **鍵盤**：`Ctrl/Cmd+F`、`F3`、`Shift+F3`、`↑`、`↓`、`Enter`、`Shift+Enter`、`Esc` 都在 capture 階段處理，對話容器收不到；零匹配時方向鍵放行，照常捲動頁面。
- 若未來 DSH 改掉列標記，找不到回覆列時會回退成掃描整個對話範圍，而不是回傳空結果；tooltip 會顯示目前是哪一種情況。

### 需求

- 有 Web 用戶端的 DeepSeek Harness（`platform: web`）。
- 支援 CSS Custom Highlight API 的 Chromium 系瀏覽器或桌面殼（Electron）；不支援時仍可搜尋與跳轉，只是不會上色。

### 平台

沒有任何 Windows 專屬程式碼：整包是純前端 JavaScript——只用 DOM、`keydown`、CSS Custom Highlight API，沒有原生模組、沒有 Node API、沒有 `process.platform` 分支。

| 平台 | 快捷鍵 | 說明 |
| --- | --- | --- |
| Windows | `Ctrl+F` | 桌面殼或任何 Chromium 系瀏覽器 |
| macOS | `Cmd+F` | 處理器同時接受 `metaKey` 與 `ctrlKey`；提示文字會切成 `Cmd+F` |
| Linux | `Ctrl+F` | 同 Windows |

macOS 兩個注意事項：

- 若未來 DSH 把 `Cmd+F` 綁成原生選單快速鍵，選單會優先於 renderer 的按鍵處理；`F3` / `Shift+F3` 仍可作為備援。
- Safari 17.2 之前沒有 Custom Highlight API：仍可跳轉，但不會上色。

### 限制

- 長對話第一次按 `Ctrl+F` 需要幾秒載入歷史。
- 每次開啟的分頁載入上限為 240 頁／90 秒；超過時尋找列會說明，並就現有內容搜尋。
- 每次掃描最多 400 筆匹配。
- 列過濾依賴 DSH 內部 DOM 屬性，那不是公開契約。
- 目前只有英文與繁體中文；其他語系會回退成中文。

### 開發

本 bundle 是 link 安裝，改完 `client.js` 重新整理頁面即可；只有 `package.json`、`cordis.patch.yml` 或 bundle 清單變動時才需要重啟 host。

```bash
node --check client.js
node --check index.js
node test/harness.cjs                 # 假 DOM：分頁、搜尋、↑/↓、文字
HARNESS_LANG=en-US node test/harness.cjs   # 同上，英文模式
```

harness 會用假 DOM（3 頁、共 36 列）實際執行 `client.js`，每項檢查輸出一行。

### 授權

MIT — 見 [LICENSE](./LICENSE)。

### 變更記錄

見 [CHANGELOG.md](./CHANGELOG.md)。每個發佈版本在 `main` 上打 `vMAJOR.MINOR.PATCH` 標籤；
`package.json`、標籤與變更記錄三者必須一致。

### 發佈流程

1. 改 `package.json` 的 `version`——SemVer：破壞性變更 → major、新增可見功能 → minor、
   只有修正或文件 → patch。
2. 把 `CHANGELOG.md` 的 `Unreleased` 項目移進 `## [x.y.z] — YYYY-MM-DD` 區塊，並更新兩條
   compare 連結。
3. 跑 `node --check client.js`、`node --check index.js`、`node test/harness.cjs`、
   `HARNESS_LANG=en-US node test/harness.cjs`。
4. 用 `python publish_github.py .gh-token` 發佈——它會把整棵樹提交到 `main`，並把
   `v<x.y.z>` 標籤建立或移到該 commit 上。
5. 安裝時可鎖定版本：`dsh plugin --profile desktop add github:racso9201/dsh-ctrl-f#v<x.y.z>`。
