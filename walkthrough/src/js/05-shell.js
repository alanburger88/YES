/*
 * 05-shell.js — skip link, masthead (logo, nav, reviewer chip, light/dark
 * toggle, phone Menu), footer, the name dialog and the branding notice.
 * SPEC section 3. Owner: foundation.
 */
(function (WT) {
  'use strict';

  var doc = document;
  var NAV_FOR_VIEW = { tour: 'tour', results: 'results', data: 'data' };

  /* ------------------------------------------------------------------ */
  /* Branding notice                                                     */
  /* ------------------------------------------------------------------ */

  var BRAND_TITLE = 'YES branding is not final.';
  var BRAND_TEXT =
    'The colours, logo and typography in the YES statement are placeholders. They will be updated once YES supplies its final brand assets. Please judge the features, not the look.';
  var BRAND_COMPACT = 'YES branding is a placeholder and will be updated.';

  /** Branding-notice HTML. { compact: true } gives the one-line version. */
  WT.brandNotice = function (opts) {
    if (opts && opts.compact) {
      return (
        '<div class="wt-notice wt-notice--brand wt-notice--compact" role="note" data-brand-notice="compact">' +
          WT.icon('info', { cls: 'wt-notice__icon', size: 18 }) +
          '<div class="wt-notice__body"><p>' + WT.esc(BRAND_COMPACT) + '</p></div>' +
        '</div>'
      );
    }
    return (
      '<div class="wt-notice wt-notice--brand" role="note" data-brand-notice="full">' +
        WT.icon('info', { cls: 'wt-notice__icon' }) +
        '<div class="wt-notice__body"><p><strong class="wt-notice__title">' + WT.esc(BRAND_TITLE) + '</strong> ' + WT.esc(BRAND_TEXT) + '</p></div>' +
      '</div>'
    );
  };

  /* ------------------------------------------------------------------ */
  /* Masthead                                                            */
  /* ------------------------------------------------------------------ */

  var els = {};

  function setMenu(open, opts) {
    if (!els.menu || !els.menuBtn) return;
    els.menu.classList.toggle('is-open', !!open);
    els.menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    doc.documentElement.classList.toggle('wt-menu-open', !!open);
    if (!open && opts && opts.focusButton) els.menuBtn.focus();
  }
  function menuOpen() {
    return !!(els.menu && els.menu.classList.contains('is-open'));
  }

  function updateNav(view) {
    WT.$$('.wt-nav__link').forEach(function (a) {
      if (a.getAttribute('data-nav') === NAV_FOR_VIEW[view]) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function updateChip() {
    if (!els.chipText) return;
    var name = WT.reviewer.name();
    WT.render(els.chipText, name ? '<span class="wt-sr-only">Your name: </span>' + WT.esc(name) : 'Add your name');
    els.chip.classList.toggle('is-named', !!name);
    // A tooltip for the icon-only chip on tablets (the text stays the accessible name).
    els.chip.title = name ? 'Reviewing as ' + name + '. Change your name' : 'Add your name';
  }

  function updateTheme() {
    if (!els.theme) return;
    els.theme.setAttribute('aria-pressed', WT.theme.effective() === 'dark' ? 'true' : 'false');
  }

  /* ------------------------------------------------------------------ */
  /* Name dialog                                                         */
  /* ------------------------------------------------------------------ */

  var nameDlg = null;

  function buildNameDialog() {
    nameDlg = WT.dialog.create({
      id: 'wt-name-dialog',
      title: 'Your name',
      body:
        '<p class="wt-dialog__text">Your name appears next to your votes and comments, which everyone with the link can see. Leave it blank to appear as “' + WT.esc(WT.ANONYMOUS) + '”.</p>' +
        '<form class="wt-name-form" id="wt-name-form" novalidate>' +
          WT.ui.field({ id: 'wt-name-input', label: 'Name', optional: true, max: WT.LIMITS.name, autocomplete: 'name', value: WT.reviewer.name() }) +
        '</form>' +
        '<div class="wt-name-dialog__other">' +
          '<h3 class="wt-name-dialog__h">Someone else using this browser?</h3>' +
          '<p>Start as a new reviewer. This browser forgets your name and answers, and the answers you’ve already given stay in the shared results.</p>' +
          '<div class="wt-cluster">' +
            '<button class="wt-btn wt-btn--secondary wt-btn--sm" type="button" data-wt-new-reviewer>' + WT.icon('restart', { size: 18 }) + '<span>Start as a new reviewer</span></button>' +
            '<button class="wt-btn wt-btn--link" type="button" data-wt-remove-answers>Remove my answers from the results</button>' +
          '</div>' +
        '</div>',
      foot:
        '<button class="wt-btn wt-btn--secondary" type="button" data-wt-close="cancel">Cancel</button>' +
        '<button class="wt-btn wt-btn--primary" type="submit" form="wt-name-form">' + WT.icon('check', { size: 18 }) + '<span>Save name</span></button>'
    });
    nameDlg.classList.add('wt-name-dialog');

    nameDlg.querySelector('#wt-name-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = nameDlg.querySelector('#wt-name-input');
      var name = WT.reviewer.setName(input.value);
      WT.dialog.close(nameDlg, 'saved');
      WT.toast(name ? 'Thanks, ' + name + '. Your name is saved.' : 'You’ll appear as “' + WT.ANONYMOUS + '”.', { kind: 'success' });
    });

    nameDlg.querySelector('[data-wt-new-reviewer]').addEventListener('click', function (e) {
      var btn = e.currentTarget;
      if (isBusy(btn)) return;
      WT.dialog
        .confirm({
          title: 'Start as a new reviewer?',
          body: 'This browser will forget your name and answers so someone else can review. Answers you’ve already given stay in the shared results.',
          confirmLabel: 'Start as a new reviewer',
          trigger: btn
        })
        .then(function (yes) {
          if (!yes) return;
          busy(btn, true);
          return saveEverything()
            .then(function () {
              // Saves are failing (offline, or the server refuses them): say so before anything is lost.
              var n = WT.answers.pending();
              if (!n) return true;
              var st = WT.answers.status();
              return WT.dialog.confirm({
                title: 'Some answers aren’t saved yet',
                body:
                  WT.fmt.plural(n, 'change') + ' on this browser ' + (n === 1 ? 'hasn’t' : 'haven’t') + ' reached the shared results yet' +
                  (st.error ? ' (' + String(st.error).replace(/\.$/, '') + ')' : '') +
                  '. If you start as a new reviewer now, ' + (n === 1 ? 'it' : 'they') + ' will be lost. To keep ' + (n === 1 ? 'it' : 'them') + ', choose “Keep my changes” and try again once you’re back online.',
                confirmLabel: 'Discard and start as a new reviewer',
                cancelLabel: 'Keep my changes',
                danger: true,
                trigger: btn
              });
            })
            .then(function (go) {
              if (!go) return;
              return WT.reviewer.reset({ discard: true }).then(function () {
                WT.dialog.setReturn(nameDlg, null);
                WT.dialog.close(nameDlg, 'reset');
                WT.go('/start');
                WT.toast('You’re now a new reviewer on this browser.', { kind: 'success' });
              });
            })
            .then(
              function () {
                busy(btn, false);
              },
              function () {
                busy(btn, false);
              }
            );
        });
    });

    nameDlg.querySelector('[data-wt-remove-answers]').addEventListener('click', function (e) {
      var btn = e.currentTarget;
      if (isBusy(btn)) return;
      WT.dialog
        .confirm({
          title: 'Remove your answers?',
          body: 'This deletes your votes, priorities and comments from the shared results, and clears them from this browser. You can’t undo this.',
          confirmLabel: 'Remove my answers',
          danger: true,
          trigger: btn
        })
        .then(function (yes) {
          if (!yes) return;
          busy(btn, true);
          // WT.reviewer.remove() stops queued and in-flight saves before the DELETE,
          // so nothing can re-create the record afterwards, then starts a new reviewer.
          return WT.reviewer.remove().then(
            function () {
              busy(btn, false);
              WT.dialog.setReturn(nameDlg, null);
              WT.dialog.close(nameDlg, 'removed');
              WT.go('/start');
              WT.toast('Your answers are removed.', { kind: 'success' });
            },
            function (err) {
              busy(btn, false);
              WT.toast('We couldn’t remove your answers. ' + ((err && err.message) || 'Please try again.'), { kind: 'error' });
            }
          );
        });
    });
  }

  /**
   * Marks a button busy (spinner) while a slow action runs. It stays enabled,
   * so focus can return to it from a confirm dialog; clicks are ignored meanwhile.
   */
  function busy(btn, on) {
    if (!btn) return;
    if (on) btn.setAttribute('aria-busy', 'true');
    else btn.removeAttribute('aria-busy');
  }
  function isBusy(btn) {
    return !!btn && btn.getAttribute('aria-busy') === 'true';
  }

  /**
   * Sends everything queued. A save already in flight resolves first, so
   * changes queued meanwhile get one more flush. Resolves when done (whatever
   * the outcome: check WT.answers.pending()).
   */
  function saveEverything() {
    var settle = function () {
      return true;
    };
    return WT.answers
      .flush()
      .then(function (ok) {
        return ok !== false && WT.answers.pending() ? WT.answers.flush() : ok;
      })
      .then(settle, settle);
  }

  /**
   * Where focus goes when the name dialog closes. The chip lives in the phone
   * Menu, which closes when the dialog opens, so on phones (Menu open, or the
   * chip tucked away in it) focus returns to the Menu button instead.
   */
  function returnTarget(trigger) {
    var t = trigger || els.chip;
    if (t && els.menu && els.menuBtn && els.menu.contains(t) && (menuOpen() || WT.isNarrow())) return els.menuBtn;
    return t;
  }

  /** Open the name dialog. trigger gets focus back afterwards (the Menu button on phones). */
  function openNameDialog(trigger) {
    if (!nameDlg) buildNameDialog();
    var input = nameDlg.querySelector('#wt-name-input');
    input.value = WT.reviewer.name();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    var ret = returnTarget(trigger);
    setMenu(false);
    WT.dialog.open(nameDlg, { trigger: ret, initialFocus: input });
  }

  WT.shell = {
    openNameDialog: openNameDialog,
    closeMenu: function () {
      setMenu(false);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */

  WT.register({
    name: 'shell',
    init: function () {
      els.mast = doc.getElementById('wt-mast');
      els.menu = doc.getElementById('wt-menu');
      els.menuBtn = doc.getElementById('wt-menu-btn');
      els.chip = doc.getElementById('wt-reviewer-chip');
      els.chipText = els.chip && els.chip.querySelector('.wt-reviewer-chip__text');
      els.theme = doc.getElementById('wt-theme-toggle');

      // Skip link: move focus to the current view without touching the URL (the router owns the hash).
      var skip = doc.querySelector('[data-skip]');
      if (skip) {
        skip.addEventListener('click', function (e) {
          e.preventDefault();
          if (!WT.focusView()) doc.getElementById('main').focus();
        });
      }

      // Phone Menu (a disclosure: focus stays on the button).
      if (els.menuBtn) {
        els.menuBtn.addEventListener('click', function () {
          setMenu(!menuOpen());
        });
      }
      doc.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && menuOpen()) {
          e.preventDefault();
          setMenu(false, { focusButton: true });
        }
      });
      doc.addEventListener('click', function (e) {
        if (!menuOpen()) return;
        if (els.menu.contains(e.target) && e.target.closest('a')) return setMenu(false);
        if (!els.menu.contains(e.target) && !els.menuBtn.contains(e.target)) setMenu(false);
      });
      doc.addEventListener('focusin', function (e) {
        if (menuOpen() && els.mast && !els.mast.contains(e.target) && !e.target.closest('dialog')) setMenu(false);
      });
      if (window.matchMedia) {
        var wide = window.matchMedia('(min-width: 720px)');
        var onWide = function () {
          if (wide.matches) setMenu(false);
        };
        if (wide.addEventListener) wide.addEventListener('change', onWide);
        else if (wide.addListener) wide.addListener(onWide);
      }

      // Reviewer chip and name dialog.
      if (els.chip) {
        els.chip.addEventListener('click', function () {
          openNameDialog(els.chip);
        });
      }
      updateChip();
      WT.on('reviewer', updateChip);

      // Light/dark toggle.
      if (els.theme) {
        els.theme.addEventListener('click', function () {
          var t = WT.theme.toggle();
          WT.announce(t === 'dark' ? 'Dark mode on' : 'Dark mode off');
        });
      }
      updateTheme();
      WT.on('theme', updateTheme);

      WT.on('route', function (r) {
        updateNav(r.view);
        setMenu(false);
      });

      window.addEventListener('offline', function () {
        WT.toast('You’re offline. We’ll save your answers when you’re back online.');
      });
    }
  });
})(window.WT = window.WT || {});
