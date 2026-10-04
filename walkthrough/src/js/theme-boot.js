/*
 * Theme boot (SPEC section 3): runs in <head> before first paint and applies the
 * saved light/dark choice (localStorage 'infoslips.wt.theme'), or the device
 * setting when nothing is saved, to <html data-theme>. It is an external file
 * (assets/theme-boot.<hash>.js) because the CSP allows no inline script.
 * It also adds class "wt-js" to <html>, so controls that need JavaScript can
 * stay hidden when it is off. WT.theme (00-core.js) takes over once the app loads.
 */
(function () {
  'use strict';
  var theme = null;
  try {
    theme = window.localStorage.getItem('infoslips.wt.theme');
  } catch (e) {
    theme = null; // storage blocked: follow the device
  }
  if (theme !== 'light' && theme !== 'dark') {
    try {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e2) {
      theme = 'light';
    }
  }
  var root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.className += (root.className ? ' ' : '') + 'wt-js'; // JS runs: show JS-only controls
})();
