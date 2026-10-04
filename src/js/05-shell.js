/*
 * Shell: skip link, masthead (brand slot, period, demo badge, language switcher,
 * light/dark toggle, "Download or print", Ask YES), section navigation (tabs
 * from 720px, a Menu on phones), footer, document title and the
 * withheld-statement state shown when reconciliation fails (PRD 4, 5.1, 5.2).
 * The masthead is the only language switch in the statement: dialogs keep the
 * language chosen before they opened.
 */
(function (root) {
  'use strict';
  var YES = root.YES;
  var ui = YES.ui;
  var t = YES.t;
  var esc = ui.esc;
  var doc = root.document;

  function withheld() {
    return !!(YES.integrity && !YES.integrity.ok);
  }

  function periodLabel() {
    return YES.fmt.date(YES.data.statement.periodEnd, 'monthYear');
  }

  /* Light/dark toggle: one button named "Dark mode", pressed when dark is on.
     The masthead shows the icon; the phone menu shows a labelled row with a switch. */
  function themeToggleHtml(fk, row) {
    var dark = YES.theme.effective() === 'dark';
    var common = ' data-theme-toggle data-fk="' + fk + '" aria-pressed="' + dark + '"';
    if (!row) {
      return (
        '<button type="button" class="btn btn--icon theme-toggle"' +
        common +
        ' aria-label="' +
        esc(t('theme.dark')) +
        '" title="' +
        esc(t('theme.dark')) +
        '">' +
        ui.icon('moon', { size: 20 }) +
        '</button>'
      );
    }
    return (
      '<button type="button" class="mast-menu__theme theme-toggle"' +
      common +
      '>' +
      ui.icon('moon', { size: 20 }) +
      '<span class="mast-menu__theme-label">' +
      esc(t('theme.dark')) +
      '</span><span class="switch" aria-hidden="true"><span class="switch__text">' +
      esc(t(dark ? 'theme.on' : 'theme.off')) +
      '</span><span class="switch__track"><span class="switch__thumb"></span></span></span></button>'
    );
  }

  /* "Download or print": the help module's record section (print, PDF, CSV). */
  function recordButtonHtml(fk, cls) {
    return (
      '<button type="button" class="btn ' +
      cls +
      '" data-mast-record data-fk="' +
      fk +
      '" aria-label="' +
      esc(t('record.button')) +
      '">' +
      ui.icon('file-down', { size: 18 }) +
      '<span class="btn__label">' +
      esc(t('record.button')) +
      '</span><span class="btn__label btn__label--short">' +
      esc(t('record.buttonShort')) +
      '</span></button>'
    );
  }

  function navLinkHtml(v, cls, fk, extra) {
    return (
      '<li><a class="' +
      cls +
      '" href="#/' +
      v +
      '" data-nav="' +
      v +
      '" data-fk="' +
      fk +
      v +
      '"' +
      (v === YES.state.view ? ' aria-current="page"' : '') +
      '><span>' +
      esc(t('nav.' + v)) +
      '</span>' +
      (extra || '') +
      '</a></li>'
    );
  }

  /*
   * Phone menu (masthead under 45em, i.e. 720px at the default text size): a
   * disclosure button opens a panel under the header with the four sections,
   * Download or print, the language switch and the light/dark toggle.
   */
  function menuHtml() {
    var links = YES.VIEWS.map(function (v) {
      return navLinkHtml(v, 'mast-menu__link', 'menu-nav-', ui.icon('check', { size: 18, cls: 'mast-menu__current' }));
    }).join('');
    return (
      '<div class="mast-menu" id="mast-menu"' +
      (menuOpen ? '' : ' hidden') +
      '>' +
      '<nav class="mast-menu__nav" aria-label="' +
      esc(t('nav.label')) +
      '"><ul class="mast-menu__list">' +
      links +
      '</ul></nav>' +
      '<div class="mast-menu__group mast-menu__group--record">' +
      recordButtonHtml('menu-record', 'mast-menu__record') +
      '</div>' +
      '<div class="mast-menu__group mast-menu__prefs">' +
      '<div class="mast-menu__pref"><span class="mast-menu__pref-label" aria-hidden="true">' +
      esc(t('lang.label')) +
      '</span>' +
      ui.langSwitchHtml({ fk: 'menu-lang' }) +
      '</div>' +
      themeToggleHtml('menu-theme', true) +
      '</div></div>'
    );
  }

  function renderMasthead() {
    var navItems = YES.VIEWS.map(function (v) {
      return navLinkHtml(v, 'nav__link', 'nav-');
    }).join('');

    // Narrow layouts show "Sep 2026" and hide the word "Statement" visually; the
    // link's accessible name stays "YES Statement September 2026".
    var html =
      '<div class="masthead__bar container' +
      (YES.config.demo ? ' has-demo' : '') +
      '">' +
      '<a class="brand" href="#/overview" data-nav="overview" data-fk="brand">' +
      ui.logoHtml({ cls: 'brand__logo' }) +
      '<span class="brand__text"><span class="brand__title">' +
      esc(t('brand.statement')) +
      '</span><span class="brand__period">' +
      esc(periodLabel()) +
      '</span><span class="brand__period-short" aria-hidden="true">' +
      esc(YES.fmt.date(YES.data.statement.periodEnd, 'monthYearShort')) +
      '</span></span></a>' +
      (YES.config.demo
        ? '<span class="demo-badge" title="' + esc(t('demo.badgeLong')) + '">' + ui.icon('info', { size: 16 }) + '<span>' + esc(t('demo.badge')) + '</span></span>'
        : '') +
      '<div class="masthead__actions">' +
      '<div class="mast-wide">' +
      ui.langSwitchHtml() +
      themeToggleHtml('theme', false) +
      recordButtonHtml('mast-record', 'btn--record') +
      '</div>' +
      '<button type="button" class="btn btn--ai btn--ask" data-ask data-fk="ask-yes" aria-haspopup="dialog" aria-expanded="' +
      !!(YES.state.assistant && YES.state.assistant.open) +
      '" aria-label="' +
      esc(t('ask.buttonLong')) +
      '">' +
      ui.icon('chat', { size: 18 }) +
      '<span class="btn__label">' +
      esc(t('ask.button')) +
      '</span><span class="btn__label btn__label--short">' +
      esc(t('ask.buttonShort')) +
      '</span></button>' +
      '<button type="button" class="btn mast-menu-btn" data-mast-menu data-fk="menu" aria-expanded="' +
      menuOpen +
      '" aria-controls="mast-menu">' +
      ui.icon(menuOpen ? 'close' : 'menu', { size: 20 }) +
      '<span>' +
      esc(t('menu.button')) +
      '</span></button>' +
      '</div></div>' +
      '<nav class="nav" aria-label="' +
      esc(t('nav.label')) +
      '"><ul class="nav__list container">' +
      navItems +
      '</ul></nav>' +
      menuHtml();
    ui.render(doc.getElementById('masthead'), html);
    fitMasthead();
    if (menuOpen) sizeMenu();
  }

  function renderFooter() {
    var s = YES.data.statement;
    var html =
      '<div class="container footer__inner">' +
      '<p class="footer__ids"><span>' +
      esc(t('footer.statementId', { id: s.id, version: s.version })) +
      '</span> · <span>' +
      esc(t('footer.generated', { date: YES.fmt.date(s.generatedAt, 'datetime') + ' ' + YES.fmt.tz(s.generatedAt) })) +
      '</span></p>' +
      '<p class="footer__disclosures" data-slot="DISCLOSURES"><strong>' +
      esc(t('footer.disclosures')) +
      ':</strong> ' +
      esc(YES.L(YES.config.slots.DISCLOSURES)) +
      '</p>' +
      (YES.config.demo ? '<p class="footer__demo">' + ui.icon('info', { size: 16 }) + ' <span>' + esc(t('footer.demo')) + '</span></p>' : '') +
      '<p class="footer__powered">' +
      esc(t('footer.poweredBy')) +
      '</p>' +
      '</div>';
    ui.render(doc.getElementById('site-footer'), html);
  }

  /* --------------------------------------------------------------- Skip link */
  function renderSkipLink() {
    var a = doc.querySelector('.skip-link');
    if (a) a.textContent = t('app.skip');
  }
  /* Following the link must not change the address: "#main" is not a route, and
     the keyboard user stays in the view they are reading. */
  function skipToContent(e) {
    e.preventDefault();
    if (withheld()) {
      var h = doc.getElementById('withheld-title');
      if (h) h.focus();
      return;
    }
    var heading = doc.querySelector('#view-' + YES.state.view + ' [data-view-heading]');
    if (heading) ui.focusView(YES.state.view);
    else doc.getElementById('main').focus();
  }

  /* ------------------------------------------------------ Masthead metrics */
  /*
   * Under 68em (1088px) the demo badge is a slim band above the brand row. The
   * masthead sticks with a negative `top` equal to that band (less a 4px
   * margin above the brand row), so the badge is on the first screen but
   * scrolls away, and only the brand row (and, from 720px, the section tabs)
   * stays pinned: under 70px on a phone, where the sections are in the Menu.
   * On short viewports (landscape phones, 400% zoom) the masthead does not
   * stick at all. --masthead-h always equals what stays pinned, so
   * scroll-padding keeps focused content clear of it (WCAG 2.4.11).
   */
  var MAX_PINNED_SHARE = 0.3;
  function syncMastheadMetrics() {
    var mast = doc.getElementById('masthead');
    if (!mast) return;
    var rootStyle = doc.documentElement.style;
    var mr = mast.getBoundingClientRect();
    var skip = 0;
    var badge = mast.querySelector('.demo-badge');
    var brand = mast.querySelector('.brand');
    var actions = mast.querySelector('.masthead__actions');
    if (badge && brand && actions) {
      var rowTop = Math.min(brand.getBoundingClientRect().top, actions.getBoundingClientRect().top);
      if (badge.getBoundingClientRect().bottom <= rowTop) skip = Math.max(0, Math.floor(rowTop - mr.top) - 4);
    }
    var pinned = Math.ceil(mr.height - skip);
    // Very large text: a pinned area over 30% of the screen would leave too
    // little room to read, so the masthead scrolls with the page instead (as
    // on short viewports). Pinning never changes its height, so this is stable.
    mast.classList.toggle('is-unpinned', pinned > (root.innerHeight || 0) * MAX_PINNED_SHARE);
    var sticky = root.getComputedStyle(mast).position === 'sticky';
    rootStyle.setProperty('--mast-skip', (sticky ? skip : 0) + 'px');
    rootStyle.setProperty('--masthead-h', (sticky ? pinned : 0) + 'px');
  }
  /*
   * Keep the brand row on one line: if the actions would wrap below the brand
   * (a longer language, a narrow phone, large text), drop the short period.
   * Remove, measure and re-apply happen in one synchronous pass, so the result
   * is stable and never oscillates.
   */
  function fitMasthead() {
    var bar = doc.querySelector('#masthead .masthead__bar');
    var brand = bar && bar.querySelector('.brand');
    var actions = bar && bar.querySelector('.masthead__actions');
    if (!brand || !actions) return;
    bar.classList.remove('is-tight');
    var wraps = actions.getBoundingClientRect().top >= brand.getBoundingClientRect().bottom - 4;
    bar.classList.toggle('is-tight', wraps);
  }
  function relayout() {
    fitMasthead();
    syncMastheadMetrics();
    // The layout left the phone range (rotation, a docked assistant closing,
    // a resized window): the menu has nothing to show there, so it closes.
    if (menuOpen && !phoneLayout()) setMenu(false);
    else if (menuOpen) sizeMenu();
  }
  var relayoutQueued = false;
  function queueRelayout() {
    // Outside the ResizeObserver callback, so a class change never re-enters it.
    if (relayoutQueued) return;
    relayoutQueued = true;
    (root.requestAnimationFrame || setTimeout)(function () {
      relayoutQueued = false;
      relayout();
    });
  }
  function trackMasthead() {
    var mast = doc.getElementById('masthead');
    if (!mast) return;
    relayout();
    if (root.ResizeObserver) new ResizeObserver(queueRelayout).observe(mast);
    root.addEventListener('resize', queueRelayout);
    if (root.matchMedia) {
      var mq = root.matchMedia('(max-height: 500px)');
      if (mq.addEventListener) mq.addEventListener('change', queueRelayout);
    }
  }

  /* -------------------------------------------------------------- Phone menu */
  var menuOpen = false;
  /** The phone layout is active when its Menu button is displayed (03-shell.css decides). */
  function phoneLayout() {
    var b = doc.querySelector('#masthead [data-mast-menu]');
    return !!(b && b.getClientRects().length);
  }
  /* The panel hangs under the header and scrolls inside itself when it is
     taller than the room left on screen (the header's place changes as the
     badge band scrolls away, so this follows scrolling while it is open). */
  function sizeMenu() {
    var mast = doc.getElementById('masthead');
    var panel = doc.getElementById('mast-menu');
    if (!mast || !panel) return;
    var room = Math.max(160, Math.floor((root.innerHeight || 0) - Math.max(0, mast.getBoundingClientRect().bottom) - 8));
    panel.style.setProperty('--menu-max', room + 'px');
  }
  var sizeQueued = false;
  function onScrollWhileOpen() {
    if (sizeQueued) return;
    sizeQueued = true;
    (root.requestAnimationFrame || setTimeout)(function () {
      sizeQueued = false;
      if (menuOpen) sizeMenu();
    });
  }
  /**
   * Open or close the phone menu. opts.focus — after closing, return focus to
   * the Menu button (Escape); without it focus stays where the visitor put it.
   */
  function setMenu(open, opts) {
    open = !!open;
    var btn = doc.querySelector('#masthead [data-mast-menu]');
    var panel = doc.getElementById('mast-menu');
    if (!btn || !panel) return;
    menuOpen = open;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.querySelector('svg').outerHTML = ui.icon(open ? 'close' : 'menu', { size: 20 });
    doc.getElementById('masthead').classList.toggle('is-menu-open', open);
    if (open) {
      sizeMenu();
      root.addEventListener('scroll', onScrollWhileOpen, { passive: true });
    } else {
      root.removeEventListener('scroll', onScrollWhileOpen);
      if (opts && opts.focus) btn.focus();
    }
  }
  function bindMenu(mast) {
    ui.delegate(mast, 'click', '[data-mast-menu]', function () {
      setMenu(!menuOpen);
    });
    // A section: close, then the global [data-nav] handler (04-core.js)
    // navigates and moves focus to the view's heading.
    ui.delegate(mast, 'click', '.mast-menu [data-nav]', function () {
      setMenu(false);
    });
    // Language and theme switches keep the menu open: the masthead re-renders
    // with it open and focus stays on the pressed control (data-fk).
    // A click anywhere else closes it. The event path is fixed when the click
    // starts, so it still names the panel when a handler has re-rendered it.
    doc.addEventListener('click', function (e) {
      if (!menuOpen) return;
      var path = e.composedPath ? e.composedPath() : [];
      var inside = path.some(function (n) {
        return n.nodeType === 1 && (n.id === 'mast-menu' || n.hasAttribute('data-mast-menu'));
      });
      if (!inside) setMenu(false);
    });
    doc.addEventListener('keydown', function (e) {
      if (menuOpen && (e.key === 'Escape' || e.key === 'Esc')) {
        e.preventDefault();
        setMenu(false, { focus: true });
      }
    });
    // Tabbing out of the masthead closes it (a re-render has no relatedTarget).
    mast.addEventListener('focusout', function (e) {
      if (menuOpen && e.relatedTarget && !mast.contains(e.relatedTarget)) setMenu(false);
    });
    // Any other navigation (Back, a link elsewhere) closes it too.
    YES.on('route', function () {
      if (menuOpen) setMenu(false);
    });
  }

  function syncAskExpanded() {
    var b = doc.querySelector('[data-ask]');
    if (b) b.setAttribute('aria-expanded', String(!!(YES.state.assistant && YES.state.assistant.open)));
  }

  function updateTitle() {
    var title = withheld() ? t('app.docTitleWithheld', { period: periodLabel() }) : t('app.docTitle', { view: t('nav.' + YES.state.view), period: periodLabel() });
    doc.title = YES.config.demo ? t('app.docTitleDemo', { title: title }) : title;
  }

  function syncNav() {
    ui.$$('#masthead [data-nav]:not(.brand)').forEach(function (a) {
      if (a.getAttribute('data-nav') === YES.state.view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    updateTitle();
  }

  /** Withheld state: shown instead of the statement when reconciliation fails. */
  function renderWithheld(result) {
    var simulated = !!YES.data.simulated;
    var checks = result.checks
      .map(function (c) {
        return (
          '<li class="check ' +
          (c.ok ? 'check--ok' : 'check--fail') +
          '">' +
          ui.icon(c.ok ? 'check-circle' : 'alert', { size: 18 }) +
          '<span>' +
          esc(t('check.' + c.id)) +
          '</span><span class="check__state">' +
          esc(t(c.ok ? 'integrity.pass' : 'integrity.fail')) +
          '</span></li>'
        );
      })
      .join('');
    var html =
      '<section class="withheld container" aria-labelledby="withheld-title">' +
      '<div class="notice notice--critical" role="alert">' +
      ui.icon('alert', { size: 24 }) +
      '<div><h1 id="withheld-title" class="withheld__title" tabindex="-1">' +
      esc(t('integrity.title')) +
      '</h1><p>' +
      esc(t('integrity.body')) +
      '</p><p>' +
      // A simulated failure is a preview: nothing is routed anywhere.
      esc(t(simulated ? 'integrity.routedSimulated' : 'integrity.routed')) +
      '</p>' +
      (simulated ? '<p><strong>' + esc(t('integrity.simulated')) + '</strong></p>' : '') +
      '</div></div>' +
      '<h2 class="withheld__checks-title">' +
      esc(t('integrity.checks')) +
      '</h2><ul class="checks withheld__checks">' +
      checks +
      '</ul>' +
      (simulated ? '<p class="withheld__return"><a class="btn btn--primary" href="#/overview" data-integrity-return data-fk="integrity-return">' + esc(t('integrity.return')) + '</a></p>' : '') +
      '</section>';
    var rootEl = doc.getElementById('integrity-root');
    // <main> is hidden while the statement is withheld, so the message itself is
    // the page's main landmark (and the skip link's target).
    rootEl.setAttribute('role', 'main');
    ui.render(rootEl, html);
  }

  YES.shell = {
    renderWithheld: renderWithheld,
    updateTitle: updateTitle
  };

  YES.register({
    name: 'shell',
    init: function () {
      var mast = doc.getElementById('masthead');
      // Language buttons ([data-lang]) are handled globally in 04-core.js.
      ui.delegate(mast, 'click', '[data-ask]', function (e, b) {
        YES.assistant.open({ topic: 'general', trigger: b });
      });
      // Light/dark: the masthead re-renders on 'theme', keeping focus on the toggle.
      ui.delegate(mast, 'click', '[data-theme-toggle]', function () {
        YES.theme.toggle();
      });
      // Download or print: the help module's record section (print, PDF, CSV).
      ui.delegate(mast, 'click', '[data-mast-record]', function () {
        if (menuOpen) setMenu(false);
        YES.help.open('record');
      });
      bindMenu(mast);
      YES.on('theme', renderMasthead);
      var skip = doc.querySelector('.skip-link');
      if (skip) skip.addEventListener('click', skipToContent);
      doc.addEventListener('click', function (e) {
        var r = e.target.closest && e.target.closest('[data-integrity-return]');
        if (!r) return;
        e.preventDefault();
        root.location.hash = '#/overview';
        root.location.reload();
      });
      YES.on('view', syncNav);
      YES.on('state', function (keys) {
        if (keys.indexOf('assistant') !== -1) syncAskExpanded();
      });
      this.render();
      trackMasthead();
    },
    render: function () {
      renderSkipLink();
      renderMasthead();
      renderFooter();
      updateTitle();
      if (withheld()) renderWithheld(YES.integrity);
    }
  });
})(window);
