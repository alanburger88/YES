/*
 * Shell: masthead (brand slot, period, demo badge, language switcher, Ask YES),
 * section navigation, footer, document title and the withheld-statement state
 * shown when reconciliation fails (PRD 4, 5.1, 5.2).
 */
(function (root) {
  'use strict';
  var YES = root.YES;
  var ui = YES.ui;
  var t = YES.t;
  var esc = ui.esc;
  var doc = root.document;

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
    var s = YES.data.statement;
    return YES.fmt.date(s.periodEnd, 'monthYear');
  }

  function renderMasthead() {
    var lang = YES.i18n.lang;
    var view = YES.state.view;
    var langButtons = YES.config.languages
      .map(function (l) {
        return (
          '<button type="button" class="seg__btn" lang="' +
          l +
          '" data-lang="' +
          l +
          '" data-fk="lang-' +
          l +
          '" aria-pressed="' +
          (l === lang) +
          '"><span class="seg__long">' +
          esc(t('lang.' + l)) +
          '</span><span class="seg__short" aria-hidden="true">' +
          l.toUpperCase() +
          '</span></button>'
        );
      })
      .join('');

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

    var html =
      '<div class="masthead__bar container">' +
      '<a class="brand" href="#/overview" data-nav="overview" data-fk="brand">' +
      logoHtml() +
      '<span class="brand__text"><span class="brand__title">' +
      esc(t('brand.statement')) +
      '</span><span class="brand__period">' +
      esc(periodLabel()) +
      '</span></span></a>' +
      (YES.config.demo
        ? '<span class="demo-badge" title="' + esc(t('demo.badgeLong')) + '">' + ui.icon('info', { size: 16 }) + '<span>' + esc(t('demo.badge')) + '</span></span>'
        : '') +
      '<div class="masthead__actions">' +
      '<div class="seg" role="group" aria-label="' +
      esc(t('lang.label')) +
      '">' +
      ui.icon('globe', { size: 18, cls: 'seg__icon' }) +
      langButtons +
      '</div>' +
      '<button type="button" class="btn btn--ai btn--ask" data-ask data-fk="ask-yes" aria-label="' +
      esc(t('ask.buttonLong')) +
      '">' +
      ui.icon('chat', { size: 18 }) +
      '<span class="btn__label">' +
      esc(t('ask.button')) +
      '</span></button>' +
      '</div></div>' +
      '<nav class="nav" aria-label="' +
      esc(t('nav.label')) +
      '"><ul class="nav__list container">' +
      navItems +
      '</ul></nav>';
    ui.render(doc.getElementById('masthead'), html);
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
      (YES.config.demo ? '<p class="footer__demo">' + ui.icon('info', { size: 16 }) + ' ' + esc(t('footer.demo')) + '</p>' : '') +
      '<p class="footer__powered">' +
      esc(t('footer.poweredBy')) +
      '</p>' +
      '</div>';
    ui.render(doc.getElementById('site-footer'), html);
  }

  function updateTitle() {
    doc.title = t('app.docTitle', { view: t('nav.' + YES.state.view), period: periodLabel() });
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
      '</p>' +
      (simulated ? '<p><strong>' + esc(t('integrity.simulated')) + '</strong></p>' : '') +
      '</div></div>' +
      '<h2 class="withheld__checks-title">' +
      esc(t('integrity.checks')) +
      '</h2><ul class="checks">' +
      checks +
      '</ul>' +
      (simulated ? '<p><a class="btn btn--primary" href="#/overview" data-integrity-return data-fk="integrity-return">' + esc(t('integrity.return')) + '</a></p>' : '') +
      '</section>';
    ui.render(doc.getElementById('integrity-root'), html);
  }

  YES.shell = {
    renderWithheld: renderWithheld,
    updateTitle: updateTitle
  };

  YES.register({
    name: 'shell',
    init: function () {
      var mast = doc.getElementById('masthead');
      ui.delegate(mast, 'click', '[data-lang]', function (e, b) {
        var l = b.getAttribute('data-lang');
        if (l !== YES.i18n.lang) YES.setLang(l);
      });
      ui.delegate(mast, 'click', '[data-ask]', function (e, b) {
        YES.assistant.open({ topic: 'general', trigger: b });
      });
      doc.addEventListener('click', function (e) {
        var r = e.target.closest && e.target.closest('[data-integrity-return]');
        if (!r) return;
        e.preventDefault();
        root.location.hash = '#/overview';
        root.location.reload();
      });
      YES.on('view', syncNav);
      this.render();
    },
    render: function () {
      renderMasthead();
      renderFooter();
      updateTitle();
      if (YES.integrity && !YES.integrity.ok) renderWithheld(YES.integrity);
    }
  });
})(window);
