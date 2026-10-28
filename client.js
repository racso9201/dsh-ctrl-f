window.__ModuleLoader__.load({
  id: 'dsh-ctrl-f',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const HL_ALL = 'dsh-find-all';
    const HL_CURRENT = 'dsh-find-current';
    const MAX_MATCHES = 400;
    const RESCAN_DELAY = 220;

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
    }

    function closeBar() {
      state.open = false;
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

      const label = state.query
        ? (state.count ? `${state.index + 1}/${state.count}` : '0/0')
        : '';

      const scopeNote = state.includeProcess
        ? '範圍：回覆 + 過程'
        : '範圍：只搜回覆（不含思考與工具輸出）';
      const rowNote = `已掃描 ${state.answerRows} 段 / 共 ${state.scannedRows} 列`;

      return h(
        'div',
        {
          'data-dsh-find-ui': '',
          title: `${scopeNote} · ${rowNote}`,
          style: BAR_STYLE,
          onMouseDown: (event) => event.stopPropagation(),
        },
        h('input', {
          ref: inputRef,
          type: 'text',
          value: state.query,
          spellCheck: false,
          placeholder: '只在回覆中尋找',
          'aria-label': '在回覆結果中尋找',
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
              minWidth: '46px',
              textAlign: 'center',
              color: 'var(--dsw-alias-label-tertiary, inherit)',
              fontVariantNumeric: 'tabular-nums',
            },
          },
          label,
        ),
        h('button', {
          type: 'button',
          title: '上一個 (Shift+Enter)',
          style: BUTTON_STYLE,
          onClick: () => step(-1),
        }, '↑'),
        h('button', {
          type: 'button',
          title: '下一個 (Enter)',
          style: BUTTON_STYLE,
          onClick: () => step(1),
        }, '↓'),
        h(
          'label',
          {
            title: '把思考過程、工具輸出與使用者訊息也納入搜尋',
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
          '含過程',
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
