/*
 * Shell: skip link, masthead (brand slot, period, demo badge, language switcher,
 * Ask YES), section navigation, footer, document title and the withheld-statement
 * state shown when reconciliation fails (PRD 4, 5.1, 5.2).
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

  function logoHtml() {
    var slot = YES.config.slots.YES_LOGO;
    if (slot.svg) return '<span class="brand__logo" role="img" aria-label="' + esc(t('brand.logoAlt')) + '">' + slot.svg + '</span>';
    return (
      '<span class="brand__logo brand__logo--placeholder" role="img" aria-label="' +
      esc(t('brand.logoAlt')) +
      '" title="' +
      esc(t('brand.logoPlaceholder')) +
      '" data-slot="YES_LOGO">' +
      esc(slot.text) +
      '</span>'
    );
  }

  function periodLabel() {
    return YES.fmt.date(YES.data.statement.periodEnd, 'monthYear');
  }

  function renderMasthead() {
    var view = YES.state.view;
    var navItems = YES.VIEWS.map(function (v) {
      return (
        '<li><a class="nav__link" href="#/' +
        v +
        '" data-nav="' +
        v +
        '" data-fk="nav-' +
        v +
        '"' +
        (v === view ? ' aria-current="page"' : '') +
        '>' +
        esc(t('nav.' + v)) +
        '</a></li>'
      );
    }).join('');

    // Narrow layouts show "Sep 2026" and hide the word "Statement" visually; the
    // link's accessible name stays "YES Statement September 2026".
    var html =
      '<div class="masthead__bar container">' +
      '<a class="brand" href="#/overview" data-nav="overview" data-fk="brand">' +
      logoHtml() +
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
      ui.langSwitchHtml() +
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
      '</div></div>' +
      '<nav class="nav" aria-label="' +
      esc(t('nav.label')) +
      '"><ul class="nav__list container">' +
      navItems +
      '</ul></nav>';
    ui.render(doc.getElementById('masthead'), html);
    fitMasthead();
    syncNavOverflow();
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
   * Small screens stack the demo badge as a strip above the brand row. The
   * masthead sticks with a negative `top` equal to that strip, so the badge is
   * on the first screen but scrolls away, and only the brand row and the
   * navigation stay pinned. On short viewports (landscape phones, 400% zoom)
   * the masthead does not stick at all. --masthead-h always equals what stays
   * pinned, so scroll-padding keeps focused content clear of it (WCAG 2.4.11).
   */
  function syncMastheadMetrics() {
    var mast = doc.getElementById('masthead');
    if (!mast) return;
    var rootStyle = doc.documentElement.style;
    var sticky = root.getComputedStyle(mast).position === 'sticky';
    var mr = mast.getBoundingClientRect();
    var skip = 0;
    var badge = mast.querySelector('.demo-badge');
    var brand = mast.querySelector('.brand');
    var actions = mast.querySelector('.masthead__actions');
    if (sticky && badge && brand && actions) {
      var rowTop = Math.min(brand.getBoundingClientRect().top, actions.getBoundingClientRect().top);
      if (badge.getBoundingClientRect().bottom <= rowTop) skip = Math.max(0, Math.floor(rowTop - mr.top) - 4);
    }
    rootStyle.setProperty('--mast-skip', skip + 'px');
    rootStyle.setProperty('--masthead-h', (sticky ? Math.ceil(mr.height - skip) : 0) + 'px');
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
    syncNavOverflow();
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
    // Focus inside a navigation row that still has to scroll (very large text):
    // bring the focused tab into view.
    mast.addEventListener('focusin', function (e) {
      var link = e.target.closest && e.target.closest('.nav__link');
      var list = link && link.parentNode && link.parentNode.parentNode;
      if (link && list && list.scrollWidth > list.clientWidth + 1) {
        var lr = link.getBoundingClientRect();
        var cr = list.getBoundingClientRect();
        if (lr.left < cr.left) list.scrollLeft -= cr.left - lr.left + 24;
        else if (lr.right > cr.right) list.scrollLeft += lr.right - cr.right + 24;
      }
    });
    mast.addEventListener('scroll', syncNavOverflow, true);
  }
  /* The four sections fit from 320px up; if large text still overflows, the
     row scrolls and an edge fade shows there is more. */
  function syncNavOverflow() {
    var nav = doc.querySelector('#masthead .nav');
    var list = nav && nav.querySelector('.nav__list');
    if (!list) return;
    var max = list.scrollWidth - list.clientWidth;
    nav.classList.toggle('has-more-right', max > 1 && list.scrollLeft < max - 1);
    nav.classList.toggle('has-more-left', max > 1 && list.scrollLeft > 1);
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
    ui.$$('.nav__link').forEach(function (a) {
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
