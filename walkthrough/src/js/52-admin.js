/*
 * 52-admin.js — admin sign-in (#/admin) and moderation (SPEC sections 3 and 8).
 * Owner: results.
 *
 * The admin code is verified with GET /api/admin/check and kept in this tab's
 * sessionStorage ('infoslips.wt.admin', via WT.api.admin). While it is stored
 * and verified, the results pages show inline moderation controls that call
 * WT.moderation:
 *   hide({ rid, featureId, field, hidden }, trigger)   hide or unhide a reason or comment
 *   deleteReviewer(rid, name, trigger)                 delete a reviewer's answers (confirm)
 *   reset(trigger)                                     delete everything (type RESET)
 *   signOut()
 * Each successful change emits 'moderated' so the results reload.
 * The code itself is the Netlify environment variable ADMIN_CODE.
 */
(function (WT) {
  'use strict';

  var doc = document;
  var section = null;
  var view = { error: '', busy: false, configured: null, value: '' };

  /* ------------------------------------------------------------------ */
  /* Moderation actions                                                  */
  /* ------------------------------------------------------------------ */

  function failMessage(err, what) {
    if (err && err.status === 401) return 'Your admin code is no longer valid, so you’ve been signed out. Sign in again on the Admin page.';
    if (err && err.status === 503) return 'Admin is not configured on this site.';
    if (err && err.status === 404) return 'That reviewer no longer exists. The results have been refreshed.';
    return 'We couldn’t ' + what + '. ' + ((err && err.message) || 'Please try again.');
  }

  function done(msg) {
    WT.toast(msg, { kind: 'success' });
    WT.emit('moderated', true);
  }

  function hide(o, trigger) {
    if (trigger) trigger.setAttribute('aria-busy', 'true');
    var label = o.field === 'reason' ? 'reason' : 'comment';
    return WT.api.admin.hide(o).then(
      function () {
        done(o.hidden ? 'The ' + label + ' is hidden from everyone.' : 'The ' + label + ' is visible again.');
        return true;
      },
      function (err) {
        if (trigger) trigger.removeAttribute('aria-busy');
        WT.toast(failMessage(err, (o.hidden ? 'hide' : 'unhide') + ' the ' + label), { kind: 'error' });
        if (err && err.status === 404) WT.emit('moderated', false);
        return false;
      }
    );
  }

  function deleteReviewer(rid, name, trigger) {
    var who = name || WT.ANONYMOUS;
    return WT.dialog
      .confirm({
        title: 'Delete these answers?',
        html:
          '<p>This deletes every vote, priority, reason and comment from <strong>' + WT.esc(who) + '</strong>. ' +
          'Everyone will stop seeing them, and the export will no longer include them. You can’t undo this.</p>',
        confirmLabel: 'Delete answers',
        danger: true,
        trigger: trigger
      })
      .then(function (yes) {
        if (!yes) return false;
        return WT.api.admin.deleteReviewer(rid).then(
          function () {
            done('Answers from ' + who + ' were deleted.');
            focusAfterRemoval();
            return true;
          },
          function (err) {
            WT.toast(failMessage(err, 'delete these answers'), { kind: 'error' });
            if (err && err.status === 404) WT.emit('moderated', false);
            return false;
          }
        );
      });
  }

  /** The trigger is about to disappear: move focus to a stable heading. */
  function focusAfterRemoval() {
    setTimeout(function () {
      var a = doc.activeElement;
      if (a && a !== doc.body && a.isConnected) return;
      var h = doc.getElementById('resp-h') || null;
      if (h) h.focus();
      else WT.focusView();
    }, 0);
  }

  function reset(trigger) {
    return WT.dialog
      .confirm({
        title: 'Reset all results?',
        html:
          '<p>This permanently deletes <strong>every reviewer’s answers</strong>: all votes, priorities, reasons and comments. ' +
          'The results start again from zero for everyone. You can’t undo this.</p>' +
          '<p>Consider exporting a CSV or JSON copy first.</p>',
        confirmLabel: 'Reset all results',
        danger: true,
        typeToConfirm: 'RESET',
        trigger: trigger
      })
      .then(function (yes) {
        if (!yes) return false;
        return WT.api.admin.reset().then(
          function (r) {
            done('All results were reset. ' + WT.fmt.plural((r && r.deleted) || 0, 'reviewer') + ' removed.');
            setTimeout(function () {
              WT.focusView();
            }, 0);
            return true;
          },
          function (err) {
            WT.toast(failMessage(err, 'reset the results'), { kind: 'error' });
            return false;
          }
        );
      });
  }

  function signOut() {
    WT.api.admin.signOut();
    WT.toast('You’ve signed out of admin in this tab.', { kind: 'success' });
    var r = WT.route();
    if (r && r.view === 'admin') render();
    setTimeout(function () {
      var a = doc.activeElement;
      if (!a || a === doc.body || !a.isConnected) WT.focusView();
    }, 0);
  }

  WT.moderation = {
    enabled: function () {
      return WT.api.admin.signedIn();
    },
    hide: hide,
    deleteReviewer: deleteReviewer,
    reset: reset,
    signOut: signOut
  };

  /* ------------------------------------------------------------------ */
  /* #/admin                                                             */
  /* ------------------------------------------------------------------ */

  function aboutCard() {
    return (
      '<section class="wt-card wt-admin__about" aria-labelledby="admin-about-h">' +
        '<h2 class="wt-card__title" id="admin-about-h">' + WT.icon('info') + '<span>About the admin code</span></h2>' +
        '<ul class="wt-admin__facts">' +
          '<li>The code is set in the Netlify environment variable <code>ADMIN_CODE</code> for this site (Site configuration → Environment variables, Functions scope). To change it, update the variable and redeploy.</li>' +
          '<li>If <code>ADMIN_CODE</code> isn’t set, admin is turned off and nobody can moderate.</li>' +
          '<li>After you sign in, the code is kept only in this browser tab (session storage). It’s forgotten when you close the tab or sign out.</li>' +
          '<li>Everyone else keeps seeing the results as before. Hidden reasons and comments are left out of the results and the exports.</li>' +
        '</ul>' +
      '</section>'
    );
  }

  function signedInCard() {
    return (
      '<section class="wt-card wt-admin__card" aria-labelledby="admin-state-h">' +
        '<h2 class="wt-card__title" id="admin-state-h">' + WT.icon('unlock') + '<span>You’re signed in as admin</span></h2>' +
        WT.ui.notice({ kind: 'success', text: 'Moderation controls now appear on the results pages: hide or unhide a reason or comment, delete a reviewer’s answers, and reset all results.', role: 'status' }) +
        '<div class="wt-admin__actions">' +
          '<a class="wt-btn wt-btn--primary" href="#/results" data-fk="admin-results">' + WT.icon('chart', { size: 18 }) + '<span>Go to the results</span></a>' +
          '<a class="wt-btn wt-btn--secondary" href="#/results/people" data-fk="admin-people">' + WT.icon('users', { size: 18 }) + '<span>Moderate by reviewer</span></a>' +
        '</div>' +
        '<hr class="wt-divider" />' +
        '<div class="wt-admin__danger">' +
          '<div><h3 class="wt-admin__h3">Reset all results</h3><p class="wt-hint">Deletes every reviewer’s answers. You’ll be asked to type RESET.</p></div>' +
          '<button class="wt-btn wt-btn--danger" type="button" data-admin="reset" data-fk="admin-reset">' + WT.icon('trash', { size: 18 }) + '<span>Reset all results</span></button>' +
        '</div>' +
        '<hr class="wt-divider" />' +
        '<button class="wt-btn wt-btn--secondary" type="button" data-admin="signout" data-fk="admin-signout">' + WT.icon('logout', { size: 18 }) + '<span>Sign out of admin</span></button>' +
      '</section>'
    );
  }

  function signInCard() {
    var notConfigured = view.configured === false;
    return (
      '<section class="wt-card wt-admin__card" aria-labelledby="admin-form-h">' +
        '<h2 class="wt-card__title" id="admin-form-h">' + WT.icon('lock') + '<span>Sign in to moderate</span></h2>' +
        (notConfigured
          ? WT.ui.notice({ kind: 'info', title: 'Admin is not configured on this site.', text: 'Set the ADMIN_CODE environment variable in Netlify and redeploy to turn it on.', role: 'status' })
          : '') +
        '<form class="wt-admin__form" id="admin-form" novalidate>' +
          '<div class="wt-field">' +
            '<label class="wt-label" for="admin-code">Admin code</label>' +
            '<p class="wt-hint" id="admin-code-hint">The code InfoSlips shared with the organisers.</p>' +
            '<input class="wt-input" id="admin-code" name="code" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" data-fk="admin-code"' +
              ' aria-describedby="admin-code-hint' + (view.error ? ' admin-code-error' : '') + '"' + (view.error ? ' aria-invalid="true"' : '') +
              ' value="' + WT.esc(view.value) + '" />' +
            (view.error ? '<p class="wt-error" id="admin-code-error">' + WT.icon('alert', { size: 16 }) + '<span>' + WT.esc(view.error) + '</span></p>' : '') +
          '</div>' +
          '<button class="wt-btn wt-btn--primary" type="submit" data-fk="admin-submit"' + (view.busy ? ' aria-busy="true" disabled' : '') + '>' + WT.icon('unlock', { size: 18 }) + '<span>Sign in</span></button>' +
        '</form>' +
      '</section>'
    );
  }

  function render() {
    if (!section) section = doc.getElementById('view-admin');
    var inn = WT.api.admin.signedIn();
    WT.render(
      section,
      '<div class="wt-container wt-admin">' +
        '<p class="wt-eyebrow">Moderation</p>' +
        '<h1 class="wt-title" tabindex="-1" data-fk="h1">Admin</h1>' +
        '<p class="wt-lead">For the organisers of this review: hide reasons or comments, delete a reviewer’s answers, or reset all results.</p>' +
        '<div class="wt-admin__grid">' + (inn ? signedInCard() : signInCard()) + aboutCard() + '</div>' +
      '</div>'
    );
  }

  function submit() {
    var input = doc.getElementById('admin-code');
    var code = input ? input.value.trim() : '';
    view.value = input ? input.value : '';
    if (!code) {
      view.error = 'Enter the admin code.';
      render();
      focusCode();
      return;
    }
    view.busy = true;
    view.error = '';
    render();
    WT.api.admin.check(code).then(
      function (ok) {
        view.busy = false;
        if (ok) {
          view.value = '';
          view.configured = true;
          render();
          WT.toast('Signed in as admin.', { kind: 'success' });
          var h = doc.getElementById('admin-state-h');
          if (h) {
            h.setAttribute('tabindex', '-1');
            h.focus();
          }
        } else {
          view.error = 'That admin code is not correct.';
          render();
          focusCode();
          WT.announce(view.error, true);
        }
      },
      function (err) {
        view.busy = false;
        if (err && err.status === 503) {
          view.configured = false;
          view.error = 'Admin is not configured. Set the ADMIN_CODE environment variable in Netlify and redeploy.';
        } else {
          view.error = err && err.status === 0 ? 'We couldn’t reach the server. Check your connection and try again.' : (err && err.message) || 'Something went wrong. Please try again.';
        }
        render();
        focusCode();
        WT.announce(view.error, true);
      }
    );
  }

  function focusCode() {
    var i = doc.getElementById('admin-code');
    if (i) i.focus();
  }

  WT.register({
    name: 'admin',
    view: 'admin',
    init: function () {
      section = doc.getElementById('view-admin');
      if (!section) return;
      section.addEventListener('submit', function (e) {
        if (e.target && e.target.id === 'admin-form') {
          e.preventDefault();
          if (!view.busy) submit();
        }
      });
      section.addEventListener('click', function (e) {
        var t = e.target.closest && e.target.closest('[data-admin]');
        if (!t) return;
        var a = t.getAttribute('data-admin');
        if (a === 'signout') signOut();
        else if (a === 'reset') reset(t);
      });
      WT.on('admin', function () {
        var r = WT.route();
        if (r && r.view === 'admin') render();
      });
    },
    render: function () {
      view.error = '';
      view.busy = false;
      view.value = '';
      render();
      // Tell visitors early when admin is switched off, and drop a stored code that no longer works.
      var checks = [
        WT.api.health().then(
          function (h) {
            var was = view.configured;
            view.configured = !!(h && h.adminConfigured);
            if (was !== view.configured && !WT.api.admin.signedIn()) {
              var r = WT.route();
              if (r && r.view === 'admin') render();
            }
          },
          function () {}
        )
      ];
      if (WT.api.admin.signedIn()) {
        checks.push(
          WT.api.admin.check(WT.api.admin.code()).then(
            function (ok) {
              if (!ok) WT.api.admin.signOut();
            },
            function () {}
          )
        );
      }
      return Promise.all(checks);
    }
  });
})(window.WT = window.WT || {});
