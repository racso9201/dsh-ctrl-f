window.__ModuleLoader__.load({
  id: 'dsh-ctrl-f',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const HL_ALL = 'dsh-find-all';
    const HL_CURRENT = 'dsh-find-current';
    const MAX_MATCHES = 400;
    const MAX_PAGES = 240;
    const LOAD_BUDGET_MS = 90000;
    const RESCAN_DELAY = 220;
    // Some builds append a count to the label ("載入更早 (20)"); match the prefix.
    const LOAD_EARLIER_TEXT = /^(load earlier|加载更早|載入更早)/i;

    /**
     * Transcript row kinds. `assistant-step` rows carry the prose the user reads;
     * the `response` group part is the answer itself, while `reasoning` parts and
     * `turn-process` rows are the model's black box. Rows flagged with
     * `data-turn-process-answer` are the compact answer kept outside the fold.
     */
    const ANSWER_KIND = 'assistant-step';
    const PROCESS_KIND = 'turn-process';
    const REASONING_PART = 'reasoning';
    const RESPONSE_PART = 'response';

    const state = {
      open: false,
      query: '',
      index: 0,
      count: 0,
      focusToken: 0,
      includeProcess: false,
      answerRows: 0,
      scannedRows: 0,
      loading: false,
      pages: 0,
      loadError: '',
    };
    const listeners = new Set();
    function emit() {
      for (const listener of listeners) {
        try {
          listener();
        } catch (error) {
          /* one broken subscriber must not stop the others */
        }
      }
    }
    function subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    let ranges = [];
    let styleTag = null;
    let rescanTimer = null;
    let observer = null;
    let attached = false;
    let loadToken = 0;

    function ensureStyle() {
      if (styleTag && styleTag.isConnected) return;
      styleTag = document.createElement('style');
      styleTag.dataset.plugin = '@local/dsh-ctrl-f';
      styleTag.dataset.pluginCss = 'dsh-ctrl-f-highlight';
      styleTag.textContent = [
        `::highlight(${HL_ALL}) { background-color: rgba(255, 206, 61, 0.42); }`,
        `::highlight(${HL_CURRENT}) { background-color: #ffb020; color: #1a1200; }`,
      ].join('\n');
      document.head.appendChild(styleTag);
    }

    function transcriptScope() {
      return (
        document.querySelector('[data-conversation-content]') ||
        document.querySelector('[data-conversation-scroll]') ||
        document.body
      );
    }

    function scrollerEl() {
      return (
        document.querySelector('[data-conversation-scroll]') ||
        document.querySelector('[data-conversation-content]')
      );
    }

    /**
     * The chat view renders its own "load earlier" pager at the top of the
     * transcript. Its label is localized ("Load earlier" / "加载更早" /
     * "載入更早"), sometimes with a count suffix, so match the prefix.
     */
    function findLoadEarlier() {
      const scopes = [scrollerEl(), document].filter(Boolean);
      for (const scope of scopes) {
        const buttons = scope.querySelectorAll('button');
        for (const button of buttons) {
          if (button.closest('[data-dsh-find-ui]')) continue;
          const label = (button.textContent || '').trim();
          if (!label || label.length > 60) continue;
          if (LOAD_EARLIER_TEXT.test(label)) return button;
        }
      }
      return null;
    }

    function transcriptSignature() {
      const scroller = scrollerEl();
      return `${document.querySelectorAll('[data-chat-flow-kind]').length}:${
        scroller ? scroller.scrollHeight : 0
      }`;
    }

    function wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Resolves once rows stop being appended, so the next click happens after
     * the chat view has actually rendered the page it just fetched.
     */
    async function waitForQuiet(quiet = 160, cap = 8000) {
      const started = Date.now();
      let signature = transcriptSignature();
      let changedAt = Date.now();
      while (Date.now() - started < cap) {
        await wait(50);
        const next = transcriptSignature();
        if (next !== signature) {
          signature = next;
          changedAt = Date.now();
          continue;
        }
        if (Date.now() - changedAt >= quiet) return true;
      }
      return false;
    }

    /**
     * Press the pager until it disappears so the whole transcript is mounted
     * before the first search runs. Cheap no-op once everything is loaded.
     */
    async function loadAllEarlier() {
      if (state.loading) return;
      const token = (loadToken += 1);
      const startedAt = Date.now();
      state.loading = true;
      state.pages = 0;
      state.loadError = '';
      emit();
      try {
        if (!findLoadEarlier()) {
          // Nothing to page: still settle briefly, rows may be mid-render.
          if (state.open) await waitForQuiet(120, 1500);
          return;
        }
        for (let page = 0; page < MAX_PAGES; page += 1) {
          if (token !== loadToken || !state.open) return;
          if (Date.now() - startedAt > LOAD_BUDGET_MS) {
            state.loadError = '載入逾時，已停止';
            return;
          }
          const button = findLoadEarlier();
          if (!button) return;
          if (button.disabled) {
            const before = transcriptSignature();
            await waitForQuiet(200, 3000);
            if (transcriptSignature() === before) {
              state.loadError = '「載入更早」一直停用';
              return;
            }
            continue;
          }
          state.pages += 1;
          emit();
          button.click();
          await waitForQuiet();
        }
        state.loadError = `已載入 ${MAX_PAGES} 頁仍未到底`;
      } finally {
        if (token === loadToken) {
          state.loading = false;
          emit();
          if (state.open) rescan();
        }
      }
    }

    function rowInfo(element) {
      return {
        kind: element.getAttribute('data-chat-flow-kind'),
        part: element.getAttribute('data-chat-group-part'),
        answer: element.hasAttribute('data-turn-process-answer'),
        hidden: element.hasAttribute('data-turn-process-hidden'),
      };
    }

    function isAnswerRow(info) {
      if (info.hidden) return false;
      if (info.answer) return true;
      if (info.kind !== ANSWER_KIND) return false;
      return info.part !== REASONING_PART;
    }

    function isProcessRow(info) {
      if (info.hidden) return true;
      if (info.kind === PROCESS_KIND) return true;
      return info.part === REASONING_PART;
    }

    /**
     * Rows the search may descend into: answer rows only by default, every
     * non-process row when the user ticks "含過程". Falling back to the whole
     * scope keeps the bar usable if a future build renames the row kinds.
     */
    function searchRoots() {
      const scope = transcriptScope();
      const rows = scope.querySelectorAll('[data-chat-flow-kind]');
      state.scannedRows = rows.length;
      if (!rows.length) {
        state.answerRows = 0;
        return [scope];
      }
      const picked = [];
      for (const row of rows) {
        const info = rowInfo(row);
        if (isAnswerRow(info)) picked.push(row);
        else if (state.includeProcess && !isProcessRow(info)) picked.push(row);
      }
      state.answerRows = picked.length;
      return picked.length ? picked : [scope];
    }

    function acceptableTextNode(node) {
      const parent = node.parentElement;
      if (!parent) return false;
      const tag = parent.tagName;
      if (
        tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' ||
        tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT'
      ) return false;
      if (parent.closest('[data-dsh-find-ui]')) return false;
      if (parent.closest('[aria-hidden="true"]')) return false;
      const text = node.nodeValue;
      return Boolean(text && text.trim());
    }

    function collectRanges(roots, query) {
      const found = [];
      if (!query) return found;
      const needle = query.toLowerCase();
      for (const root of roots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            return acceptableTextNode(node)
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT;
          },
        });
        let visited = 0;
        let node = walker.nextNode();
        while (node && visited < 40000) {
          visited += 1;
          const haystack = node.nodeValue.toLowerCase();
          let from = 0;
          let at = haystack.indexOf(needle, from);
          while (at !== -1) {
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + needle.length);
            found.push(range);
            if (found.length >= MAX_MATCHES) return found;
            from = at + Math.max(1, needle.length);
            at = haystack.indexOf(needle, from);
          }
          node = walker.nextNode();
        }
      }
      return found;
    }

    function paint() {
      if (!(typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function')) return;
      try {
        CSS.highlights.delete(HL_ALL);
        CSS.highlights.delete(HL_CURRENT);
        if (!ranges.length) return;
        CSS.highlights.set(HL_ALL, new Highlight(...ranges));
        const current = ranges[state.index];
        if (current) CSS.highlights.set(HL_CURRENT, new Highlight(current));
      } catch (error) {
        /* detached ranges during a re-render simply skip one paint */
      }
    }

    function rescan() {
      const roots = searchRoots();
      ranges = collectRanges(roots, state.query);
      state.count = ranges.length;
      if (!ranges.length) state.index = 0;
      else state.index = Math.min(Math.max(0, state.index), ranges.length - 1);
      paint();
      emit();
    }

    function scheduleRescan() {
      if (!state.open) return;
      clearTimeout(rescanTimer);
      rescanTimer = setTimeout(rescan, RESCAN_DELAY);
    }

    function revealCurrent() {
      const range = ranges[state.index];
      if (!range) return;
      const start = range.startContainer;
      const element = start.nodeType === 1 ? start : start.parentElement;
      if (!element) return;
      try {
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      } catch (error) {
        element.scrollIntoView();
      }
    }

    function step(delta) {
      if (!ranges.length) return;
      state.index = (state.index + delta + ranges.length) % ranges.length;
      paint();
      revealCurrent();
      emit();
    }

    function openBar() {
      state.open = true;
      state.focusToken += 1;
      ensureStyle();
      rescan();
      attach();
      // One full load per open: page everything in, then the existing rescan
      // (MutationObserver + explicit rescan in loadAllEarlier) covers it all.
      loadAllEarlier();
    }

    function closeBar() {
      state.open = false;
      loadToken += 1;
      state.loading = false;
      state.pages = 0;
      state.loadError = '';
      ranges = [];
      state.count = 0;
      state.index = 0;
      clearTimeout(rescanTimer);
      if (typeof CSS !== 'undefined' && CSS.highlights) {
        CSS.highlights.delete(HL_ALL);
        CSS.highlights.delete(HL_CURRENT);
      }
      detach();
      emit();
    }

    function setQuery(query) {
      state.query = query;
      state.index = 0;
      rescan();
    }

    function setIncludeProcess(include) {
      state.includeProcess = Boolean(include);
      state.index = 0;
      rescan();
    }

    function onMutations(records) {
      for (const record of records) {
        const target = record.target;
        const element = target && (target.nodeType === 1 ? target : target.parentElement);
        if (element && element.closest('[data-dsh-find-ui]')) continue;
        scheduleRescan();
        return;
      }
    }

    function attach() {
      if (attached) return;
      attached = true;
      document.addEventListener('scroll', scheduleRescan, true);
      if (typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(onMutations);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
    }

    function detach() {
      if (!attached) return;
      attached = false;
      document.removeEventListener('scroll', scheduleRescan, true);
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }

    const INPUT_STYLE = {
      width: '200px',
      border: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.18))',
      borderRadius: '6px',
      background: 'var(--dsw-alias-bg-base, transparent)',
      color: 'var(--dsw-alias-label-primary, inherit)',
      font: '12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
      padding: '3px 6px',
      outline: 'none',
    };

    const BUTTON_STYLE = {
      border: 'none',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary, inherit)',
      cursor: 'pointer',
      font: '12px/1 system-ui, -apple-system, "Segoe UI", sans-serif',
      padding: '4px 5px',
      borderRadius: '5px',
    };

    const IS_MAC = (() => {
      try {
        const data = navigator.userAgentData;
        if (data && typeof data.platform === 'string') return data.platform === 'macOS';
      } catch (error) {
        // userAgentData is Chromium-only; fall through to platform sniffing.
      }
      return /Mac|iPhone|iPad|iPod/.test((navigator && navigator.platform) || '');
    })();
    // macOS users press Cmd+F, everyone else Ctrl+F; the handler accepts both,
    // only the hint text changes.
    const SHORTCUT_LABEL = IS_MAC ? 'Cmd+F' : 'Ctrl+F';

    /** Follow the app's own language: <html lang>, then the browser locale. */
    function detectLang() {
      const tag = String(
        (document.documentElement && document.documentElement.lang) ||
        (typeof navigator !== 'undefined' && navigator.language) ||
        '',
      ).toLowerCase();
      return tag.startsWith('en') ? 'en' : 'zh';
    }
    const LANG = detectLang();

    const TEXT = LANG === 'en'
      ? {
          placeholder: 'Search answers only',
          inputLabel: 'Search the assistant answers',
          loadingPages: (pages) => `Loading ${pages} page${pages === 1 ? '' : 's'}…`,
          scopePrefix: 'scope: ',
          scopeProcess: 'answers + process',
          scopeAnswers: 'answers only (no reasoning or tool output)',
          loadingNote: (pages) => `loading the whole transcript (${pages} pages so far)`,
          scanNote: (answers, rows) => `scanned ${answers} answers of ${rows} rows`,
          errDisabled: '"Load earlier" stayed disabled',
          errTimeout: 'load timed out',
          errPageCap: (pages) => `stopped after ${pages} pages`,
          prevTitle: 'Previous (Shift+Enter / ↑)',
          nextTitle: 'Next (Enter / ↓)',
          closeTitle: 'Close (Esc)',
          includeTitle: 'Also search reasoning, tool output and your own messages',
          includeLabel: 'Agent reasoning',
        }
      : {
          placeholder: '只在回覆中尋找',
          inputLabel: '在回覆結果中尋找',
          loadingPages: (pages) => `載入 ${pages} 頁…`,
          scopePrefix: '範圍：',
          scopeProcess: '回覆 + 過程',
          scopeAnswers: '只搜回覆（不含思考與工具輸出）',
          loadingNote: (pages) => `正在載入整段對話（已載入 ${pages} 頁）`,
          scanNote: (answers, rows) => `已掃描 ${answers} 段 / 共 ${rows} 列`,
          errDisabled: '「載入更早」一直停用',
          errTimeout: '載入逾時，已停止',
          errPageCap: (pages) => `已載入 ${pages} 頁仍未到底`,
          prevTitle: '上一個 (Shift+Enter / ↑)',
          nextTitle: '下一個 (Enter / ↓)',
          closeTitle: '關閉 (Esc)',
          includeTitle: '把思考過程、工具輸出與使用者訊息也納入搜尋',
          includeLabel: '含agent 思考過程',
        };

    const BAR_STYLE = {
      position: 'fixed',
      top: '64px',
      right: '28px',
      zIndex: 2147483000,
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 8px',
      borderRadius: '10px',
      background: 'var(--dsw-alias-bg-layer-1, #1f1f1f)',
      border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.16))',
      boxShadow: '0 10px 28px rgba(0,0,0,0.28)',
      color: 'var(--dsw-alias-label-primary, #fff)',
      font: '12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
    };

    function FindBar() {
      const [, force] = React.useReducer((value) => value + 1, 0);
      const inputRef = React.useRef(null);

      React.useEffect(() => subscribe(force), []);

      React.useEffect(() => {
        if (!state.open || !inputRef.current) return;
        inputRef.current.focus();
        inputRef.current.select();
      }, [state.open, state.focusToken]);

      if (!state.open) return null;

      const label = state.loading
        ? TEXT.loadingPages(state.pages)
        : state.query
          ? (state.count ? `${state.index + 1}/${state.count}` : '0/0')
          : '';

      const scopeNote = `${SHORTCUT_LABEL} · ${TEXT.scopePrefix}`
        + (state.includeProcess ? TEXT.scopeProcess : TEXT.scopeAnswers);
      const rowNote = state.loading
        ? TEXT.loadingNote(state.pages)
        : TEXT.scanNote(state.answerRows, state.scannedRows);
      const loadNote = state.loadError ? ` · ${state.loadError}` : '';

      return h(
        'div',
        {
          'data-dsh-find-ui': '',
          title: `${scopeNote} · ${rowNote}${loadNote}`,
          style: BAR_STYLE,
          onMouseDown: (event) => event.stopPropagation(),
        },
        h('input', {
          ref: inputRef,
          type: 'text',
          value: state.query,
          spellCheck: false,
          placeholder: TEXT.placeholder,
          'aria-label': TEXT.inputLabel,
          style: INPUT_STYLE,
          onChange: (event) => setQuery(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              closeBar();
              return;
            }
            if ((event.ctrlKey || event.metaKey) && (event.key === 'f' || event.key === 'F')) {
              event.preventDefault();
              event.currentTarget.select();
            }
          },
        }),
        h(
          'span',
          {
            style: {
              minWidth: state.loading ? '78px' : '46px',
              textAlign: 'center',
              color: 'var(--dsw-alias-label-tertiary, inherit)',
              fontVariantNumeric: 'tabular-nums',
            },
          },
          label,
        ),
        h('button', {
          type: 'button',
          title: TEXT.prevTitle,
          style: BUTTON_STYLE,
          onClick: () => step(-1),
        }, '↑'),
        h('button', {
          type: 'button',
          title: TEXT.nextTitle,
          style: BUTTON_STYLE,
          onClick: () => step(1),
        }, '↓'),
        h(
          'label',
          {
            title: TEXT.includeTitle,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              color: 'var(--dsw-alias-label-tertiary, inherit)',
              cursor: 'pointer',
              userSelect: 'none',
            },
          },
          h('input', {
            type: 'checkbox',
            checked: state.includeProcess,
            onChange: (event) => setIncludeProcess(event.target.checked),
            style: { margin: 0, cursor: 'pointer' },
          }),
          TEXT.includeLabel,
        ),
        h('button', {
          type: 'button',
          title: '關閉 (Esc)',
          style: BUTTON_STYLE,
          onClick: () => closeBar(),
        }, '✕'),
      );
    }

    function installShortcut() {
      const onKeyDown = (event) => {
        const primary = event.ctrlKey || event.metaKey;
        if (primary && !event.altKey && !event.shiftKey && (event.code === 'KeyF' || event.key === 'f' || event.key === 'F')) {
          event.preventDefault();
          event.stopPropagation();
          if (state.open) {
            state.focusToken += 1;
            emit();
          } else {
            openBar();
          }
          return;
        }
        if (event.key === 'F3') {
          event.preventDefault();
          event.stopPropagation();
          if (state.open) step(event.shiftKey ? -1 : 1);
          else openBar();
          return;
        }
        if (state.open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
          // Steal the arrows while the bar is open so they step through matches
          // instead of scrolling the transcript. With no matches there is
          // nothing to step to, so leave normal scrolling alone.
          if (state.count > 0) {
            event.preventDefault();
            event.stopPropagation();
            step(event.key === 'ArrowDown' ? 1 : -1);
          }
          return;
        }
        if (event.key === 'Escape' && state.open) {
          event.preventDefault();
          event.stopPropagation();
          closeBar();
        }
      };
      document.addEventListener('keydown', onKeyDown, true);
      return () => {
        document.removeEventListener('keydown', onKeyDown, true);
        closeBar();
        if (styleTag) styleTag.remove();
        styleTag = null;
      };
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'ctrl-f-find',
          order: 60,
        }, FindBar));
        ctx.effect(installShortcut, 'ctrl-f: global key binding');
      },
    };
  },
});
