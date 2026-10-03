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

async function spy(page) {
  await page.evaluate(() => {
    window.__calls = [];
    const fk = (o) => (o && o.trigger && o.trigger.getAttribute ? o.trigger.getAttribute('data-fk') : null);
    YES.explorer.openTx = (id, o) => __calls.push({ fn: 'openTx', id, fk: fk(o) });
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

  t.step('not-in-balance notice');
  const notin = norm(await page.locator('.ov-notin').innerText());
  t.assert(notin.includes('1 pending transaction (−30.00 EXUSD) is not included in this balance.'), 'pending notice: ' + notin);
  t.assert(notin.includes('Pending'), 'status chip with label');
  await spy(page);
  await page.click('[data-fk="ov-notin-view"]');
  t.eq(await calls(page), [{ fn: 'openTx', id: 'TX-260930-2247', fk: 'ov-notin-view' }], 'pending notice opens the pending transaction');

  t.step('statement details');
  const details = page.locator('.ov-details');
  t.eq(await details.evaluate((d) => d.open), false, 'details collapsed by default (secondary)');
  await page.click('[data-fk="ov-details"]');
  t.eq(await details.evaluate((d) => d.open), true, 'details open');
  const dtext = norm(await details.innerText());
  for (const s of ['YES-STM-202609-000184', '1.0', 'Original', 'Period start', 'Period end', 'Statement as of', 'Generated', 'Timezone', 'EDT (America/New_York)', '•••• 7316', '0x5A…E19C', 'Masked', 'Posted date', 'Dates and totals use the posted date.', 'masked to protect your account']) {
    t.assert(dtext.includes(s), 'details include ' + s);
  }
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

  t.step('select outgoing transfers with the keyboard');
  await page.focus('[data-ov-step="transfers_out"]');
  await page.keyboard.press('Enter');
  t.eq(await page.evaluate(() => YES.state.journeyStep), 'transfers_out', 'state.journeyStep set');
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
  t.eq(await calls(page), [{ fn: 'openTx', id: 'TX-260909-2051', fk: 'ov-tx-TX-260909-2051' }], 'openTx called with id and trigger');

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
  t.eq(await page.locator('#ov-panel-section').count(), 0, 'panel removed');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'ov-step-transfers_out', 'focus returns to the step');
  t.eq(await page.evaluate(() => location.hash), '#/overview', 'deep link cleared');

  t.step('group selection');
  await page.focus('[data-ov-step="outgoing"]');
  await page.keyboard.press('Space');
  t.eq(await page.getAttribute('[data-ov-step="outgoing"]', 'aria-pressed'), 'true', 'group pressed');
  t.eq(await page.locator('#ov-panel-section [data-ov-tx]').count(), 9, 'outgoing group lists 9 rows (5 transfers, 1 redemption, 3 fees)');
  t.eq(await page.getAttribute('.ov-sum', 'data-sum'), '-55250', 'group sum −552.50');
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
  t.assert(norm(await page.locator('.ov-handshake').innerText()).startsWith('Hola, Sam. Aquí tienes tu actividad de YES del'), 'Spanish handshake');
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
  await page.keyboard.press('End');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-ov-pt')), '14', 'End moves to the last point');
  await spy(page);
  await page.keyboard.press('Enter');
  t.eq(await calls(page), [{ fn: 'openTx', id: 'TX-260929-1952', fk: 'ov-pt-TX-260929-1952' }], 'activating a point opens that transaction');
  if (wide) {
    const pt = await page.locator('[data-ov-pt="3"]').boundingBox();
    await page.mouse.move(pt.x + pt.width / 2 + 3, pt.y + 40);
    await page.waitForTimeout(50);
    t.assert(await page.locator('.ov-cross').isVisible(), 'crosshair on hover');
    t.assert(norm(await page.locator('.ov-tip').innerText()).includes('975.00 EXUSD'), 'hover snaps to the nearest transaction (movement before its fee)');
    t.assert(norm(await page.locator('.ov-tip').innerText()).includes('+1 more at the same time'), 'tooltip notes same-time transactions');
    await shot(t, 'chart-hover');
    await page.mouse.click(pt.x + pt.width / 2 + 3, pt.y + 40);
    t.eq((await calls(page))[0].id, 'TX-260909-2051', 'clicking the plot opens the nearest transaction');
    await page.mouse.move(5, 5);
  }
  await page.click('[data-fk="ov-ctable"]');
  const crow = await page.$$eval('.ov-ctable tbody tr', (rows) => rows.length);
  t.eq(crow, 16, 'chart table: opening row + 15 posted rows');
  await page.click('.ov-ctable [data-ov-tx="TX-260912-0806"]');
  t.eq((await calls(page))[0].id, 'TX-260912-0806', 'table rows open their transaction');
  await page.click('[data-fk="ov-chart-explain"]');
  t.eq((await calls(page))[0], { fn: 'assistant', topic: 'chart', id: null }, 'chart Explain with AI');

  t.step('fees and insight');
  const fees = norm(await page.locator('.ov-fees').innerText());
  t.assert(fees.includes('−2.50 EXUSD') && fees.includes('3 fees') && fees.includes('Fees in other assets: none'), 'fees summary: ' + fees);
  t.eq(await page.locator('.ov-fees [data-ov-tx]').count(), 3, 'three fee lines');
  await page.click('[data-fk="ov-fees-explain"]');
  t.eq((await calls(page))[0], { fn: 'assistant', topic: 'fees', id: null }, 'fees Explain with AI');
  const insight = norm(await page.locator('.ov-insight').innerText());
  const largest = await page.evaluate(() => YES.calc.largest().id);
  t.assert(insight.includes('+250.00 EXUSD') && insight.includes('September 1, 2026'), 'insight from calc.largest(): ' + insight);
  t.eq(await page.locator('.ov-insight, .ov-education, [class*="promo"]').count(), 1, 'at most one insight card');
  await page.click('[data-fk="ov-insight-view"]');
  t.eq((await calls(page))[0].id, largest, 'insight opens the largest transaction');
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
  await shot(t, 'dark');
  if (wide) {
    await page.evaluate(() => document.getElementById('ov-why-title').scrollIntoView());
    await shot(t, 'dark-why');
  }
}
