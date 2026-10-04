/*
 * 50-results.js — the results view (SPEC section 8). Owner: results.
 *
 *   #/results              Overview: summary in words, KPI tiles, three charts
 *   #/results/features     By feature: every feature ranked (cards)
 *   #/results/<featureId>  Feature detail: screenshot, description, stats, every response
 *   #/results/people       People: reviewers × features matrix
 *
 * Data comes from GET /api/results (admins get hidden text with ?admin=1).
 * It refreshes every 30 s while the tab is visible and the view is shown, and
 * announces politely only when the numbers change. Inline moderation controls
 * appear when a verified admin code is stored (52-admin.js does the work).
 * Charts are built by 51-charts.js. Emits 'results' with each fresh object.
 */
(function (WT) {
  'use strict';

  var doc = document;
  var SUBS = { features: 'features', people: 'people' };
  var timeFmt = null;

  var state = {
    data: null,
    sig: '',
    loadedAt: 0,
    loading: null,
    queued: null,
    error: null,
    refreshError: null,
    manual: false,
    sub: 'overview',
    param: '',
    tables: {},
    sort: 'support',
    me: '',
    timer: null
  };
  var section = null;

  /* ------------------------------------------------------------------ */
  /* Model                                                               */
  /* ------------------------------------------------------------------ */

  var EMPTY = { include: 0, exclude: 0, undecided: 0, priority: { high: 0, medium: 0, low: 0 }, score: null, comments: 0, reasons: 0, responses: [] };

  /**
   * The one "wanted" rule, used by the KPI tile here and the Data requirements
   * view: more include than exclude votes (a tie is not wanted). Takes any
   * object with include and exclude counts, such as /api/results features[id].
   */
  function wanted(x) {
    return (Number(x && x.include) || 0) > (Number(x && x.exclude) || 0);
  }
  var WANTED = {
    label: 'Features most reviewers want',
    rule: 'more include than exclude votes',
    full: 'Features most reviewers want (more include than exclude votes)'
  };

  /**
   * Priority counts for one feature. A priority means "how important if it is
   * included", so only responses whose vote is not Exclude count. Computed from
   * responses[] when they are all there (so it holds whatever rule the server
   * used for features[id].priority); otherwise the server's counts are used.
   */
  function priorityOf(x) {
    var total = (x.include || 0) + (x.exclude || 0) + (x.undecided || 0);
    var list = x.responses;
    if (Array.isArray(list) && list.length && list.length >= total) {
      var p = { high: 0, medium: 0, low: 0 };
      list.forEach(function (r) {
        if (r && r.vote !== 'exclude' && Object.prototype.hasOwnProperty.call(p, r.priority)) p[r.priority]++;
      });
      return p;
    }
    var q = x.priority || EMPTY.priority;
    return { high: q.high || 0, medium: q.medium || 0, low: q.low || 0 };
  }
  /** (High×3 + Medium×2 + Low×1) ÷ priority responses, to 2 decimals; null without any. */
  function scoreOf(p) {
    var n = p.high + p.medium + p.low;
    return n ? Math.round(((p.high * 3 + p.medium * 2 + p.low) / n) * 100) / 100 : null;
  }

  /** One row per feature (tour order) with derived numbers. */
  function model(data) {
    return WT.features.map(function (f, i) {
      var x = (data && data.features && data.features[f.id]) || EMPTY;
      var p = priorityOf(x);
      var votes = (x.include || 0) + (x.exclude || 0);
      var pn = p.high + p.medium + p.low;
      return {
        id: f.id,
        title: f.title,
        short: f.short || '',
        section: f.section,
        index: i,
        include: x.include || 0,
        exclude: x.exclude || 0,
        undecided: x.undecided || 0,
        votes: votes,
        answers: votes + (x.undecided || 0),
        share: votes ? (x.include || 0) / votes : null,
        net: (x.include || 0) - (x.exclude || 0),
        priority: p,
        pn: pn,
        score: scoreOf(p),
        comments: x.comments || 0,
        reasons: x.reasons || 0,
        responses: x.responses || []
      };
    });
  }

  /** Net support (include − exclude), then include share, include votes, score, tour order. Unvoted last. */
  function bySupport(a, b) {
    if (!a.votes !== !b.votes) return a.votes ? -1 : 1;
    return b.net - a.net || (b.share || 0) - (a.share || 0) || b.include - a.include || (b.score || 0) - (a.score || 0) || a.index - b.index;
  }
  /** Share of High, then Medium; features without priorities last (tour order). */
  function byMix(a, b) {
    if (!a.pn !== !b.pn) return a.pn ? -1 : 1;
    if (!a.pn) return a.index - b.index;
    return b.priority.high / b.pn - a.priority.high / a.pn || b.priority.medium / b.pn - a.priority.medium / a.pn || b.pn - a.pn || a.index - b.index;
  }
  function byScore(a, b) {
    return b.score - a.score || b.pn - a.pn || b.priority.high - a.priority.high || a.index - b.index;
  }
  function byComments(a, b) {
    return b.comments - a.comments || bySupport(a, b);
  }
  function byOrder(a, b) {
    return a.index - b.index;
  }
  var SORTS = {
    support: { label: 'Net support', fn: bySupport },
    score: { label: 'Priority score', fn: function (a, b) {
      if ((a.score === null) !== (b.score === null)) return a.score === null ? 1 : -1;
      return a.score === null ? bySupport(a, b) : byScore(a, b);
    } },
    comments: { label: 'Most comments', fn: byComments },
    order: { label: 'Walkthrough order', fn: byOrder }
  };

  function scoreRows(rows) {
    return rows
      .filter(function (r) {
        return r.include > 0 && r.score !== null;
      })
      .sort(byScore);
  }

  /* ------------------------------------------------------------------ */
  /* Words                                                               */
  /* ------------------------------------------------------------------ */

  function listJoin(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }
  function link(r) {
    return '<a class="wt-sum__link" href="#/results/' + encodeURIComponent(r.id) + '">' + WT.esc(r.title) + '</a>';
  }
  /** "all High priority", "mostly Medium priority", "mixed priority", "no priority set" */
  function prioPhrase(r) {
    if (!r.pn) return 'no priority set';
    var best = null;
    var tie = false;
    ['high', 'medium', 'low'].forEach(function (k) {
      var n = r.priority[k];
      if (best === null || n > r.priority[best]) {
        best = k;
        tie = false;
      } else if (n === r.priority[best]) tie = true;
    });
    if (tie) return 'mixed priority';
    return (r.priority[best] === r.pn ? 'all ' : 'mostly ') + WT.PRIORITY_LABEL[best] + ' priority';
  }
  function topTied(rows, key) {
    var max = 0;
    rows.forEach(function (r) {
      max = Math.max(max, r[key]);
    });
    if (!max) return [];
    return rows.filter(function (r) {
      return r[key] === max;
    });
  }

  /** The auto-generated sentences: [{ key, icon, html }] */
  function sentences(rows) {
    var out = [];

    var sup = rows
      .filter(function (r) {
        return r.include > 0;
      })
      .sort(function (a, b) {
        return b.share - a.share || b.include - a.include || (b.score || 0) - (a.score || 0) || a.index - b.index;
      })
      .slice(0, 3);
    out.push({
      key: 'support',
      icon: 'check-circle',
      html: sup.length
        ? 'Strongest support goes to ' +
          listJoin(
            sup.map(function (r) {
              return link(r) + ' (' + WT.fmt.pct(r.include, r.votes) + ' include, ' + r.include + ' of ' + WT.fmt.plural(r.votes, 'vote') + ', ' + prioPhrase(r) + ')';
            })
          ) + '.'
        : 'Nobody has voted to include a feature yet.'
    });

    var deb = rows
      .filter(function (r) {
        return r.include > 0 && r.exclude > 0;
      })
      .sort(function (a, b) {
        return Math.abs(a.share - 0.5) - Math.abs(b.share - 0.5) || b.votes - a.votes || a.index - b.index;
      });
    if (deb.length) {
      var d0 = Math.abs(deb[0].share - 0.5);
      var tied = deb
        .filter(function (r) {
          return Math.abs(r.share - 0.5) === d0 && r.votes === deb[0].votes;
        })
        .slice(0, 3);
      out.push({
        key: 'debated',
        icon: 'layers',
        html:
          tied.length === 1
            ? 'The most debated feature is ' + link(tied[0]) + ', split ' + tied[0].include + ' include to ' + tied[0].exclude + ' exclude.'
            : 'The most debated features are ' +
              listJoin(
                tied.map(function (r) {
                  return link(r) + ' (' + r.include + ' include, ' + r.exclude + ' exclude)';
                })
              ) + '.'
      });
    } else {
      out.push({ key: 'debated', icon: 'layers', html: 'No feature has votes on both sides yet, so nothing is debated.' });
    }

    var exc = topTied(rows, 'exclude').slice(0, 3);
    out.push({
      key: 'excluded',
      icon: 'x-circle',
      html: !exc.length
        ? 'Nobody has voted to exclude a feature yet.'
        : exc.length === 1
          ? 'The most excluded feature is ' + link(exc[0]) + ', with ' + WT.fmt.plural(exc[0].exclude, 'exclude vote') + ' (' + WT.fmt.pct(exc[0].exclude, exc[0].votes) + ' of its votes).'
          : 'The most excluded features are ' + listJoin(exc.map(link)) + ', with ' + WT.fmt.plural(exc[0].exclude, 'exclude vote') + ' each.'
    });

    var com = topTied(rows, 'comments').slice(0, 3);
    out.push({
      key: 'commented',
      icon: 'comment',
      html: !com.length
        ? 'No comments yet.'
        : com.length === 1
          ? 'The most commented feature is ' + link(com[0]) + ', with ' + WT.fmt.plural(com[0].comments, 'comment') + '.'
          : 'The most commented features are ' + listJoin(com.map(link)) + ', with ' + WT.fmt.plural(com[0].comments, 'comment') + ' each.'
    });

    var none = rows.filter(function (r) {
      return !r.votes;
    });
    var shown = none.length > 5 ? none.slice(0, 4) : none;
    var names = shown.map(link);
    if (none.length > shown.length) names.push(WT.fmt.num(none.length - shown.length) + ' more');
    out.push({
      key: 'novotes',
      icon: 'minus',
      html: !none.length
        ? 'Every feature has at least one vote.'
        : (none.length === 1 ? '1 feature has no votes yet: ' : WT.fmt.num(none.length) + ' features have no votes yet: ') + listJoin(names) + '.'
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Small HTML helpers                                                  */
  /* ------------------------------------------------------------------ */

  function clock(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    timeFmt = timeFmt || new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    return timeFmt.format(d);
  }
  function admin() {
    return !!(WT.api.admin.signedIn() && state.data && state.data.admin);
  }
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
  }
  function nameOf(p) {
    return p && p.name ? p.name : WT.ANONYMOUS;
  }
  /** For admin actions: anonymous reviewers are told apart by their id, as in the exports. */
  function adminName(p) {
    return p && p.name ? p.name : WT.ANONYMOUS + ' (' + String((p && p.rid) || '').slice(0, 6) + ')';
  }
  function youBadge(rid) {
    return state.me && rid === state.me ? ' <span class="wt-badge wt-badge--brand wt-you">You</span>' : '';
  }
  function feat(id) {
    return WT.feature(id);
  }
  /**
   * A response's priority badge. An Exclude vote's priority is what it would be
   * if the feature were included, so it says so and isn't counted in the charts.
   */
  function prioBadge(r) {
    if (!r.priority || !WT.PRIORITY_LABEL[r.priority]) return WT.ui.badge('none', 'No priority');
    if (r.vote !== 'exclude') return WT.ui.priorityBadge(r.priority);
    return '<span class="wt-badge wt-badge--if" data-priority="' + WT.esc(r.priority) + '">' + WT.esc(WT.PRIORITY_LABEL[r.priority]) + '<span class="wt-sr-only"> priority</span> if included</span>';
  }

  /* ------------------------------------------------------------------ */
  /* Shared frame: heading, status bar, admin bar, sub-navigation        */
  /* ------------------------------------------------------------------ */

  function headInfo() {
    var f = state.sub === 'feature' ? feat(state.param) : null;
    if (state.sub === 'feature' && f) {
      return {
        eyebrow: 'Results · Feature ' + (WT.featureIndex(f.id) + 1) + ' of ' + WT.features.length + ' · ' + WT.sectionLabel(f.section),
        h1: f.title,
        lede: f.short,
        title: f.title + ' · Results'
      };
    }
    if (state.sub === 'feature') return { eyebrow: 'Results', h1: 'Feature not found', lede: '', title: 'Feature not found · Results' };
    if (state.sub === 'features') {
      return { eyebrow: 'Results · By feature', h1: 'Every feature, ranked', lede: 'Each feature with its include share, priority split and comments. Open one to see every answer and the part of the statement it refers to.', title: 'By feature · Results' };
    }
    if (state.sub === 'people') {
      return { eyebrow: 'Results · People', h1: 'Everyone’s answers', lede: 'Each reviewer’s vote and priority for every feature, side by side.', title: 'People · Results' };
    }
    return {
      eyebrow: 'Results · InfoSlips × YES',
      h1: 'What reviewers think',
      lede: 'Everyone with the link sees the same results: which features reviewers want in the production YES statement, how important each one is, and why.',
      title: 'Results'
    };
  }

  function statusBar() {
    var d = state.data;
    var counts = d
      ? '<p class="wt-rs__counts">' +
          '<span class="wt-rs__count" data-count="reviewers"><strong>' + WT.fmt.num(d.reviewers) + '</strong> ' + (d.reviewers === 1 ? 'reviewer' : 'reviewers') + '</span>' +
          '<span class="wt-rs__count" data-count="answers"><strong>' + WT.fmt.num(d.answers) + '</strong> ' + (d.answers === 1 ? 'answer' : 'answers') + '</span>' +
          '<span class="wt-rs__count" data-count="comments"><strong>' + WT.fmt.num(d.comments) + '</strong> ' + (d.comments === 1 ? 'comment' : 'comments') + '</span>' +
        '</p>'
      : state.error
        ? '<p class="wt-rs__counts"></p>'
        : '<p class="wt-rs__counts"><span class="wt-skeleton wt-skeleton--text wt-rs__sk"></span></p>';
    var stamp = d
      ? '<p class="wt-rs__updated">' + WT.icon('refresh', { size: 16 }) +
          '<span>Last updated <time class="wt-rs__time" datetime="' + WT.esc(d.generatedAt) + '" title="' + WT.esc(WT.fmt.date(d.generatedAt)) + '">' + WT.esc(clock(d.generatedAt)) + '</time>' +
          '<span class="wt-rs__auto"> · updates every 30 seconds</span></span></p>'
      : '';
    var refreshErr = state.refreshError
      ? '<p class="wt-rs__err" role="status">' + WT.icon('alert', { size: 16 }) + '<span><strong>Couldn’t refresh.</strong> Showing the last results.</span></p>'
      : '';
    return (
      '<div class="wt-rs">' +
        counts +
        '<div class="wt-rs__right">' + stamp + refreshErr +
          '<button class="wt-btn wt-btn--secondary wt-btn--sm" type="button" data-action="refresh" data-fk="refresh"' + (state.loading && state.manual ? ' aria-busy="true"' : '') + '>' +
            WT.icon('refresh', { size: 18 }) + '<span>Refresh</span></button>' +
        '</div>' +
      '</div>'
    );
  }

  function adminBar() {
    if (!admin()) return '';
    return (
      '<div class="wt-adminbar" role="region" aria-label="Admin moderation">' +
        '<p class="wt-adminbar__text">' + WT.icon('lock', { size: 18 }) +
          '<span><strong>Admin mode.</strong> Hide a reason or comment, delete a reviewer’s answers or reset all results. Changes are visible to everyone.</span></p>' +
        '<div class="wt-adminbar__actions">' +
          '<button class="wt-btn wt-btn--danger wt-btn--sm" type="button" data-mod="reset" data-fk="mod-reset">' + WT.icon('trash', { size: 18 }) + '<span>Reset all results</span></button>' +
          '<button class="wt-btn wt-btn--secondary wt-btn--sm" type="button" data-mod="signout" data-fk="mod-signout">' + WT.icon('logout', { size: 18 }) + '<span>Sign out of admin</span></button>' +
        '</div>' +
      '</div>'
    );
  }

  function subnav() {
    var cur = state.sub === 'feature' ? 'features' : state.sub;
    var items = [
      { key: 'overview', href: '#/results', label: 'Overview', icon: 'chart' },
      { key: 'features', href: '#/results/features', label: 'By feature', icon: 'list' },
      { key: 'people', href: '#/results/people', label: 'People', icon: 'users' }
    ];
    return (
      '<nav class="wt-subnav" aria-label="Results sections"><ul class="wt-subnav__list">' +
        items
          .map(function (it) {
            return (
              '<li><a class="wt-subnav__link" href="' + it.href + '" data-fk="nav-' + it.key + '"' + (cur === it.key ? ' aria-current="page"' : '') + '>' +
                WT.icon(it.icon, { size: 18 }) + '<span>' + it.label + '</span></a></li>'
            );
          })
          .join('') +
      '</ul></nav>'
    );
  }

  function frame(body) {
    var h = headInfo();
    WT.setTitle(h.title);
    return (
      '<div class="wt-container wt-results" data-sub="' + WT.esc(state.sub) + '">' +
        '<header class="wt-results__head">' +
          '<div class="wt-results__intro">' +
            '<p class="wt-eyebrow">' + WT.esc(h.eyebrow) + '</p>' +
            '<h1 class="wt-title wt-results__h1" tabindex="-1" data-fk="h1">' + WT.esc(h.h1) + '</h1>' +
            (h.lede ? '<p class="wt-lead wt-results__lede">' + WT.esc(h.lede) + '</p>' : '') +
          '</div>' +
          '<div class="wt-results__exports" role="group" aria-label="Export all answers">' +
            '<a class="wt-btn wt-btn--secondary wt-btn--sm" href="' + WT.esc(WT.api.exportUrl('csv')) + '" download data-export="csv" data-fk="export-csv">' + WT.icon('download', { size: 18 }) + '<span>Export CSV</span></a>' +
            '<a class="wt-btn wt-btn--secondary wt-btn--sm" href="' + WT.esc(WT.api.exportUrl('json')) + '" download data-export="json" data-fk="export-json">' + WT.icon('download', { size: 18 }) + '<span>Export JSON</span></a>' +
          '</div>' +
        '</header>' +
        statusBar() +
        WT.brandNotice({ compact: true }) +
        adminBar() +
        subnav() +
        '<div class="wt-results__body' + (state.loading && state.manual && state.data ? ' is-refreshing' : '') + '">' + body + '</div>' +
      '</div>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* States                                                              */
  /* ------------------------------------------------------------------ */

  function loadingBody() {
    return (
      '<div class="wt-results__loading">' +
        '<div class="wt-kpis">' +
          [1, 2, 3, 4].map(function () {
            return '<div class="wt-card wt-kpi">' + WT.ui.skeleton({ lines: 1, label: 'Loading results…' }) + '</div>';
          }).join('') +
        '</div>' +
        '<div class="wt-card">' + WT.ui.skeleton({ lines: 4, block: true, label: 'Loading charts…' }) + '</div>' +
      '</div>'
    );
  }

  /**
   * An error message that asks to try again exactly once: the server's own
   * messages often end with "Please try again." (or "Try again in 5 minutes.").
   */
  function tryAgain(message) {
    var base = String(message || 'Something went wrong.').trim();
    if (!/[.!?]$/.test(base)) base += '.';
    return /\btry again\b/i.test(base) ? base : base + ' Please try again.';
  }

  function errorBody() {
    var e = state.error || {};
    var msg = e.status === 0 ? 'We couldn’t reach the server. Check your connection and try again.' : tryAgain(e.message);
    return (
      '<div class="wt-results__error">' +
        WT.ui.notice({ kind: 'error', title: 'We couldn’t load the results.', text: msg }) +
        '<p><button class="wt-btn wt-btn--primary" type="button" data-action="retry" data-fk="retry">' + WT.icon('refresh') + '<span>Try again</span></button></p>' +
      '</div>'
    );
  }

  function emptyBody() {
    return (
      '<div class="wt-empty wt-results__empty">' +
        WT.icon('chart', { size: 40, cls: 'wt-empty__icon' }) +
        '<h2 class="wt-results__empty-h">No answers yet — be the first: <a href="#/tour" data-fk="empty-start">start the walkthrough</a></h2>' +
        '<p>Results appear here as soon as someone answers. This page checks for new answers every 30 seconds.</p>' +
      '</div>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* Overview                                                            */
  /* ------------------------------------------------------------------ */

  function kpis(rows) {
    var d = state.data;
    var majority = rows.filter(wanted).length;
    var reasons = rows.reduce(function (s, r) {
      return s + r.reasons;
    }, 0);
    var avg = d.reviewers ? Math.round((d.answers / d.reviewers) * 10) / 10 : 0;
    var tiles = [
      { key: 'reviewers', label: 'Reviewers', value: d.reviewers, sub: 'people who answered at least one feature', icon: 'users' },
      { key: 'answers', label: 'Answers', value: d.answers, sub: 'about ' + avg.toLocaleString('en-GB') + ' per reviewer, across ' + WT.features.length + ' features', icon: 'check-circle' },
      { key: 'comments', label: 'Comments', value: d.comments, sub: 'plus ' + WT.fmt.plural(reasons, 'reason') + ' given with votes', icon: 'comment' },
      { key: 'majority', label: WANTED.label, value: majority, sub: 'of ' + WT.features.length + ' (' + WANTED.rule + ')', icon: 'target' }
    ];
    return (
      '<ul class="wt-kpis" role="list" aria-label="Key numbers">' +
        tiles
          .map(function (t) {
            return (
              '<li class="wt-card wt-kpi" data-kpi="' + t.key + '">' +
                '<span class="wt-kpi__label">' + WT.icon(t.icon, { size: 18 }) + WT.esc(t.label) + '</span>' +
                '<span class="wt-kpi__value">' + WT.fmt.num(t.value) + '</span>' +
                '<span class="wt-kpi__sub">' + WT.esc(t.sub) + '</span>' +
              '</li>'
            );
          })
          .join('') +
      '</ul>'
    );
  }

  function overview() {
    var rows = model(state.data);
    var sum = sentences(rows);
    var sup = WT.charts.support(rows.slice().sort(bySupport));
    var mix = WT.charts.priorityMix(rows.slice().sort(byMix));
    var sr = scoreRows(rows);
    var sc = WT.charts.scoreRank(sr);
    var noPrio = rows.filter(function (r) {
      return r.include > 0 && r.score === null;
    });
    return (
      '<div class="wt-ov">' +
        '<section class="wt-ov__top" aria-labelledby="sum-h">' +
          '<div class="wt-card wt-sum">' +
            '<h2 class="wt-sum__h" id="sum-h">' + WT.icon('sparkle', { size: 22 }) + '<span>In summary</span></h2>' +
            '<ul class="wt-sum__list" role="list">' +
              sum
                .map(function (s) {
                  return '<li class="wt-sum__item" data-summary="' + s.key + '">' + WT.icon(s.icon, { size: 20, cls: 'wt-sum__icon' }) + '<p>' + s.html + '</p></li>';
                })
                .join('') +
            '</ul>' +
          '</div>' +
          kpis(rows) +
        '</section>' +
        '<section class="wt-ov__charts" aria-labelledby="charts-h">' +
          '<h2 class="wt-ov__h" id="charts-h">In charts</h2>' +
          WT.charts.figure({
            id: 'support',
            title: 'Support by feature',
            desc: 'Votes to exclude (left) and include (right), sorted by net support: include minus exclude. Select a feature to see every answer.',
            legend: sup.legend,
            chart: sup.chart,
            table: sup.table,
            showTable: state.tables.support
          }) +
          '<div class="wt-ov__pair">' +
            WT.charts.figure({
              id: 'mix',
              title: 'Priority mix',
              desc: 'High, Medium and Low as a share of the reviewers who set a priority. Priorities come only from reviewers who didn’t vote Exclude. The number on the right is how many set a priority (Exclude votes not counted).',
              legend: mix.legend,
              chart: mix.chart,
              table: mix.table,
              showTable: state.tables.mix
            }) +
            WT.charts.figure({
              id: 'score',
              title: 'Priority score ranking',
              desc: 'Average priority, where High is 3, Medium 2 and Low 1, for features with at least one include vote. Exclude votes are not counted.',
              legend: '',
              chart: sr.length ? sc.chart : '<p class="wt-chart__empty">No feature has an include vote with a priority yet.</p>',
              table: sr.length ? sc.table : '<p class="wt-chart__empty">No feature has an include vote with a priority yet.</p>',
              showTable: state.tables.score,
              note: noPrio.length
                ? WT.esc(WT.fmt.plural(noPrio.length, 'feature') + ' with include votes ' + (noPrio.length === 1 ? 'has' : 'have') + ' no priority yet: ') +
                  noPrio.map(function (r) { return WT.esc(r.title); }).join(', ') + '.'
                : ''
            }) +
          '</div>' +
        '</section>' +
        '<p class="wt-ov__more"><a class="wt-btn wt-btn--secondary" href="#/results/features" data-fk="ov-more">' +
          '<span>See every feature ranked</span>' + WT.icon('arrow-right') + '</a></p>' +
      '</div>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* By feature: ranking cards                                           */
  /* ------------------------------------------------------------------ */

  function features() {
    var rows = model(state.data);
    var sort = SORTS[state.sort] ? state.sort : 'support';
    rows.sort(SORTS[sort].fn);
    var options = Object.keys(SORTS)
      .map(function (k) {
        return '<option value="' + k + '"' + (k === sort ? ' selected' : '') + '>' + WT.esc(SORTS[k].label) + '</option>';
      })
      .join('');
    var items = rows
      .map(function (r, i) {
        var p = r.priority;
        return (
          '<li class="wt-card wt-rank__item" data-id="' + WT.esc(r.id) + '">' +
            '<span class="wt-rank__n"><span class="wt-sr-only">Rank </span>' + (i + 1) + '</span>' +
            '<button class="wt-rank__thumb" type="button" data-shot="' + WT.esc(r.id) + '" data-fk="shot-' + WT.esc(r.id) + '" aria-label="Open the screenshot of ' + WT.esc(r.title) + '">' +
              WT.charts.shotBox({ id: r.id, thumb: true, alt: '' }) +
              '<span class="wt-rank__zoom" aria-hidden="true">' + WT.icon('expand', { size: 14 }) + '</span>' +
            '</button>' +
            '<div class="wt-rank__main">' +
              '<h2 class="wt-rank__title"><a href="#/results/' + encodeURIComponent(r.id) + '" data-fk="rank-' + WT.esc(r.id) + '">' + WT.esc(r.title) + '</a></h2>' +
              '<p class="wt-rank__section">' + WT.esc(WT.sectionLabel(r.section)) + '</p>' +
            '</div>' +
            '<dl class="wt-rank__stats">' +
              '<div class="wt-rank__stat wt-rank__stat--include"><dt>Include</dt><dd>' +
                '<span class="wt-rank__big" data-stat="include">' + (r.votes ? WT.fmt.pct(r.include, r.votes) : '–') + '</span>' +
                '<span class="wt-rank__small" data-stat="votes">' + (r.votes ? '(' + r.include + ' of ' + WT.fmt.plural(r.votes, 'vote') + ')' : 'No votes yet') + '</span>' +
                WT.charts.spark(r, 'votes') +
              '</dd></div>' +
              '<div class="wt-rank__stat wt-rank__stat--prio"><dt>Priority</dt><dd>' +
                '<span class="wt-rank__split" data-stat="priority">' +
                  '<span>High ' + p.high + '</span><span aria-hidden="true"> · </span><span>Medium ' + p.medium + '</span><span aria-hidden="true"> · </span><span>Low ' + p.low + '</span>' +
                '</span>' +
                WT.charts.spark(r, 'priority') +
              '</dd></div>' +
              '<div class="wt-rank__stat wt-rank__stat--comments"><dt>Comments</dt><dd>' +
                WT.icon('comment', { size: 16 }) + '<span data-stat="comments">' + r.comments + '</span>' +
              '</dd></div>' +
            '</dl>' +
            WT.icon('chevron-right', { cls: 'wt-rank__chev' }) +
          '</li>'
        );
      })
      .join('');
    return (
      '<div class="wt-rank">' +
        '<div class="wt-rank__tools">' +
          '<p class="wt-rank__count">' + WT.fmt.plural(rows.length, 'feature') + '</p>' +
          '<div class="wt-rank__sort"><label class="wt-label" for="rank-sort">Sort by</label>' +
            '<select class="wt-select" id="rank-sort" data-sort data-fk="rank-sort">' + options + '</select></div>' +
        '</div>' +
        '<div class="wt-rank__cols" aria-hidden="true"><span>Rank</span><span></span><span>Feature</span><span>Include</span><span>Priority</span><span>Comments</span><span></span></div>' +
        '<ol class="wt-rank__list" role="list" aria-label="Features ranked by ' + WT.esc(SORTS[sort].label.toLowerCase()) + '">' + items + '</ol>' +
      '</div>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* Feature detail                                                      */
  /* ------------------------------------------------------------------ */

  function responseHtml(r, fid, isAdmin) {
    var who = nameOf(r);
    var part = function (field, label) {
      var text = r[field];
      var hidden = field === 'reason' ? r.hiddenReason : r.hiddenComment;
      var has = (text && String(text).trim()) || hidden;
      if (!has) return '';
      var body;
      if (text === null || text === undefined) {
        body = '<p class="wt-resp__text wt-resp__text--hidden">' + WT.ui.badge('hidden', 'Hidden by admin', 'eye-off') + '</p>';
      } else {
        body = '<p class="wt-resp__text">' + WT.esc(text) + '</p>' + (hidden ? '<p class="wt-resp__flag">' + WT.ui.badge('hidden', 'Hidden from everyone else', 'eye-off') + '</p>' : '');
      }
      var mod = isAdmin
        ? '<button class="wt-btn wt-btn--link wt-btn--sm wt-resp__mod" type="button" data-mod="hide" data-rid="' + WT.esc(r.rid) + '" data-feature="' + WT.esc(fid) + '" data-field="' + field + '" data-hidden="' + (hidden ? '0' : '1') + '" data-fk="hide-' + WT.esc(r.rid) + '-' + field + '">' +
            WT.icon(hidden ? 'eye' : 'eye-off', { size: 16 }) + '<span>' + (hidden ? 'Unhide ' : 'Hide ') + (field === 'reason' ? 'reason' : 'comment') + '</span></button>'
        : '';
      return '<div class="wt-resp__part wt-resp__part--' + field + '"><p class="wt-resp__label">' + label + '</p>' + body + mod + '</div>';
    };
    var parts = part('reason', 'Why') + part('comment', 'Comment');
    return (
      '<li class="wt-card wt-resp" data-rid="' + WT.esc(r.rid) + '">' +
        '<div class="wt-resp__head">' +
          '<span class="wt-avatar' + (r.name ? '' : ' wt-avatar--anon') + '" aria-hidden="true">' + (r.name ? WT.esc(initials(r.name)) : WT.icon('user', { size: 18 })) + '</span>' +
          '<div class="wt-resp__who">' +
            '<h3 class="wt-resp__name">' + WT.esc(who) + youBadge(r.rid) + '</h3>' +
            '<p class="wt-resp__time"><time datetime="' + WT.esc(r.updatedAt) + '">' + WT.esc(WT.fmt.relative(r.updatedAt)) + '</time>' +
              '<span aria-hidden="true"> · </span><span class="wt-resp__abs">' + WT.esc(WT.fmt.date(r.updatedAt)) + '</span></p>' +
          '</div>' +
          '<div class="wt-resp__badges">' + WT.ui.voteBadge(r.vote) + prioBadge(r) + '</div>' +
        '</div>' +
        (parts ? '<div class="wt-resp__body">' + parts + '</div>' : '<p class="wt-resp__nothing">No reason or comment.</p>') +
        (isAdmin
          ? '<div class="wt-resp__admin"><button class="wt-btn wt-btn--secondary wt-btn--sm" type="button" data-mod="delete" data-rid="' + WT.esc(r.rid) + '" data-name="' + WT.esc(adminName(r)) + '" data-fk="del-' + WT.esc(r.rid) + '">' +
              WT.icon('trash', { size: 16 }) + '<span>Delete all answers from ' + WT.esc(adminName(r)) + '</span></button></div>'
          : '') +
      '</li>'
    );
  }

  function aboutHtml(f) {
    var s = WT.steps && WT.steps[f.id];
    var bullets = function (title, list) {
      if (!list || !list.length) return '';
      return '<h3 class="wt-detail__h3">' + WT.esc(title) + '</h3><ul class="wt-detail__bullets">' + list.map(function (b) {
        return '<li>' + WT.esc(b) + '</li>';
      }).join('') + '</ul>';
    };
    return (
      '<section class="wt-card wt-detail__about" aria-labelledby="about-h">' +
        '<h2 class="wt-detail__h2" id="about-h">About this feature</h2>' +
        '<p class="wt-detail__what">' + WT.esc(s && s.what ? s.what : f.short) + '</p>' +
        (s ? bullets('Value for YES', s.valueYes) + bullets('Value for your customers', s.valueCustomer) : '') +
      '</section>'
    );
  }

  function featureDetail() {
    var f = feat(state.param);
    if (!f) {
      return (
        '<div class="wt-empty">' + WT.icon('search', { size: 40, cls: 'wt-empty__icon' }) +
          '<h2>We couldn’t find that feature</h2>' +
          '<p>It may have been renamed. <a href="#/results/features">See every feature</a>.</p>' +
        '</div>'
      );
    }
    var rows = model(state.data);
    var r = rows[WT.featureIndex(f.id)];
    var ranked = rows.slice().sort(bySupport);
    var rank = ranked.indexOf(r) + 1;
    var isAdmin = admin();
    var idx = WT.featureIndex(f.id);
    var prev = idx > 0 ? WT.features[idx - 1] : null;
    var next = idx < WT.features.length - 1 ? WT.features[idx + 1] : null;
    var stats = [
      { k: 'include', label: 'Include share', v: r.votes ? WT.fmt.pct(r.include, r.votes) : '–', sub: r.votes ? r.include + ' of ' + WT.fmt.plural(r.votes, 'vote') : 'No votes yet' },
      { k: 'votes', label: 'Votes', v: r.include + ' / ' + r.exclude, sub: 'include / exclude' + (r.undecided ? ' · ' + r.undecided + ' without a vote' : '') },
      { k: 'score', label: 'Priority score', v: WT.charts.scoreText(r.score), sub: r.pn ? 'of 3, from ' + WT.fmt.plural(r.pn, 'priority response') : 'No priorities yet' },
      { k: 'rank', label: 'Support rank', v: r.votes ? String(rank) : '–', sub: 'of ' + WT.features.length + ' features' },
      { k: 'comments', label: 'Comments', v: String(r.comments), sub: WT.fmt.plural(r.reasons, 'reason') + ' given' }
    ];
    var responses = r.responses.length
      ? '<ol class="wt-resps" role="list">' + r.responses.map(function (x) {
          return responseHtml(x, f.id, isAdmin);
        }).join('') + '</ol>'
      : '<div class="wt-empty wt-empty--sm">' + WT.icon('comment', { size: 32, cls: 'wt-empty__icon' }) +
          '<p>No answers for this feature yet — be the first: <a href="#/tour/' + encodeURIComponent(f.id) + '">give your view in the walkthrough</a>.</p></div>';
    return (
      '<div class="wt-detail">' +
        '<div class="wt-detail__grid">' +
          '<div class="wt-detail__media">' +
            '<figure class="wt-card wt-detail__shot">' +
              '<button class="wt-detail__shotbtn" type="button" data-shot="' + WT.esc(f.id) + '" data-fk="detail-shot">' +
                WT.charts.shotBox({ id: f.id, alt: f.title + ' in the YES statement', eager: true }) +
                '<span class="wt-detail__zoom">' + WT.icon('expand', { size: 16 }) + '<span>Enlarge</span></span>' +
              '</button>' +
              '<figcaption class="wt-caption">This part of the interactive YES statement. YES branding is a placeholder.</figcaption>' +
            '</figure>' +
            '<div class="wt-detail__links">' +
              '<a class="wt-btn wt-btn--primary" href="#/tour/' + encodeURIComponent(f.id) + '" data-fk="detail-tour">' + WT.icon('play', { size: 18 }) + '<span>See it in the walkthrough</span></a>' +
              '<a class="wt-btn wt-btn--secondary" href="#/data/' + encodeURIComponent(f.id) + '" data-fk="detail-data">' + WT.icon('braces', { size: 18 }) + '<span>Data requirements</span></a>' +
            '</div>' +
          '</div>' +
          '<div class="wt-detail__side">' +
            '<section class="wt-card wt-detail__glance" aria-labelledby="glance-h">' +
              '<h2 class="wt-detail__h2" id="glance-h">At a glance</h2>' +
              '<dl class="wt-glance">' +
                stats.map(function (s) {
                  return '<div class="wt-glance__item" data-glance="' + s.k + '"><dt>' + WT.esc(s.label) + '</dt><dd><span class="wt-glance__v">' + WT.esc(s.v) + '</span><span class="wt-glance__sub">' + WT.esc(s.sub) + '</span></dd></div>';
                }).join('') +
              '</dl>' +
              '<figure class="wt-detail__mini" aria-label="Votes and priorities for ' + WT.esc(f.title) + '">' +
                WT.charts.mini(r) +
                '<figcaption class="wt-sr-only">The numbers above, as bars.</figcaption>' +
              '</figure>' +
            '</section>' +
          '</div>' +
          aboutHtml(f) +
        '</div>' +
        '<section class="wt-detail__responses" aria-labelledby="resp-h">' +
          '<h2 class="wt-detail__h2" id="resp-h" tabindex="-1">Responses <span class="wt-badge wt-badge--neutral">' + r.responses.length + '</span></h2>' +
          responses +
        '</section>' +
        '<nav class="wt-detail__pager" aria-label="Other features">' +
          (prev ? '<a class="wt-detail__pg wt-detail__pg--prev" href="#/results/' + encodeURIComponent(prev.id) + '" data-fk="pg-prev">' + WT.icon('arrow-left', { size: 18 }) + '<span><span class="wt-detail__pg-k">Previous feature</span><span class="wt-detail__pg-t">' + WT.esc(prev.title) + '</span></span></a>' : '<span></span>') +
          (next ? '<a class="wt-detail__pg wt-detail__pg--next" href="#/results/' + encodeURIComponent(next.id) + '" data-fk="pg-next"><span><span class="wt-detail__pg-k">Next feature</span><span class="wt-detail__pg-t">' + WT.esc(next.title) + '</span></span>' + WT.icon('arrow-right', { size: 18 }) + '</a>' : '') +
        '</nav>' +
      '</div>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* People matrix                                                       */
  /* ------------------------------------------------------------------ */

  function cell(resp, f) {
    if (!resp) {
      return '<td class="wt-mx wt-mx--na"><span class="wt-mx__chip" aria-hidden="true">–</span><span class="wt-sr-only">' + WT.esc(f.title) + ': not answered</span></td>';
    }
    var v = resp.vote;
    var p = WT.PRIORITY_LABEL[resp.priority] ? resp.priority : null;
    var sym = v === 'include' ? '✓' : v === 'exclude' ? '✗' : '–';
    // An Exclude vote's priority only applies "if included": shown in brackets, never counted.
    var cond = v === 'exclude' && p;
    var letter = p ? p.charAt(0).toUpperCase() : '';
    var text = (v ? WT.VOTE_LABEL[v] : 'No vote') + (p ? ', ' + WT.PRIORITY_LABEL[p] + ' priority' + (cond ? ' if included' : '') : ', no priority') + ((resp.comment && String(resp.comment).trim()) || resp.hiddenComment ? ', with a comment' : '');
    return (
      '<td class="wt-mx wt-mx--' + (v || 'none') + '" data-feature="' + WT.esc(f.id) + '">' +
        '<span class="wt-mx__chip" aria-hidden="true"><span class="wt-mx__sym">' + sym + '</span>' + (p ? '<span class="wt-mx__p' + (cond ? ' wt-mx__p--if' : '') + '">' + (cond ? '(' + letter + ')' : letter) + '</span>' : '') + '</span>' +
        '<span class="wt-sr-only">' + WT.esc(f.title) + ': ' + WT.esc(text) + '</span>' +
      '</td>'
    );
  }

  function people() {
    var d = state.data;
    var isAdmin = admin();
    var byRid = {};
    WT.features.forEach(function (f) {
      var x = d.features[f.id];
      (x ? x.responses : []).forEach(function (resp) {
        (byRid[resp.rid] = byRid[resp.rid] || {})[f.id] = resp;
      });
    });
    var head =
      '<tr><th scope="col" class="wt-mx__corner">Reviewer</th>' +
      WT.features.map(function (f, i) {
        return '<th scope="col" class="wt-mx__fh"><a href="#/results/' + encodeURIComponent(f.id) + '" data-fk="mxh-' + WT.esc(f.id) + '"><span class="wt-mx__fn">' + (i + 1) + '</span><span class="wt-mx__ft">' + WT.esc(f.title) + '</span></a></th>';
      }).join('') +
      '<th scope="col" class="is-num wt-mx__total">Answered</th></tr>';
    var body = d.people
      .map(function (p) {
        var answers = byRid[p.rid] || {};
        return (
          '<tr data-rid="' + WT.esc(p.rid) + '">' +
            '<th scope="row" class="wt-mx__who">' +
              '<span class="wt-mx__name">' + WT.esc(nameOf(p)) + youBadge(p.rid) + '</span>' +
              '<span class="wt-mx__meta"><time datetime="' + WT.esc(p.updatedAt) + '" title="' + WT.esc(WT.fmt.date(p.updatedAt)) + '">' + WT.esc(WT.fmt.relative(p.updatedAt)) + '</time></span>' +
              (isAdmin
                ? '<button class="wt-btn wt-btn--link wt-btn--sm wt-mx__del" type="button" data-mod="delete" data-rid="' + WT.esc(p.rid) + '" data-name="' + WT.esc(adminName(p)) + '" data-fk="mxdel-' + WT.esc(p.rid) + '">' +
                    WT.icon('trash', { size: 14 }) + '<span>Delete answers<span class="wt-sr-only"> from ' + WT.esc(adminName(p)) + '</span></span></button>'
                : '') +
            '</th>' +
            WT.features.map(function (f) {
              return cell(answers[f.id], f);
            }).join('') +
            '<td class="is-num wt-mx__total">' + p.answered + '<span class="wt-muted"> / ' + WT.features.length + '</span></td>' +
          '</tr>'
        );
      })
      .join('');
    var legend =
      '<ul class="wt-mx-legend" role="list" aria-label="Key">' +
        '<li><span class="wt-mx__chip wt-mx__chip--include" aria-hidden="true">✓</span>Include</li>' +
        '<li><span class="wt-mx__chip wt-mx__chip--exclude" aria-hidden="true">✗</span>Exclude</li>' +
        '<li><span class="wt-mx__chip wt-mx__chip--none" aria-hidden="true">–</span>No vote or not answered</li>' +
        '<li><span class="wt-mx__letter" aria-hidden="true">H</span><span class="wt-mx__letter" aria-hidden="true">M</span><span class="wt-mx__letter" aria-hidden="true">L</span>High, Medium or Low priority</li>' +
        '<li><span class="wt-mx__chip wt-mx__chip--exclude" aria-hidden="true"><span class="wt-mx__sym">✗</span><span class="wt-mx__p wt-mx__p--if">(H)</span></span>Exclude, with the priority if it were included (not counted)</li>' +
      '</ul>';
    return (
      '<div class="wt-people">' +
        '<p class="wt-people__intro">' + WT.fmt.plural(d.people.length, 'reviewer') + ', newest activity first. Features are in walkthrough order; scroll sideways to see them all, and select a feature for its answers.</p>' +
        legend +
        WT.ui.tableWrap(
          '<table class="wt-table wt-table--sticky-col wt-table--compact wt-mx-table"><caption class="wt-sr-only">Each reviewer’s vote and priority for every feature</caption>' +
            '<thead>' + head + '</thead><tbody>' + body + '</tbody></table>',
          'Reviewers by feature',
          'wt-mx-wrap'
        ) +
      '</div>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* Drawing                                                             */
  /* ------------------------------------------------------------------ */

  function visible() {
    var r = WT.route();
    return !!(r && r.view === 'results');
  }

  function bodyHtml() {
    if (!state.data) return state.error ? errorBody() : loadingBody();
    if (state.sub === 'feature') return featureDetail();
    if (!state.data.reviewers) return emptyBody();
    if (state.sub === 'people') return people();
    if (state.sub === 'features') return features();
    return overview();
  }

  function draw() {
    if (!section || !visible()) return;
    WT.charts.hideTip();
    WT.render(section, frame(bodyHtml()));
    WT.charts.apply(section);
    section.setAttribute('aria-busy', state.data || state.error ? 'false' : 'true');
  }

  function updateStamp() {
    if (!section || !state.data) return;
    var t = section.querySelector('.wt-rs__time');
    if (t) {
      t.setAttribute('datetime', state.data.generatedAt);
      t.setAttribute('title', WT.fmt.date(state.data.generatedAt));
      t.textContent = clock(state.data.generatedAt);
    }
    var err = section.querySelector('.wt-rs__err');
    if (err && !state.refreshError) err.remove();
  }

  function signature(d) {
    return JSON.stringify([d.admin, d.reviewers, d.answers, d.comments, d.features, d.people]);
  }

  function countsText(d) {
    return WT.fmt.plural(d.reviewers, 'reviewer') + ', ' + WT.fmt.plural(d.answers, 'answer') + ' and ' + WT.fmt.plural(d.comments, 'comment');
  }

  /**
   * Fetch results. opts: { manual, force }. Resolves with the data (or null on
   * failure). A plain call joins the newest request in flight. A forced call
   * must reflect every change made before it (a save, a deletion), so while an
   * older request is in flight it queues one more request after it; forced
   * calls that arrive meanwhile share that queued request.
   */
  function load(opts) {
    opts = opts || {};
    if (state.loading) {
      if (!opts.force) return state.queued || state.loading;
      if (!state.queued) {
        var next = function () {
          state.queued = null;
          return load(opts);
        };
        state.queued = state.loading.then(next, next);
      }
      return state.queued;
    }
    state.manual = !!opts.manual;
    var asAdmin = WT.api.admin.signedIn();
    var p = WT.api.results({ admin: asAdmin }).then(
      function (data) {
        var prev = state.data;
        var sig = signature(data);
        var changed = sig !== state.sig;
        state.loading = null;
        state.data = data;
        state.sig = sig;
        state.loadedAt = Date.now();
        state.error = null;
        state.refreshError = null;
        WT.emit('results', data);
        if (visible()) {
          if (changed || opts.force || opts.manual || !prev) draw();
          else updateStamp();
          var moved = prev && (prev.reviewers !== data.reviewers || prev.answers !== data.answers || prev.comments !== data.comments);
          if (moved) WT.announce('Results updated: ' + countsText(data) + '.');
          else if (opts.manual) WT.announce('Results are up to date.');
        }
        state.manual = false;
        return data;
      },
      function (err) {
        state.loading = null;
        state.manual = false;
        if (state.data) state.refreshError = err;
        else state.error = err;
        if (visible()) {
          draw();
          if (opts.manual && state.data) WT.announce('We couldn’t refresh the results. Showing the last ones.');
        }
        return null;
      }
    );
    state.loading = p;
    if (opts.manual && visible()) {
      var btn = section && section.querySelector('[data-action="refresh"]');
      if (btn) btn.setAttribute('aria-busy', 'true');
      var body = section && section.querySelector('.wt-results__body');
      if (body && state.data) body.classList.add('is-refreshing');
    }
    return p;
  }

  /* ------------------------------------------------------------------ */
  /* Auto-refresh                                                        */
  /* ------------------------------------------------------------------ */

  function refreshMs() {
    return WT.results && WT.results.refreshMs > 0 ? WT.results.refreshMs : 30000;
  }
  function stop() {
    clearTimeout(state.timer);
    state.timer = null;
  }
  function schedule() {
    stop();
    if (!visible() || doc.visibilityState === 'hidden') return;
    state.timer = setTimeout(tick, refreshMs());
  }
  function tick() {
    state.timer = null;
    if (!visible() || doc.visibilityState === 'hidden') return;
    load().then(schedule, schedule);
  }

  /* ------------------------------------------------------------------ */
  /* Screenshot dialog                                                   */
  /* ------------------------------------------------------------------ */

  var shotDlg = null;
  function openShot(id, trigger) {
    var f = feat(id);
    if (!f) return;
    shotDlg = WT.dialog.create({
      id: 'wt-shot-dialog',
      title: f.title,
      size: 'lg',
      body:
        '<figure class="wt-shotdlg">' +
          WT.charts.shotBox({ id: f.id, alt: f.title + ' in the YES statement', eager: true, cls: 'wt-shotdlg__box' }) +
          '<figcaption class="wt-caption">' + WT.esc(f.short) + ' YES branding is a placeholder.</figcaption>' +
        '</figure>',
      foot:
        (state.sub !== 'feature' || state.param !== f.id
          ? '<a class="wt-btn wt-btn--secondary" href="#/results/' + encodeURIComponent(f.id) + '" data-wt-close="go">' + WT.icon('comment', { size: 18 }) + '<span>See the answers</span></a>'
          : '') +
        '<a class="wt-btn wt-btn--primary" href="#/tour/' + encodeURIComponent(f.id) + '" data-wt-close="go">' + WT.icon('play', { size: 18 }) + '<span>See it in the walkthrough</span></a>'
    });
    WT.charts.watchImages(shotDlg);
    WT.dialog.open(shotDlg, { trigger: trigger, lightDismiss: true, initialFocus: '.wt-dialog__close' });
  }

  /* ------------------------------------------------------------------ */
  /* Module                                                              */
  /* ------------------------------------------------------------------ */

  function setRoute(param) {
    state.param = param || '';
    state.sub = !param ? 'overview' : SUBS[param] ? SUBS[param] : 'feature';
  }

  function show(param) {
    setRoute(param);
    WT.reviewer.rid().then(function (rid) {
      if (rid !== state.me) {
        state.me = rid;
        if (state.data && visible()) draw();
      }
    });
    draw();
    var stale = !state.data || Date.now() - state.loadedAt > 10000 || (WT.api.admin.signedIn() && !state.data.admin);
    var p = stale ? load({ force: true }) : Promise.resolve(state.data);
    return p.then(function () {
      schedule();
    });
  }

  function onAction(e) {
    var t = e.target.closest && e.target.closest('[data-action], [data-shot], [data-mod]');
    if (!t || !section.contains(t)) return;
    if (t.hasAttribute('data-action')) {
      var a = t.getAttribute('data-action');
      if (a === 'refresh' || a === 'retry') {
        if (a === 'retry') {
          state.error = null;
          draw();
        }
        load({ manual: a === 'refresh', force: true }).then(schedule, schedule);
      }
      return;
    }
    if (t.hasAttribute('data-shot')) {
      openShot(t.getAttribute('data-shot'), t);
      return;
    }
    var mod = t.getAttribute('data-mod');
    if (!WT.moderation) return;
    if (mod === 'hide') {
      WT.moderation.hide({ rid: t.getAttribute('data-rid'), featureId: t.getAttribute('data-feature'), field: t.getAttribute('data-field'), hidden: t.getAttribute('data-hidden') === '1' }, t);
    } else if (mod === 'delete') {
      WT.moderation.deleteReviewer(t.getAttribute('data-rid'), t.getAttribute('data-name'), t);
    } else if (mod === 'reset') {
      WT.moderation.reset(t);
    } else if (mod === 'signout') {
      WT.moderation.signOut();
    }
  }

  /** Drop hidden text from cached admin results (after signing out). */
  function scrub(d) {
    if (!d || !d.admin) return d;
    var c = JSON.parse(JSON.stringify(d));
    c.admin = false;
    Object.keys(c.features || {}).forEach(function (id) {
      (c.features[id].responses || []).forEach(function (r) {
        if (r.hiddenReason) r.reason = null;
        if (r.hiddenComment) r.comment = null;
      });
    });
    return c;
  }

  WT.results = {
    refreshMs: 30000,
    /** Fetch now. { manual, force } */
    load: load,
    /** The last results object (or null). */
    data: function () {
      return state.data;
    },
    /** Rows and sentences used by the page (tests and other modules). */
    model: function () {
      return state.data ? model(state.data) : [];
    },
    sentences: function () {
      return state.data ? sentences(model(state.data)) : [];
    },
    /** True when a feature's stats ({ include, exclude }) have more include than exclude votes. */
    wanted: wanted,
    /** How "wanted" is named everywhere: { label, rule, full }. */
    WANTED: WANTED,
    /** Priority counts that ignore Exclude votes, from a features[id] object. */
    priorityOf: priorityOf,
    /** An error message that says "Please try again." once at most. */
    tryAgain: tryAgain
  };

  WT.register({
    name: 'results',
    view: 'results',
    init: function () {
      section = doc.getElementById('view-results');
      if (!section) return;
      WT.charts.bind(section, function (id, on) {
        state.tables[id] = on;
      });
      section.addEventListener('click', onAction);
      section.addEventListener('change', function (e) {
        if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-sort')) {
          state.sort = e.target.value;
          draw();
          WT.announce('Sorted by ' + (SORTS[state.sort] ? SORTS[state.sort].label.toLowerCase() : 'net support') + '.');
        }
      });
      doc.addEventListener('visibilitychange', function () {
        if (!visible()) return;
        if (doc.visibilityState === 'hidden') stop();
        else if (Date.now() - state.loadedAt >= refreshMs()) tick();
        else schedule();
      });
      WT.on('admin', function (on) {
        if (!on && state.data && state.data.admin) {
          state.data = scrub(state.data);
          state.sig = signature(state.data);
        }
        if (visible()) {
          draw();
          load({ force: true });
        } else {
          state.loadedAt = 0;
        }
      });
      WT.on('moderated', function () {
        state.loadedAt = 0;
        if (visible()) load({ force: true });
      });
      // A save that lands while the results are on screen (say, the last answer
      // of the walkthrough, or one made in another tab's tour) shows up straight
      // away instead of at the next poll. Debounced, since saves come in bursts;
      // forced, so a request already in flight from before the save is not reused.
      var refreshAfterSave = WT.debounce(function () {
        if (!visible() || doc.visibilityState === 'hidden') return;
        load({ force: true }).then(schedule, schedule);
      }, 400);
      WT.on('saved', function (s) {
        if (!s || !s.ok) return;
        state.loadedAt = 0;
        if (visible()) refreshAfterSave();
      });
      WT.on('reviewer', function () {
        WT.reviewer.rid().then(function (rid) {
          if (rid !== state.me) {
            state.me = rid;
            if (visible() && state.data) draw();
          }
        });
      });
    },
    render: function (param) {
      return show(param);
    },
    onRoute: function (param) {
      return show(param);
    },
    leave: function () {
      stop();
      WT.charts.hideTip();
    }
  });
})(window.WT = window.WT || {});
