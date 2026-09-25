/*!
 * abyss-hide.js
 * Built by Felzeth | haru.team/felzeth | github.com/felzeth
 * Optional config: define before loading this script.
 * window.ABYSS_HIDE_CONFIG = {
 *   hosts: ['host.example'], // additional hosts
 *   guardMode: 'warn',      // 'warn' (default), 'freeze', or 'off'
 *   silenceConsole: true, traps: true, blockPageRequests: true,
 *   scrubTiming: true, stripReferrer: true // all true by default; false disables
 * };
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 0. CONFIG                                                          *
   * ------------------------------------------------------------------ */

  var userCfg = (typeof window !== 'undefined' && window.ABYSS_HIDE_CONFIG) || {};

  var CFG = {
    hosts: (userCfg.hosts || []).slice(),
    guardMode: userCfg.guardMode !== undefined ? userCfg.guardMode : 'warn',
    silenceConsole: userCfg.silenceConsole !== false,
    traps: userCfg.traps !== false,
    blockPageRequests: userCfg.blockPageRequests !== false,
    scrubTiming: userCfg.scrubTiming !== false,
    stripReferrer: userCfg.stripReferrer !== false,
  };

  try {
    Object.defineProperty(window, '__abyssHideOrigin', {
      value: [70, 101, 108, 122, 101, 116, 104, 32, 124, 32, 104, 97, 114, 117,
        46, 116, 101, 97, 109, 47, 102, 101, 108, 122, 101, 116, 104, 32, 124,
        32, 103, 105, 116, 104, 117, 98, 46, 99, 111, 109, 47, 102, 101, 108,
        122, 101, 116, 104].map(function (code) { return String.fromCharCode(code); }).join(''),
      enumerable: false,
    });
  } catch (_) {}

  // Built-in hosts from the net-log study (chrome-net-export-log.json).
  var DEFAULT_HOSTS = [
    'player.abyssplayer.com',
    'abyssplayer.com',
    'abyss.to',
    'morphify.net',
    'iamcdn.net',
    'img.freeimagecdn.net',
  ];

  var HOSTS = DEFAULT_HOSTS.concat(CFG.hosts);

  // Auto-learn: absorb the hostname of any abyss-looking iframe already in
  // the page (e.g. a different sub-domain the site uses), so the file keeps
  // working when the embed URL changes.
  try {
    var frames = document.querySelectorAll('iframe[src]');
    for (var fi = 0; fi < frames.length; fi++) {
      var src = frames[fi].getAttribute('src') || '';
      if (/abyss/i.test(src)) {
        var m = /^https?:\/\/([^/?#]+)/i.exec(src);
        if (m && HOSTS.indexOf(m[1]) === -1) HOSTS.push(m[1]);
      }
    }
  } catch (_) {}

  function isAbyss(u) {
    try {
      var s = String(u);
      for (var i = 0; i < HOSTS.length; i++) if (s.indexOf(HOSTS[i]) !== -1) return true;
    } catch (_) {}
    return false;
  }

  /* ------------------------------------------------------------------ *
   * 1. CONSOLE SILENCE (first, synchronous)                            *
   * ------------------------------------------------------------------ */

  if (CFG.silenceConsole) {
    (function () {
      try {
        var noop = function () {};
        var names = ['log', 'debug', 'info', 'warn', 'error', 'dir', 'dirxml',
          'table', 'trace', 'group', 'groupCollapsed', 'groupEnd', 'clear',
          'count', 'countReset', 'assert', 'profile', 'profileEnd', 'time',
          'timeLog', 'timeEnd', 'timeStamp'];
        for (var i = 0; i < names.length; i++) {
          try { console[names[i]] = noop; } catch (_) {}
        }
      } catch (_) {}
    })();
  }

  /* ------------------------------------------------------------------ *
   * 2. REPORT SUPPRESSION — telemetry gets nowhere to go               *
   *    (kills the Reporting-API / CSP leak vector seen in the study;   *
   *     violations are logged to console only — which is silenced)     *
   * ------------------------------------------------------------------ */

  (function suppressReports() {
    try {
      if (!document.head) return;
      // Report-only policy with NO report-uri/report-to: violations are
      // generated but have no delivery endpoint. Nothing leaves the browser.
      var meta = document.createElement('meta');
      meta.setAttribute('http-equiv', 'Content-Security-Policy-Report-Only');
      meta.setAttribute('content', 'default-src *');
      document.head.insertBefore(meta, document.head.firstChild);
    } catch (_) {}
    // Note: if the hosting SERVER sends NEL/Report-To headers, they cannot be
    // removed from JS. For a fully silent site, have your host send none.
  })();

  /* ------------------------------------------------------------------ *
   * 3. REFERRER HYGIENE — your page URL never reaches abyss/CDN logs   *
   * ------------------------------------------------------------------ */

  if (CFG.stripReferrer) {
    (function () {
      try {
        if (!document.querySelector('meta[name="referrer"]')) {
          var r = document.createElement('meta');
          r.setAttribute('name', 'referrer');
          r.setAttribute('content', 'no-referrer');
          document.head.appendChild(r);
        }
      } catch (_) {}
    })();
  }

  /* ------------------------------------------------------------------ *
   * 4. PAGE-LEVEL REQUEST BLOCK                                        *
   *    Refuses THIS page's own calls to abyss hosts. The cross-origin   *
   *    video iframe is a separate browsing context running its own JS —  *
   *    these patches do not apply inside it, so playback is unaffected. *
   * ------------------------------------------------------------------ */

  if (CFG.blockPageRequests) {
    (function () {
      // fetch
      var _fetch = window.fetch;
      if (_fetch) {
        window.fetch = function (input, init) {
          try {
            var u = (typeof input === 'string') ? input : (input && input.url);
            if (isAbyss(u)) return Promise.resolve(new Response(null, { status: 204 }));
          } catch (_) {}
          return _fetch.call(window, input, init);
        };
      }
      // XHR
      var _open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        try { if (isAbyss(url)) url = 'data:text/plain,'; } catch (_) {}
        var args = [method, url].concat([].slice.call(arguments, 2));
        return _open.apply(this, args);
      };
      // WebSocket
      var _WS = window.WebSocket;
      function PatchedWS(url, protocols) {
        try { if (isAbyss(url)) url = 'ws://127.0.0.1:1'; } catch (_) {}
        return protocols === undefined ? new _WS(url) : new _WS(url, protocols);
      }
      PatchedWS.prototype = _WS.prototype;
      ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { PatchedWS[k] = _WS[k]; });
      try { window.WebSocket = PatchedWS; } catch (_) {}
      // EventSource
      if (window.EventSource) {
        var _ES = window.EventSource;
        function PatchedES(url, cfg) {
          try { if (isAbyss(url)) url = 'data:text/event-stream,'; } catch (_) {}
          return cfg === undefined ? new _ES(url) : new _ES(url, cfg);
        }
        PatchedES.prototype = _ES.prototype;
        try { window.EventSource = PatchedES; } catch (_) {}
      }
      // sendBeacon
      var _beacon = navigator.sendBeacon;
      if (_beacon) {
        navigator.sendBeacon = function (url, data) {
          try { if (isAbyss(url)) return true; } catch (_) {}
          return _beacon.call(navigator, url, data);
        };
      }
    })();
  }

  /* ------------------------------------------------------------------ *
   * 5. HINT + DOM HYGIENE (video-iframe safe)                          *
   *    Removes abyss prefetch/preconnect hints and injected abyss       *
   *    <script>/<img> nodes. IFRAMES ARE NEVER REMOVED — that is the    *
   *    video. If the site re-creates the player iframe dynamically, it  *
   *    stays.                                                          *
   * ------------------------------------------------------------------ */

  (function domHygiene() {
    function purgeHints() {
      try {
        var links = document.querySelectorAll(
          'link[rel="dns-prefetch"],link[rel="preconnect"],link[rel="preload"],link[rel="prefetch"]');
        for (var i = 0; i < links.length; i++) {
          if (isAbyss(links[i].href)) links[i].parentNode.removeChild(links[i]);
        }
      } catch (_) {}
    }
    purgeHints();
    document.addEventListener('DOMContentLoaded', purgeHints);

    try {
      var mo = new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          for (var i = 0; i < m.addedNodes.length; i++) {
            var n = m.addedNodes[i];
            if (n.nodeType !== 1 || n.tagName === 'IFRAME') continue; // never touch iframes
            var u = n.src || n.href || n.data || '';
            if (isAbyss(u)) { try { n.parentNode.removeChild(n); } catch (_) {} }
          }
        });
      });
      mo.observe(document, { childList: true, subtree: true });
    } catch (_) {}
  })();

  /* ------------------------------------------------------------------ *
   * 6. TIMING SCRUB — abyss URLs vanish from performance reads         *
   * ------------------------------------------------------------------ */

  if (CFG.scrubTiming) {
    (function () {
      function clean(list) {
        try {
          return Array.prototype.filter.call(list, function (e) { return !isAbyss(e.name); });
        } catch (_) { return list; }
      }
      try {
        var p = Performance.prototype;
        var _getEntries = p.getEntries;
        p.getEntries = function () { return clean(_getEntries.call(this)); };
        var _byType = p.getEntriesByType;
        p.getEntriesByType = function (t) { return clean(_byType.call(this, t)); };
        var _byName = p.getEntriesByName;
        p.getEntriesByName = function (n, t) { return clean(_byName.call(this, n, t)); };
      } catch (_) {}
      try {
        var PO = window.PerformanceObserver;
        if (PO) {
          var Filtered = function (cb) {
            return new PO(function (list) {
              cb({ getEntries: function () { return clean(list.getEntries()); } }, this);
            });
          };
          Filtered.prototype = PO.prototype;
          Filtered.supportedEntryTypes = PO.supportedEntryTypes;
          window.PerformanceObserver = Filtered;
        }
      } catch (_) {}
    })();
  }

  /* ------------------------------------------------------------------ *
   * 7. INSPECTION DETERRENT — for people trying to watch the log       *
   *    The video NEVER stops. 'warn' shows a banner, 'freeze' locks    *
   *    pointer/scroll (playback continues underneath), 'off' does      *
   *    nothing. Inspection shortcuts are swallowed while DevTools is   *
   *    closed (browsers ignore this once it is open).                  *
   * ------------------------------------------------------------------ */

  (function guard() {
    if (CFG.guardMode === 'off') return;

    // Self-contained styles: the file needs no external CSS.
    try {
      var st = document.createElement('style');
      st.textContent =
        '#__abyss_hide_banner{position:fixed;top:0;left:0;right:0;z-index:2147483647;' +
        'background:#b91c1c;color:#fff;font:600 13px/1.4 system-ui,sans-serif;' +
        'text-align:center;padding:8px 12px;pointer-events:none}' +
        '.__abyss_freeze{overflow:hidden!important}' +
        '.__abyss_freeze body{pointer-events:none!important}' +
        '.__abyss_freeze,.__abyss_freeze *{user-select:none!important}';
      (document.head || document.documentElement).appendChild(st);
    } catch (_) {}

    var open = false, banner = null;

    function showBanner() {
      if (banner) return;
      try {
        banner = document.createElement('div');
        banner.id = '__abyss_hide_banner';
        banner.textContent = '⚠ Network inspection is disabled on this page.';
        (document.body || document.documentElement).appendChild(banner);
      } catch (_) {}
    }
    function hideBanner() {
      if (!banner) return;
      try { banner.parentNode.removeChild(banner); } catch (_) {}
      banner = null;
    }

    function setOpen(v) {
      if (v === open) return;
      open = v;
      if (open) {
        showBanner();
        if (CFG.guardMode === 'freeze') {
          try { document.documentElement.classList.add('__abyss_freeze'); } catch (_) {}
        }
      } else {
        hideBanner();
        try { document.documentElement.classList.remove('__abyss_freeze'); } catch (_) {}
      }
    }

    // size-delta heuristic (docked DevTools)
    function sizeDelta() {
      try { return window.outerWidth - window.innerWidth > 160 ||
                    window.outerHeight - window.innerHeight > 160; } catch (_) { return false; }
    }
    // debugger-timing heuristic (works undocked; throttled in background tabs)
    function timingCheck() {
      var t0 = Date.now();
      try { (function () { debugger; })(); } catch (_) {}
      return Date.now() - t0 > 120;
    }
    function loop() {
      try { setOpen(sizeDelta() || timingCheck()); } catch (_) {}
      setTimeout(loop, 300);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', loop, { once: true });
    } else loop();

    // inspection shortcuts: F12, Ctrl+Shift+I/J/C, Ctrl+U
    try {
      document.addEventListener('keydown', function (e) {
        var k = (e.key || '').toLowerCase();
        if (k === 'f12' ||
           (e.ctrlKey && e.shiftKey && (k === 'i' || k === 'j' || k === 'c')) ||
           (e.ctrlKey && k === 'u')) {
          e.preventDefault(); e.stopPropagation();
          showBanner();
          setTimeout(hideBanner, 2500);
        }
      }, true);
    } catch (_) {}

    // right-click on the player area (casual "Inspect element" path)
    try {
      document.addEventListener('contextmenu', function (e) {
        if (e.target && e.target.tagName === 'IFRAME') e.preventDefault();
      });
    } catch (_) {}
  })();

  /* ------------------------------------------------------------------ *
   * 8. DEBUGGER TRAPS (annoyance layer)                                *
   * ------------------------------------------------------------------ */

  if (CFG.traps) {
    (function () {
      try {
        var fn = new Function('debugger;');
        var loopTrap = function () { try { fn(); } catch (_) {} setTimeout(loopTrap, 500); };
        loopTrap();
      } catch (_) {}
    })();
  }

  /* ------------------------------------------------------------------ *
   * 9. MINIMAL PUBLIC API                                              *
   * ------------------------------------------------------------------ */

  window.AbyssHide = {
    version: '2.0',
    hosts: HOSTS,
    isAbyss: isAbyss,
    addHost: function (h) { if (HOSTS.indexOf(h) === -1) HOSTS.push(h); },
  };
})();
