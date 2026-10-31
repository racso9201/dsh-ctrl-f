# Changelog

All notable changes to `dsh-ctrl-f` are documented here. This file follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every published version is tagged `vMAJOR.MINOR.PATCH` on `main`; the version in
`package.json`, the tag, and the top entry of this file must always match.

## [Unreleased]

Nothing yet.

## [1.2.1] — 2026-10-31

**English**

### Added
- `↑` / `↓` step to the previous / next match while the find bar is open. The keys are
  captured in the capture phase and the native scroll is cancelled, so the transcript no
  longer scrolls under the cursor; with zero matches the arrows are left alone.
- Bilingual UI: the find bar follows the app language (`<html lang>`, falling back to
  `navigator.language`) — English strings for English UIs, Chinese for the rest.
- `test/harness.cjs`: a fake-DOM harness that runs the real `client.js` (paging, search,
  arrow keys, labels) — 16 checks, in both languages.

### Changed
- The "include process" checkbox is now labelled **Agent reasoning** (was *Process*).
- README rewritten as a bilingual document (English first, 繁體中文 second) with a
  Platforms table, Limitations, Development and Changelog sections.
- `meta.json` title/description are bilingual so the plugin shows up readably in a
  Chinese or an English UI.

### Fixed
- The checkbox label was hard-coded in the render tree, so editing the translation table
  had no visible effect.

**繁體中文**

### 新增
- 尋找列開啟時，`↑` / `↓` 可跳到上一個／下一個結果；按鍵在 capture 階段攔截並取消原生捲動，
  對話不會再跟著滾；零匹配時方向鍵放行，維持原本的頁面捲動。
- 介面中英雙語：跟隨應用程式語言（`<html lang>`，取不到時看 `navigator.language`）。
- `test/harness.cjs`：以假 DOM 實際執行 `client.js` 的測試骨架（分頁、搜尋、方向鍵、文字），
  共 16 項、中英兩種語系都跑。

### 變更
- 勾選框由「含過程」改名為 **含agent 思考過程**（英文介面為 *Agent reasoning*）。
- README 改寫為中英雙語（英文在前、繁中在後），補上 Platforms 表、限制、開發與變更記錄。
- `meta.json` 的標題與描述改為中英並列。

### 修正
- 勾選框文字原本硬編碼在 render tree，改翻譯表不會生效。

## [1.1.0] — 2026-10-28

### Added
- Platform-aware hint: `Cmd+F` on macOS, `Ctrl+F` on Windows/Linux.
- `## Platforms` section documenting Windows, macOS and Linux, plus macOS caveats
  (native menu accelerators, Safari < 17.2 without the Custom Highlight API).

### Changed
- Version bumped to 1.1.0; README gained a changelog.

## [1.0.0] — 2026-10-28

### Added
- First release: a `Ctrl+F` find bar for the DeepSeek Harness Web client that searches
  **assistant answers only**, skipping reasoning, tool calls, tool output and collapsed
  process blocks.
- Highlights via the CSS Custom Highlight API (no `<mark>` injection), theme colors from
  `--dsw-alias-*` tokens, `Enter` / `Shift+Enter` / `F3` navigation, debounced rescans
  while a response streams.

## Release notes

- `1.2.0` was built and validated locally but never published; it is folded into `1.2.1`
  (its changelog entry lives in the README).
- `2.0.0`–`2.0.1` were experiments with a full-transcript index and were rolled back in
  favour of the simpler on-open pager, so they are not part of the release history.

[Unreleased]: https://github.com/racso9201/dsh-ctrl-f/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/racso9201/dsh-ctrl-f/compare/v1.1.0...v1.2.1
[1.1.0]: https://github.com/racso9201/dsh-ctrl-f/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/racso9201/dsh-ctrl-f/releases/tag/v1.0.0
