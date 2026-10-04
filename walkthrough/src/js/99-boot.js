/*
 * 99-boot.js — starts the app once every module has registered (it is the last
 * file in the bundle). Owner: foundation.
 * Theme → module init() in file order → router → answer sync. Sets WT.ready and
 * <html data-wt-ready="1"> and emits 'ready'.
 */
(function (WT) {
  'use strict';
  function start() {
    try {
      WT.boot();
    } catch (e) {
      if (window.console) console.error('[WT] boot failed', e);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window.WT = window.WT || {});
