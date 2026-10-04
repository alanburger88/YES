/*
 * 51-charts.js — chart builders for the results view (SPEC section 8). Owner: results.
 *
 * Charts are list-based HTML (an <ol> per chart, one <li> per feature) whose
 * marks are spans sized from JS with el.style.setProperty (the CSP forbids
 * style="" in markup). Every chart sits in a <figure> with a <figcaption>, a
 * legend, a "Show as table" toggle and a table that is the source of truth.
 * Marks are aria-hidden; each row carries its values as screen-reader text.
 *
 * Colour (brand palette only, SPEC section 4; validated with the dataviz
 * skill's validate_palette.js and re-checked in the browser by
 * tests/50-results.test.mjs). Charts always sit on a card: white in light mode,
 * Slate 2 #334155 in dark mode. Every mark is >= 3:1 against that surface:
 *
 *   role      light (on #FFFFFF)            dark (on #334155)
 *   include   Medium Green #277656  5.51:1   Green  #4EAF60  3.76:1
 *   exclude   Slate 2      #334155 10.35:1   Slate 4 #94A3B8 4.04:1
 *   high      Slate 1      #0F172A 17.85:1   Lime   #DBE64C  7.61:1
 *   medium    Dark Green   #1D5941  8.21:1   Acorn  #80D100  5.44:1
 *   low       Medium Green #277656  5.51:1   Green  #4EAF60  3.76:1
 *   score     Medium Green #277656  5.51:1   Green  #4EAF60  3.76:1
 *
 * Include/exclude is a polarity pair (side of the axis also encodes it):
 * worst CVD ΔE 15.3 light / 11.0 dark, normal-vision ΔE 17.2 / 16.5.
 * High/Medium/Low is an ordinal ramp: monotone lightness with ΔL >= 0.06 in
 * both modes (the dark ramp passes every ordinal check; in light the darkest
 * step is near-neutral Slate 1, because no third brand green reaches 3:1 on
 * white). Segments are split by 2px surface gaps, ordered H → M → L, labelled
 * in place when the label fits, and always backed by the legend and table.
 */
(function (WT) {
  'use strict';

  var doc = document;

  var PALETTE = {
    light: { surface: '#ffffff', include: '#277656', exclude: '#334155', high: '#0f172a', medium: '#1d5941', low: '#277656', score: '#277656' },
    dark: { surface: '#334155', include: '#4eaf60', exclude: '#94a3b8', high: '#dbe64c', medium: '#80d100', low: '#4eaf60', score: '#4eaf60' }
  };
  var PRIORITIES = ['high', 'medium', 'low'];

  /* ------------------------------------------------------------------ */
  /* Screenshots and thumbnails (with a neutral placeholder on error)    */
  /* ------------------------------------------------------------------ */

  var failed = {};

  /**
   * A screenshot box. { id, thumb, alt, cls, eager }. When the image fails to
   * load (or failed before), the box shows a neutral placeholder instead.
   */
  function shotBox(o) {
    var src = WT.shot(o.id, !!o.thumb);
    var missing = !!failed[src];
    var phText = o.thumb ? '' : '<span class="wt-shot-box__ph-text">Screenshot not available yet</span>';
    return (
      '<span class="wt-shot-box' + (o.thumb ? ' wt-shot-box--thumb' : '') + (o.cls ? ' ' + WT.esc(o.cls) : '') + (missing ? ' is-missing' : '') + '">' +
        (missing
          ? ''
          : '<img class="wt-shot-img" src="' + WT.esc(src) + '" alt="' + WT.esc(o.alt || '') + '"' +
            (o.eager ? '' : ' loading="lazy"') + ' decoding="async"' + (o.thumb ? ' width="64" height="40"' : '') + ' />') +
        '<span class="wt-shot-box__ph"' + (o.alt && missing ? ' role="img" aria-label="' + WT.esc(o.alt + ' (screenshot not available yet)') + '"' : ' aria-hidden="true"') + '>' +
          WT.icon('image', { size: o.thumb ? 18 : 32 }) + phText +
        '</span>' +
      '</span>'
    );
  }

  function onImageError(e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.classList.contains('wt-shot-img')) return;
    failed[img.getAttribute('src')] = true;
    var box = img.closest('.wt-shot-box');
    var alt = img.getAttribute('alt');
    if (box) {
      box.classList.add('is-missing');
      var ph = box.querySelector('.wt-shot-box__ph');
      if (ph && alt) {
        ph.removeAttribute('aria-hidden');
        ph.setAttribute('role', 'img');
        ph.setAttribute('aria-label', alt + ' (screenshot not available yet)');
      }
    }
    img.remove();
  }

  /** Listen (once per root) for screenshot load errors. */
  function watchImages(root) {
    if (!root || root._wtImgWatch) return;
    root._wtImgWatch = true;
    root.addEventListener('error', onImageError, true);
  }

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function frac(n, d) {
    return d ? Math.max(0, Math.min(1, n / d)) : 0;
  }
  function tipAttr(title, lines) {
    return ' data-tip-title="' + WT.esc(title) + '" data-tip="' + WT.esc(lines.join('\n')) + '"';
  }
  function legend(items, label) {
    return (
      '<ul class="wt-legend-list" aria-label="' + WT.esc(label || 'Legend') + '">' +
        items
          .map(function (it) {
            return '<li class="wt-legend-list__item"><span class="wt-key wt-key--' + WT.esc(it.kind) + '" aria-hidden="true"></span>' + WT.esc(it.label) + '</li>';
          })
          .join('') +
      '</ul>'
    );
  }
  function pctOf(n, d) {
    return WT.fmt.pct(n, d);
  }
  function plural(n, one, many) {
    return WT.fmt.plural(n, one, many);
  }
  function featureLink(r, cls, fk, extra) {
    return '<a class="' + cls + '" href="#/results/' + encodeURIComponent(r.id) + '" data-fk="' + WT.esc(fk) + '">' + (extra || '') +
      '<span class="wt-chart__name">' + WT.esc(r.title) + '</span></a>';
  }

  /* ------------------------------------------------------------------ */
  /* Figure: caption, legend, chart/table toggle                         */
  /* ------------------------------------------------------------------ */

  /**
   * { id, title, desc, legend (html), chart (html), table (html), showTable, note }
   */
  function figure(o) {
    var on = !!o.showTable;
    return (
      '<figure class="wt-card wt-fig" id="fig-' + WT.esc(o.id) + '" data-fig="' + WT.esc(o.id) + '">' +
        '<figcaption class="wt-fig__cap" id="fig-' + WT.esc(o.id) + '-cap">' +
          '<span class="wt-fig__title">' + WT.esc(o.title) + '</span>' +
          (o.desc ? '<span class="wt-fig__desc">' + o.desc + '</span>' : '') +
        '</figcaption>' +
        '<button class="wt-chip wt-fig__toggle" type="button" aria-pressed="' + (on ? 'true' : 'false') + '" aria-controls="fig-' + WT.esc(o.id) + '-table fig-' + WT.esc(o.id) + '-chart" data-fig-toggle="' + WT.esc(o.id) + '" data-fk="tgl-' + WT.esc(o.id) + '">' +
          WT.icon('list', { size: 18 }) + '<span>Show as table</span>' +
        '</button>' +
        '<div class="wt-fig__chart" id="fig-' + WT.esc(o.id) + '-chart"' + (on ? ' hidden' : '') + '>' +
          (o.legend || '') + o.chart +
        '</div>' +
        '<div class="wt-fig__table" id="fig-' + WT.esc(o.id) + '-table"' + (on ? '' : ' hidden') + '>' + o.table + '</div>' +
        (o.note ? '<p class="wt-fig__note">' + o.note + '</p>' : '') +
      '</figure>'
    );
  }

  /** A data table inside a focusable scroll region. cols: [{ label, num }], rows: [[cell html…]] */
  function table(o) {
    var head = o.cols
      .map(function (c) {
        return '<th scope="col"' + (c.num ? ' class="is-num"' : '') + '>' + WT.esc(c.label) + '</th>';
      })
      .join('');
    var body = o.rows
      .map(function (cells) {
        return (
          '<tr>' +
            cells
              .map(function (c, i) {
                var col = o.cols[i] || {};
                if (i === 0 && o.rowHeader !== false) return '<th scope="row">' + c + '</th>';
                return '<td' + (col.num ? ' class="is-num"' : '') + '>' + c + '</td>';
              })
              .join('') +
          '</tr>'
        );
      })
      .join('');
    return WT.ui.tableWrap(
      '<table class="wt-table wt-table--compact ' + WT.esc(o.cls || '') + '"><caption class="wt-sr-only">' + WT.esc(o.caption) + '</caption>' +
        '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>',
      o.caption
    );
  }

  /* ------------------------------------------------------------------ */
  /* 1. Support by feature: diverging include / exclude bars             */
  /* ------------------------------------------------------------------ */

  /** rows: model rows sorted by net support. Returns { chart, table, legend }. */
  function support(rows) {
    var max = 1;
    rows.forEach(function (r) {
      max = Math.max(max, r.include, r.exclude);
    });
    var items = rows
      .map(function (r) {
        var lines = ['Include|' + r.include, 'Exclude|' + r.exclude];
        if (r.undecided) lines.push('No vote|' + r.undecided);
        lines.push('Include share|' + pctOf(r.include, r.votes));
        var sr = r.votes
          ? r.include + ' include, ' + r.exclude + ' exclude, ' + pctOf(r.include, r.votes) + ' include' + (r.undecided ? ', ' + r.undecided + ' without a vote' : '')
          : 'no votes yet';
        var plot = r.votes
          ? '<span class="wt-sup__half wt-sup__half--neg">' +
              (r.exclude ? '<span class="wt-mark wt-mark--exclude wt-sup__bar" data-w="' + frac(r.exclude, max).toFixed(4) + '"></span><span class="wt-chart__val">' + r.exclude + '</span>' : '') +
            '</span>' +
            '<span class="wt-sup__axis"></span>' +
            '<span class="wt-sup__half wt-sup__half--pos">' +
              (r.include ? '<span class="wt-mark wt-mark--include wt-sup__bar" data-w="' + frac(r.include, max).toFixed(4) + '"></span><span class="wt-chart__val">' + r.include + '</span>' : '') +
            '</span>'
          : '<span class="wt-sup__half wt-sup__half--neg"></span><span class="wt-sup__axis"></span><span class="wt-sup__half wt-sup__half--pos"><span class="wt-chart__none">No votes yet</span></span>';
        return (
          '<li class="wt-chart__row wt-sup__row' + (r.votes ? '' : ' is-empty') + '" data-id="' + WT.esc(r.id) + '"' + tipAttr(r.title, lines) + '>' +
            featureLink(r, 'wt-chart__label', 'sup-' + r.id, shotBox({ id: r.id, thumb: true, alt: '' })) +
            '<span class="wt-chart__plot wt-sup__plot" aria-hidden="true">' + plot + '</span>' +
            '<span class="wt-sr-only">: ' + WT.esc(sr) + '</span>' +
          '</li>'
        );
      })
      .join('');
    var chart =
      '<div class="wt-sup__scale" aria-hidden="true"><span class="wt-sup__scale-spacer"></span>' +
        '<span class="wt-sup__scale-neg">' + WT.icon('arrow-left', { size: 14 }) + 'Exclude</span>' +
        '<span class="wt-sup__scale-pos">Include' + WT.icon('arrow-right', { size: 14 }) + '</span></div>' +
      '<ol class="wt-chart wt-sup" role="list" aria-label="Support by feature, sorted by net support">' + items + '</ol>';
    var tableHtml = table({
      caption: 'Support by feature, sorted by net support',
      cls: 'wt-fig-table wt-fig-table--support',
      cols: [{ label: 'Feature' }, { label: 'Include', num: true }, { label: 'Exclude', num: true }, { label: 'No vote', num: true }, { label: 'Net', num: true }, { label: 'Include share', num: true }],
      rows: rows.map(function (r) {
        return [
          '<a href="#/results/' + encodeURIComponent(r.id) + '">' + WT.esc(r.title) + '</a>',
          String(r.include),
          String(r.exclude),
          String(r.undecided),
          (r.net > 0 ? '+' : r.net < 0 ? '−' : '') + Math.abs(r.net),
          pctOf(r.include, r.votes)
        ];
      })
    });
    return {
      chart: chart,
      table: tableHtml,
      legend: legend([{ kind: 'exclude', label: 'Exclude' }, { kind: 'include', label: 'Include' }], 'Support legend')
    };
  }

  /* ------------------------------------------------------------------ */
  /* 2. Priority mix: 100% stacked High / Medium / Low                   */
  /* ------------------------------------------------------------------ */

  function stack(parts, total, labelFn) {
    return parts
      .filter(function (p) {
        return p.n > 0;
      })
      .map(function (p) {
        return (
          '<span class="wt-mark wt-mark--' + p.kind + ' wt-hbar__seg" data-g="' + p.n + '">' +
            '<span class="wt-seg__lab">' + WT.esc(labelFn ? labelFn(p) : pctOf(p.n, total)) + '</span>' +
          '</span>'
        );
      })
      .join('');
  }

  function prioParts(p) {
    return [
      { kind: 'high', label: 'High', n: p.high },
      { kind: 'medium', label: 'Medium', n: p.medium },
      { kind: 'low', label: 'Low', n: p.low }
    ];
  }

  function priorityMix(rows) {
    var items = rows
      .map(function (r) {
        var p = r.priority;
        var lines = prioParts(p).map(function (x) {
          return x.label + '|' + x.n + ' (' + pctOf(x.n, r.pn) + ')';
        });
        lines.push('With a priority|' + r.pn);
        var sr = r.pn
          ? prioParts(p)
              .map(function (x) {
                return x.label + ' ' + x.n + ' (' + pctOf(x.n, r.pn) + ')';
              })
              .join(', ') + ', from ' + plural(r.pn, 'priority response')
          : 'no priorities yet';
        return (
          '<li class="wt-chart__row wt-mix__row' + (r.pn ? '' : ' is-empty') + '" data-id="' + WT.esc(r.id) + '"' + tipAttr(r.title, lines) + '>' +
            featureLink(r, 'wt-chart__label', 'mix-' + r.id) +
            '<span class="wt-chart__plot wt-mix__plot" aria-hidden="true">' +
              (r.pn ? '<span class="wt-hbar">' + stack(prioParts(p), r.pn) + '</span><span class="wt-chart__n">' + r.pn + '</span>' : '<span class="wt-chart__none">No priorities yet</span>') +
            '</span>' +
            '<span class="wt-sr-only">: ' + WT.esc(sr) + '</span>' +
          '</li>'
        );
      })
      .join('');
    var chart =
      '<div class="wt-chart__scale" aria-hidden="true"><span class="wt-chart__scale-spacer"></span>' +
        '<span class="wt-chart__plot wt-mix__plot"><span class="wt-axis"><span>0%</span><span>50%</span><span>100%</span></span><span class="wt-chart__n">n</span></span></div>' +
      '<ol class="wt-chart wt-mix" role="list" aria-label="Priority mix by feature, among reviewers who set a priority">' + items + '</ol>';
    var tableHtml = table({
      caption: 'Priority mix by feature, among reviewers who set a priority',
      cls: 'wt-fig-table wt-fig-table--mix',
      cols: [{ label: 'Feature' }, { label: 'High', num: true }, { label: 'Medium', num: true }, { label: 'Low', num: true }, { label: 'With a priority', num: true }],
      rows: rows.map(function (r) {
        var cell = function (n) {
          return r.pn ? n + ' <span class="wt-muted">(' + pctOf(n, r.pn) + ')</span>' : String(n);
        };
        return [
          '<a href="#/results/' + encodeURIComponent(r.id) + '">' + WT.esc(r.title) + '</a>',
          cell(r.priority.high),
          cell(r.priority.medium),
          cell(r.priority.low),
          String(r.pn)
        ];
      })
    });
    return {
      chart: chart,
      table: tableHtml,
      legend: legend([{ kind: 'high', label: 'High' }, { kind: 'medium', label: 'Medium' }, { kind: 'low', label: 'Low' }], 'Priority legend')
    };
  }

  /* ------------------------------------------------------------------ */
  /* 3. Priority score ranking: lollipop on a 1–3 scale                  */
  /* ------------------------------------------------------------------ */

  function scoreText(s) {
    return s === null || s === undefined ? '–' : Number(s).toFixed(2);
  }

  function scoreRank(rows) {
    var items = rows
      .map(function (r, i) {
        var x = frac(r.score - 1, 2);
        var lines = ['Score|' + scoreText(r.score) + ' of 3', 'High|' + r.priority.high, 'Medium|' + r.priority.medium, 'Low|' + r.priority.low, 'Include votes|' + r.include];
        var sr = 'rank ' + (i + 1) + ', score ' + scoreText(r.score) + ' of 3 from ' + plural(r.pn, 'priority response') + ', ' + plural(r.include, 'include vote');
        return (
          '<li class="wt-chart__row wt-score__row" data-id="' + WT.esc(r.id) + '"' + tipAttr(r.title, lines) + '>' +
            featureLink(r, 'wt-chart__label', 'score-' + r.id, '<span class="wt-score__rank" aria-hidden="true">' + (i + 1) + '</span>') +
            '<span class="wt-chart__plot wt-score__plot" aria-hidden="true">' +
              '<span class="wt-score__track">' +
                '<span class="wt-score__grid wt-score__grid--1"></span><span class="wt-score__grid wt-score__grid--2"></span><span class="wt-score__grid wt-score__grid--3"></span>' +
                '<span class="wt-mark wt-mark--score wt-score__stem" data-w="' + x.toFixed(4) + '"></span>' +
                '<span class="wt-mark wt-mark--score wt-score__dot" data-x="' + x.toFixed(4) + '"></span>' +
              '</span>' +
              '<span class="wt-chart__val wt-score__val">' + scoreText(r.score) + '</span>' +
            '</span>' +
            '<span class="wt-sr-only">: ' + WT.esc(sr) + '</span>' +
          '</li>'
        );
      })
      .join('');
    var chart =
      '<div class="wt-chart__scale" aria-hidden="true"><span class="wt-chart__scale-spacer"></span>' +
        '<span class="wt-chart__plot wt-score__plot"><span class="wt-axis wt-axis--inset"><span>Low · 1</span><span>Medium · 2</span><span>High · 3</span></span>' +
        '<span class="wt-score__val"></span></span></div>' +
      '<ol class="wt-chart wt-score" role="list" aria-label="Priority score ranking, from 1 (Low) to 3 (High)">' + items + '</ol>';
    var tableHtml = table({
      caption: 'Priority score ranking (High 3, Medium 2, Low 1), features with at least one include vote',
      cls: 'wt-fig-table wt-fig-table--score',
      cols: [{ label: 'Rank', num: true }, { label: 'Feature' }, { label: 'Score', num: true }, { label: 'High', num: true }, { label: 'Medium', num: true }, { label: 'Low', num: true }, { label: 'Include votes', num: true }],
      rowHeader: false,
      rows: rows.map(function (r, i) {
        return [
          String(i + 1),
          '<a href="#/results/' + encodeURIComponent(r.id) + '">' + WT.esc(r.title) + '</a>',
          scoreText(r.score),
          String(r.priority.high),
          String(r.priority.medium),
          String(r.priority.low),
          String(r.include)
        ];
      })
    });
    return { chart: chart, table: tableHtml, legend: '' };
  }

  /* ------------------------------------------------------------------ */
  /* Mini charts (feature detail, ranking cards)                         */
  /* ------------------------------------------------------------------ */

  /** Two 100% bars: votes (include/exclude) and priority (H/M/L). */
  function mini(r) {
    var votes = r.votes
      ? '<span class="wt-hbar wt-hbar--lg">' +
          stack(
            [
              { kind: 'include', label: 'Include', n: r.include },
              { kind: 'exclude', label: 'Exclude', n: r.exclude }
            ],
            r.votes,
            function (p) {
              return p.n + ' ' + p.label.toLowerCase();
            }
          ) +
        '</span>'
      : '<span class="wt-chart__none">No votes yet</span>';
    var prio = r.pn
      ? '<span class="wt-hbar wt-hbar--lg">' +
          stack(prioParts(r.priority), r.pn, function (p) {
            return p.n + ' ' + p.label.toLowerCase();
          }) +
        '</span>'
      : '<span class="wt-chart__none">No priorities yet</span>';
    return (
      '<div class="wt-mini" aria-hidden="true">' +
        '<div class="wt-mini__row"><span class="wt-mini__label">Votes</span>' + votes + '</div>' +
        '<div class="wt-mini__row"><span class="wt-mini__label">Priority</span>' + prio + '</div>' +
      '</div>' +
      '<div class="wt-mini__legends">' +
        legend([{ kind: 'include', label: 'Include' }, { kind: 'exclude', label: 'Exclude' }], 'Votes legend') +
        legend([{ kind: 'high', label: 'High' }, { kind: 'medium', label: 'Medium' }, { kind: 'low', label: 'Low' }], 'Priority legend') +
      '</div>'
    );
  }

  /** A slim inline split bar (ranking cards). kind: 'votes' | 'priority' */
  function spark(r, kind) {
    if (kind === 'votes') {
      if (!r.votes) return '<span class="wt-spark wt-spark--empty" aria-hidden="true"></span>';
      return '<span class="wt-spark" aria-hidden="true">' + stack([{ kind: 'include', n: r.include }, { kind: 'exclude', n: r.exclude }], r.votes, function () {
        return '';
      }) + '</span>';
    }
    if (!r.pn) return '<span class="wt-spark wt-spark--empty" aria-hidden="true"></span>';
    return '<span class="wt-spark" aria-hidden="true">' + stack(prioParts(r.priority), r.pn, function () {
      return '';
    }) + '</span>';
  }

  /* ------------------------------------------------------------------ */
  /* Geometry, label fitting, tooltips, toggles                          */
  /* ------------------------------------------------------------------ */

  /** Turn data-w / data-x / data-g into CSS custom properties, then fit in-mark labels. */
  function apply(root) {
    if (!root) return;
    WT.$$('[data-w]', root).forEach(function (el) {
      var f = Math.max(0, Math.min(1, Number(el.getAttribute('data-w')) || 0));
      el.style.setProperty('--w', (f * 100).toFixed(2) + '%');
      el.style.setProperty('--f', f.toFixed(4));
    });
    WT.$$('[data-x]', root).forEach(function (el) {
      el.style.setProperty('--x', (Math.max(0, Math.min(1, Number(el.getAttribute('data-x')) || 0)) * 100).toFixed(2) + '%');
    });
    WT.$$('[data-g]', root).forEach(function (el) {
      el.style.setProperty('--g', String(Number(el.getAttribute('data-g')) || 0));
    });
    fit(root);
  }

  /** Show an in-segment label only when it fits with padding (never clipped). */
  function fit(root) {
    WT.$$('.wt-seg__lab', root).forEach(function (lab) {
      var seg = lab.parentNode;
      if (!lab.textContent) {
        lab.classList.add('is-off');
        return;
      }
      lab.classList.remove('is-off');
      var w = seg.clientWidth;
      if (!w || lab.scrollWidth + 10 > w) lab.classList.add('is-off');
    });
  }

  var tip = null;
  var tipFor = null;
  var tipShownAt = 0;
  function tipEl() {
    if (!tip) {
      tip = doc.createElement('div');
      tip.className = 'wt-tip wt-surface';
      tip.setAttribute('aria-hidden', 'true');
      tip.hidden = true;
      doc.body.appendChild(tip);
    }
    return tip;
  }
  function showTip(row, x, y) {
    var t = tipEl();
    if (tipFor !== row) {
      tipFor = row;
      t.textContent = '';
      var h = doc.createElement('p');
      h.className = 'wt-tip__title';
      h.textContent = row.getAttribute('data-tip-title') || '';
      t.appendChild(h);
      // Values lead, labels follow (text only: names come from data).
      (row.getAttribute('data-tip') || '').split('\n').forEach(function (line) {
        if (!line) return;
        var i = line.indexOf('|');
        var r = doc.createElement('div');
        r.className = 'wt-tip__row';
        var v = doc.createElement('span');
        v.className = 'wt-tip__v';
        v.textContent = line.slice(i + 1);
        var k = doc.createElement('span');
        k.className = 'wt-tip__k';
        k.textContent = line.slice(0, i);
        r.appendChild(v);
        r.appendChild(k);
        t.appendChild(r);
      });
    }
    if (t.hidden) tipShownAt = Date.now();
    t.hidden = false;
    var r = t.getBoundingClientRect();
    var vw = doc.documentElement.clientWidth;
    var vh = doc.documentElement.clientHeight;
    var left = Math.min(Math.max(8, x + 14), vw - r.width - 8);
    var top = y + 16;
    if (top + r.height > vh - 8) top = Math.max(8, y - r.height - 12);
    t.style.setProperty('--tip-x', Math.round(left) + 'px');
    t.style.setProperty('--tip-y', Math.round(top) + 'px');
  }
  function hideTip() {
    if (tip) tip.hidden = true;
    tipFor = null;
  }

  /** Wire tooltips and chart/table toggles inside root (once). onToggle(id, showTable) is optional. */
  function bind(root, onToggle) {
    if (!root || root._wtCharts) return;
    root._wtCharts = true;
    watchImages(root);
    root.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      var row = e.target.closest && e.target.closest('[data-tip]');
      if (!row || !root.contains(row)) return hideTip();
      showTip(row, e.clientX, e.clientY);
    });
    root.addEventListener('pointerleave', hideTip);
    root.addEventListener('focusin', function (e) {
      var row = e.target.closest && e.target.closest('[data-tip]');
      if (!row) return hideTip();
      var b = row.getBoundingClientRect();
      var plot = row.querySelector('.wt-chart__plot');
      var pb = plot ? plot.getBoundingClientRect() : b;
      showTip(row, pb.left + Math.min(pb.width, 160) / 2, b.bottom - 8);
    });
    root.addEventListener('focusout', function (e) {
      if (!e.relatedTarget || !root.contains(e.relatedTarget) || !e.relatedTarget.closest('[data-tip]')) hideTip();
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && tip && !tip.hidden) hideTip();
    });
    // Scrolling moves the rows away from a fixed tooltip, so hide it (but not
    // for the scroll that brought the row into view a moment ago).
    window.addEventListener(
      'scroll',
      function () {
        if (Date.now() - tipShownAt > 250) hideTip();
      },
      { passive: true }
    );
    root.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-fig-toggle]');
      if (!btn || !root.contains(btn)) return;
      var id = btn.getAttribute('data-fig-toggle');
      var on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      var chart = doc.getElementById('fig-' + id + '-chart');
      var tbl = doc.getElementById('fig-' + id + '-table');
      if (chart) chart.hidden = on;
      if (tbl) tbl.hidden = !on;
      if (!on && chart) fit(chart);
      hideTip();
      if (onToggle) onToggle(id, on);
    });
    if (window.ResizeObserver) {
      var refit = WT.debounce(function () {
        fit(root);
      }, 120);
      new ResizeObserver(refit).observe(root);
    }
  }

  WT.charts = {
    PALETTE: PALETTE,
    PRIORITIES: PRIORITIES,
    shotBox: shotBox,
    watchImages: watchImages,
    figure: figure,
    table: table,
    legend: legend,
    support: support,
    priorityMix: priorityMix,
    scoreRank: scoreRank,
    scoreText: scoreText,
    mini: mini,
    spark: spark,
    apply: apply,
    fit: fit,
    bind: bind,
    hideTip: hideTip
  };
})(window.WT = window.WT || {});
