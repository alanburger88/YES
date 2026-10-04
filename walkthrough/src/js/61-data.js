/*
 * 61-data.js — the Data requirements view (#/data, #/data/<featureId>).
 * SPEC section 7. Owner: data view.
 *
 * A scope switch picks the features: "Features I included" (WT.answers),
 * "Features the group wants" (include share ≥ 50% with at least one vote, from
 * WT.api.results), "All features", or "Custom" (a checklist fine-tunes any of
 * them). The merged explorer (WT.json) shows their data, followed by a card per
 * feature. #/data/<featureId> preselects one feature. If the results API can't
 * be reached, the group option shows a notice and the others keep working.
 */
(function (WT) {
  'use strict';

  var doc = document;
  var section = null;
  var els = {};
  var explorer = null;
  var quiet = false; // set while this module rewrites its own URL
  var state = { scope: 'mine', custom: [], fineOpen: false, fromParam: false, missing: '' };
  var res = { data: null, error: null, busy: false };
  var lastAnnounced = '';

  function visible() {
    var r = WT.route();
    return !!(r && r.view === 'data' && section && !section.hidden);
  }

  /* ------------------------------------------------------------------ */
  /* Scopes                                                              */
  /* ------------------------------------------------------------------ */

  function allIds() {
    var dr = WT.dataReq || {};
    return WT.features
      .map(function (f) {
        return f.id;
      })
      .filter(function (id) {
        return dr[id];
      });
  }
  function mineIds() {
    var a = WT.answers.all();
    return allIds().filter(function (id) {
      return a[id] && a[id].vote === 'include';
    });
  }
  function groupInfo(id) {
    var f = res.data && res.data.features && res.data.features[id];
    if (!f) return null;
    var inc = Number(f.include) || 0;
    var exc = Number(f.exclude) || 0;
    var votes = inc + exc;
    return { include: inc, exclude: exc, votes: votes, share: votes ? inc / votes : 0 };
  }
  function groupIds() {
    if (!res.data) return [];
    return allIds().filter(function (id) {
      var g = groupInfo(id);
      return !!g && g.votes >= 1 && g.share >= 0.5;
    });
  }
  function selection() {
    if (state.scope === 'mine') return mineIds();
    if (state.scope === 'group') return groupIds();
    if (state.scope === 'all') return allIds();
    return allIds().filter(function (id) {
      return state.custom.indexOf(id) !== -1;
    });
  }
  function groupStatus() {
    if (res.data) return 'ok';
    if (res.busy) return 'loading';
    if (res.error) return 'error';
    return 'loading';
  }

  function loadResults() {
    if (res.busy) return;
    res.busy = true;
    WT.api.results().then(
      function (r) {
        res.data = r && r.features ? r : res.data;
        res.error = null;
      },
      function (e) {
        res.error = e || new Error('Results unavailable');
      }
    ).then(function () {
      res.busy = false;
      if (visible()) update({ quietly: true });
    });
  }

  /* ------------------------------------------------------------------ */
  /* HTML                                                                */
  /* ------------------------------------------------------------------ */

  function fieldCounts(id) {
    var f = (WT.dataReq[id] && WT.dataReq[id].fields) || [];
    return {
      fields: f.length,
      required: f.filter(function (x) {
        return x.required;
      }).length
    };
  }

  function pageHtml() {
    return (
      '<div class="wt-container wt-dv">' +
        '<header class="wt-dv__head">' +
          '<p class="wt-eyebrow">For the production build</p>' +
          '<h1 class="wt-title" tabindex="-1" data-fk="h1">Data requirements</h1>' +
          '<p class="wt-lead">These are the fields YES would supply to InfoSlips in production for the features you choose. Fields that several features share appear once. Explore them as a JSON structure, search for a field, or download a sample and a JSON Schema for your technical teams.</p>' +
          '<p class="wt-dv__fictional">' + WT.icon('info', { size: 18 }) + '<span>Every example value is fictional and matches the demo statement.</span></p>' +
        '</header>' +
        '<section class="wt-card wt-dv__scope" aria-labelledby="dv-scope-h">' +
          '<h2 class="wt-dv__h2 wt-dv__h2--card" id="dv-scope-h">Choose the features</h2>' +
          '<div class="wt-dv__scope-body" data-dv="scope"></div>' +
        '</section>' +
        '<div class="wt-dv__status" data-dv="status"></div>' +
        '<div class="wt-dv__empty-host" data-dv="empty" hidden></div>' +
        '<section class="wt-dv__explore" data-dv="explore" aria-labelledby="dv-explore-h" hidden>' +
          '<div class="wt-dv__section-head">' +
            '<h2 class="wt-dv__h2" id="dv-explore-h">The data structure</h2>' +
            '<p class="wt-dv__summary" data-dv="summary"></p>' +
          '</div>' +
          '<div class="wt-card wt-dv__explorer" data-dv="explorer"></div>' +
        '</section>' +
        '<section class="wt-dv__features" data-dv="features" aria-labelledby="dv-features-h" hidden>' +
          '<div class="wt-dv__section-head">' +
            '<h2 class="wt-dv__h2" id="dv-features-h">Features in this view</h2>' +
            '<p class="wt-dv__summary">Field counts are each feature’s own fields. Every feature also needs the ' + ((WT.dataReq.$common && WT.dataReq.$common.fields.length) || 0) + ' fields of the statement envelope.</p>' +
          '</div>' +
          '<ul class="wt-dv__cards" role="list" data-dv="cards"></ul>' +
        '</section>' +
      '</div>'
    );
  }

  function optionHtml(value, title, desc, n) {
    var checked = state.scope === value;
    return (
      '<label class="wt-dv__opt">' +
        '<input class="wt-dv__radio" type="radio" name="dv-scope"' +
        WT.attrs({ value: value, checked: checked, 'data-fk': 'dv-scope-' + value, 'aria-describedby': 'dv-scope-' + value + '-d' }) + ' />' +
        '<span class="wt-dv__opt-body">' +
          '<span class="wt-dv__opt-title">' + WT.esc(title) + '</span>' +
          (n === null ? '' : '<span class="wt-dv__opt-n wt-num" aria-hidden="true">' + WT.esc(n) + '</span>') +
          '<span class="wt-dv__opt-desc" id="dv-scope-' + value + '-d">' + WT.esc(desc) + '</span>' +
        '</span>' +
      '</label>'
    );
  }

  function scopeHtml() {
    var N = allIds().length;
    var mine = mineIds().length;
    var gs = groupStatus();
    var group = groupIds().length;
    var custom = state.scope === 'custom' ? selection().length : null;
    var sel = selection();
    var groupDesc =
      gs === 'ok'
        ? group
          ? WT.fmt.plural(group, 'feature') + ' that at least half the voters included'
          : 'No feature has majority support yet'
        : gs === 'error'
          ? 'Everyone’s votes couldn’t be loaded'
          : 'Loading everyone’s votes…';
    var options =
      optionHtml('mine', 'Features I included', mine ? WT.fmt.plural(mine, 'feature') + ' you voted to include' : 'You haven’t included any yet', mine) +
      optionHtml('group', 'Features the group wants', groupDesc, gs === 'ok' ? group : null) +
      optionHtml('all', 'All features', 'Every feature in the statement', N) +
      optionHtml('custom', 'Custom', custom === null ? 'Pick features from the list below' : WT.fmt.plural(custom, 'feature') + ' you picked', custom);

    // The checklist, grouped by section.
    var groups = {};
    var order = [];
    WT.features.forEach(function (f) {
      if (!WT.dataReq[f.id]) return;
      if (!groups[f.section]) {
        groups[f.section] = [];
        order.push(f.section);
      }
      groups[f.section].push(f);
    });
    order.sort(function (a, b) {
      var k = Object.keys(WT.SECTIONS);
      return k.indexOf(a) - k.indexOf(b);
    });
    var lists = order
      .map(function (s) {
        return (
          '<fieldset class="wt-fieldset wt-dv__fine-group">' +
            '<legend class="wt-dv__fine-legend">' + WT.esc(WT.sectionLabel(s)) + '</legend>' +
            groups[s]
              .map(function (f) {
                var on = sel.indexOf(f.id) !== -1;
                var c = fieldCounts(f.id);
                return (
                  '<label class="wt-dv__check">' +
                    '<input type="checkbox" class="wt-dv__checkbox"' + WT.attrs({ value: f.id, checked: on, 'data-dv-feature': f.id, 'data-fk': 'dv-f-' + f.id }) + ' />' +
                    '<span class="wt-dv__check-title">' + WT.esc(f.title) + '</span>' +
                    '<span class="wt-dv__check-n">' + WT.esc(WT.fmt.plural(c.fields, 'field')) + '</span>' +
                  '</label>'
                );
              })
              .join('') +
          '</fieldset>'
        );
      })
      .join('');

    return (
      '<fieldset class="wt-fieldset wt-dv__scopes-fs">' +
        '<legend class="wt-sr-only">Show the data for</legend>' +
        '<div class="wt-dv__scopes">' + options + '</div>' +
      '</fieldset>' +
      '<details class="wt-details wt-dv__fine" data-dv-fine' + (state.fineOpen ? ' open' : '') + '>' +
        '<summary data-fk="dv-fine">' +
          '<span>Fine-tune the list of features</span>' +
          '<span class="wt-badge wt-badge--neutral wt-dv__fine-count">' + WT.esc(sel.length + ' of ' + N + ' selected') + '</span>' +
        '</summary>' +
        '<div class="wt-dv__fine-body">' +
          '<p class="wt-hint">Ticking or clearing a feature switches to <strong>Custom</strong>.</p>' +
          '<div class="wt-dv__fine-actions">' +
            '<button class="wt-btn wt-btn--secondary wt-btn--sm" type="button" data-dv-act="select-all" data-fk="dv-select-all">' + WT.icon('check', { size: 18 }) + '<span>Select all</span></button>' +
            '<button class="wt-btn wt-btn--ghost wt-btn--sm" type="button" data-dv-act="select-none" data-fk="dv-select-none">' + WT.icon('x', { size: 18 }) + '<span>Clear all</span></button>' +
          '</div>' +
          '<div class="wt-dv__fine-groups">' + lists + '</div>' +
        '</div>' +
      '</details>'
    );
  }

  function emptyHtml() {
    var answered = WT.answers.stats();
    var tourLabel = WT.reviewer.hasProgress() ? 'Continue the walkthrough' : 'Start the walkthrough';
    var tour = '<a class="wt-btn wt-btn--primary" href="#/tour" data-fk="dv-empty-tour"><span>' + tourLabel + '</span>' + WT.icon('arrow-right') + '</a>';
    var all = '<button class="wt-btn wt-btn--secondary" type="button" data-dv-act="scope-all" data-fk="dv-empty-all">' + WT.icon('layers', { size: 18 }) + '<span>Show all features</span></button>';
    var title;
    var text;
    var actions;
    if (state.scope === 'group') {
      title = 'No feature has the group’s support yet';
      text = 'A feature appears here once at least half of the people who voted on it chose <strong>Include</strong>. Add your own votes in the walkthrough, or see what everyone thinks so far.';
      actions = tour + '<a class="wt-btn wt-btn--secondary" href="#/results" data-fk="dv-empty-results">' + WT.icon('chart', { size: 18 }) + '<span>See the results</span></a>' + all;
    } else if (state.scope === 'custom') {
      title = 'No features selected';
      text = 'Tick the features you want in the list above, or choose one of the other options.';
      actions = all;
    } else {
      title = 'You haven’t included any features yet';
      text =
        'In the walkthrough, vote <strong>Include</strong> on each feature you want in the production statement. Its data requirements then appear here, merged with the others into one structure.' +
        (answered.exclude ? ' So far you’ve voted to exclude ' + WT.esc(WT.fmt.plural(answered.exclude, 'feature')) + '.' : '');
      actions = tour + all;
    }
    return (
      '<div class="wt-empty wt-dv__empty">' +
        '<span class="wt-empty__icon">' + WT.icon('braces', { size: 36 }) + '</span>' +
        '<h2 class="wt-dv__empty-h">' + WT.esc(title) + '</h2>' +
        '<p class="wt-dv__empty-text">' + text + '</p>' +
        '<div class="wt-dv__empty-actions">' + actions + '</div>' +
      '</div>'
    );
  }

  function statusHtml() {
    var parts = '';
    if (state.missing) {
      parts += WT.ui.notice({
        kind: 'info',
        role: 'status',
        title: 'We couldn’t find that feature.',
        text: 'There’s no feature called “' + state.missing + '”. Choose features below.'
      });
    }
    if (state.scope === 'group' && !res.data) {
      if (res.error && !res.busy) {
        parts += WT.ui.notice({
          kind: 'error',
          role: 'status',
          title: 'We couldn’t load everyone’s votes.',
          html:
            WT.esc((res.error && res.error.message) || 'Please try again.') +
            ' The other options still work.' +
            '<span class="wt-dv__retry"><button class="wt-btn wt-btn--secondary wt-btn--sm" type="button" data-dv-act="retry" data-fk="dv-retry">' + WT.icon('refresh', { size: 18 }) + '<span>Try again</span></button></span>'
        });
      } else {
        parts += '<div class="wt-dv__loading">' + WT.ui.skeleton({ lines: 2, title: false, label: 'Loading everyone’s votes…' }) + '</div>';
      }
    }
    return parts;
  }

  function cardHtml(id, alone) {
    var f = WT.feature(id);
    var d = WT.dataReq[id];
    var c = fieldCounts(id);
    var a = WT.answers.get(id);
    var g = groupInfo(id);
    var e = encodeURIComponent(id);
    var votes = '';
    if (a && a.vote) votes += '<span class="wt-dv__vote"><span class="wt-dv__vote-k">You:</span>' + WT.ui.voteBadge(a.vote) + '</span>';
    if (g && g.votes) {
      votes +=
        '<span class="wt-dv__vote"><span class="wt-dv__vote-k">Group:</span><span class="wt-badge wt-badge--neutral">' +
        WT.esc(WT.fmt.pct(g.share) + ' include · ' + WT.fmt.plural(g.votes, 'vote')) +
        '</span></span>';
    }
    var notes = d.notes && d.notes.length
      ? '<details class="wt-dv__notes"><summary>Implementation notes <span class="wt-dv__notes-n">' + d.notes.length + '</span></summary><ul>' +
        d.notes.map(function (n) {
          return '<li>' + WT.esc(n) + '</li>';
        }).join('') +
        '</ul></details>'
      : '';
    return (
      '<li class="wt-card wt-dv__card" data-dv-card="' + WT.esc(id) + '">' +
        '<div class="wt-dv__thumb">' +
          '<img class="wt-dv__img" src="' + WT.esc(WT.shot(id, true)) + '" alt="" width="320" height="200" loading="lazy" decoding="async" />' +
          '<span class="wt-dv__thumb-fallback" aria-hidden="true">' + WT.icon('image', { size: 28 }) + '</span>' +
        '</div>' +
        '<div class="wt-dv__card-body">' +
          '<p class="wt-dv__card-eyebrow">Step ' + (f.index + 1) + ' · ' + WT.esc(WT.sectionLabel(f.section)) + '</p>' +
          '<h3 class="wt-dv__card-title">' + WT.esc(f.title) + '</h3>' +
          '<p class="wt-dv__card-sum">' + WT.esc(d.summary) + '</p>' +
          '<p class="wt-dv__card-meta">' +
            '<span class="wt-dv__count"><strong class="wt-num">' + c.fields + '</strong> ' + (c.fields === 1 ? 'field' : 'fields') + '</span>' +
            '<span class="wt-dv__count"><strong class="wt-num">' + c.required + '</strong> required</span>' +
            '<span class="wt-dv__count"><strong class="wt-num">' + (c.fields - c.required) + '</strong> optional</span>' +
          '</p>' +
          (votes ? '<p class="wt-dv__votes">' + votes + '</p>' : '') +
          notes +
          '<div class="wt-dv__card-links">' +
            (alone ? '' : '<a class="wt-btn wt-btn--secondary wt-btn--sm" href="#/data/' + e + '">' + WT.icon('braces', { size: 18 }) + '<span>Only this feature<span class="wt-sr-only">: ' + WT.esc(f.title) + '</span></span></a>') +
            '<a class="wt-dv__link" href="#/tour/' + e + '">' + WT.icon('play', { size: 16 }) + '<span>Walkthrough<span class="wt-sr-only">: ' + WT.esc(f.title) + '</span></span></a>' +
            '<a class="wt-dv__link" href="#/results/' + e + '">' + WT.icon('chart', { size: 16 }) + '<span>Results<span class="wt-sr-only">: ' + WT.esc(f.title) + '</span></span></a>' +
          '</div>' +
        '</div>' +
      '</li>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function summaryText(ids) {
    var s = WT.json.stats(ids);
    return (
      'Merged data for ' + WT.fmt.plural(ids.length, 'feature') + ': ' +
      WT.fmt.plural(s.fields, 'field') + ', ' + WT.fmt.num(s.required) + ' required and ' + WT.fmt.num(s.optional) + ' optional, from ' +
      WT.fmt.plural(s.sources.length, 'source system') + '.'
    );
  }

  function update(opts) {
    opts = opts || {};
    if (!section || !els.scope) return;
    var ids = selection();
    WT.render(els.scope, scopeHtml());
    WT.render(els.status, statusHtml());
    var waiting = state.scope === 'group' && !res.data;
    var empty = !ids.length && !waiting;
    els.empty.hidden = !empty;
    if (empty) WT.render(els.empty, emptyHtml());
    else els.empty.innerHTML = '';
    var show = ids.length > 0;
    els.explore.hidden = !show;
    els.features.hidden = !show;
    var msg;
    if (show) {
      explorer = WT.json.mount(els.explorer, { features: ids, label: 'Data fields for the chosen features' });
      var text = summaryText(ids);
      els.summary.textContent = text;
      var alone = ids.length === 1;
      WT.render(els.cards, ids.map(function (id) {
        return cardHtml(id, alone);
      }).join(''));
      msg = text;
    } else {
      els.cards.innerHTML = '';
      msg = waiting ? (res.error ? 'Everyone’s votes couldn’t be loaded.' : '') : 'No features selected.';
    }
    if (!opts.quietly && msg && msg !== lastAnnounced) WT.announce(msg);
    if (msg) lastAnnounced = msg;
  }

  function applyParam(param) {
    state.missing = '';
    if (param) {
      if (WT.feature(param) && WT.dataReq[param]) {
        state.scope = 'custom';
        state.custom = [param];
        state.fromParam = true;
        state.fineOpen = false;
        var f = WT.feature(param);
        WT.setTitle('Data requirements: ' + f.title);
      } else {
        state.missing = param;
      }
    } else if (state.fromParam) {
      state.scope = 'mine';
      state.custom = [];
      state.fromParam = false;
    }
  }

  function render(param) {
    section = section || doc.getElementById('view-data');
    applyParam(param);
    WT.render(section, pageHtml());
    els = {};
    WT.$$('[data-dv]', section).forEach(function (el) {
      els[el.getAttribute('data-dv')] = el;
    });
    explorer = null;
    lastAnnounced = '';
    update({ quietly: true });
    loadResults();
  }

  function onRoute(param) {
    if (quiet) return;
    applyParam(param);
    update();
  }

  /** Drop a /data/<id> deep link from the URL once the visitor picks another scope. */
  function dropParam() {
    var r = WT.route();
    if (r && r.view === 'data' && r.param) {
      quiet = true;
      WT.go('/data', { replace: true });
      quiet = false;
      WT.setTitle('Data requirements');
    }
  }

  function setScope(value) {
    if (['mine', 'group', 'all', 'custom'].indexOf(value) === -1) return;
    if (value === 'custom' && state.scope !== 'custom') {
      state.custom = selection();
      state.fineOpen = true;
    }
    state.scope = value;
    state.fromParam = false;
    state.missing = '';
    dropParam();
    if (value === 'group' && !res.data) loadResults();
    update();
  }

  function setCustom(ids) {
    state.scope = 'custom';
    state.custom = ids;
    state.fromParam = false;
    state.fineOpen = true;
    dropParam();
    update();
  }

  WT.register({
    name: 'data',
    view: 'data',
    keepScroll: true,
    manageFocus: true,
    init: function () {
      section = doc.getElementById('view-data');
      if (!section) return;

      section.addEventListener('change', function (e) {
        var t = e.target;
        if (t.name === 'dv-scope' && t.checked) return setScope(t.value);
        if (t.hasAttribute && t.hasAttribute('data-dv-feature')) {
          var ids = WT.$$('[data-dv-feature]', section)
            .filter(function (c) {
              return c.checked;
            })
            .map(function (c) {
              return c.value;
            });
          setCustom(ids);
        }
      });
      section.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-dv-act]');
        if (!b || !section.contains(b)) return;
        var act = b.getAttribute('data-dv-act');
        if (act === 'select-all') setCustom(allIds());
        else if (act === 'select-none') setCustom([]);
        else if (act === 'scope-all') {
          setScope('all');
          var r = section.querySelector('[data-fk="dv-scope-all"]');
          if (r) r.focus();
        } else if (act === 'retry') {
          res.error = null;
          loadResults();
          update({ quietly: true });
          WT.announce('Loading everyone’s votes…');
        }
      });
      // <details> toggle does not bubble: listen in the capture phase.
      section.addEventListener(
        'toggle',
        function (e) {
          if (e.target.hasAttribute && e.target.hasAttribute('data-dv-fine')) state.fineOpen = e.target.open;
        },
        true
      );
      // Thumbnails that are missing show a neat placeholder instead.
      section.addEventListener(
        'error',
        function (e) {
          var img = e.target;
          if (img && img.classList && img.classList.contains('wt-dv__img')) {
            var box = img.closest('.wt-dv__thumb');
            if (box) box.classList.add('is-missing');
            img.remove();
          }
        },
        true
      );

      var refresh = WT.debounce(function () {
        if (visible()) update({ quietly: state.scope !== 'mine' });
      }, 60);
      WT.on('answers', refresh);
      WT.on('results', function (r) {
        if (r && r.features) {
          res.data = r;
          res.error = null;
          if (visible()) update({ quietly: true });
        }
      });
      // The router leaves focus to this module (manageFocus) so its own URL
      // rewrites don't move focus; a real navigation still focuses the h1.
      WT.on('route', function (r) {
        if (r.view !== 'data' || quiet || !r.prev || r.prev === r.path) return;
        if (r.prev.indexOf('/data') === 0) {
          try {
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
          } catch (e) {
            window.scrollTo(0, 0);
          }
        }
        WT.focusView('data');
      });
    },
    render: render,
    onRoute: onRoute
  });
})(window.WT = window.WT || {});
