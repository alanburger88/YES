// Overview: first screen, balance card, statement details, balance journey,
// running-balance chart, fees/insight, video placeholder (PRD 4, 5.1, 5.2, 5.7).
export const meta = { name: 'overview', viewports: ['desktop', 'mobile', 'narrow'] };

const BAD = ['serious', 'critical'];
// Amounts use a non-breaking space before the unit; compare on plain spaces.
const norm = (s) => String(s).replace(/\u00a0/g, ' ');
const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));

async function noHorizontalOverflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders = [];
    document.querySelectorAll('#view-overview *').forEach((el) => {
      // SVG internals are clipped by their own viewport; check the <svg> box itself.
      if (el.closest('.sr-only') || el.ownerSVGElement || !el.getClientRects().length) return;
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > vw + 1 || r.left < -1)) offenders.push((el.className && el.className.baseVal === undefined ? el.className : el.tagName) + ' ' + Math.round(r.left) + '→' + Math.round(r.right));
    });
    return { scroll: document.documentElement.scrollWidth <= vw, offenders: offenders.slice(0, 6) };
  });
}

/** Journey layout facts: active layout, labels broken inside words, colliding values, text spilling out of a step. */
async function journeyLayout(page) {
  return page.evaluate(() => {
    const jr = document.querySelector('#ov-journey-body .jr');
    const layout = getComputedStyle(jr).getPropertyValue('--jr-layout').trim();
    const broken = [...jr.querySelectorAll('.jr-step .jr-label > span:last-child')]
      .filter((e) => {
        // A label wrapped inside a word renders more lines than it has words.
        const lh = parseFloat(getComputedStyle(e).lineHeight) || 16;
        return Math.round(e.getBoundingClientRect().height / lh) > e.textContent.trim().split(/\s+/).length;
      })
      .map((e) => e.textContent.trim());
    const vals = [...jr.querySelectorAll('.jr-step .jr-value')].map((e) => e.getBoundingClientRect());
    const overlaps = [];
    for (let i = 0; i < vals.length; i++)
      for (let j = i + 1; j < vals.length; j++) {
        const a = vals[i];
        const b = vals[j];
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps.push(i + '/' + j);
      }
    const spill = [...jr.querySelectorAll('.jr-step')]
      .filter((s) => {
        const p = s.getBoundingClientRect();
        return [...s.querySelectorAll('.jr-value, .jr-label, .jr-sub')].some((c) => {
          const r = c.getBoundingClientRect();
          return r.left < p.left - 0.5 || r.right > p.right + 0.5 || c.scrollWidth > c.clientWidth + 1;
        });
      })
      .map((s) => s.dataset.step);
    const valueTops = layout === 'waterfall' ? [...new Set(vals.map((r) => Math.round(r.top)))] : [];
    return { layout, broken, overlaps, spill, valueRows: valueTops.length, width: document.getElementById('ov-journey-body').clientWidth };
  });
}

/** Rendered x-axis date labels of the running-balance chart that collide. */
async function axisCollisions(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('.ov-chart__svg');
    if (!svg) return ['no chart'];
    const labels = [...svg.querySelectorAll('text.c-tick[text-anchor="middle"]')].map((tx) => tx.getBoundingClientRect());
    labels.sort((a, b) => a.left - b.left);
    const out = [];
    for (let i = 1; i < labels.length; i++) if (labels[i].left < labels[i - 1].right + 2) out.push(i);
    return out;
  });
}

/** Poster colours (contrast of its text on its background, background luminance) and its bars. */
async function posterFacts(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.ov-video__poster');
    const ctx = document.createElement('canvas').getContext('2d');
    const rgb = (c) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const lum = (c) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const bg = lum(rgb(getComputedStyle(el).backgroundColor));
    const ink = lum(rgb(getComputedStyle(el.querySelector('.ov-poster__hello')).fill));
    return {
      contrast: Math.round(((Math.max(bg, ink) + 0.05) / (Math.min(bg, ink) + 0.05)) * 10) / 10,
      bg: Math.round(bg * 100) / 100,
      bars: el.querySelectorAll('.ov-poster__bar').length,
      steps: YES.calc.journey().length
    };
  });
}

/** Elements whose text wraps inside a word (more rendered lines than words). */
async function brokenWords(page, sel) {
  return page.$$eval(sel, (els) =>
    els
      .filter((e) => e.getClientRects().length)
      .filter((e) => {
        const lh = parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.5;
        return Math.round(e.getBoundingClientRect().height / lh) > e.textContent.trim().split(/\s+/).length;
      })
      .map((e) => e.textContent.trim())
  );
}

async function spy(page) {
  await page.evaluate(() => {
    window.__calls = [];
    const fk = (o) => (o && o.trigger && o.trigger.getAttribute ? o.trigger.getAttribute('data-fk') : null);
    // list: the ids Previous / Next stay within (null: the explorer's default).
    YES.explorer.openTx = (id, o) => __calls.push({ fn: 'openTx', id, fk: fk(o), list: (o && o.list) || null });
    YES.explorer.applyFilter = (f, o) => __calls.push({ fn: 'applyFilter', f, o });
    YES.explorer.showRows = (ids, label) => __calls.push({ fn: 'showRows', ids, label });
    YES.assistant.open = (ctx) => __calls.push({ fn: 'assistant', topic: ctx.topic, id: ctx.id || null });
    YES.understand.openTopic = (id) => __calls.push({ fn: 'openTopic', id });
  });
}
const calls = (page) => page.evaluate(() => window.__calls.splice(0));

async function shot(t, name, opts) {
  await settle(t.page);
  await t.page.waitForTimeout(350); // let smooth scrolling finish
  await t.shot(name, opts);
}

async function fresh(t, hash) {
  await t.goto(hash);
  await t.page.reload();
  await t.page.waitForFunction(() => window.YES && window.YES.ready === true);
}

async function axeOk(t, sel, label) {
  const v = await t.axe(sel);
  const bad = v.filter((x) => BAD.includes(x.impact));
  t.eq(bad, [], `axe serious/critical (${label})`);
  return v;
}

export default async function (t) {
  const { page } = t;
  const vp = t.viewport;
  const wide = vp === 'desktop';

  // Collect runtime warnings (missing i18n keys only warn) from a fresh load.
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' && /\[i18n\]|overview/i.test(m.text())) warnings.push(m.text());
  });
  await fresh(t, '#/overview');

  /* ------------------------------------------------------------ first screen */
  t.step('heading and handshake');
  t.eq(await page.locator('#view-overview h1').count(), 1, 'exactly one h1 in the overview');
  const h1 = page.locator('#h-overview');
  t.eq(await h1.getAttribute('class'), 'view-title', 'h1 class');
  t.assert((await h1.getAttribute('tabindex')) === '-1' && (await h1.getAttribute('data-view-heading')) !== null, 'h1 is the focusable view heading');
  t.eq(norm(await h1.innerText()).trim(), 'Your September 2026 statement', 'h1 names the statement period');
  const expectedHandshake = await page.evaluate(
    () =>
      'Hello, ' +
      YES.data.statement.customer.firstName +
      '. Here is your YES activity for ' +
      YES.fmt.range(YES.data.statement.periodStart, YES.data.statement.periodEnd) +
      '. Start with the highlights, then explore any movement you would like to understand. If something does not look right, we are here to help.'
  );
  t.eq(norm(await page.locator('.ov-handshake').innerText()).trim(), expectedHandshake, 'PRD handshake, verbatim, with first name and period');

  t.step('balance card');
  t.eq(norm(await page.locator('.ov-hero__num').innerText()).trim(), '1,147.50', 'hero shows the closing balance');
  t.eq(norm(await page.locator('.ov-hero__sym').innerText()).trim(), 'EXUSD', 'asset symbol next to the hero');
  const heroStyle = await page.locator('.ov-hero__num').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { size: parseFloat(cs.fontSize), nums: cs.fontVariantNumeric };
  });
  t.assert(heroStyle.size >= 48, 'hero figure is at least 48px (got ' + heroStyle.size + ')');
  t.assert(!/tabular/.test(heroStyle.nums), 'hero uses proportional figures');
  t.assert(norm(await page.locator('.ov-hero .sr-only').innerText()).includes('token units'), 'hero spoken text names token units');
  t.assert(norm(await page.locator('#ov-balance-title').innerText()).includes('Statement balance'), 'labelled "Statement balance"');
  t.assert(norm(await page.locator('.ov-hero__unit').innerText()).includes('token units'), 'unit label shown');
  const asOf = norm(await page.locator('.ov-asof').innerText());
  t.assert(/As of Sep 30, 2026, 11:59\sPM EDT \(America\/New_York\)/.test(asOf), 'as-of date, time and timezone: ' + asOf);
  const fiat = norm(await page.locator('.ov-fiat').innerText());
  t.assert(fiat.includes('USD 1,147.50') && fiat.includes('Illustrative') && fiat.includes('1.0000') && fiat.includes('Illustrative demo rate') && /not a guarantee of value/.test(fiat), 'USD equivalent with rate, source, time and no-guarantee wording');
  t.assert(norm(await page.locator('.ov-fiat__meta').innerText()).includes('Sep 30, 2026'), 'fiat timestamp shown');
  const change = norm(await page.locator('.ov-change').innerText());
  t.assert(change.includes('+147.50 EXUSD') && change.includes('1,000.00 EXUSD'), 'signed net change since opening: ' + change);
  t.eq(await page.locator('.ov-change__value .dir--in').count(), 1, 'direction icon on the net change');
  // A positive change takes the upward trend glyph, never the downward "received" tray arrow.
  const netIcon = await page.evaluate(() => {
    const parse = (name) => {
      const box = document.createElement('div');
      box.innerHTML = YES.ui.icon(name);
      return box.querySelector('svg').innerHTML;
    };
    const inner = document.querySelector('.ov-change__value .dir svg').innerHTML;
    return { up: inner === parse('trend-up'), arrowIn: inner === parse('arrow-in') };
  });
  t.eq(netIcon, { up: true, arrowIn: false }, 'net change +147.50 uses the trend-up glyph');
  const netFit = await page.evaluate(() => {
    const side = document.querySelector('.ov-balance__side').getBoundingClientRect();
    const parts = [...document.querySelectorAll('.ov-change__value > *')].map((e) => e.getBoundingClientRect());
    return parts.every((r) => r.right <= side.right + 0.5 && r.left >= side.left - 0.5);
  });
  t.assert(netFit, 'net change stays inside its column');

  t.step('first screen');
  const fold = await page.evaluate(() => ({
    actions: Math.round(Math.max(...[...document.querySelectorAll('.ov-actions .btn')].map((b) => b.getBoundingClientRect().bottom + scrollY))),
    journey: Math.round(document.getElementById('ov-journey-title').getBoundingClientRect().top + scrollY),
    vh: innerHeight
  }));
  if (vp === 'mobile') t.assert(fold.actions <= fold.vh, 'both primary actions are on the first screen of a 390×844 phone (bottom ' + fold.actions + ')');
  if (wide) t.assert(fold.journey + 32 <= fold.vh, 'the balance journey starts on the first screen at 1280×900 (heading at ' + fold.journey + ')');
  const p0 = await posterFacts(page);
  t.eq(p0.bars, p0.steps, 'poster bars are this statement’s journey steps, not a decorative chart');
  t.assert(p0.contrast >= 4.5, 'poster text contrast (light): ' + p0.contrast);

  t.step('not-in-balance notice');
  const notin = norm(await page.locator('.ov-notin').innerText());
  t.assert(notin.includes('1 pending transaction (−30.00 EXUSD) is not included in this balance.'), 'pending notice: ' + notin);
  t.assert(notin.includes('Pending'), 'status chip with label');
  t.assert(notin.includes('Redemption request awaiting bank settlement · initiated Sep 30, 2026'), 'detail names the date with the "Initiated" field name used elsewhere: ' + notin);
  await spy(page);
  await page.click('[data-fk="ov-notin-view"]');
  t.eq(await calls(page), [{ fn: 'openTx', id: 'TX-260930-2247', fk: 'ov-notin-view', list: null }], 'pending notice opens the pending transaction (a single transaction: no list of its own)');
  // Several transactions outside the balance: "Show them in Transactions" hands
  // the explorer a localised chip label, so the chip follows a language switch.
  await page.evaluate(() => {
    window.__orig = YES.data;
    const copy = JSON.parse(JSON.stringify(YES.data));
    const extra = Object.assign(JSON.parse(JSON.stringify(copy.transactions.find((x) => x.status === 'pending'))), { id: 'TX-260930-2350', seq: 17, status: 'failed', reference: 'REF-T3ST-0002' });
    copy.transactions.push(extra);
    YES.data = copy;
    YES.renderAll();
  });
  t.assert(norm(await page.locator('.ov-notin').innerText()).includes('2 transactions that are not posted (−60.00 EXUSD in total)'), 'notice counts both');
  await spy(page);
  await page.click('[data-fk="ov-notin-all"]');
  t.eq(
    (await calls(page))[0],
    { fn: 'showRows', ids: ['TX-260930-2247', 'TX-260930-2350'], label: { en: 'Not included in this balance', es: 'No incluidos en este saldo' } },
    'Show them in Transactions passes the ids and a { en, es } label'
  );
  await page.evaluate(() => {
    YES.data = window.__orig;
    YES.renderAll();
  });
  await page.click('.nav__link[data-nav="overview"]');

  t.step('statement details');
  const details = page.locator('.ov-details');
  t.eq(await details.evaluate((d) => d.open), false, 'details collapsed by default (secondary)');
  await page.click('[data-fk="ov-details"]');
  t.eq(await details.evaluate((d) => d.open), true, 'details open');
  const dtext = norm(await details.innerText());
  for (const s of ['YES-STM-202609-000184', '1.0', 'Original', 'Period start', 'Period end', 'Statement as of', 'Generated', 'Timezone', 'EDT (America/New_York)', '•••• 7316', '0x5A…E19C', 'Masked', 'Posted date', 'Dates and totals use the posted date.', 'masked to protect your account']) {
    t.assert(dtext.includes(s), 'details include ' + s);
  }
  const masked = await page.$$eval('.ov-details dd .mono', (els) =>
    els.map((e) => ({ hidden: (e.querySelector('[aria-hidden="true"]') || {}).textContent || null, spoken: (e.querySelector('.sr-only') || {}).textContent || null }))
  );
  t.eq(masked[1], { hidden: '•••• 7316', spoken: 'ending in 7316' }, 'masked account number: bullets hidden from assistive technology, "ending in 7316" spoken');
  t.eq(await page.evaluate(() => YES.state.overview.details), true, 'details open state kept in YES.state');
  t.assert(!(await page.locator('.ov-details [data-reveal], .ov-details button').count()), 'no reveal control (feature flag off)');
  await shot(t, 'details', { fullPage: false });

  t.step('primary actions');
  await spy(page);
  await page.click('[data-ov-explore]');
  t.eq((await calls(page))[0], { fn: 'applyFilter', f: {}, o: { reset: true } }, 'Explore transactions resets filters');
  t.eq(await page.evaluate(() => YES.state.view), 'transactions', 'Explore transactions navigates to Transactions');
  await page.click('.nav__link[data-nav="overview"]');
  await page.click('[data-fk="ov-explain-balance"]');
  t.eq(await calls(page), [{ fn: 'assistant', topic: 'balance', id: null }], 'Explain this balance opens the assistant on topic balance');
  t.assert((await page.locator('[data-fk="ov-explain-balance"]').getAttribute('aria-label')).startsWith('Explain this balance'), 'accessible name contains the visible label');

  /* ------------------------------------------------------------ journey */
  t.step('journey values');
  const steps = await page.$$eval('.jr [data-step]', (els) => els.map((e) => ({ id: e.dataset.step, value: +e.dataset.value, tag: e.tagName })));
  t.eq(
    steps.map((s) => s.id),
    ['opening', 'deposits', 'transfers_in', 'transfers_out', 'redemptions', 'fees', 'closing'],
    'seven steps in order'
  );
  t.eq(
    steps.map((s) => s.value),
    [100000, 50000, 20000, -45000, -10000, -250, 114750],
    'step values (minor units)'
  );
  const fromCalc = await page.evaluate(() => YES.calc.journey().map((s) => s.value));
  t.eq(steps.map((s) => s.value), fromCalc, 'values come from YES.calc.journey()');
  t.eq(steps.filter((s) => s.tag === 'BUTTON').length, 5, 'each category step is a button');
  const visible = await page.$$eval('.jr [data-step] .jr-value .ov-num > [aria-hidden="true"]', (els) => els.map((e) => e.textContent.trim()));
  t.eq(visible, ['1,000.00', '+500.00', '+200.00', '−450.00', '−100.00', '−2.50', '1,147.50'], 'exact token values with sign');
  t.eq(await page.locator('.jr [data-ov-step]').evaluateAll((els) => els.every((e) => e.getAttribute('aria-pressed') === 'false')), true, 'all toggles start unpressed');
  const groups = await page.$$eval('.jr-group', (els) => els.map((e) => ({ id: e.dataset.group, value: +e.dataset.value, text: e.innerText.replace(/\s+/g, ' ').trim() })));
  t.eq(groups.map((g) => [g.id, g.value]), [['incoming', 70000], ['outgoing', -55250]], 'two groups with totals');
  t.assert(groups[0].text.includes('Incoming activity') && groups[0].text.includes('+700.00'), 'incoming group label/value');
  t.assert(groups[1].text.includes('Outgoing activity and fees') && groups[1].text.includes('−552.50'), 'outgoing group label/value');
  t.eq(await page.locator('.jr-step--in .jr-dir, .jr-step--out .jr-dir').count(), 5, 'icons accompany direction (not colour alone)');
  t.assert(norm(await page.locator('[data-ov-step="transfers_out"] .sr-only').first().innerText()).includes('minus 450.00 EXUSD'), 'spoken amount says minus');
  // Steps are grouped by type: the levels between them are subtotals, not balances
  // the account held (the ledger never went above 1,250.00).
  const stepText = norm(await page.locator('[data-ov-step="transfers_in"]').innerText());
  t.assert(stepText.includes('Running subtotal after this step: 1,700.00 EXUSD') && !/balance after/i.test(stepText), 'intermediate level is a running subtotal: ' + stepText);
  t.eq(
    await page.$$eval('#view-overview', (els) => (els[0].textContent.match(/Balance after this step|Balance after step/g) || []).length),
    0,
    'no "balance after" label on journey subtotals'
  );
  t.assert(norm(await page.locator('.ov-sechead .ov-legend').innerText()).includes('Opening and closing balance'), 'dark bars keyed as opening and closing balance');
  const layout0 = await journeyLayout(page);
  t.eq(layout0.layout, wide ? 'waterfall' : 'list', 'journey layout for a ' + layout0.width + 'px column');
  t.eq([layout0.broken, layout0.overlaps, layout0.spill], [[], [], []], 'labels wrap between words, values neither collide nor spill');
  if (wide) t.eq(layout0.valueRows, 1, 'waterfall values share one baseline');
  t.eq(
    await page.evaluate(() => [getComputedStyle(document.querySelector('.jr-label')).overflowWrap, getComputedStyle(document.querySelector('.jr-sub')).whiteSpace]),
    ['break-word', 'normal'],
    'labels never break anywhere; counts may wrap (text spacing)'
  );

  t.step('select outgoing transfers with the keyboard');
  const histBefore = await page.evaluate(() => history.length);
  await page.focus('[data-ov-step="transfers_out"]');
  await page.keyboard.press('Enter');
  t.eq(await page.evaluate(() => YES.state.journeyStep), 'transfers_out', 'state.journeyStep set');
  // PRD 5.2: selecting a step filters the transaction explorer to exactly its transactions.
  t.eq(
    await page.evaluate(() => YES.state.filters),
    await page.evaluate(() => Object.assign(YES.defaultFilters(), { step: 'transfers_out' })),
    'the explorer filter follows the selected step (fresh filter, step only)'
  );
  t.eq(await page.evaluate(() => history.length), histBefore + 1, 'selecting from the full journey adds a history entry (Back clears it)');
  t.eq(await page.getAttribute('[data-ov-step="transfers_out"]', 'aria-pressed'), 'true', 'pressed');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'ov-step-transfers_out', 'focus stays on the toggle');
  t.eq(await page.evaluate(() => location.hash), '#/overview/transfers_out', 'deep link reflects the selection');
  const panel = page.locator('#ov-panel-section');
  t.assert(await panel.isVisible(), 'transactions panel visible');
  t.eq(norm(await page.locator('#ov-panel-title').innerText()).trim(), 'Outgoing transfers', 'panel heading names the step');
  const rowIds = await page.$$eval('#ov-panel-section [data-ov-tx]', (els) => els.map((e) => e.getAttribute('data-ov-tx')));
  const expectIds = await page.evaluate(() => YES.calc.category('transfers_out').txIds);
  t.eq(rowIds.length, 5, 'exactly 5 rows');
  t.eq(rowIds, expectIds, 'exactly the step transactions, chronological');
  const rowTexts = await page.$$eval('#ov-panel-section .ov-tx', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  rowTexts.forEach((r, i) => (rowTexts[i] = norm(r)));
  t.assert(rowTexts[0].includes('Sep 3, 2026') && rowTexts[0].includes('Sent') && rowTexts[0].includes('Daniel K.') && rowTexts[0].includes('−120.00'), 'row shows posted date, type label, counterparty and signed amount: ' + rowTexts[0]);
  t.eq(await page.getAttribute('.ov-sum', 'data-sum'), '-45000', 'sum of rows equals the step value');
  const sumText = norm(await page.locator('.ov-sum').innerText());
  t.assert(sumText.includes('−450.00 EXUSD') && sumText.includes('Matches Outgoing transfers in the journey'), 'sum line proves the rows add up: ' + sumText);
  t.eq(await page.locator('.ov-sum--ok').count(), 1, 'sum marked as matching');
  t.eq(norm(await page.locator('.ov-sum__math').innerText()).trim(), '−120.00 − 200.00 − 60.00 − 45.50 − 24.50 = −450.00 EXUSD', 'row arithmetic shown');
  t.assert(norm(await page.locator('#live-polite').innerText()).length >= 0, 'live region exists');
  await page.waitForFunction(() => document.getElementById('live-polite').textContent.includes('Outgoing transfers selected'));
  t.assert(norm(await page.locator('#live-polite').innerText()).includes('5 transactions'), 'selection announced with result count');
  t.eq(await page.locator('.jr-step.is-dim').count(), 6, 'other steps recede');
  t.eq(await page.locator('#ov-panel-section.is-anim').count(), 1, 'panel slides in (motion allowed)');
  if (!wide) {
    // Narrow layout: the panel follows the selected row.
    t.eq(await page.evaluate(() => document.querySelector('[data-step="transfers_out"]').nextElementSibling.id), 'ov-panel', 'panel sits right after the selected row');
  } else {
    t.eq(await page.evaluate(() => document.getElementById('ov-panel').previousElementSibling.classList.contains('jr')), true, 'panel sits below the waterfall');
  }
  await shot(t, 'journey-selected');

  t.step('row opens the transaction');
  await spy(page);
  await page.click('#ov-panel-section [data-ov-tx="TX-260909-2051"]');
  t.eq(await calls(page), [{ fn: 'openTx', id: 'TX-260909-2051', fk: 'ov-tx-TX-260909-2051', list: expectIds }], 'openTx called with id, trigger and the step’s rows in display order');

  t.step('panel actions');
  await page.click('[data-fk="ov-panel-explain"]');
  t.eq(await calls(page), [{ fn: 'assistant', topic: 'step', id: 'transfers_out' }], 'Explain with AI carries the step');
  await page.click('[data-ov-show="transfers_out"]');
  t.eq((await calls(page))[0], { fn: 'applyFilter', f: { step: 'transfers_out' }, o: { reset: true } }, 'Show in Transactions filters to the step');
  t.eq(await page.evaluate(() => YES.state.view), 'transactions', 'navigated to Transactions');
  await page.click('.nav__link[data-nav="overview"]');
  t.eq(await page.evaluate(() => YES.state.journeyStep), 'transfers_out', 'selection survives navigation');

  t.step('clear selection');
  await page.click('[data-ov-clear]');
  t.eq(await page.evaluate(() => YES.state.journeyStep), null, 'cleared');
  t.eq(await page.evaluate(() => YES.state.filters.step), null, 'clearing the step restores the full ledger in the explorer');
  t.eq(await page.locator('#ov-panel-section').count(), 0, 'panel removed');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'ov-step-transfers_out', 'focus returns to the step');
  t.eq(await page.evaluate(() => location.hash), '#/overview', 'deep link cleared');

  t.step('group selection');
  await page.focus('[data-ov-step="outgoing"]');
  await page.keyboard.press('Space');
  t.eq(await page.getAttribute('[data-ov-step="outgoing"]', 'aria-pressed'), 'true', 'group pressed');
  t.eq(await page.locator('#ov-panel-section [data-ov-tx]').count(), 9, 'outgoing group lists 9 rows (5 transfers, 1 redemption, 3 fees)');
  t.eq(await page.getAttribute('.ov-sum', 'data-sum'), '-55250', 'group sum −552.50');
  t.eq(await page.evaluate(() => YES.state.filters.step), 'outgoing', 'a group filters the explorer too');
  const panelFacts = await page.evaluate(() => {
    const sum = document.querySelector('.ov-sum__label');
    const lh = parseFloat(getComputedStyle(sum).lineHeight);
    const jr = document.querySelector('.jr').getBoundingClientRect();
    const panel = document.getElementById('ov-panel-section').getBoundingClientRect();
    const seps = [...document.querySelectorAll('#ov-panel-section .ov-seps')];
    const lineStartsClipped = seps.every((w) => {
      if (getComputedStyle(w).display === 'contents') return true; // table-like row: no separators
      const wl = w.getBoundingClientRect().left;
      let top = null;
      return [...w.querySelectorAll('.ov-seps__in > :not(.sr-only)')].every((it) => {
        const r = it.getBoundingClientRect();
        const starts = top === null || r.top > top + 2;
        top = r.top;
        // An item that starts a line sits one separator left of the wrapper: its "·" is clipped.
        return !starts || r.left + parseFloat(getComputedStyle(it).paddingLeft) <= wl + 0.5;
      });
    });
    return {
      sumOneLine: sum.getBoundingClientRect().height < lh * 1.6,
      textDots: seps.some((w) => /·/.test(w.textContent)),
      lineStartsClipped,
      fullWidth: Math.abs(panel.left - jr.left) < 1
    };
  });
  t.eq([panelFacts.sumOneLine, panelFacts.textDots, panelFacts.lineStartsClipped], [true, false, true], 'panel: "Sum of these rows" on one line; separators drawn by CSS and hidden at line starts');
  if (vp === 'narrow') t.assert(panelFacts.fullWidth, 'phones: the panel uses the full card width (no group indent)');
  t.eq(await page.locator('.jr-step.is-member').count(), 3, 'member steps highlighted');
  t.eq(await page.locator('.jr-check:visible').count(), 1, 'check icon marks the pressed toggle');
  await page.click('[data-ov-step="incoming"]');
  t.eq(await page.getAttribute('[data-ov-step="outgoing"]', 'aria-pressed'), 'false', 'previous group released');
  t.eq(await page.locator('#ov-panel-section [data-ov-tx]').count(), 6, 'incoming group lists 6 rows');
  t.eq(await page.getAttribute('.ov-sum', 'data-sum'), '70000', 'incoming sum +700.00');
  await shot(t, 'journey-group');
  await page.click('[data-ov-step="incoming"]');
  t.eq(await page.evaluate(() => YES.state.journeyStep), null, 'pressing again toggles off');

  t.step('language switch preserves the selection');
  await page.click('[data-ov-step="transfers_out"]');
  await page.click('[data-lang="es"]');
  t.eq(await page.evaluate(() => YES.state.journeyStep), 'transfers_out', 'state kept');
  t.eq(await page.getAttribute('[data-ov-step="transfers_out"]', 'aria-pressed'), 'true', 'still pressed after re-render');
  t.eq(norm(await page.locator('#ov-panel-title').innerText()).trim(), 'Transferencias enviadas', 'panel heading in Spanish');
  t.assert(norm(await page.locator('#ov-panel-section').innerText()).includes('450,00'), 'Spanish number format 450,00');
  t.eq(await page.locator('#ov-panel-section [data-ov-tx]').count(), 5, 'same 5 rows');
  t.assert(norm(await page.locator('#h-overview').innerText()).includes('septiembre de 2026'), 'h1 in Spanish');
  t.eq(
    norm(await page.locator('.ov-handshake').innerText()).trim(),
    'Hola, Sam. Aquí tienes tu actividad de YES del 1 al 30 de septiembre de 2026. Empieza por lo esencial y explora cualquier movimiento que quieras entender mejor. Si algo no te cuadra, estamos aquí para ayudarte.',
    'Spanish handshake reads naturally ("del 1 al 30 de septiembre")'
  );
  t.assert(norm(await page.locator('[data-ov-step="transfers_in"]').innerText()).includes('Subtotal acumulado tras este paso: 1.700,00 EXUSD'), 'Spanish subtotal wording');
  t.assert(norm(await page.locator('.ov-hero__num').innerText()).includes('147,50'), 'hero in Spanish format');
  t.eq(await page.evaluate(() => YES.state.overview.details), true, 'details disclosure state survives');
  t.eq(await page.locator('.ov-details').evaluate((d) => d.open), true, 'details still open');
  t.eq(await page.evaluate(() => YES.i18n.audit()), {}, 'i18n parity');
  const untranslated = await page.evaluate(() => {
    const keys = Object.keys(YES.i18n.dict.en).filter((k) => k.startsWith('overview.'));
    return keys.filter((k) => YES.i18n.dict.es[k] === YES.i18n.dict.en[k] && !/^(Original)$/.test(YES.i18n.dict.en[k]));
  });
  t.eq(untranslated, [], 'every Spanish overview string is translated');
  await page.click('[data-fk="ov-jtable"]');
  await page.click('[data-fk="ov-ctable"]');
  const ovEs = await noHorizontalOverflow(page);
  t.assert(ovEs.scroll, 'no horizontal scroll in Spanish');
  t.eq(ovEs.offenders, [], 'nothing overflows in Spanish');
  t.eq(
    await page.$$eval('.ov-tablebox .table-wrap', (els) => els.map((w) => Math.max(0, w.scrollWidth - w.clientWidth))),
    [0, 0],
    'the journey and running-balance tables fit their width in Spanish (no sideways scroll, down to 320px)'
  );
  t.eq(await brokenWords(page, '.ov-jtable th[scope="row"] .ov-table__label, .ov-jtable th[scope="row"] .ov-table__sub'), [], 'table row headers wrap between words in Spanish');
  const esJourney = await journeyLayout(page);
  t.eq([esJourney.broken, esJourney.overlaps, esJourney.spill], [[], [], []], 'Spanish journey: no broken labels, collisions or spills');
  await page.click('[data-fk="ov-jtable"]');
  await page.click('[data-fk="ov-ctable"]');
  await shot(t, 'spanish');
  await page.click('[data-lang="en"]');
  t.eq(await page.getAttribute('[data-ov-step="transfers_out"]', 'aria-pressed'), 'true', 'still selected after switching back');

  t.step('equation and table view');
  t.eq(await page.getAttribute('.jr-eq', 'data-equation'), '1,000.00 + 500.00 + 200.00 − 450.00 − 100.00 − 2.50 = 1,147.50 EXUSD', 'equation text built from data');
  const spoken = norm(await page.locator('.jr-eq .sr-only').innerText());
  t.assert(spoken.includes('Opening balance 1,000.00 EXUSD') && spoken.includes('minus Outgoing transfers 450.00 EXUSD') && spoken.includes('equals Closing balance 1,147.50 EXUSD'), 'spoken equation: ' + spoken);
  await page.click('[data-fk="ov-jtable"]');
  const table = await page.$$eval('.ov-jtable tbody tr', (rows) => rows.map((r) => Array.from(r.children).map((c) => (c.querySelector('.ov-table__label, [aria-hidden="true"]') || c).textContent.trim())));
  t.eq(
    table,
    [
      ['Opening balance', '—', '1,000.00', '—'],
      ['Deposits', '+500.00', '1,500.00', '3'],
      ['Incoming transfers', '+200.00', '1,700.00', '3'],
      ['Outgoing transfers', '−450.00', '1,250.00', '5'],
      ['Redemptions', '−100.00', '1,150.00', '1'],
      ['Fees', '−2.50', '1,147.50', '3'],
      ['Closing balance', '—', '1,147.50', '—']
    ],
    'journey table: step, change, balance after, count'
  );
  t.assert(norm(await page.locator('.ov-jtable caption').innerText()).includes('Balance journey'), 'table has a caption');
  t.eq(await page.$$eval('.ov-jtable thead th', (ths) => ths.map((th) => th.getAttribute('scope'))), ['col', 'col', 'col', 'col'], 'column headers scoped');

  /* ------------------------------------------------------------ chart */
  t.step('running-balance chart');
  t.eq(await page.locator('.ov-chart__svg').count(), 1, 'chart drawn');
  t.eq(await page.locator('.ov-chart__svg').getAttribute('aria-hidden'), 'true', 'SVG decorative; text alternative carries meaning');
  t.eq(await page.locator('[data-ov-pt]').count(), 15, 'one keyboard point per posted transaction');
  const summary = norm(await page.locator('#ov-chart-summary').innerText());
  t.assert(summary.includes('highest at 1,250.00 EXUSD on September 1, 2026') && summary.includes('lowest at 974.00 EXUSD on September 9, 2026') && summary.includes('1,147.50 EXUSD'), 'summary sentence: ' + summary);
  t.eq(await page.locator('[data-ov-pt][tabindex="0"]').count(), 1, 'roving tabindex: one tab stop');
  const svgBox = await page.locator('.ov-chart__svg').boundingBox();
  const plotBox = await page.locator('#ov-chart-plot').boundingBox();
  t.assert(Math.abs(svgBox.width - plotBox.width) <= 2, 'chart drawn at the container width');
  await page.focus('[data-ov-pt="0"]');
  t.assert(await page.locator('.ov-tip').isVisible(), 'tooltip on focus');
  await page.keyboard.press('ArrowRight');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-ov-pt')), '1', 'arrow key moves to the next point');
  t.assert(norm(await page.locator('.ov-tip').innerText()).includes('1,130.00 EXUSD'), 'tooltip shows balance after the second transaction');
  t.assert(norm(await page.locator('[data-ov-pt="1"]').getAttribute('aria-label')).includes('Balance after: 1,130.00 EXUSD'), 'point has a full accessible name');
  const ptLabels = await page.$$eval('[data-ov-pt]', (els) => els.map((e) => e.getAttribute('aria-label')));
  t.eq(ptLabels.filter((l) => /\.\.|•/.test(l)), [], 'point names: no doubled full stop ("Daniel K.."), masked ids spoken, not bullets');
  t.assert(norm(ptLabels[1]).includes('Daniel K. Balance after') && ptLabels.some((l) => /ending in 4821/.test(l)), 'abbreviated name ends the clause once; masked id read as "ending in"');
  t.eq(await axisCollisions(page), [], 'x-axis date labels do not collide');
  const dodge = await page.evaluate(() => {
    // Same-time markers (a movement and its fee) must not sit on top of each other.
    const at = {};
    document.querySelectorAll('.ov-chart__svg .ov-mk').forEach((mk) => {
      const i = +mk.getAttribute('data-i');
      const b = document.querySelector('[data-ov-pt="' + i + '"]');
      const r = mk.getBoundingClientRect();
      const label = b.getAttribute('aria-label');
      const key = label.slice(0, label.indexOf(': ')); // the date and time
      (at[key] = at[key] || []).push(r.left + r.width / 2);
    });
    return Object.values(at)
      .filter((xs) => xs.length > 1)
      .map((xs) => Math.round(Math.abs(xs[1] - xs[0])));
  });
  t.eq(dodge.length, 3, 'three same-time pairs (Sep 9, 12 and 20)');
  t.assert(dodge.every((d) => d >= 6), 'same-time markers are dodged so both show: ' + dodge.join(', '));
  await page.keyboard.press('End');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-ov-pt')), '14', 'End moves to the last point');
  // Previous / Next in the detail follow the chart: every posted transaction, oldest first.
  const chartOrder = await page.evaluate(() => YES.calc.posted().map((x) => x.id));
  await spy(page);
  await page.keyboard.press('Enter');
  t.eq(await calls(page), [{ fn: 'openTx', id: 'TX-260929-1952', fk: 'ov-pt-TX-260929-1952', list: chartOrder }], 'activating a point opens that transaction within the chart’s order');
  if (wide) {
    const pt = await page.locator('[data-ov-pt="3"]').boundingBox();
    await page.mouse.move(pt.x + pt.width / 2 + 3, pt.y + 40);
    await page.waitForTimeout(50);
    t.assert(await page.locator('.ov-cross').isVisible(), 'crosshair on hover');
    t.assert(norm(await page.locator('.ov-tip').innerText()).includes('975.00 EXUSD'), 'hover snaps to the nearest transaction (movement before its fee)');
    t.assert(norm(await page.locator('.ov-tip').innerText()).includes('+1 more at the same time'), 'tooltip notes same-time transactions');
    await shot(t, 'chart-hover');
    await page.mouse.click(pt.x + pt.width / 2 + 3, pt.y + 40);
    const plotCall = (await calls(page))[0];
    t.eq([plotCall.id, plotCall.list], ['TX-260909-2051', chartOrder], 'clicking the plot opens the nearest transaction, within the chart’s order');
    await page.mouse.move(5, 5);
  }
  await page.click('[data-fk="ov-ctable"]');
  const crow = await page.$$eval('.ov-ctable tbody tr', (rows) => rows.length);
  t.eq(crow, 16, 'chart table: opening row + 15 posted rows');
  await page.click('.ov-ctable [data-ov-tx="TX-260912-0806"]');
  const tableCall = (await calls(page))[0];
  t.eq([tableCall.id, tableCall.list], ['TX-260912-0806', chartOrder], 'table rows open their transaction, within the same order');
  await page.click('[data-fk="ov-chart-explain"]');
  t.eq((await calls(page))[0], { fn: 'assistant', topic: 'chart', id: null }, 'chart Explain with AI');

  t.step('fees and insight');
  const fees = norm(await page.locator('.ov-fees').innerText());
  t.assert(fees.includes('−2.50 EXUSD') && fees.includes('3 fees') && fees.includes('Fees in other assets: none'), 'fees summary: ' + fees);
  t.eq(await page.locator('.ov-fees [data-ov-tx]').count(), 3, 'three fee lines');
  const feeIds = await page.$$eval('.ov-fees [data-ov-tx]', (els) => els.map((e) => e.getAttribute('data-ov-tx')));
  await page.click(`.ov-fees [data-ov-tx="${feeIds[1]}"]`);
  t.eq((await calls(page))[0], { fn: 'openTx', id: feeIds[1], fk: 'ov-fee-' + feeIds[1], list: feeIds }, 'a fee line opens within the fee lines');
  await page.click('[data-fk="ov-fees-explain"]');
  t.eq((await calls(page))[0], { fn: 'assistant', topic: 'fees', id: null }, 'fees Explain with AI');
  const insight = norm(await page.locator('.ov-insight').innerText());
  const largest = await page.evaluate(() => YES.calc.largest().id);
  t.assert(insight.includes('+250.00 EXUSD') && insight.includes('September 1, 2026'), 'insight from calc.largest(): ' + insight);
  t.eq(await page.locator('.ov-insight, .ov-education, [class*="promo"]').count(), 1, 'at most one insight card');
  await page.click('[data-fk="ov-insight-view"]');
  t.eq((await calls(page))[0], { fn: 'openTx', id: largest, fk: 'ov-insight-view', list: null }, 'insight opens the largest transaction (no list of its own)');
  await page.click('[data-fk="ov-insight-learn"]');
  t.eq(await calls(page), [{ fn: 'openTopic', id: 'token_units' }], 'education link opens token units');
  await page.click('[data-fk="ov-fees-show"]');
  t.eq(await page.evaluate(() => YES.state.journeyStep), 'fees', 'Show fees selects the fees step');
  t.eq(await page.evaluate(() => document.activeElement.id), 'ov-panel-title', 'focus moves to the panel heading');
  t.eq(await page.locator('#ov-panel-section [data-ov-tx]').count(), 3, 'three fee rows');

  t.step('order of content');
  const order = await page.evaluate(() => ['.ov-balance', '.ov-journey', '.ov-why', '.ov-video'].map((s) => document.querySelector(s).getBoundingClientRect().top + scrollY));
  t.assert(order[0] < order[1] && order[1] < order[2] && order[2] < order[3], 'balance, journey, why, then video (below essential facts)');

  t.step('selectStep / clearStep API');
  await page.evaluate(() => YES.nav.go('help'));
  await page.evaluate(() => YES.overview.selectStep('redemptions'));
  t.eq(await page.evaluate(() => YES.state.view), 'overview', 'selectStep navigates to Overview');
  t.eq(await page.getAttribute('[data-ov-step="redemptions"]', 'aria-pressed'), 'true', 'step pressed via API');
  t.eq(await page.evaluate(() => document.activeElement.id), 'ov-panel-title', 'API selection focuses the panel heading');
  t.eq(await page.locator('#ov-panel-section [data-ov-tx]').count(), 1, 'one redemption row (the pending one is excluded)');
  t.eq(await page.evaluate(() => YES.overview.selectStep('nope')), false, 'unknown step ignored');
  await page.evaluate(() => YES.overview.clearStep());
  t.eq(await page.evaluate(() => YES.state.journeyStep), null, 'clearStep clears');
  await t.goto('#/overview/deposits');
  t.eq(await page.getAttribute('[data-ov-step="deposits"]', 'aria-pressed'), 'true', 'hash change selects a step');
  await fresh(t, '#/overview/deposits');
  t.eq(await page.getAttribute('[data-ov-step="deposits"]', 'aria-pressed'), 'true', 'deep link selects a step on load');
  t.eq(await page.locator('#ov-panel-section [data-ov-tx]').count(), 3, 'deep-linked panel rows');

  /* ------------------------------------------------------------ video */
  t.step('video placeholder');
  const vcard = norm(await page.locator('.ov-video').innerText());
  t.assert(vcard.includes('Your statement in 60 seconds') && vcard.includes('1:00') && vcard.includes('storyboard, not a video'), 'video card copy');
  t.eq(await page.locator('video, [autoplay]').count(), 0, 'no <video> and no autoplay');
  const play = page.locator('[data-ov-video]');
  t.assert((await play.getAttribute('aria-label')).startsWith('Play'), 'play control labelled');
  await play.click();
  const dlg = page.locator('#video-dialog');
  t.eq(await dlg.evaluate((d) => d.open), true, 'dialog opens');
  t.eq(await page.evaluate(() => document.activeElement.id), 'video-dialog-title', 'focus moves to the dialog heading');
  t.eq(await page.locator('#video-dialog video, #video-dialog [autoplay], #video-dialog iframe').count(), 0, 'no media element in the dialog');
  const dtxt = norm(await dlg.innerText());
  t.assert(dtxt.includes('Placeholder') && dtxt.includes('no video in this demo'), 'dialog says it is a placeholder');
  t.eq(await page.locator('.ov-story__frame').count(), 5, 'five storyboard frames');
  const frames = await page.$$eval('.ov-story__title', (els) => els.map((e) => e.textContent.trim()));
  t.eq(frames, ['Personal greeting', 'Opening and closing balance', 'Largest meaningful movement', 'How to inspect a transaction', 'Where to get help'], 'storyboard order');
  const transcript = norm(await page.locator('.ov-transcript').innerText());
  t.assert(transcript.includes('Hello, Sam.') && transcript.includes('1,000.00 EXUSD') && transcript.includes('1,147.50 EXUSD') && transcript.includes('+147.50 EXUSD') && transcript.includes('+250.00 EXUSD'), 'transcript figures from the same snapshot');
  const req = norm(await page.locator('.ov-req').innerText());
  for (const r of ['approved video asset', 'Captions', 'transcript', 'pause', 'Localized', 'static fallback']) t.assert(req.includes(r), 'production requirement: ' + r);
  await axeOk(t, '#video-dialog', 'video dialog');
  await shot(t, 'video-dialog');
  await page.keyboard.press('Escape');
  t.eq(await dlg.evaluate((d) => d.open), false, 'Escape closes');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'ov-video-play', 'focus returns to the play control');
  await play.click();
  await page.click('[data-fk="ov-video-done"]');
  t.eq(await dlg.evaluate((d) => d.open), false, 'Close button closes');

  t.step('poster draws the approved [YES_LOGO] artwork, like the masthead and print header');
  const posterLogo = () =>
    page.evaluate(() => {
      const poster = document.querySelector('.ov-video__poster');
      const svg = poster.querySelector('.ov-poster__svg');
      const art = svg.querySelector('foreignObject .yes-logo--art.ov-poster__art--art');
      const hello = svg.querySelector('.ov-poster__hello').getBoundingClientRect();
      const r = art && (art.querySelector('svg, img') || art).getBoundingClientRect();
      // Poster units (viewBox 0 0 320 180) to page pixels.
      const m = svg.getScreenCTM();
      return {
        placeholder: svg.querySelectorAll('.ov-poster__logo, .ov-poster__logotext').length,
        art: art ? (art.querySelector('img') ? 'img' : art.querySelector('svg') ? 'svg' : 'empty') : null,
        hidden: art ? art.getAttribute('aria-hidden') === 'true' && !art.hasAttribute('role') : null,
        // In the placeholder's corner (20, 18), at the lettering height, above the greeting, with its own aspect ratio.
        box: r && {
          corner: Math.abs(r.left - (m.a * 20 + m.e)) <= 1 && Math.abs(r.top - (m.d * 18 + m.f)) <= 1,
          height: Math.round(r.height / m.d),
          above: r.bottom <= hello.top,
          ratio: Math.round((r.width / r.height) * 10) / 10
        },
        ink: art ? getComputedStyle(art).color === getComputedStyle(svg.querySelector('.ov-poster__hello')).fill : null
      };
    });
  t.eq(await posterLogo(), { placeholder: 2, art: null, hidden: null, box: null, ink: null }, 'without artwork: the poster’s own text placeholder');
  const before = t.external.length;
  await page.evaluate(() => {
    YES.config.slots.YES_LOGO.svg = '<svg viewBox="0 0 120 40" aria-hidden="true" focusable="false"><rect width="120" height="40" rx="8" fill="currentColor"/></svg>';
    YES.renderAll();
  });
  t.eq(
    await posterLogo(),
    { placeholder: 0, art: 'svg', hidden: true, box: { corner: true, height: 24, above: true, ratio: 3 }, ink: true },
    'approved SVG replaces the placeholder: in its corner, 24 units high, 3:1 kept, poster ink for currentColor'
  );
  await page.evaluate(() => document.querySelector('.ov-video').scrollIntoView({ block: 'center' }));
  await shot(t, 'poster-logo-art', { fullPage: false });
  await page.evaluate(() => {
    delete YES.config.slots.YES_LOGO.svg;
    YES.config.slots.YES_LOGO.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 90 30%22%3E%3Crect width=%2290%22 height=%2230%22 fill=%22%23fff%22/%3E%3C/svg%3E';
    YES.renderAll();
  });
  const dataLogo = await posterLogo();
  t.eq([dataLogo.placeholder, dataLogo.art, dataLogo.box && dataLogo.box.height], [0, 'img', 24], 'a data: image is drawn the same way');
  await page.evaluate(() => {
    YES.config.slots.YES_LOGO.src = 'https://cdn.example.com/logo.png';
    YES.renderAll();
  });
  t.eq((await posterLogo()).placeholder, 2, 'an image URL that would fetch is ignored: the placeholder stays');
  await page.evaluate(() => {
    delete YES.config.slots.YES_LOGO.src;
    YES.renderAll();
  });
  t.eq(t.external.slice(before).filter((u) => /example\.com/.test(u)), [], 'no request for a logo URL');
  t.eq((await posterLogo()).placeholder, 2, 'placeholder restored');

  /* ------------------------------------------------------------ layout & a11y */
  t.step('no horizontal scroll');
  await page.evaluate(() => YES.overview.selectStep('outgoing'));
  const ov = await noHorizontalOverflow(page);
  t.assert(ov.scroll, 'page does not scroll horizontally');
  t.eq(ov.offenders, [], 'no element overflows the viewport');

  t.step('axe');
  await settle(page);
  await axeOk(t, '#view-overview', 'overview with selection and tables open');
  await shot(t, 'full', { fullPage: true });

  t.step('touch targets');
  const small = await page.$$eval('#view-overview button:not(.ov-pt):not(.ov-table__tx), #view-overview summary', (els) =>
    els
      .filter((e) => e.getClientRects().length)
      .map((e) => [e.getAttribute('data-fk'), Math.round(e.getBoundingClientRect().height), Math.round(e.getBoundingClientRect().width)])
      .filter((x) => x[1] < 44 || x[2] < 44)
  );
  t.eq(small, [], 'interactive controls are at least 44px');

  /* ------------------------------------------------------------ data branches */
  t.step('low-data branch');
  await page.evaluate(() => {
    window.__orig = YES.data;
    const copy = JSON.parse(JSON.stringify(YES.data));
    const keep = copy.transactions.filter((x) => x.status === 'posted').slice(0, 2);
    copy.transactions = keep;
    copy.statement.closing = keep[keep.length - 1].balanceAfter;
    YES.data = copy;
    YES.set({ journeyStep: null });
    YES.renderAll();
  });
  t.assert(await page.evaluate(() => YES.calc.reconcile().ok), 'low-data copy reconciles');
  t.eq(await page.locator('.ov-chart__svg').count(), 0, 'no chart with fewer than 3 transactions');
  t.eq(await page.locator('.ov-lowlist li').count(), 2, 'simple list instead');
  t.assert(norm(await page.locator('.ov-lowdata').innerText()).includes('With only 2 transactions'), 'low-data explanation');
  t.eq(await page.locator('.jr [data-step]').count(), 7, 'journey still renders');
  t.eq(await page.getAttribute('.jr-eq', 'data-equation'), '1,000.00 + 250.00 + 0.00 − 120.00 + 0.00 + 0.00 = 1,130.00 EXUSD', 'equation follows the data');
  await page.click('[data-ov-step="transfers_in"]');
  t.assert(norm(await page.locator('#ov-panel-section').innerText()).includes('No transactions contributed'), 'empty step explained');
  await shot(t, 'low-data');

  t.step('mismatch branch: exception instead of journey');
  await page.evaluate(() => {
    YES.data = YES.calc.simulateMismatch(window.__orig);
    YES.set({ journeyStep: null });
    YES.renderAll();
  });
  t.eq(await page.locator('.jr').count(), 0, 'no journey drawn for a non-reconciling statement');
  t.eq(await page.locator('.ov-chart__svg').count(), 0, 'no chart either');
  t.assert(norm(await page.locator('.ov-exception').innerText()).includes('can’t be shown'), 'exception message shown');
  t.eq(await page.locator('.ov-exception[role="alert"]').count(), 1, 'exception is announced');
  await page.evaluate(() => {
    YES.data = window.__orig;
    YES.renderAll();
  });
  t.eq(await page.locator('.jr [data-step]').count(), 7, 'journey restored');

  /* ------------------------------------------------------------ motion & dark */
  t.step('reduced motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(t, '#/overview');
  t.assert(await page.evaluate(() => YES.ui.reducedMotion()), 'reduced motion detected');
  await page.click('[data-ov-step="deposits"]');
  t.eq(await page.locator('#ov-panel-section.is-anim, .jr-step.is-anim').count(), 0, 'no selection animation under reduced motion');
  t.eq(await page.locator('#ov-panel-section [data-ov-tx]').count(), 3, 'content identical without motion');
  const anims = await page.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.getTiming().duration > 1).length);
  t.eq(anims, 0, 'no running animations');

  t.step('runtime warnings');
  t.eq(warnings, [], 'no missing i18n keys or overview warnings at runtime');

  t.step('dark colour scheme');
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await fresh(t, '#/overview/transfers_out');
  await axeOk(t, '#view-overview', 'dark scheme');
  const pd = await posterFacts(page);
  t.assert(pd.contrast >= 4.5 && pd.bg < 0.2, 'dark poster stays deep (luminance ' + pd.bg + ') with readable text (' + pd.contrast + ')');
  await shot(t, 'dark');
  if (wide) {
    await page.evaluate(() => document.getElementById('ov-why-title').scrollIntoView());
    await shot(t, 'dark-why');
  }
  /* ------------------------------------------------------------ history */
  t.step('browser Back clears the selection instead of leaving the statement');
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto('about:blank');
  await t.goto('#/overview');
  const len0 = await page.evaluate(() => history.length);
  await page.click('[data-ov-step="transfers_out"]');
  await page.click('[data-ov-step="deposits"]');
  t.eq(await page.evaluate(() => [location.hash, history.length]), ['#/overview/deposits', len0 + 1], 'one entry for the selection; moving between steps replaces it');
  await page.goBack();
  await page.waitForFunction(() => YES.state.journeyStep === null);
  t.eq(
    await page.evaluate(() => [location.protocol, location.hash, YES.state.view, YES.state.filters.step, !!document.getElementById('ov-panel-section')]),
    ['file:', '#/overview', 'overview', null, false],
    'Back restores the full journey and the full ledger, still inside the statement'
  );
  await page.waitForFunction(() => /Selection cleared/.test(document.getElementById('live-polite').textContent));
  await page.goForward();
  await page.waitForFunction(() => YES.state.journeyStep === 'deposits');
  await page.waitForFunction(() => /Deposits selected/.test(document.getElementById('live-polite').textContent));
  t.eq(await page.evaluate(() => YES.state.filters.step), 'deposits', 'Forward selects the step again (and filters again)');
  await page.click('[data-ov-clear]');
  await page.waitForFunction(() => location.hash === '#/overview');
  t.eq(await page.evaluate(() => history.length), len0 + 1, 'Clear steps back through the same entry, so history does not grow');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'ov-step-deposits', 'focus returns to the step');
  await page.click('[data-ov-step="fees"]');
  await page.click('.nav__link[data-nav="transactions"]');
  await page.goBack();
  await page.waitForFunction(() => YES.state.view === 'overview');
  t.eq(await page.evaluate(() => YES.state.journeyStep), 'fees', 'Back from Transactions returns to the selected step');
  await page.goBack();
  await page.waitForFunction(() => YES.state.journeyStep === null);
  t.eq(await page.evaluate(() => location.protocol), 'file:', 'and the next Back returns to the full journey');

  /* ------------------------------------------------------------ text spacing */
  t.step('WCAG 1.4.12 text spacing');
  await fresh(t, '#/overview');
  await page.addStyleTag({
    content: '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }'
  });
  await page.waitForTimeout(150);
  const hidden = await page.evaluate(() =>
    [...document.querySelectorAll('.jr-sub')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        const plot = e.closest('.jr-step').querySelector('.jr-plot').getBoundingClientRect();
        const underBar = r.right > plot.left + 0.5 && r.left < plot.right - 0.5 && r.bottom > plot.top + 0.5 && r.top < plot.bottom - 0.5;
        return e.scrollWidth > e.clientWidth + 1 || underBar;
      })
      .map((e) => e.textContent)
  );
  t.eq(hidden, [], 'step counts wrap instead of running under the bar');

  /* ------------------------------------------------------------ forced colours */
  t.step('forced colours: the legend matches the bars');
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark', forcedColors: 'active' });
  await fresh(t, '#/overview');
  const paint = (sel) =>
    page.evaluate((s) => {
      const cs = getComputedStyle(document.querySelector(s));
      return cs.backgroundImage !== 'none' ? 'stripes' : cs.backgroundColor;
    }, sel);
  const keys = { in: await paint('.ov-key--in'), out: await paint('.ov-key--out'), total: await paint('.ov-key--total') };
  const bars = { in: await paint('.jr-step--in .jr-bar'), out: await paint('.jr-step--out .jr-bar'), total: await paint('.jr-step--total .jr-bar') };
  t.eq(bars, keys, 'each bar looks like its legend key');
  t.eq(new Set(Object.values(keys)).size, 3, 'adds, reduces and balance are three different marks');
  t.eq(keys.out, 'stripes', 'reduces is a pattern, not only a colour');
  await page.click('[data-ov-step="transfers_out"]');
  const dim = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.jr-step.is-dim .jr-bar'));
    return { opacity: cs.opacity, outline: /inset/.test(cs.boxShadow) };
  });
  t.eq(dim, { opacity: '1', outline: true }, 'receding steps stay visible as outlines');
  await shot(t, 'forced-colors');
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light', forcedColors: 'none' });

  /* ------------------------------------------------------------ container layout */
  if (wide) {
    t.step('journey and balance card lay out for the width they have (docked assistant, narrow windows)');
    const cases = [
      [1100, true, 'en'],
      [1280, true, 'en'],
      [1280, true, 'es'],
      [1440, true, 'en'],
      [900, false, 'en'],
      [900, false, 'es'],
      [1024, false, 'es'],
      [860, false, 'en'],
      [800, false, 'es'],
      [768, false, 'en'],
      [720, false, 'es']
    ];
    for (const [w, docked, lang] of cases) {
      await page.setViewportSize({ width: w, height: 900 });
      await fresh(t, '#/overview/transfers_out');
      if (lang === 'es') await page.click('[data-lang="es"]');
      await page.evaluate((d) => document.documentElement.classList.toggle('assistant-docked', d), docked);
      await page.waitForTimeout(200); // resize observer + rAF
      const L = await journeyLayout(page);
      const where = `${w}px${docked ? ' docked' : ''} ${lang} (${L.width}px column, ${L.layout})`;
      t.eq([L.broken, L.overlaps, L.spill], [[], [], []], 'no broken labels, collisions or spills at ' + where);
      if (L.layout === 'waterfall') t.eq(L.valueRows, 1, 'one value baseline at ' + where);
      t.eq(L.layout, L.width >= 880 ? 'waterfall' : 'list', 'the waterfall only when its column can hold it at ' + where);
      const placed = await page.evaluate(() => (document.getElementById('ov-panel').parentElement.classList.contains('jr') ? 'list' : 'waterfall'));
      t.eq(placed, L.layout, 'the panel sits where the layout puts it at ' + where);
      const card = await page.evaluate(() => {
        const inside = (sel, outer) => [...document.querySelectorAll(sel)].every((e) => e.getBoundingClientRect().right <= outer.right + 0.5);
        const box = document.querySelector('.ov-balance').getBoundingClientRect();
        const side = document.querySelector('.ov-balance__side').getBoundingClientRect();
        return inside('.ov-hero > :not(.sr-only), .ov-notin__actions .btn, .ov-fiat__line', box) && inside('.ov-change__value > *, .ov-actions .btn', side);
      });
      t.assert(card, 'balance card figures and actions stay inside the card at ' + where);
      t.eq(await axisCollisions(page), [], 'chart axis labels do not collide at ' + where);
    }
    t.step('the narrowest waterfall (a 55rem column) keeps every label whole');
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const lang of ['en', 'es']) {
      await fresh(t, '#/overview/transfers_out');
      if (lang === 'es') await page.click('[data-lang="es"]');
      await page.evaluate(() => (document.getElementById('ov-journey-body').style.width = '55rem'));
      await page.waitForTimeout(200);
      const L = await journeyLayout(page);
      // spill: a label wider than its step's column would run into the next step.
      t.eq([L.layout, L.broken, L.overlaps, L.spill, L.valueRows], ['waterfall', [], [], [], 1], `${lang}, ${L.width}px column: no broken labels, collisions or spills`);
      if (lang === 'es') {
        await page.evaluate(() => document.getElementById('ov-journey-title').scrollIntoView());
        await shot(t, 'waterfall-narrowest-es', { fullPage: false });
      }
    }

    t.step('docking while the panel has focus keeps focus');
    await page.setViewportSize({ width: 1280, height: 900 });
    await fresh(t, '#/overview/transfers_out');
    await page.focus('[data-fk="ov-panel-clear"]');
    await page.evaluate(() => document.documentElement.classList.add('assistant-docked'));
    await page.waitForFunction(() => document.getElementById('ov-panel').parentElement.classList.contains('jr'));
    t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'ov-panel-clear', 'focus stays on the same control when the panel moves');
    await shot(t, 'docked-list');
    await page.evaluate(() => document.documentElement.classList.remove('assistant-docked'));
    await page.waitForFunction(() => !document.getElementById('ov-panel').parentElement.classList.contains('jr'));
    t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'ov-panel-clear', 'and when it moves back below the waterfall');
  }
}
