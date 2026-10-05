/*
 * 10-start.js — the start page (#/start). SPEC section 3. Owner: foundation.
 * Hero, how it works, optional name, start/continue, links to results and data
 * requirements, the full branding notice and the privacy note.
 */
(function (WT) {
  'use strict';

  var doc = document;
  var section = null;

  function tourHref(id) {
    return '#/tour/' + encodeURIComponent(id);
  }

  function statusBadge(a) {
    if (!a) return '';
    if (a.vote) return WT.ui.voteBadge(a.vote);
    return WT.ui.badge('neutral', 'Answered');
  }

  function groupsHtml() {
    var answers = WT.answers.all();
    var groups = {};
    WT.features.forEach(function (f) {
      (groups[f.section] = groups[f.section] || []).push(f);
    });
    // Canonical section order first, then any section the list adds later.
    var order = Object.keys(WT.SECTIONS).filter(function (s) {
      return groups[s];
    });
    Object.keys(groups).forEach(function (s) {
      if (order.indexOf(s) === -1) order.push(s);
    });
    return order
      .map(function (sec) {
        var items = groups[sec]
          .map(function (f) {
            return (
              '<li class="wt-start__feature">' +
                '<a class="wt-start__feature-link" href="' + tourHref(f.id) + '">' +
                  '<span class="wt-start__feature-n" aria-hidden="true">' + (f.index + 1) + '</span>' +
                  '<span class="wt-start__feature-title">' + WT.esc(f.title) + '</span>' +
                '</a>' +
                statusBadge(answers[f.id]) +
              '</li>'
            );
          })
          .join('');
        return (
          '<div class="wt-card wt-start__group">' +
            '<h3 class="wt-start__group-h"><span>' + WT.esc(WT.sectionLabel(sec)) + '</span>' +
            '<span class="wt-badge wt-badge--neutral">' + WT.esc(WT.fmt.plural(groups[sec].length, 'feature')) + '</span></h3>' +
            '<ol class="wt-start__list" role="list">' + items + '</ol>' +
          '</div>'
        );
      })
      .join('');
  }

  function html() {
    var N = WT.features.length;
    var first = N ? WT.features[0].id : '';
    var stats = WT.answers.stats();
    var last = WT.reviewer.lastStep();
    var progress = !!last || stats.answered > 0;
    // The same resume point as #/tour without an id (40-tour.js): the step the
    // reviewer last had open, else the first feature they haven't answered.
    var resumeId = last || stats.firstUnanswered || first;
    var k = WT.featureIndex(resumeId) + 1;
    var resumeFeature = WT.feature(resumeId);
    var resumeLabel = (last ? 'Continue where you left off: ' : 'Continue with ') + (resumeFeature ? resumeFeature.title : '') + ' (step ' + k + ' of ' + N + ')';
    var sections = {};
    WT.features.forEach(function (f) {
      sections[f.section] = true;
    });
    var sectionCount = Object.keys(sections).length;

    // Keep what someone is typing if a re-render happens mid-edit.
    var input = doc.getElementById('start-name');
    var nameValue = input && doc.activeElement === input ? input.value : WT.reviewer.name();

    // Every feature answered: the results come first, and the walkthrough stays a click away.
    var complete = N > 0 && stats.answered >= N;
    var resume =
      '<a class="wt-btn ' + (complete ? 'wt-btn--link' : 'wt-btn--primary wt-btn--lg') + '" data-fk="start-continue" data-start="continue" href="' + tourHref(resumeId) + '">' +
        '<span>' + WT.esc(resumeLabel) + '</span>' + WT.icon('arrow-right', complete ? { size: 18 } : undefined) + '</a>';
    var primary = complete
      ? '<a class="wt-btn wt-btn--primary wt-btn--lg" data-fk="start-primary" data-start="results" href="#/results">' +
          '<span>You’ve answered every feature: see the results</span>' + WT.icon('arrow-right') + '</a>' + resume
      : progress
        ? resume
        : '<a class="wt-btn wt-btn--primary wt-btn--lg" data-fk="start-primary" data-start="begin" href="' + tourHref(first) + '">' +
            '<span>Start the walkthrough</span>' + WT.icon('arrow-right') + '</a>';
    var restart = progress
      ? '<a class="wt-btn wt-btn--link" data-fk="start-restart" data-start="restart" href="' + tourHref(first) + '">' + WT.icon('restart', { size: 18 }) + '<span>Start from the beginning</span></a>'
      : '';
    // The statement on its own, in a new tab, for reviewers who want to explore it freely.
    var tryIt =
      '<a class="wt-btn wt-btn--link wt-start__try" data-fk="start-try" data-start="try" href="statement/index.html" target="_blank" rel="noopener">' +
        '<span>Try the statement on its own</span><span class="wt-sr-only"> (opens in a new tab)</span>' +
        WT.icon('external', { size: 18 }) + '</a>';
    var progressBlock = progress
      ? '<div class="wt-start__progress">' +
          WT.ui.progress({ id: 'start-progress', value: stats.answered, max: N, label: 'You’ve answered ' + stats.answered + ' of ' + N + ' features' }) +
        '</div>'
      : '';

    return (
      '<div class="wt-start">' +
        '<div class="wt-container wt-start__hero">' +
          '<div class="wt-start__intro">' +
            '<p class="wt-eyebrow">InfoSlips × YES · Feature review</p>' +
            '<h1 class="wt-display wt-title" tabindex="-1" data-fk="h1">Help shape the new YES statement</h1>' +
            '<p class="wt-lead">InfoSlips built this interactive statement for YES to show the art of the possible. Walk through it and, for each feature, tell us whether it belongs in the production statement, how important it is, and why. YES will use everyone’s answers to choose the features for the first release.</p>' +
            progressBlock +
            '<div class="wt-start__actions">' + primary + restart + tryIt + '</div>' +
            '<p class="wt-start__meta">' + WT.icon('info', { size: 18 }) + '<span>About 40 minutes for all ' + N + ' features · You can stop and continue at any time on this browser.</span></p>' +
            WT.brandNotice() +
          '</div>' +
          '<section class="wt-card wt-start__you" aria-labelledby="start-you-h">' +
            '<h2 class="wt-card__title" id="start-you-h">' + WT.icon('user') + '<span>About you</span></h2>' +
            '<form class="wt-start__name" id="start-name-form" novalidate>' +
              WT.ui.field({
                id: 'start-name',
                label: 'Your name',
                optional: true,
                hint: 'Shown next to your votes and comments. Leave it blank to appear as “' + WT.ANONYMOUS + '”.',
                max: WT.LIMITS.name,
                autocomplete: 'name',
                value: nameValue
              }) +
            '</form>' +
            '<p class="wt-start__privacy">' + WT.icon('lock', { size: 18 }) +
              '<span>Your answers are saved to a shared database as you go and are visible to everyone with this link. They’re linked to this browser, not to an account.</span></p>' +
          '</section>' +
        '</div>' +

        '<section class="wt-band wt-start__how" aria-labelledby="start-how-h">' +
          '<div class="wt-container">' +
            '<h2 id="start-how-h">How it works</h2>' +
            '<ol class="wt-steps" role="list">' +
              '<li class="wt-steps__item"><span class="wt-steps__n" aria-hidden="true">1</span><div>' +
                '<h3 class="wt-steps__h">Take the guided walkthrough</h3>' +
                '<p>About 40 minutes, ' + N + ' features. We highlight each part of the statement and explain what it does for YES and for your customers.</p></div></li>' +
              '<li class="wt-steps__item"><span class="wt-steps__n" aria-hidden="true">2</span><div>' +
                '<h3 class="wt-steps__h">Give your view</h3>' +
                '<p>For each feature, vote to include or exclude it, set a priority and comment. Your answers save as you go.</p></div></li>' +
              '<li class="wt-steps__item"><span class="wt-steps__n" aria-hidden="true">3</span><div>' +
                '<h3 class="wt-steps__h">See what everyone thinks</h3>' +
                '<p>Compare everyone’s votes, priorities and comments, and the data each feature needs.</p></div></li>' +
            '</ol>' +
          '</div>' +
        '</section>' +

        '<section class="wt-container wt-start__features" aria-labelledby="start-features-h">' +
          '<h2 id="start-features-h">What you’ll review</h2>' +
          '<p class="wt-start__features-intro">' + N + ' features across ' + sectionCount + ' parts of the statement. Jump to any of them, in any order.</p>' +
          '<div class="wt-start__groups">' + groupsHtml() + '</div>' +
        '</section>' +

        '<section class="wt-container wt-start__next" aria-labelledby="start-next-h">' +
          '<h2 id="start-next-h" class="wt-sr-only">More</h2>' +
          '<div class="wt-start__links">' +
            '<a class="wt-card wt-card--link wt-start__link" href="#/results">' +
              '<span class="wt-start__link-icon">' + WT.icon('chart', { size: 24 }) + '</span>' +
              '<span class="wt-start__link-text"><span class="wt-start__link-title">See the results</span>' +
              '<span class="wt-start__link-desc">What everyone thinks, as charts and in words.</span></span>' + WT.icon('arrow-right', { cls: 'wt-start__link-arrow' }) +
            '</a>' +
            '<a class="wt-card wt-card--link wt-start__link" href="#/data">' +
              '<span class="wt-start__link-icon">' + WT.icon('braces', { size: 24 }) + '</span>' +
              '<span class="wt-start__link-text"><span class="wt-start__link-title">Data requirements</span>' +
              '<span class="wt-start__link-desc">The data each feature needs, as an explorable JSON structure.</span></span>' + WT.icon('arrow-right', { cls: 'wt-start__link-arrow' }) +
            '</a>' +
          '</div>' +
        '</section>' +
      '</div>'
    );
  }

  // What the page shows besides the name: re-render only when this changes, so
  // saving the name (a 'reviewer' event) never replaces the form or a link that
  // is being clicked (blur → change → save would otherwise swap the element
  // between mousedown and click).
  var shown = null;
  function signature() {
    var all = WT.answers.all();
    return JSON.stringify([
      WT.reviewer.lastStep(),
      WT.features.map(function (f) {
        var a = all[f.id];
        return a ? a.vote || 1 : 0;
      })
    ]);
  }

  function render() {
    if (!section) section = doc.getElementById('view-start');
    shown = signature();
    WT.render(section, html());
  }

  /** Show the saved name in the field unless someone is typing in it. */
  function syncName() {
    var input = doc.getElementById('start-name');
    if (input && doc.activeElement !== input) {
      var name = WT.reviewer.name();
      if (input.value !== name) input.value = name;
    }
  }

  function visible() {
    var r = WT.route();
    return r && r.view === 'start';
  }

  function saveName() {
    var input = doc.getElementById('start-name');
    if (!input) return;
    var before = WT.reviewer.name();
    var name = WT.reviewer.setName(input.value);
    if (input.value !== name) input.value = name;
    if (name !== before) WT.announce(name ? 'Name saved' : 'Name removed. You’ll appear as “' + WT.ANONYMOUS + '”.');
  }

  WT.register({
    name: 'start',
    view: 'start',
    init: function () {
      section = doc.getElementById('view-start');
      section.addEventListener('change', function (e) {
        if (e.target && e.target.id === 'start-name') saveName();
      });
      // Enter saves the name without an implicit form submission: the save
      // re-renders nothing (see signature()), and the browser never submits.
      section.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.isComposing && e.target && e.target.id === 'start-name') {
          e.preventDefault();
          saveName();
        }
      });
      section.addEventListener('submit', function (e) {
        if (e.target && e.target.id === 'start-name-form') {
          e.preventDefault();
          saveName();
        }
      });
      // Re-render after the current event has finished, and only when the page content changed.
      var queued = false;
      var rerender = function () {
        if (queued) return;
        queued = true;
        setTimeout(function () {
          queued = false;
          if (!visible()) return;
          if (signature() !== shown) render();
          else syncName();
        }, 0);
      };
      WT.on('answers', rerender);
      WT.on('reviewer', rerender);
    },
    render: render
  });
})(window.WT = window.WT || {});
