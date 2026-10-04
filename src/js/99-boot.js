/*
 * Boot: apply the light/dark theme and brand slots, choose language, run the
 * release gate, initialise modules, resolve the initial route and load
 * connected enhancements.
 */
(function (root) {
  'use strict';
  var YES = root.YES;
  var doc = root.document;

  function applyBrandSlots() {
    var s = YES.config.slots;
    var r = doc.documentElement.style;
    r.setProperty('--yes-primary-slot', s.YES_PRIMARY);
    r.setProperty('--yes-primary-dark-slot', s.YES_PRIMARY_DARK || s.YES_PRIMARY);
    r.setProperty('--yes-accent-slot', s.YES_ACCENT);
    r.setProperty('--yes-font-slot', s.YES_FONT);
  }

  function initialLang() {
    var fromHash = YES.nav.current().params.lang;
    if (fromHash && YES.config.languages.indexOf(fromHash) !== -1) return fromHash;
    try {
      var stored = root.sessionStorage.getItem('yes.lang');
      if (stored && YES.config.languages.indexOf(stored) !== -1) return stored;
    } catch (e) {
      /* storage unavailable */
    }
    return YES.data.statement.language || YES.config.defaultLanguage;
  }

  function boot() {
    // Light/dark before anything renders (also applied as 04-core.js loads).
    YES.theme.init();
    applyBrandSlots();

    // Showcase-only integrity preview: #/overview?simulate=mismatch
    var simulate = YES.nav.current().params.simulate;
    if (simulate === 'mismatch') YES.data = YES.calc.simulateMismatch(YES.data);

    var lang = initialLang();
    YES.i18n.lang = lang;
    YES.state.lang = lang;
    doc.documentElement.lang = lang;

    // Release gate: a statement whose totals do not reconcile is withheld.
    YES.integrity = YES.calc.reconcile(YES.data);
    var withheld = !YES.integrity.ok && YES.config.reconciliation.blockOnMismatch;
    doc.documentElement.classList.toggle('is-withheld', withheld);
    if (withheld && root.console) console[YES.data.simulated ? 'warn' : 'error']('[YES] statement withheld: reconciliation failed', YES.integrity);

    // While withheld only the shell runs: feature modules are never initialised
    // or rendered, so no withheld figure reaches the DOM (not even on a language switch).
    YES.initModules(function (m) {
      return !withheld || m.name === 'shell';
    });

    if (withheld) {
      var h = doc.getElementById('withheld-title');
      if (h) h.focus();
    } else {
      YES.nav.apply();
    }

    doc.documentElement.classList.add('is-ready');
    YES.ready = true;
    YES.emit('ready');

    // Re-boot when the integrity preview is toggled through the address bar.
    root.addEventListener('hashchange', function () {
      if (!YES.nav.isRouteHash(root.location.hash)) return;
      var now = YES.nav.current().params.simulate || null;
      if ((now || null) !== (simulate || null)) root.location.reload();
    });

    // Connected enhancement: accessibility widget (online only, never blocking).
    YES.userway.load();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
