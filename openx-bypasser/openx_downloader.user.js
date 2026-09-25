// ==UserScript==
// @name         OpenX Direct Downloader
// @namespace    openx.direct.dl
// @author       github.com/felzeth
// @version      1.7.0
// @description  Direct 480p/720p/1080p downloads on content.openx.xyz (bypasses the ad wall; the server only checks a Turnstile token), plus a popup-free fast-forward helper for the site's own ad counters.
// @match        https://content.openx.xyz/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

/*
  REVERSE-ENGINEERED FLOW:
  - GET /api/get-video-info?v=<slug>  -> { name, sources:[{quality,size,videoId,hash}] }   (public)
  - GET /api/export?videoId&hash&token&filename -> file (application/octet-stream)
      token = Cloudflare Turnstile response (sitekey below), SINGLE-USE, ~5 min TTL,
      referer required, Range rejected. Ad counters are client-side theatre only.
*/

(function () {
  'use strict';
  if (window.__OXD_LOADED) return;      // guard against double injection on SPA re-nav
  window.__OXD_LOADED = true;

  const SITEKEY = '0x4AAAAAABjR-PW5STU0FnV1';
  const QUALITIES = ['480', '720', '1080'];
  const slug = new URLSearchParams(location.search).get('v') || '';

  let info = null;
  let busy = false;
  let tsHolder = null;

  // ---------- helpers ----------
  function el(tag, style, text) {
    const e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (text != null) e.textContent = text;
    return e;
  }
  const fmtMB = (b) => (b / 1048576).toFixed(1) + ' MB';
  const log = (...a) => console.log('%c[OpenX DL]', 'color:#4da3ff', ...a);

  const BTN = [
    'font:11px system-ui', 'padding:5px 8px', 'border-radius:7px',
    'border:1px solid #2c333a', 'background:#1b2128', 'color:#e8eaed', 'cursor:pointer',
  ].join(';');

  // ---------- panel (pure createElement - no innerHTML anywhere) ----------
  const panel = el('div', [
    'position:fixed', 'top:12px', 'right:12px', 'z-index:999999',
    'background:#101418', 'color:#e8eaed', 'border:1px solid #2c333a',
    'border-radius:12px', 'padding:12px 14px', 'font:13px/1.45 system-ui,sans-serif',
    'width:290px', 'box-shadow:0 8px 30px rgba(0,0,0,.45)', 'user-select:none',
  ].join(';'));

  // header row: title + collapse toggle
  const headerRow = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:8px');
  const head = el('div', 'font-weight:700;cursor:pointer', 'OpenX Direct DL');
  const minBtn = el('button', [
    'font:11px system-ui', 'width:22px', 'height:22px', 'line-height:1',
    'border-radius:6px', 'border:1px solid #2c333a', 'background:#1b2128',
    'color:#e8eaed', 'cursor:pointer', 'flex:none',
  ].join(';'), '-');
  headerRow.append(head, minBtn);

  // everything below the header lives in one collapsible body
  const body = el('div', 'margin-top:8px');
  const title = el('div', 'opacity:.75;font-size:11px;margin-bottom:8px;word-break:break-word', slug ? ('slug: ' + slug) : 'no ?v= slug');
  const btnBox = el('div', 'display:flex;flex-direction:column;gap:6px');
  const statusLine = el('div', 'margin-top:8px;font-size:11px;opacity:.85;min-height:15px', 'starting');

  // ---------- fast-forward controls ----------
  const ffRow = el('div', 'display:flex;gap:6px;margin-top:8px');
  const ffSelect = el('select', [
    'flex:1', 'font:11px system-ui', 'padding:5px', 'border-radius:7px',
    'border:1px solid #2c333a', 'background:#1b2128', 'color:#e8eaed', 'cursor:pointer',
  ].join(';'));
  for (const q of QUALITIES) {
    const o = el('option', null, q + 'p');
    o.value = q;
    ffSelect.append(o);
  }
  ffSelect.value = '1080';
  const ffRunBtn = el('button', BTN, 'Run');
  const refreshBtn = el('button', BTN, 'refresh');
  ffRow.append(ffSelect, ffRunBtn, refreshBtn);

  const ffCount = el('div', 'margin-top:6px;font-size:10px;opacity:.75;min-height:13px', 'ad opens: 0 · active: 0');

  const foot = el('div', 'margin-top:6px;font-size:10px;opacity:.55', 'one fresh link per click · single-use · ~5 min TTL');

  // ---------- minted-url result box ----------
  const resultBox = el('div', [
    'display:none', 'margin-top:8px', 'border:1px solid #2c333a', 'border-radius:8px',
    'background:#0b0e12', 'padding:8px',
  ].join(';'));
  const resultLabel = el('div', 'font-size:10px;opacity:.6;margin-bottom:4px', 'MINTED URL (single-use, ~5 min TTL):');
  const resultUrl = el('div', [
    'font:10px/1.4 ui-monospace,Consolas,monospace', 'color:#8fd3ff',
    'word-break:break-all', 'max-height:66px', 'overflow-y:auto', 'user-select:all',
  ].join(';'));
  const resultRow = el('div', 'display:flex;gap:6px;margin-top:6px');
  const mkMini = (label) => el('button', [
    'flex:1', 'font:11px system-ui', 'padding:5px 4px', 'border-radius:6px',
    'border:1px solid #2c333a', 'background:#1b2128', 'color:#e8eaed', 'cursor:pointer',
  ].join(';'), label);
  const copyUrlBtn = mkMini('Copy URL');
  const copyCurlBtn = mkMini('Copy curl');
  const dlAgainBtn = mkMini('Download');
  resultRow.append(copyUrlBtn, copyCurlBtn, dlAgainBtn);
  resultBox.append(resultLabel, resultUrl, resultRow);

  let lastUrl = null;
  function showResult(url) {
    lastUrl = url;
    resultUrl.textContent = url;
    resultBox.style.display = 'block';
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch {}
    try {
      const ta = el('textarea');
      ta.value = t;
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
  copyUrlBtn.addEventListener('click', async () => {
    if (!lastUrl) return;
    const ok = await copyText(lastUrl);
    setStatus(ok ? 'URL copied' : 'copy failed — select the URL text manually', !ok);
  });
  copyCurlBtn.addEventListener('click', async () => {
    if (!lastUrl) return;
    const slugQ = slug ? `?v=${slug}` : '/';
    const cmd = [
      'curl -L -o video.mp4 --speed-limit 10240 --speed-time 30 \\',
      '-H "user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36" \\',
      `-H "referer: https://content.openx.xyz/${slugQ}" \\`,
      `"${lastUrl}"`,
    ].join('\n  ');
    setStatus((await copyText(cmd)) ? 'curl command copied' : 'copy failed', false);
  });
  dlAgainBtn.addEventListener('click', () => {
    if (!lastUrl) return;
    const a = el('a');
    a.href = lastUrl; a.rel = 'noopener'; a.target = '_blank';
    document.body.appendChild(a); a.click(); a.remove();
    setStatus('re-sent to downloads (same token - only works if not yet consumed)', true);
  });

  body.append(title, btnBox, statusLine, resultBox, ffRow, ffCount, foot);
  panel.append(headerRow, body);
  document.documentElement.appendChild(panel);

  // ---------- collapse / expand (state remembered per site) ----------
  let collapsed = false;
  function applyCollapse() {
    body.style.display = collapsed ? 'none' : 'block';
    minBtn.textContent = collapsed ? '+' : '-';
    panel.style.width = collapsed ? 'auto' : '290px';
    panel.style.padding = collapsed ? '8px 12px' : '12px 14px';
    try { localStorage.setItem('oxdCollapsed', collapsed ? '1' : '0'); } catch {}
  }
  minBtn.addEventListener('click', () => { collapsed = !collapsed; applyCollapse(); });
  head.addEventListener('click', () => { collapsed = !collapsed; applyCollapse(); });
  try { collapsed = localStorage.getItem('oxdCollapsed') === '1'; } catch {}
  applyCollapse();

  function setStatus(t, warn) {
    statusLine.textContent = t;
    statusLine.style.color = warn ? '#ffb84d' : '#9fe19f';
  }

  function renderButtons() {
    btnBox.replaceChildren();
    if (!info || !Array.isArray(info.sources) || !info.sources.length) {
      btnBox.append(el('div', 'opacity:.6', 'no sources'));
      return;
    }
    for (const src of info.sources) {
      const b = el('button', [
        'font:12.5px system-ui', 'padding:8px', 'border-radius:8px', 'border:0',
        'background:#2563eb', 'color:#fff', 'cursor:pointer', 'text-align:left',
        'display:flex', 'justify-content:space-between',
      ].join(';'));
      const l = el('span', null, src.quality.toUpperCase());
      const r = el('span', 'opacity:.85', fmtMB(src.size));
      b.append(l, r);
      b.addEventListener('click', () => directDownload(src));
      btnBox.append(b);
    }
  }

  // ---------- data ----------
  async function loadInfo(force) {
    if (info && !force) return info;
    if (!slug) { setStatus('no ?v= slug on this page', true); return null; }
    setStatus('fetching video info…');
    try {
      const r = await fetch(`/api/get-video-info?v=${encodeURIComponent(slug)}`, { credentials: 'include' });
      if (!r.ok) { setStatus('get-video-info failed: ' + r.status, true); return null; }
      info = await r.json();
      title.textContent = (info && info.name) ? info.name.slice(0, 90) : title.textContent;
      renderButtons();
      setStatus('ready — pick a quality');
      return info;
    } catch (e) {
      setStatus('info error: ' + e.message, true);
      return null;
    }
  }

  // ---------- turnstile ----------
  function loadTurnstile() {
    return new Promise((res, rej) => {
      if (window.turnstile) return res();
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.addEventListener('load', () => res());
      s.addEventListener('error', () => rej(new Error('turnstile api.js failed to load')));
      document.head.appendChild(s);
      setTimeout(() => rej(new Error('turnstile api.js timeout')), 20000);
    });
  }

  // fresh widget per click -> fresh token (tokens are single-use)
  function newToken() {
    return new Promise(async (resolve, reject) => {
      try {
        await loadTurnstile();
        if (!tsHolder) {
          tsHolder = el('div', 'position:fixed;bottom:10px;right:12px;z-index:999999;background:#fff;border-radius:10px;padding:6px;box-shadow:0 6px 24px rgba(0,0,0,.4)');
          document.documentElement.appendChild(tsHolder);
        }
        tsHolder.replaceChildren();
        let settled = false;
        const wid = window.turnstile.render(tsHolder, {
          sitekey: SITEKEY,
          callback: (t) => { if (!settled) { settled = true; setTimeout(() => { try { window.turnstile.remove(wid); } catch {} }, 800); resolve(t); } },
          'error-callback': (e) => { if (!settled) { settled = true; reject(new Error('turnstile error ' + e)); } },
          'timeout-callback': () => { if (!settled) { settled = true; reject(new Error('turnstile timeout')); } },
        });
        setTimeout(() => { if (!settled) { settled = true; reject(new Error('no token in 180s (solve the widget bottom-right)')); } }, 180000);
      } catch (e) { reject(e); }
    });
  }

  // ---------- download ----------
  async function directDownload(src) {
    if (busy) { setStatus('busy — wait for current action', true); return; }
    busy = true;
    try {
      setStatus(`solving turnstile for ${src.quality}…`);
      const token = await newToken();
      setStatus('minting download URL…');

      const name = (info.name || 'video').replace(/\.mp4$/i, '').replace(/\.ts$/i, '');
      const filename = `${name}_${src.quality}.mp4`;
      const url = 'https://content.openx.xyz/api/export'
        + `?videoId=${src.videoId}&hash=${src.hash}`
        + `&token=${encodeURIComponent(token)}`
        + `&filename=${encodeURIComponent(filename)}`;

      // show it in the panel (copy / curl / re-download)
      showResult(url);

      // same-origin navigation -> required Referer sent automatically;
      // content-disposition: attachment saves with the right name.
      const a = el('a');
      a.href = url; a.rel = 'noopener'; a.target = '_blank';
      document.body.appendChild(a); a.click(); a.remove();

      setStatus(`minted ${src.quality} + sent to downloads (token burned)`);
      log('minted url:', url);
    } catch (e) {
      setStatus(e.message, true);
      log('error', e);
    } finally { busy = false; }
  }

  // ---------- fast-forward the site's own ad counters (no real tabs) ----------
  // page logic: const S = window.open(adUrl); setTimeout(() => { if (S && !S.closed) i.value++ }, 1e3)
  // => hook window.open to return a FAKE window object: truthy, .closed === false, so the
  //    site's 1s "popup alive" check passes and its counter increments - no tab opens,
  //    no ad network is ever contacted. Then click the target card until "Download Now".
  // card matching: climb from each watch/download button to the TIGHTEST ancestor that
  // contains the target quality label AND the watch/download text AND none of the other
  // quality labels - the old version matched whole-container text and clicked the wrong card.
  function findCard(q) {
    const reSelf = new RegExp(q + '\\s*p', 'i');
    const others = QUALITIES.filter((x) => x !== q).join('|');
    const reOther = new RegExp(others + '\\s*p', 'i');
    let best = null;
    for (const b of document.querySelectorAll('button')) {
      const bt = (b.innerText || '').replace(/\s+/g, ' ');
      if (!/watch ad|download now/i.test(bt)) continue;
      let e = b;
      for (let hops = 0; e && hops < 6; hops++, e = e.parentElement) {
        const t = (e.innerText || '').replace(/\s+/g, ' ');
        if (reSelf.test(t) && !reOther.test(t)) {
          if (!best || t.length < best.t.length) best = { el: e, t };
          break;                       // tightest ancestor for this button
        }
      }
    }
    return best;
  }

  // minimal stand-in for a popup: the site only reads .closed (plus harmless method calls)
  function makeFakeWindow() {
    return {
      closed: false,
      close() { this.closed = true; },
      focus() {}, blur() {}, stop() {}, print() {},
      postMessage() {}, moveTo() {}, resizeTo() {}, scrollTo() {},
    };
  }

  function fastForward(q) {
    if (window.__OXD_FF) { setStatus('fast-forward already running', true); return; }
    window.__OXD_FF = true;
    ffRunBtn.disabled = true;
    ffSelect.disabled = true;

    const origOpen = window.open;
    let pagesOpened = 0;
    let pagesAlive = 0;
    let stuck = 0;
    let lastKey = '';

    function updateCount(siteStr) {
      let s = 'ad opens: ' + pagesOpened + ' · active: ' + pagesAlive;
      if (siteStr) s += ' · site: ' + siteStr;
      ffCount.textContent = s;
    }
    function siteCounter(card) {
      const m = card && card.t.match(/(\d+)\s*\/\s*(\d+)/);
      return m ? m[1] + '/' + m[2] : null;
    }
    function finish(msg, warn) {
      window.open = origOpen;
      window.__OXD_FF = false;
      ffRunBtn.disabled = false;
      ffSelect.disabled = false;
      setStatus(msg, warn);
      const c = findCard(q);
      updateCount(siteCounter(c));
    }

    // hook: never open anything - hand the site a fake window so its
    // "popup alive after 1s" check passes and its own counter increments.
    window.open = function (...args) {
      const fake = makeFakeWindow();
      pagesOpened++;
      pagesAlive++;
      updateCount();
      setTimeout(() => {            // the 1.2s alive window, same timing as before
        fake.closed = true;
        pagesAlive = Math.max(0, pagesAlive - 1);
        updateCount(siteCounter(findCard(q)));
      }, 1200);
      return fake;
    };

    setStatus(`fast-forwarding counters for ${q}p…`);
    updateCount();

    const tick = () => {
      if (!window.__OXD_FF) return;
      const card = findCard(q);
      if (!card) { finish(`card for ${q}p not found`, true); return; }
      updateCount(siteCounter(card));

      if (/download now/i.test(card.t)) {
        finish(`counters done for ${q}p — the site button is unlocked`);
        return;
      }
      const btn = [...card.el.querySelectorAll('button')].find((b) => /watch ad/i.test(b.innerText || ''));
      if (!btn) { finish('watch button not found in the card', true); return; }
      btn.click();

      // stuck detection: no new pages AND no site-counter movement for 8 ticks
      const key = pagesOpened + '|' + (siteCounter(card) || '');
      stuck = (key === lastKey) ? stuck + 1 : 0;
      lastKey = key;
      if (stuck >= 8) { finish('no progress — the site counter is not moving', true); return; }

      setTimeout(tick, 1700);
    };
    setTimeout(tick, 300);
  }

  // ---------- wiring (direct refs, no DOM queries) ----------
  refreshBtn.addEventListener('click', () => loadInfo(true));
  ffRunBtn.addEventListener('click', () => fastForward(ffSelect.value));

  loadInfo();
  log('panel ready');
})();
