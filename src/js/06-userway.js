/*
 * Accessibility widget integration point (PRD 2, 5.8, 8 Phase A).
 *
 * Loads the official UserWay widget exactly once, online only, with the account
 * ID from YES.config.userway. The statement itself is the accessibility
 * implementation; the widget only augments it. If the widget cannot load
 * (offline, blocked, timed out) the status becomes 'unavailable' and nothing
 * else changes. If the hosting viewer (e.g. InfoSlips) already provides
 * UserWay, the loader detects it and does not add a second launcher.
 *
 * Status values: idle | disabled | host | loading | loaded | unavailable
 */
(function (root) {
  'use strict';
  var YES = root.YES;
  var doc = root.document;

  var uw = (YES.userway = { status: 'idle' });

  function set(status) {
    uw.status = status;
    YES.emit('userway', status);
  }

  function hostProvidesWidget() {
    var scripts = doc.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i++) {
      if (/userway\.org/i.test(scripts[i].getAttribute('src')) && !scripts[i].hasAttribute('data-yes-userway')) return true;
    }
    return !!(root.UserWay || root._userway_config);
  }

  uw.load = function () {
    var cfg = YES.config.userway;
    if (!cfg || !cfg.enabled || !cfg.accountId || !cfg.src) return set('disabled');
    if (doc.querySelector('script[data-yes-userway]')) return; // already requested once
    if (hostProvidesWidget()) return set('host');
    if (root.navigator && root.navigator.onLine === false) return set('unavailable');
    if (root.location && root.location.protocol !== 'https:' && root.location.protocol !== 'http:' && root.location.protocol !== 'file:') return set('unavailable');

    set('loading');
    var s = doc.createElement('script');
    s.src = cfg.src;
    s.async = true;
    s.setAttribute('data-account', cfg.accountId);
    s.setAttribute('data-yes-userway', '');
    var timer = setTimeout(function () {
      if (uw.status === 'loading') set('unavailable');
    }, cfg.timeoutMs || 8000);
    s.onload = function () {
      clearTimeout(timer);
      set('loaded');
    };
    s.onerror = function () {
      clearTimeout(timer);
      set('unavailable');
    };
    doc.body.appendChild(s);
  };

  root.addEventListener('online', function () {
    if (uw.status === 'unavailable' && !doc.querySelector('script[data-yes-userway]')) uw.load();
  });
})(window);
