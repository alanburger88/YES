// Transactions explorer: search, filters, sort, table/cards, detail dialog,
// deep links, language (the masthead is the only switch), CSV export, print,
// Download PDF, light/dark themes, accessibility.
import { readFileSync } from 'node:fs';

export const meta = { name: 'explorer', viewports: ['desktop', 'mobile'], hash: '#/transactions' };

const TRANSFERS_OUT = ['TX-260903-1127', 'TX-260909-2051', 'TX-260918-2011', 'TX-260924-1327', 'TX-260929-1952'];

export default async function (t) {
  const { page } = t;
  const mobile = t.viewport !== 'desktop';
  // Amounts use a no-break space before the unit (YES.fmt); compare with plain spaces.
  const nbsp = (s) => String(s).replace(/\u00a0/g, ' ');

  const ids = () => page.$$eval('#transactions-root [data-tx-row]', (els) => els.map((e) => e.getAttribute('data-tx-row')));
  const count = () => page.locator('#tx-results-title').innerText().then(nbsp);
  const waitCount = (text) => page.waitForFunction((x) => (document.querySelector('#tx-results-title') || {}).textContent === x, text, { timeout: 4000 });
  const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const dialogOpen = () => page.evaluate(() => document.getElementById('tx-dialog').open);
  const activeFk = () => page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-fk'));
  // The dialog's 'close' event (state + route cleanup) fires a task after `open` flips.
  // Closing by the customer steps back over the detail's history entry (async), so
  // also wait for the address to settle before the next navigation.
  const waitClosed = () => page.waitForFunction(() => !document.getElementById('tx-dialog').open && YES.state.selectedTx === null && !/^#\/transactions\/./.test(location.hash), null, { timeout: 3000 });
  const expectFocus = async (fk, msg) => {
    await page.waitForFunction((k) => document.activeElement && document.activeElement.getAttribute('data-fk') === k, fk, { timeout: 2000 }).catch(() => {});
    t.eq(await activeFk(), fk, msg);
  };
  // Real users focus the select before changing it (Playwright's selectOption does not).
  const sortBy = async (v) => {
    await page.focus('#tx-sort');
    await page.selectOption('#tx-sort', v);
  };
  const openPanel = async () => {
    if (!mobile) return;
    if ((await page.getAttribute('[data-tx-toggle]', 'aria-expanded')) !== 'true') await page.click('[data-tx-toggle]');
  };
  const clearAll = async () => {
    await page.evaluate(() => YES.explorer.clearFilters({ focus: false }));
    await waitCount('Showing all 16 transactions');
  };
  // The masthead is the only language switch (ARCHITECTURE rule 7). On phones it
  // lives in the Menu; the first [data-lang] in the DOM is then the hidden
  // desktop switch, so always go through the visible one.
  const headerLang = async (l) => {
    if (mobile) {
      await page.click('#masthead [data-mast-menu]');
      await page.click(`#mast-menu [data-lang="${l}"]`);
      await page.keyboard.press('Escape');
    } else {
      await page.click(`#masthead .mast-wide [data-lang="${l}"]`);
    }
    await page.waitForFunction((x) => YES.i18n.lang === x, l, { timeout: 3000 });
  };
  // A real page load (t.goto with only a new hash is a same-document navigation).
  const fresh = async (hash) => {
    await page.goto('about:blank');
    await t.goto(hash);
  };
  // RFC 4180 CSV (quoted cells may hold commas, quotes and newlines).
  const parseCsv = (text) => {
    const rows = [];
    let row = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') row.push(cell), (cell = '');
      else if (c === '\r' && text[i + 1] === '\n') row.push(cell), rows.push(row), (row = []), (cell = ''), i++;
      else cell += c;
    }
    if (cell || row.length) row.push(cell), rows.push(row);
    return rows;
  };
  const seriousAxe = async (sel, label) => {
    // Start at the top so the sticky masthead does not overlap the controls being measured.
    if (sel === '#view-transactions') await page.evaluate(() => window.scrollTo(0, 0));
    const v = await t.axe(sel);
    const bad = v.filter((x) => x.impact === 'serious' || x.impact === 'critical');
    t.eq(bad, [], `axe serious/critical violations in ${label}`);
    const minor = v.filter((x) => !(x.impact === 'serious' || x.impact === 'critical'));
    if (minor.length) console.log(`    (axe ${label}, ${t.viewport}: ${minor.map((x) => x.id + '/' + x.impact).join(', ')})`);
  };

  /* ------------------------------------------------------------------ */
  t.step('view renders');
  await page.waitForSelector('#h-transactions');
  t.eq(await page.locator('#view-transactions h1').count(), 1, 'exactly one h1 in the view');
  const h1 = page.locator('#h-transactions');
  t.eq((await h1.innerText().then(nbsp)).trim(), 'Transactions', 'h1 text');
  t.eq(await h1.getAttribute('class'), 'view-title', 'h1 class');
  t.eq(await h1.getAttribute('tabindex'), '-1', 'h1 tabindex');
  t.assert((await h1.getAttribute('data-view-heading')) !== null, 'h1 has data-view-heading');
  const lede = await page.locator('#view-transactions .view-lede').innerText().then(nbsp);
  t.assert(lede.includes('Dates and totals use the posted date'), 'lede names the date basis');
  t.assert(lede.includes('America/New_York'), 'lede names the timezone');
  t.assert(/September/.test(lede), 'lede names the period');
  t.eq(await count(), 'Showing all 16 transactions', 'initial count');
  t.eq((await ids()).length, 16, '16 rows');
  t.assert((await page.locator('#transactions-root [data-tx-total]').innerText().then(nbsp)).includes('+147.50 USBC'), 'net change from calc');
  if (mobile) {
    t.eq(await page.locator('.tx-table').count(), 0, 'no table on mobile');
    t.eq(await page.locator('.tx-cards > li.tx-card').count(), 16, '16 stacked cards');
    t.eq(await page.getAttribute('[data-tx-toggle]', 'aria-expanded'), 'false', 'filters collapsed on mobile');
    t.assert(!(await page.locator('#tx-filter-panel').isVisible()), 'filter panel hidden until opened');
  } else {
    t.eq(await page.locator('.tx-table tbody tr').count(), 16, '16 table rows');
    t.assert(await page.locator('#tx-filter-panel').isVisible(), 'filters always visible on desktop');
    t.assert(!(await page.locator('[data-tx-toggle]').isVisible()), 'no filter toggle on desktop');
    t.eq((await page.locator('.tx-table thead th').first().innerText().then(nbsp)).trim(), 'Posted', 'date column shows the posted basis');
    t.eq(await page.locator('.tx-table thead th').first().getAttribute('aria-sort'), 'descending', 'date column sorted');
  }
  // Pending row is explicit and has no balance after.
  const pend = page.locator('[data-tx-row="TX-260930-2247"]');
  t.assert((await pend.innerText().then(nbsp)).includes('Not included in statement balance'), 'pending row says not included');
  t.assert((await pend.innerText().then(nbsp)).includes('Pending'), 'pending row has status chip');
  t.assert(!(await pend.innerText().then(nbsp)).includes('Balance after'), 'pending row has no balance after');
  t.assert(await noHScroll(), 'no horizontal scroll');
  t.eq(await page.evaluate(() => YES.i18n.audit()), {}, 'i18n parity');
  t.eq(await page.locator('#transactions-root a[href^="http"], #transactions-root [src^="http"]').count(), 0, 'no external links');
  await t.shot('list');

  /* ------------------------------------------------------------------ */
  t.step('search keeps focus and caret');
  await page.click('#tx-q');
  await page.locator('#tx-q').pressSequentially('Daniel', { delay: 25 });
  await waitCount('Showing 2 of 16 transactions');
  t.eq(await page.evaluate(() => document.activeElement.id), 'tx-q', 'focus stays in the search box');
  t.eq(await page.evaluate(() => [document.activeElement.value, document.activeElement.selectionStart]), ['Daniel', 6], 'value and caret preserved');
  t.eq((await ids()).sort(), ['TX-260903-1127', 'TX-260929-1952'], 'Daniel matches two transfers');
  const marks = await page.$$eval('#transactions-root [data-tx-row] mark', (els) => els.map((e) => e.textContent));
  t.assert(marks.length >= 2 && marks.every((m) => m.toLowerCase() === 'daniel'), 'matches highlighted with <mark>');
  t.assert((await page.locator('[data-tx-row="TX-260903-1127"] .tx-match').innerText().then(nbsp)).includes('Counterparty'), 'shows which field matched');
  t.assert((await page.locator('[data-tx-chip="q"]').innerText().then(nbsp)).includes('Daniel'), 'search chip');
  await page.waitForFunction(() => document.getElementById('live-polite').textContent.includes('Showing 2 of 16 transactions'), null, { timeout: 4000 });
  await t.shot('search');
  // Facet counts follow the search and the other filters (standard faceting).
  const facet = (k) => page.$eval(`[data-tx-n="${k}"] [aria-hidden]`, (e) => e.textContent);
  t.eq([await facet('direction:all'), await facet('direction:in'), await facet('direction:out'), await facet('types:transfer_out'), await facet('types:deposit')], ['2', '0', '2', '2', '0'], 'facet counts reflect the search');
  t.assert(await page.$eval('[data-tx-n="direction:in"]', (e) => e.closest('.tx-check').classList.contains('is-zero')), 'options that would show nothing are de-emphasised');
  t.eq(await page.$eval('[data-tx-n="direction:out"] .sr-only', (e) => e.textContent), 'results: 2', 'count available to screen readers');

  t.step('search reference, id, status, memo, canonical type, accents');
  const searchFor = async (q) => {
    await page.fill('#tx-q', q);
    await page.waitForTimeout(80);
    return ids();
  };
  t.eq(await searchFor('REF-X1R7'), ['TX-260920-0900'], 'reference search');
  const refMatch = await page.locator('[data-tx-row="TX-260920-0900"] .tx-match').innerText().then(nbsp);
  t.assert(refMatch.includes('Reference') && refMatch.includes('REF-X1R7'), 'reference match shown with its value');
  t.eq(await page.locator('[data-tx-row="TX-260920-0900"] .tx-match mark').innerText().then(nbsp), 'REF-X1R7', 'reference highlighted');
  t.eq(await searchFor('tx-260915'), ['TX-260915-1648'], 'transaction id search (case-insensitive)');
  t.eq(await searchFor('pending'), ['TX-260930-2247'], 'status search');
  t.eq(await page.$$eval('[data-tx-row="TX-260930-2247"] .status mark', (els) => [...new Set(els.map((e) => e.textContent))]), ['Pending'], 'matched status highlighted in its chip');
  const statusMarks = await page.$$eval('#transactions-root [data-tx-row] .status mark', (els) => els.length);
  t.assert(statusMarks >= 1, 'status chip carries a <mark>');
  t.eq(await searchFor('groceries'), ['TX-260924-1327'], 'memo search');
  t.eq((await searchFor('transfer_out')).sort(), TRANSFERS_OUT.slice().sort(), 'canonical type search');
  t.eq((await searchFor('on-chain')).sort(), ['TX-260909-2051', 'TX-260915-1648'], 'rail search');
  t.eq((await searchFor('debit card')).length, 2, 'method/counterparty multi-word search');
  t.eq((await searchFor('Received')).length, 3, 'customer type label search');
  t.eq(await searchFor('45.50'), ['TX-260924-1327'], 'amount search (point)');
  t.assert((await page.locator('[data-tx-row="TX-260924-1327"] .tx-match').innerText().then(nbsp)).includes('Amount'), 'amount match named');
  t.eq(await page.locator('[data-tx-row="TX-260924-1327"] mark.tx-mark-amount').count(), 1, 'matched amount highlighted');
  t.eq(await searchFor('-45,50'), ['TX-260924-1327'], 'amount search (comma, signed)');
  t.eq(await searchFor('+45.50'), [], 'a typed sign is respected');
  t.assert((await searchFor('45')).includes('TX-260924-1327'), 'a whole number finds amounts in that unit');
  t.eq(await searchFor('Redeemed'), ['TX-260920-0900'], 'a pending redemption is not labelled "Redeemed"');
  t.eq(await searchFor('requested'), ['TX-260930-2247'], 'it reads "Redemption requested"');
  t.eq(await searchFor('1190'), ['TX-260912-0805'], 'the visible tail of a masked identifier is searchable');
  const masked = await page.evaluate(() => {
    const row = document.querySelector('[data-tx-row="TX-260912-0805"]');
    const m = row.querySelector('.tx-sub .tx-mask');
    return { label: row.querySelector('[data-tx-open]').getAttribute('aria-label'), hidden: m.querySelector('[aria-hidden="true"]').textContent, spoken: m.querySelector('.sr-only').textContent };
  });
  t.assert(masked.label.includes('Debit card ending in 1190') && !masked.label.includes('•'), 'row name speaks "ending in 1190", not bullets: ' + masked.label);
  t.eq([nbsp(masked.hidden), masked.spoken], ['•••• 1190', 'ending in 1190'], 'bullets hidden from assistive technology, the tail spoken');
  await page.click('[data-tx-q-clear]');
  await waitCount('Showing all 16 transactions');
  t.eq(await page.inputValue('#tx-q'), '', 'clear search button empties the box');
  t.eq(await page.evaluate(() => document.activeElement.id), 'tx-q', 'focus back in search');

  /* ------------------------------------------------------------------ */
  t.step('direction + rail filters');
  await openPanel();
  await page.check('#tx-dir-out');
  await page.check('#tx-rails-onchain');
  await waitCount('Showing 1 of 16 transactions');
  t.eq(await ids(), ['TX-260909-2051'], 'outgoing + on-chain → the network send only');
  const chipTexts = await page.$$eval('[data-tx-chip]', (els) => els.map((e) => e.textContent.trim()));
  t.assert(chipTexts.includes('Direction: Outgoing') && chipTexts.includes('Rail: On-chain'), 'active filter chips');
  if (mobile) t.eq((await page.locator('[data-tx-badge] [aria-hidden]').innerText().then(nbsp)).trim(), '2', 'toggle shows active count');
  await page.click('[data-tx-chip="rail:onchain"]');
  await waitCount('Showing 10 of 16 transactions');
  t.assert(!(await page.isChecked('#tx-rails-onchain')), 'chip removal unchecks the control');
  t.assert(/^tx-chip-|^tx-results-title$/.test((await activeFk()) || ''), 'focus moves to a neighbouring chip');
  await clearAll();

  t.step('amount range (point and comma decimals)');
  await openPanel();
  await page.fill('#tx-min', '100');
  await page.fill('#tx-max', '200');
  await waitCount('Showing 5 of 16 transactions');
  t.eq((await ids()).sort(), ['TX-260903-1127', 'TX-260909-2051', 'TX-260912-0805', 'TX-260920-0900', 'TX-260922-0901'], 'amounts between 100 and 200');
  t.assert((await page.locator('[data-tx-chip="amount"]').innerText().then(nbsp)).includes('100.00 USBC to 200.00 USBC'), 'amount chip');
  await page.fill('#tx-min', '45,5');
  await page.fill('#tx-max', '45.50');
  await waitCount('Showing 1 of 16 transactions');
  t.eq(await ids(), ['TX-260924-1327'], 'comma and point decimals both parsed');
  await page.fill('#tx-min', '4x');
  await page.waitForTimeout(80);
  t.eq(await page.getAttribute('#tx-min', 'aria-invalid'), 'true', 'invalid amount flagged');
  t.assert(await page.locator('#tx-amt-err').isVisible(), 'invalid amount explained');
  t.eq(await page.evaluate(() => [YES.explorer.parseAmount('1,000.50').value, YES.explorer.parseAmount('2.5').value, YES.explorer.parseAmount('−12,30').value]), [100050, 250, 1230], 'parser');
  await clearAll();

  t.step('amount range keeps its meaning across a language switch');
  await openPanel();
  await page.fill('#tx-max', '1,000');
  await waitCount('Showing 16 of 16 transactions');
  t.assert((await page.locator('[data-tx-chip="amount"]').innerText().then(nbsp)).includes('up to 1,000.00 USBC'), 'EN: 1,000 is one thousand');
  await page.evaluate(() => YES.setLang('es'));
  t.eq(await count(), 'Mostrando 16 de 16 movimientos', 'ES: same rows');
  t.eq(await page.inputValue('#tx-max'), '1000', 'input rewritten without an ambiguous separator');
  t.assert((await page.locator('[data-tx-chip="amount"]').innerText().then(nbsp)).includes('hasta 1.000,00 USBC'), 'ES chip: one thousand');
  await page.evaluate(() => YES.setLang('en'));
  await page.fill('#tx-max', '');
  await page.fill('#tx-min', '45.5');
  await waitCount('Showing 10 of 16 transactions');
  await page.evaluate(() => YES.setLang('es'));
  t.eq(await page.inputValue('#tx-min'), '45,50', 'decimals rewritten with the Spanish comma');
  t.eq(await count(), 'Mostrando 10 de 16 movimientos', 'ES: same rows for a decimal minimum');
  await page.evaluate(() => YES.setLang('en'));
  t.eq(await page.inputValue('#tx-min'), '45.50', 'and back');
  await clearAll();

  t.step('date range on the posted basis');
  await openPanel();
  t.eq([await page.getAttribute('#tx-from', 'min'), await page.getAttribute('#tx-to', 'max')], ['2026-09-01', '2026-09-30'], 'date inputs bounded to the period');
  await page.fill('#tx-from', '2026-09-09');
  await page.fill('#tx-to', '2026-09-12');
  await waitCount('Showing 4 of 16 transactions');
  t.eq((await ids()).sort(), ['TX-260909-2051', 'TX-260909-2052', 'TX-260912-0805', 'TX-260912-0806'], 'posted 9–12 September');
  t.assert((await page.locator('[data-tx-chip="date"]').innerText().then(nbsp)).startsWith('Posted:'), 'date chip names the basis');
  await page.fill('#tx-from', '2026-09-20');
  await page.waitForTimeout(80);
  t.assert(await page.locator('#tx-date-err').isVisible(), 'reversed range explained');
  await clearAll();

  t.step('sorting never changes which rows match (the date filter stays on the posted basis)');
  await openPanel();
  await page.fill('#tx-from', '2026-09-01');
  await page.fill('#tx-to', '2026-09-01');
  await waitCount('Showing 1 of 16 transactions');
  t.eq(await ids(), ['TX-260901-0418'], 'posted 1 September');
  await sortBy('initiated:desc');
  await page.waitForTimeout(80);
  t.eq(await count(), 'Showing 1 of 16 transactions', 'a sort-only change keeps the same rows');
  t.eq(await ids(), ['TX-260901-0418'], 'same row after sorting by initiated date');
  t.assert((await page.locator('[data-tx-chip="date"]').innerText().then(nbsp)).startsWith('Posted:'), 'date chip still names the posted basis');
  t.eq([await page.getAttribute('#tx-from', 'min'), await page.getAttribute('#tx-to', 'max')], ['2026-09-01', '2026-09-30'], 'date bounds stay on the period');
  t.assert((await page.locator('#tx-date-legend').innerText().then(nbsp)).includes('posted date'), 'date legend keeps the posted basis');
  t.assert((await page.locator('[data-tx-row="TX-260901-0418"]').innerText().then(nbsp)).includes('Previous period'), 'prior-period initiation tagged');
  const note = await page.locator('.tx-basis-note').innerText().then(nbsp);
  t.assert(note.includes('date column shows when each transaction was initiated') && note.includes('date filter and the totals still use the posted date'), 'basis note: ' + note);
  if (!mobile) t.eq((await page.locator('.tx-table thead th').first().innerText().then(nbsp)).trim(), 'Initiated', 'date column switches to Initiated');
  t.assert((await page.locator('.tx-caption').innerText().then(nbsp)).includes('initiated date'), 'caption names the initiated basis');
  await clearAll();
  await sortBy('initiated:asc');
  await page.waitForTimeout(80);
  t.eq((await ids())[0], 'TX-260901-0418', 'earliest initiated first (31 Aug deposit)');
  await sortBy('posted:desc');

  t.step('posted-date range leaves out unposted rows and says so');
  await page.evaluate(() => YES.explorer.applyFilter({ from: '2026-09-29', to: '2026-09-30' }, { reset: true, navigate: false }));
  await waitCount('Showing 1 of 16 transactions');
  t.eq(await ids(), ['TX-260929-1952'], 'only the transaction posted in the range');
  t.assert((await page.locator('[data-tx-undated]').innerText().then(nbsp)).includes('1 transaction initiated in these dates is not listed') , 'unposted transaction explained');
  await clearAll();
  t.eq(await page.locator('[data-tx-undated]').count(), 0, 'no note without a date range');

  t.step('applyFilter({ announce: false }) leaves the caller to announce');
  await page.evaluate(() => {
    YES.ui.announce('Caller summary.');
    YES.explorer.applyFilter({ step: 'fees' }, { reset: true, navigate: false, announce: false });
  });
  await waitCount('Showing 3 of 16 transactions');
  await page.waitForTimeout(400);
  t.eq(await page.evaluate(() => document.getElementById('live-polite').textContent), 'Caller summary.', 'no count announcement talks over the caller');
  await clearAll();

  t.step('sort by amount');
  await sortBy('amount:desc');
  await page.waitForTimeout(80);
  t.eq((await ids())[0], 'TX-260901-0418', 'largest first');
  await sortBy('amount:asc');
  await page.waitForTimeout(80);
  t.eq((await ids())[0], 'TX-260912-0806', 'smallest first');
  if (!mobile) t.eq(await page.locator('.tx-table thead th.num').first().getAttribute('aria-sort'), 'ascending', 'amount column aria-sort');
  await sortBy('posted:desc');
  await page.waitForTimeout(80);
  t.eq((await ids())[0], 'TX-260930-2247', 'back to newest posted first');

  t.step('zero results + clear all');
  await page.fill('#tx-q', 'zzzz');
  await waitCount('Showing 0 of 16 transactions');
  const empty = page.locator('.tx-empty');
  t.assert(await empty.isVisible(), 'empty state visible');
  t.assert((await empty.innerText().then(nbsp)).includes('“zzzz”'), 'empty state names what is applied');
  await page.click('[data-fk="tx-empty-clear"]');
  await waitCount('Showing all 16 transactions');
  t.eq(await page.inputValue('#tx-q'), '', 'search cleared');
  t.eq(await page.evaluate(() => document.activeElement.id), 'tx-results-title', 'focus on results after clear');
  await page.waitForFunction(() => document.getElementById('live-polite').textContent.includes('All filters cleared'), null, { timeout: 3000 });

  /* ------------------------------------------------------------------ */
  t.step('journey step → exactly 5 rows summing −450.00');
  const listed = await page.evaluate(() => YES.explorer.applyFilter({ step: 'transfers_out' }, { reset: true }).map((x) => x.id));
  t.eq(listed.slice().sort(), TRANSFERS_OUT.slice().sort(), 'applyFilter returns the step rows');
  await waitCount('Showing 5 of 16 transactions');
  t.eq((await ids()).sort(), TRANSFERS_OUT.slice().sort(), 'exactly the outgoing transfers');
  const total = await page.locator('[data-tx-total]').innerText().then(nbsp);
  t.assert(total.includes('Filtered total') && total.includes('−450.00 USBC') && total.includes('5 posted transactions'), 'filtered total ' + total);
  t.eq((await page.locator('[data-tx-chip="step"]').innerText().then(nbsp)).trim(), 'Step: Outgoing transfers', 'step chip');
  t.eq(await page.evaluate(() => document.activeElement.id), 'tx-results-title', 'focus moved to the results');
  t.eq(await page.getAttribute('.tx-chips__back', 'href'), '#/overview', 'way back to the journey');
  await page.waitForFunction(() => document.getElementById('live-polite').textContent.includes('Showing 5 of 16'), null, { timeout: 3000 });
  await page.waitForTimeout(700);
  await t.shot('step');
  await page.click('[data-tx-chip="step"]');
  await waitCount('Showing all 16 transactions');
  t.eq((await ids()).length, 16, 'removing the step chip restores the ledger');

  t.step('showRows with a label');
  await page.evaluate(() => YES.explorer.showRows(['TX-260903-1127', 'TX-260929-1952'], 'Rows used in this explanation'));
  await waitCount('Showing 2 of 16 transactions');
  t.eq((await page.locator('[data-tx-chip="ids"]').innerText().then(nbsp)).trim(), 'Rows used in this explanation (2)', 'id-list chip');
  t.eq(await page.evaluate(() => YES.explorer.filtered().length), 2, 'filtered() API');
  await clearAll();

  t.step('applyFilter from another view navigates');
  await page.evaluate(() => YES.nav.go('overview'));
  await page.evaluate(() => YES.explorer.applyFilter({ step: 'fees' }, { reset: true }));
  t.assert(await page.locator('#view-transactions').isVisible(), 'navigated to Transactions');
  t.eq((await ids()).length, 3, 'fees step → 3 rows');
  t.eq(await page.evaluate(() => location.hash), '#/transactions', 'route is #/transactions');
  await clearAll();

  /* ------------------------------------------------------------------ */
  t.step('open detail by click; Escape returns focus');
  if (mobile) await page.click('[data-tx-row="TX-260903-1127"] .tx-card__foot', { force: true });
  else await page.click('[data-tx-row="TX-260903-1127"] [data-tx-open]');
  await page.waitForFunction(() => document.getElementById('tx-dialog').open);
  t.eq((await page.locator('#tx-dialog-title').innerText().then(nbsp)).trim(), 'Transfer to another YES customer', 'dialog title');
  t.eq(await page.getAttribute('#tx-dialog', 'aria-labelledby'), 'tx-dialog-title', 'dialog labelled by its title');
  t.assert(await page.locator('[data-txd-close]').isVisible(), 'visible close button');
  t.eq(await page.evaluate(() => location.hash), '#/transactions/TX-260903-1127', 'deep-link route');
  t.eq(await page.evaluate(() => YES.state.selectedTx), 'TX-260903-1127', 'selectedTx in state');
  const dtext = await page.locator('#tx-dialog').innerText().then(nbsp);
  for (const s of ['−120.00 USBC', 'US Bank Coin (USBC)', 'Posted', 'Initiated', 'EDT', 'Event type', 'transfer_out', 'Internal (YES)', 'YES transfer', 'Daniel K.', '“Rent share”', '1,130.00 USBC', 'REF-T3M8-4LZ1', 'TX-260903-1127', 'No fees']) {
    t.assert(dtext.includes(s), 'detail shows ' + s);
  }
  t.eq(await page.locator('#tx-dialog .tx-onchain').count(), 0, 'no blockchain section for an internal transfer');
  t.eq(await page.locator('#tx-dialog .tx-kv span[lang], #transactions-root .tx-memo span[lang]').count(), 0, 'a memo in the UI language needs no lang attribute');
  const demoTag = page.locator('#tx-dialog .tx-dlg__demo .tag--illustrative');
  t.assert(await demoTag.isVisible(), 'detail is visibly marked as demo data');
  t.eq((await demoTag.innerText().then(nbsp)).trim(), 'Illustrative demo data', 'demo tag wording');
  t.eq(await page.locator('#tx-dialog [data-lang]').count(), 0, 'no language switch in the detail: the masthead is the only one');
  t.eq(await page.locator('#tx-dialog').getByRole('button', { name: /^(English|Español|EN|ES)$/ }).count(), 0, 'no language buttons by name either');
  t.eq(await page.locator('#tx-dialog [data-txd-copy]').count(), 2, 'copy buttons for reference and id');
  await page.click('[data-txd-copy="ref"]');
  await page.waitForFunction(() => /Copied|Copy is not available/.test(document.getElementById('toast').textContent), null, { timeout: 3000 });
  await page.waitForTimeout(300);
  await t.shot('dialog');
  await seriousAxe('#tx-dialog', 'detail dialog');
  await page.keyboard.press('Escape');
  await waitClosed();
  await expectFocus('tx-open-TX-260903-1127', 'focus returns to the row that opened it');
  await page.waitForFunction(() => location.hash === '#/transactions', null, { timeout: 2000 }).catch(() => {});
  t.eq(await page.evaluate(() => location.hash), '#/transactions', 'route param cleared on close');
  t.eq(await page.evaluate(() => YES.state.selectedTx), null, 'selectedTx cleared');
  t.eq(await page.locator('#tx-dialog button').count(), 0, 'no stale controls left in the closed dialog');

  t.step('browser Back closes the detail and stays in the list');
  await page.click('[data-tx-row="TX-260909-2051"] [data-tx-open]', { force: true });
  await page.waitForFunction(() => document.getElementById('tx-dialog').open);
  t.eq(await page.evaluate(() => location.hash), '#/transactions/TX-260909-2051', 'opening the detail adds a history entry for it');
  await page.goBack();
  await waitClosed();
  t.eq(await page.evaluate(() => [YES.state.view, location.hash]), ['transactions', '#/transactions'], 'Back closes the detail and stays in Transactions');
  await expectFocus('tx-open-TX-260909-2051', 'focus returns to the row, not <body>');
  await page.goForward();
  await page.waitForFunction(() => document.getElementById('tx-dialog').open && YES.state.selectedTx === 'TX-260909-2051', null, { timeout: 3000 });
  t.assert(true, 'Forward reopens it');
  await page.click('[data-txd-close]');
  await waitClosed();
  await page.waitForFunction(() => location.hash === '#/transactions', null, { timeout: 2000 }).catch(() => {});
  t.eq(await page.evaluate(() => YES.state.view), 'transactions', 'closing after Forward stays in Transactions');

  t.step('open detail by keyboard; next/previous');
  await page.focus('[data-fk="tx-open-TX-260905-0733"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('tx-dialog').open);
  t.eq(await page.evaluate(() => document.activeElement.id), 'tx-dialog-title', 'focus moves into the dialog');
  t.eq((await page.locator('.tx-pager__long').textContent().then(nbsp)).trim(), '14 of 16', 'position in list');
  await page.focus('[data-fk="txd-next"]');
  await page.keyboard.press('Enter');
  t.eq((await page.locator('#tx-dialog-title').innerText().then(nbsp)).trim(), 'Transfer to another YES customer', 'next transaction');
  t.eq(await activeFk(), 'txd-next', 'focus stays on Next, so the next press moves on again');
  await page.waitForFunction(() => /Showing Transfer to another YES customer, 15 of 16\./.test((document.querySelector('#tx-dialog .dlg-live--polite') || {}).textContent || ''), null, { timeout: 2000 }).catch(() => {});
  t.eq(await page.evaluate(() => (document.querySelector('#tx-dialog .dlg-live--polite') || {}).textContent), 'Showing Transfer to another YES customer, 15 of 16.', 'change announced with the position');
  await page.keyboard.press('Enter');
  t.eq(await page.evaluate(() => YES.state.selectedTx), 'TX-260901-0418', 'last transaction');
  t.eq(await activeFk(), 'txd-prev', 'at the end, focus moves to Previous (Next is disabled)');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  t.eq(await page.evaluate(() => YES.state.selectedTx), 'TX-260905-0733', 'and back with Previous');
  await page.click('[data-fk="txd-next"]');
  t.eq(await page.evaluate(() => YES.state.selectedTx), 'TX-260903-1127', 'selectedTx follows next');
  t.eq(await page.evaluate(() => location.hash), '#/transactions/TX-260903-1127', 'route follows next');
  await page.click('[data-fk="txd-prev"]');
  t.eq(await page.evaluate(() => YES.state.selectedTx), 'TX-260905-0733', 'previous transaction');
  await page.click('[data-txd-close]');
  await waitClosed();
  await expectFocus('tx-open-TX-260905-0733', 'close button returns focus to the row');

  t.step('previous/next follow the list the detail was opened from');
  await page.evaluate(() => YES.explorer.applyFilter({ step: 'transfers_out' }, { reset: true }));
  await waitCount('Showing 5 of 16 transactions');
  await page.click('[data-tx-row="TX-260924-1327"] [data-tx-open]', { force: true });
  await page.waitForFunction(() => document.getElementById('tx-dialog').open);
  t.eq((await page.locator('.tx-pager__long').textContent().then(nbsp)).trim(), '2 of 5', 'pager counts the step rows');
  await page.click('[data-fk="txd-prev"]');
  t.eq(await page.evaluate(() => YES.state.selectedTx), 'TX-260929-1952', 'Previous stays within the step');
  await page.click('[data-txd-close]');
  await waitClosed();
  await clearAll();
  // Opened from another view with an explicit list (the overview step panel).
  await page.evaluate(() => YES.explorer.openTx('TX-260924-1327', { list: ['TX-260903-1127', 'TX-260909-2051', 'TX-260918-2011', 'TX-260924-1327', 'TX-260929-1952'] }));
  t.eq((await page.locator('.tx-pager__long').textContent().then(nbsp)).trim(), '4 of 5', 'explicit list: 4 of 5');
  await page.click('[data-fk="txd-next"]');
  t.eq(await page.evaluate(() => YES.state.selectedTx), 'TX-260929-1952', 'Next opens the 5th outgoing transfer, not a deposit');
  t.assert(await page.locator('[data-fk="txd-next"]').isDisabled(), 'end of the list');
  await page.evaluate(() => YES.explorer.closeTx());
  await waitClosed();
  // Inferred from the trigger's own list when the caller passes none.
  await page.evaluate(() => {
    const ul = document.createElement('ul');
    ul.id = 'fake-list';
    ul.innerHTML = ['TX-260905-0733', 'TX-260915-1648', 'TX-260926-1009'].map((id) => `<li><button type="button" data-demo-tx="${id}">${id}</button></li>`).join('');
    document.getElementById('transactions-root').appendChild(ul);
    YES.explorer.openTx('TX-260915-1648', { trigger: ul.querySelector('[data-demo-tx="TX-260915-1648"]') });
  });
  t.eq((await page.locator('.tx-pager__long').textContent().then(nbsp)).trim(), '2 of 3', 'list inferred from the trigger');
  await page.evaluate(() => YES.explorer.closeTx());
  await waitClosed();
  await page.evaluate(() => document.getElementById('fake-list').remove());

  t.step('fee links both ways');
  await page.click('[data-tx-row="TX-260909-2051"] [data-tx-open]', { force: true });
  await page.waitForFunction(() => document.getElementById('tx-dialog').open);
  const fees = await page.locator('#tx-dialog .tx-fees').innerText().then(nbsp);
  t.assert(fees.includes('Network transfer fee') && fees.includes('−1.00 USBC') && fees.includes('TX-260909-2052'), 'parent lists its fee line');
  t.assert((await page.locator('#tx-dialog .tx-fees__total').innerText().then(nbsp)).includes('−201.00 USBC'), 'total including fees');
  await page.click('[data-fk="txd-fee-TX-260909-2052"]');
  t.eq((await page.locator('#tx-dialog-title').innerText().then(nbsp)).trim(), 'Fee for sending to an external wallet', 'fee line opened');
  t.assert((await page.locator('#tx-dialog').innerText().then(nbsp)).includes('This fee belongs to'), 'fee links back');
  await page.click('[data-fk="txd-parent"]');
  t.eq(await page.evaluate(() => YES.state.selectedTx), 'TX-260909-2051', 'back to the parent');
  await page.keyboard.press('Escape');
  await waitClosed();
  await expectFocus('tx-open-TX-260909-2051', 'focus returns to the row of the transaction shown last');

  t.step('inquiry and explain actions');
  await page.evaluate(() => {
    window.__inq = [];
    window.__ai = null;
    // Records the id, where focus is to return, and whether the detail was still open.
    YES.inquiry.start = (id, o) => window.__inq.push([id, o && o.trigger ? o.trigger.getAttribute('data-fk') : null, document.getElementById('tx-dialog').open]);
    YES.assistant.open = (ctx) => {
      window.__ai = { topic: ctx.topic, id: ctx.id, trigger: ctx.trigger && ctx.trigger.getAttribute('data-fk') };
    };
  });
  await page.click('[data-tx-row="TX-260918-2011"] [data-tx-open]', { force: true });
  await page.waitForFunction(() => document.getElementById('tx-dialog').open);
  t.eq((await page.locator('[data-fk="txd-ask"]').innerText().then(nbsp)).trim(), 'Ask about this transaction', 'ask label');
  await page.click('[data-fk="txd-ask"]');
  t.eq(await page.evaluate(() => window.__inq), [['TX-260918-2011', 'tx-open-TX-260918-2011', false]], 'the detail closes itself, then hands the inquiry the row to return to');
  await waitClosed();
  t.eq(await page.evaluate(() => [YES.state.selectedTx, location.hash]), [null, '#/transactions'], 'the hand-off steps back over the detail’s history entry');
  await page.click('[data-tx-row="TX-260918-2011"] [data-tx-open]', { force: true });
  await page.waitForFunction(() => document.getElementById('tx-dialog').open);
  await page.evaluate(() => {
    YES.inquiry.draftFor = (id) => (id === 'TX-260918-2011' ? { txId: id, step: 2, status: 'draft' } : null);
    YES.set({ inquiry: { txId: 'TX-260918-2011', step: 2, status: 'draft' } });
  });
  t.eq((await page.locator('[data-fk="txd-ask"]').innerText().then(nbsp)).trim(), 'Continue your inquiry', 'continue label for a draft');
  await page.evaluate(() => {
    YES.inquiry.draftFor = (id) => (id === 'TX-260918-2011' ? { txId: id, step: 4, status: 'submitted', ref: 'DEMO-0001' } : null);
    YES.set({ inquiry: { txId: 'TX-260918-2011', step: 4, status: 'submitted', ref: 'DEMO-0001' } });
  });
  t.assert((await page.locator('#tx-dialog').innerText().then(nbsp)).includes('Demo only — no inquiry was sent'), 'submitted demo inquiry is labelled');
  await page.click('[data-fk="txd-explain"]');
  t.eq(await page.evaluate(() => window.__ai), { topic: 'transaction', id: 'TX-260918-2011', trigger: 'tx-open-TX-260918-2011' }, 'explain opens the assistant with context');
  t.assert(!(await dialogOpen()), 'detail hands over to the assistant');

  /* ------------------------------------------------------------------ */
  t.step('deep link to the on-chain sample (fresh load)');
  await fresh('#/transactions/TX-260909-2051');
  await page.waitForFunction(() => document.getElementById('tx-dialog').open);
  const oc = await page.locator('#tx-dialog .tx-onchain').innerText().then(nbsp);
  t.assert(oc.includes('Illustrative reference — no live blockchain verification'), 'exact illustrative label');
  t.assert(oc.includes('Example Network (illustrative)') && oc.includes('0xDE40…E19C') && oc.includes('64'), 'network, hash, confirmations');
  t.assert(oc.includes('no explorer link'), 'explains why there is no explorer link');
  t.eq(await page.locator('#tx-dialog a[href^="http"], #tx-dialog [href*="://"]').count(), 0, 'no explorer/http link');
  t.eq(await page.locator('[data-txd-copy="hash"]').count(), 1, 'hash copy button');
  await page.waitForTimeout(300);
  await t.shot('onchain');
  await seriousAxe('#tx-dialog', 'on-chain dialog');

  t.step('unverified on-chain, pending, prior period');
  await page.evaluate(() => YES.explorer.openTx('TX-260915-1648'));
  const uv = await page.locator('#tx-dialog .tx-onchain').innerText().then(nbsp);
  t.assert(uv.includes('appear only when verified') && !uv.includes('Illustrative reference'), 'unverified transfer shows no chain details');
  await page.evaluate(() => YES.explorer.openTx('TX-260930-2247'));
  const pd = await page.locator('#tx-dialog').innerText().then(nbsp);
  t.assert(pd.includes('Not included in statement balance') && pd.includes('Not posted'), 'pending detail is explicit');
  t.assert(pd.includes('Redemption requested') && !pd.includes('Redeemed'), 'a pending redemption reads "Redemption requested"');
  t.eq(await page.$eval('#tx-dialog .tx-kv .sr-only', (e) => e.textContent).catch(() => null), 'ending in 4821', 'masked counterparty spoken as "ending in 4821"');
  t.eq(await page.evaluate(() => location.hash), '#/transactions/TX-260930-2247', 'route follows openTx');
  await page.evaluate(() => YES.explorer.openTx('TX-260901-0418'));
  const pp = await page.locator('#tx-dialog').innerText().then(nbsp);
  // The note itself is statement data (01-data.js); the explorer shows it in full.
  const ppNote = nbsp(await page.evaluate(() => YES.L(YES.calc.tx('TX-260901-0418').notes[0])));
  t.assert(pp.includes('Previous period') && pp.includes(ppNote) && pp.includes('August 31'), 'prior-period note');
  // Without a note of its own, the detail explains the prior-period initiation itself.
  const ppFallback = await page.evaluate(() => {
    const tx = YES.calc.tx('TX-260901-0418');
    const keep = tx.notes;
    tx.notes = [];
    YES.explorer.openTx(tx.id);
    const el = document.querySelector('#tx-dialog .tx-prevnote');
    tx.notes = keep;
    YES.explorer.openTx(tx.id);
    return el ? el.textContent : null;
  });
  t.assert(/^Initiated in the previous period\./.test(ppFallback || ''), 'fallback note says "Initiated", like the field: ' + ppFallback);
  await page.evaluate(() => YES.explorer.closeTx());
  t.assert(!(await dialogOpen()), 'closeTx closes');
  t.eq(await page.evaluate(() => location.hash), '#/transactions', 'closeTx clears the route');

  t.step('route changes open the detail (hashchange)');
  await page.evaluate(() => (location.hash = '#/transactions/TX-260912-0805'));
  await page.waitForFunction(() => YES.state.selectedTx === 'TX-260912-0805', null, { timeout: 3000 });
  t.assert(await dialogOpen(), 'hashchange to a transaction opens it');
  await page.evaluate(() => (location.hash = '#/transactions'));
  await waitClosed();
  t.assert(!(await dialogOpen()), 'hashchange away from the transaction closes it');

  t.step('closing a detail never erases a newer transaction address');
  await page.evaluate(() => YES.explorer.openTx('TX-260905-0733'));
  // (An open right after a close waits for that close's native 'close' event.)
  await page.waitForFunction(() => document.getElementById('tx-dialog').open && YES.state.selectedTx === 'TX-260905-0733', null, { timeout: 2000 }).catch(() => {});
  t.eq(await page.evaluate(() => location.hash), '#/transactions/TX-260905-0733', 'detail open with its own address');
  await page.evaluate(() => {
    // A newer link is in the address bar but not applied yet, and the close
    // (as by Escape) is handled first: neither stepping back nor a rewrite may erase it.
    history.replaceState(null, '', '#/transactions/TX-260912-0805');
    document.getElementById('tx-dialog').close();
  });
  await page.waitForFunction(() => YES.state.selectedTx === null, null, { timeout: 2000 });
  await page.waitForTimeout(150);
  t.eq(await page.evaluate(() => location.hash), '#/transactions/TX-260912-0805', 'the newer address is kept');
  await page.evaluate(() => YES.nav.apply());
  await page.waitForFunction(() => YES.state.selectedTx === 'TX-260912-0805', null, { timeout: 2000 }).catch(() => {});
  t.assert((await dialogOpen()) && (await page.evaluate(() => YES.state.selectedTx)) === 'TX-260912-0805', 'and opens its transaction');
  await page.evaluate(() => YES.explorer.closeTx());
  await waitClosed();

  t.step('unknown transaction in the route');
  await fresh('#/transactions/TX-000000-0000');
  t.assert(!(await dialogOpen()), 'no dialog for an unknown id');
  t.eq(await page.evaluate(() => location.hash), '#/transactions', 'unknown id removed from the route');

  t.step('openTx over another view keeps that view');
  await t.goto('#/overview');
  await page.evaluate(() => YES.explorer.openTx('TX-260905-0733'));
  t.assert(await dialogOpen(), 'dialog opens over the overview');
  t.eq(await page.evaluate(() => location.hash), '#/overview', 'overview route kept');
  await page.keyboard.press('Escape');
  t.assert(!(await dialogOpen()), 'closed');

  /* ------------------------------------------------------------------ */
  t.step('the detail follows the masthead language; filters and the row survive a switch');
  await fresh('#/transactions');
  await page.evaluate(() => YES.explorer.applyFilter({ step: 'transfers_out' }, { reset: true }));
  await page.click('[data-tx-row="TX-260903-1127"] [data-tx-open]', { force: true });
  await page.waitForFunction(() => document.getElementById('tx-dialog').open);
  t.eq(await page.locator('#tx-dialog [data-lang]').count(), 0, 'the detail has no language switch of its own');
  // A programmatic switch while it is open re-renders it in place, on the same
  // transaction, with focus kept on the same control.
  await page.focus('#tx-dialog [data-fk="txd-close"]');
  await page.evaluate(() => YES.setLang('es'));
  t.assert(await dialogOpen(), 'still open after YES.setLang');
  t.eq(await page.evaluate(() => YES.state.selectedTx), 'TX-260903-1127', 'same transaction after YES.setLang');
  t.eq((await page.locator('#tx-dialog-title').innerText().then(nbsp)).trim(), 'Transferencia a otro cliente de YES', 're-rendered in Spanish in place');
  t.eq(await activeFk(), 'txd-close', 'focus kept on the close button');
  t.eq(await page.locator('#tx-dialog [data-lang]').count(), 0, 'still no switch after a re-render');
  await page.evaluate(() => YES.setLang('en'));
  t.eq((await page.locator('#tx-dialog-title').innerText().then(nbsp)).trim(), 'Transfer to another YES customer', 'and back to English in place');
  // The customer's way: close the detail, switch in the masthead (the phone
  // Menu), reopen the same row. The page behind the modal is inert meanwhile.
  await page.click('#tx-dialog [data-txd-close]');
  await waitClosed();
  await expectFocus('tx-open-TX-260903-1127', 'closing returns focus to the row');
  await headerLang('es');
  t.eq(await page.evaluate(() => YES.state.filters.step), 'transfers_out', 'filters kept in state');
  t.eq(await count(), 'Mostrando 5 de 16 movimientos', 'Spanish count, same filter');
  t.assert((await page.locator('[data-tx-total]').innerText().then(nbsp)).includes('−450,00 USBC'), 'Spanish filtered total 450,00');
  t.eq((await page.locator('[data-tx-chip="step"]').innerText().then(nbsp)).trim(), 'Paso: Transferencias enviadas', 'Spanish chip');
  t.assert(await page.locator('[data-tx-row="TX-260903-1127"]').isVisible(), 'the same row is still in the list');
  await page.click('[data-tx-row="TX-260903-1127"] [data-tx-open]', { force: true });
  await page.waitForFunction(() => document.getElementById('tx-dialog').open);
  t.eq(await page.evaluate(() => YES.state.selectedTx), 'TX-260903-1127', 'same transaction reopened');
  t.eq((await page.locator('#tx-dialog-title').innerText().then(nbsp)).trim(), 'Transferencia a otro cliente de YES', 'reopened in the language chosen in the masthead');
  const esDlg = await page.locator('#tx-dialog').innerText().then(nbsp);
  t.assert(esDlg.includes('−120,00 USBC') && esDlg.includes('Preguntar por este movimiento'), 'Spanish amounts and actions');
  t.eq(await page.locator('#tx-dialog [data-lang]').count(), 0, 'still no language switch in the Spanish detail');
  t.eq(await page.evaluate(() => YES.i18n.audit()), {}, 'i18n parity after switch');
  // WCAG 3.1.2: the customer's own memo is not translated, so it keeps the statement's language.
  t.eq(await page.evaluate(() => [...document.querySelectorAll('#tx-dialog .tx-kv span[lang], [data-tx-row="TX-260903-1127"] .tx-memo span[lang]')].map((e) => e.getAttribute('lang') + ':' + e.textContent)), ['en:Rent share', 'en:Rent share'], 'memo marked lang="en" in the Spanish detail and row');
  t.assert(nbsp(await page.locator('#tx-dialog .tx-kv').innerText()).includes('«Rent share»'), 'memo quoted the Spanish way');
  t.eq((await page.locator('#tx-dialog .tag--illustrative').innerText().then(nbsp)).trim(), 'Datos ilustrativos de demostración', 'Spanish demo tag');
  await page.waitForTimeout(300);
  await t.shot('es-dialog');
  await seriousAxe('#tx-dialog', 'Spanish detail dialog');
  await page.keyboard.press('Escape');
  await waitClosed();
  await expectFocus('tx-open-TX-260903-1127', 'focus returns to the row');
  t.eq((await page.locator('#h-transactions').innerText().then(nbsp)).trim(), 'Movimientos', 'Spanish h1');
  await t.shot('es-list');

  t.step('Spanish CSV headers');
  const esCsv = await page.evaluate(() => YES.explorer.csv('all'));
  t.assert(esCsv.split('\r\n')[0].includes('ID del movimiento') && esCsv.split('\r\n')[0].includes('Clasificación de los datos'), 'localized CSV headers');
  t.assert(esCsv.includes('-120.00'), 'machine-readable amounts stay "." decimals in Spanish');
  await page.evaluate(() => YES.setLang('en'));
  t.eq(await count(), 'Showing 5 of 16 transactions', 'back to English, filter intact');

  /* ------------------------------------------------------------------ */
  t.step('CSV — complete record');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-fk="tx-csv-all"]')]);
  const name = dl.suggestedFilename();
  t.assert(name.includes('YES-STM-202609-000184') && name.includes('DEMO') && name.endsWith('.csv'), 'filename ' + name);
  const buf = readFileSync(await dl.path());
  t.eq([buf[0], buf[1], buf[2]], [0xef, 0xbb, 0xbf], 'UTF-8 BOM');
  const text = buf.toString('utf8').replace(/^﻿/, '');
  const lines = text.split('\r\n').filter(Boolean);
  t.eq(lines.length, 17, 'header + 16 rows');
  const header = lines[0].split(',');
  for (const h of ['Statement ID', 'Transaction ID', 'Posted date', 'Initiated date', 'Event type', 'Type', 'Description', 'Counterparty', 'Direction', 'Amount', 'Asset', 'Balance after', 'Status', 'Included in statement balance', 'Rail', 'Reference', 'Data classification']) {
    t.assert(header.includes(h), 'header has ' + h);
  }
  t.assert(lines.slice(1).every((l) => l.endsWith(',ILLUSTRATIVE_DEMO_DATA')), 'every row classified');
  const row = lines.find((l) => l.includes('TX-260903-1127')).split(',');
  const col = (h) => row[header.indexOf(h)];
  t.eq([col('Statement ID'), col('Posted date'), col('Posted time'), col('Event type'), col('Type'), col('Direction'), col('Amount'), col('Balance after'), col('Status'), col('Included in statement balance'), col('Rail'), col('Reference')], ['YES-STM-202609-000184', '2026-09-03', '18:40', 'transfer_out', 'Sent', 'outgoing', '-120.00', '1130.00', 'posted', 'true', 'internal', 'REF-T3M8-4LZ1'], 'machine-readable values');
  const prow = lines.find((l) => l.includes('TX-260930-2247')).split(',');
  t.eq([prow[header.indexOf('Posted date')], prow[header.indexOf('Balance after')], prow[header.indexOf('Included in statement balance')], prow[header.indexOf('Status')]], ['', '', 'false', 'pending'], 'pending row');
  t.eq(lines.find((l) => l.includes('TX-260901-0418')).split(',')[header.indexOf('Initiated date')], '2026-08-31', 'initiated date in statement timezone');
  // Statement-level facts on every row (rectangular, so it opens in any spreadsheet).
  t.eq(
    ['Statement version', 'Issue status', 'Period start', 'Period end', 'Statement as of', 'Generated', 'Date basis', 'Opening balance', 'Closing balance', 'Export scope'].map((h) => col(h)),
    ['1.0', 'original', '2026-09-01', '2026-09-30', '2026-09-30 23:59', '2026-10-01 06:15', 'posted', '1000.00', '1147.50', 'Complete record'],
    'statement facts in the complete record'
  );
  const net = lines.slice(1).map((l) => l.split(',')).filter((r) => r[header.indexOf('Included in statement balance')] === 'true').reduce((a, r) => a + Math.round(parseFloat(r[header.indexOf('Amount')]) * 100), 0);
  t.eq(100000 + net, 114750, 'opening + included amounts = closing, from the file alone');
  // The browser gives no signal that a download finished, so the toast says it started.
  await page.waitForFunction(() => /CSV download started \(16 transactions\)/.test(document.getElementById('toast').textContent) && document.getElementById('toast').textContent.includes('Nothing was sent'), null, { timeout: 3000 });

  t.step('CSV — current view + escaping');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-fk="tx-csv-view"]')]);
  t.assert(dl2.suggestedFilename().includes('current-view') && dl2.suggestedFilename().includes('DEMO'), 'current-view filename');
  const rows2 = parseCsv(readFileSync(await dl2.path(), 'utf8').replace(/^﻿/, ''));
  t.eq(rows2.length, 6, 'header + 5 filtered rows');
  const scope = rows2[1][rows2[0].indexOf('Export scope')];
  t.assert(scope.includes('Current view') && scope.includes('Step: Outgoing transfers') && scope.includes('Posted date, newest first'), 'current view records its filter and order: ' + scope);
  t.assert(rows2.every((r) => r.length === rows2[0].length), 'rectangular');
  const esc = await page.evaluate(() => {
    const tx = JSON.parse(JSON.stringify(YES.calc.tx('TX-260903-1127')));
    tx.id = 'TX-TEST-0001';
    tx.memo = 'Say "hi", then\nleave';
    tx.counterparty = { en: '=SUM(A1)', es: '=SUM(A1)' };
    YES.data.transactions.push(tx);
    const out = YES.explorer.csv('all');
    YES.data.transactions.pop();
    return out.split('\r\n').find((l) => l.includes('TX-TEST-0001'));
  });
  t.assert(esc.includes('"Say ""hi"", then\nleave"'), 'quotes, commas and newlines escaped');
  t.assert(esc.includes(",'=SUM(A1),"), 'formula-like text neutralised');

  t.step('print');
  await page.evaluate(() => {
    window.__printed = 0;
    window.print = () => window.__printed++;
  });
  await page.click('[data-fk="tx-print"]');
  t.eq(await page.evaluate(() => window.__printed), 1, 'Print statement calls window.print()');

  t.step('Download PDF statement: next to Print, built by the help module');
  // The statement-of-record PDF is composed by YES.help.downloadPdf (60-help.js).
  // The isolated explorer build has no help module: then there is no dead
  // button and the copy promises CSV only; a stand-in API brings the button.
  const realPdf = await page.evaluate(() => typeof (YES.help && YES.help.downloadPdf) === 'function');
  if (realPdf) {
    const [pdl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('[data-fk="tx-pdf"]')]);
    t.assert(/^YES-statement-.*202609-000184.*-DEMO\.pdf$/.test(pdl.suggestedFilename()), 'PDF filename ' + pdl.suggestedFilename());
    t.eq(readFileSync(await pdl.path()).subarray(0, 8).toString('latin1'), '%PDF-1.4', 'a real PDF file');
  } else {
    t.eq(await page.locator('[data-tx-pdf]').count(), 0, 'no PDF button without YES.help.downloadPdf');
    t.assert(!(await page.locator('.tx-export__body').innerText()).includes('PDF'), 'the copy does not promise a PDF');
    t.eq(await page.$$eval('.tx-export__actions .btn', (els) => els.map((e) => e.getAttribute('data-fk'))), ['tx-print', 'tx-csv-all', 'tx-csv-view'], 'Print, then the CSV files');
  }
  // Count calls with a stand-in (the real one stays on window.__realPdf for the full build).
  await page.evaluate(() => {
    window.__pdfCalls = 0;
    window.__realPdf = YES.help.downloadPdf || null;
    YES.help.downloadPdf = function () {
      window.__pdfCalls++;
    };
    YES.renderAll();
  });
  const pdfBtn = page.locator('#transactions-root').getByRole('button', { name: 'Download PDF statement', exact: true });
  t.eq(await pdfBtn.count(), 1, 'one "Download PDF statement" button');
  t.eq(await page.$$eval('.tx-export__actions .btn', (els) => els.map((e) => e.getAttribute('data-fk'))), ['tx-print', 'tx-pdf', 'tx-csv-all', 'tx-csv-view'], 'Print and PDF (the statement of record), then the CSV files');
  t.assert((await page.locator('.tx-export__body').innerText()).includes('save it as a PDF'), 'the copy names the PDF');
  t.eq(await page.$eval('[data-fk="tx-pdf"] svg', (e) => e.getAttribute('aria-hidden')), 'true', 'icon is decorative');
  await pdfBtn.click();
  t.eq(await page.evaluate(() => window.__pdfCalls), 1, 'click calls YES.help.downloadPdf() once');
  await page.focus('[data-fk="tx-pdf"]');
  await page.keyboard.press('Enter');
  t.eq(await page.evaluate(() => window.__pdfCalls), 2, 'Enter works too');
  t.eq(await activeFk(), 'tx-pdf', 'focus stays on the button');
  const exp = await page.evaluate(() => {
    const box = (fk) => document.querySelector(`[data-fk="${fk}"]`).getBoundingClientRect();
    const a = document.querySelector('.tx-export__actions').getBoundingClientRect();
    const [pr, pdf, all, view] = ['tx-print', 'tx-pdf', 'tx-csv-all', 'tx-csv-view'].map(box);
    return {
      pairs: Math.abs(pr.top - pdf.top) < 2 && Math.abs(all.top - view.top) < 2 && all.top > pr.bottom - 1 && Math.abs(pr.left - all.left) < 2 && Math.abs(pdf.left - view.left) < 2,
      stacked: [pr, pdf, all, view].every((r, i, l) => i === 0 || r.top >= l[i - 1].bottom - 1),
      fullWidth: [pr, pdf, all, view].every((r) => Math.abs(r.width - a.width) < 2),
      startAligned: [pr, pdf, all, view].every((r) => Math.abs(r.left - pr.left) < 2),
      minH: Math.min(pr.height, pdf.height, all.height, view.height),
      inside: [pr, pdf, all, view].every((r) => r.right <= a.right + 1)
    };
  });
  if (mobile) {
    t.assert(exp.stacked && exp.fullWidth, 'phone: one full-width list ' + JSON.stringify(exp));
    t.assert(exp.minH >= 44, 'phone: 44px targets');
    t.eq(await page.$eval('[data-fk="tx-pdf"]', (e) => getComputedStyle(e).justifyContent), 'flex-start', 'phone: icons and labels start at the same edge');
  } else {
    t.assert(exp.pairs, 'desktop: Print + PDF on one row, the two CSV files below, in columns ' + JSON.stringify(exp));
  }
  t.assert(exp.inside, 'buttons stay inside the card');
  await page.evaluate(() => document.querySelector('.tx-export').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  await t.shot('export');
  await page.evaluate(() => YES.setLang('es'));
  t.eq((await page.locator('[data-fk="tx-pdf"]').innerText().then(nbsp)).trim(), 'Descargar estado de cuenta en PDF', 'Spanish label');
  t.assert((await page.locator('.tx-export__body').innerText()).includes('guárdalo en PDF'), 'Spanish copy names the PDF');
  t.assert(await noHScroll(), 'Spanish: no horizontal scroll');
  t.eq(await page.evaluate(() => YES.i18n.audit()), {}, 'i18n parity with the PDF strings');
  await page.evaluate(() => YES.setLang('en'));
  // The full build keeps its real API; the isolated build keeps the stand-in so
  // the accessibility checks below cover the button.
  await page.evaluate(() => {
    if (window.__realPdf) {
      YES.help.downloadPdf = window.__realPdf;
      YES.renderAll();
    }
  });

  /* ------------------------------------------------------------------ */
  t.step('accessibility of the view');
  await clearAll();
  await seriousAxe('#view-transactions', 'transactions view');
  if (mobile) {
    await openPanel();
    await seriousAxe('#view-transactions', 'transactions view with filters open');
  }
  const unlabeled = await page.$$eval('#transactions-root input, #transactions-root select', (els) => els.filter((e) => !(e.labels && e.labels.length) && !e.getAttribute('aria-label')).map((e) => e.id));
  t.eq(unlabeled, [], 'every control labelled');
  const noFk = await page.$$eval('#transactions-root button, #transactions-root input, #transactions-root select, #transactions-root a', (els) => els.filter((e) => !e.getAttribute('data-fk')).map((e) => e.outerHTML.slice(0, 80)));
  t.eq(noFk, [], 'every control has a focus key');

  if (mobile) {
    t.step('mobile filter panel');
    t.assert(await page.locator('#tx-filter-panel').isVisible(), 'panel opens');
    await page.check('#tx-types-fee');
    await waitCount('Showing 3 of 16 transactions');
    t.eq((await page.locator('[data-tx-done]').innerText().then(nbsp)).trim(), 'Show results (3)', 'panel shows result count');
    const small = await page.$$eval('#tx-filter-panel .tx-check, [data-tx-toggle], [data-tx-done]', (els) => els.filter((e) => e.getBoundingClientRect().height < 44).length);
    t.eq(small, 0, '44px touch targets in the filter panel');
    await t.shot('filters');
    await page.click('[data-tx-done]');
    t.assert(!(await page.locator('#tx-filter-panel').isVisible()), 'panel collapses');
    t.eq(await page.evaluate(() => document.activeElement.id), 'tx-results-title', 'focus on results');
    await page.evaluate(() => YES.setLang('es'));
    t.eq(await page.evaluate(() => YES.state.filters.types), ['fee'], 'filters survive language switch');
    t.eq(await page.isChecked('#tx-types-fee'), true, 'checkbox state re-rendered');
    await page.evaluate(() => YES.setLang('en'));
    await clearAll();

    t.step('phone toolbar: readable sort, Clear all follows the chips');
    const tb = await page.evaluate(() => {
      const root = document.getElementById('transactions-root');
      const cs = getComputedStyle(root);
      const inner = root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { sel: document.getElementById('tx-sort').getBoundingClientRect().width, inner };
    });
    t.assert(tb.sel >= tb.inner - 1, `sort select uses the full width (${tb.sel} of ${tb.inner})`);
    await page.evaluate(() => YES.explorer.applyFilter({ q: 'Daniel', direction: 'out' }, { reset: true, navigate: false }));
    await waitCount('Showing 2 of 16 transactions');
    const chipPos = await page.evaluate(() => {
      const chipsEls = [...document.querySelectorAll('[data-tx-chip]')];
      const last = chipsEls[chipsEls.length - 1].getBoundingClientRect();
      const clear = document.querySelector('.tx-chips__clear').getBoundingClientRect();
      const box = document.querySelector('.tx-chips').getBoundingClientRect();
      return { sameLine: Math.abs(clear.top - last.top) < 6, room: box.right - last.right - 8 >= clear.width };
    });
    t.assert(chipPos.sameLine || !chipPos.room, '"Clear all" sits after the last chip when it fits');
    await page.evaluate(() => document.getElementById('h-transactions').scrollIntoView());
    await page.waitForTimeout(300);
    await t.shot('chips');
    await clearAll();

    t.step('phone detail: compact footer; the header is the eyebrow and Close (no language switch)');
    await page.evaluate(() => YES.explorer.openTx('TX-260909-2051'));
    await page.waitForTimeout(350);
    const parts = await page.evaluate(() => {
      const d = document.getElementById('tx-dialog');
      const h = (s) => d.querySelector(s).getBoundingClientRect().height;
      return { head: h('.dlg__head'), body: h('.dlg__body'), foot: h('.dlg__foot'), vh: innerHeight };
    });
    t.assert(parts.foot <= 130, 'footer is two rows: ' + JSON.stringify(parts));
    t.assert(parts.body >= parts.vh * 0.55, 'details get most of the sheet: ' + JSON.stringify(parts));
    t.eq(await page.locator('#tx-dialog [data-lang]').count(), 0, 'no language switch on the sheet');
    const head = await page.evaluate(() => {
      const d = document.getElementById('tx-dialog');
      const r = (s) => d.querySelector(s).getBoundingClientRect();
      const eb = r('.tx-dlg__eyebrow');
      const cl = r('[data-txd-close]');
      const ti = r('#tx-dialog-title');
      const hd = r('.dlg__head');
      return { sameRow: cl.top < eb.bottom && cl.bottom > eb.top, w: cl.width, h: cl.height, edge: hd.right - cl.right, title: ti.width / hd.width, below: ti.top >= eb.bottom - 1 };
    });
    t.assert(head.sameRow && head.below, 'Close beside the eyebrow, the title below: ' + JSON.stringify(head));
    t.assert(head.w >= 44 && head.h >= 44, '44px Close target: ' + JSON.stringify(head));
    t.assert(head.edge <= 16, 'Close at the end of the header: ' + JSON.stringify(head));
    t.assert(head.title >= 0.8, 'the title gets the full width: ' + JSON.stringify(head));
    t.assert(await page.locator('#tx-dialog .tag--illustrative').first().isVisible(), 'demo tag visible on the sheet');
    await t.shot('sheet');
    // To change language on a phone: close the sheet, use the Menu, reopen.
    await page.click('#tx-dialog [data-txd-close]');
    await waitClosed();
    await headerLang('es');
    t.eq(await page.getAttribute('#masthead [data-mast-menu]', 'aria-expanded'), 'false', 'Menu closed again');
    await page.evaluate(() => YES.explorer.openTx('TX-260909-2051'));
    await page.waitForTimeout(350);
    t.eq((await page.locator('#tx-dialog-title').innerText().then(nbsp)).trim(), 'Envío a un monedero externo en una red blockchain', 'sheet reopened in Spanish');
    t.assert(nbsp(await page.locator('#tx-dialog').innerText()).includes('−200,00 USBC'), 'Spanish amount on the sheet');
    await t.shot('sheet-es');
    await page.click('#tx-dialog [data-txd-close]');
    await waitClosed();
    await headerLang('en');

    t.step('narrow 320px');
    await page.setViewportSize({ width: 320, height: 640 });
    await page.waitForTimeout(150);
    t.assert(await noHScroll(), 'no horizontal scroll at 320px');
    await openPanel();
    t.assert(await noHScroll(), 'no horizontal scroll at 320px with filters open');
    await page.evaluate(() => YES.explorer.openTx('TX-260909-2051'));
    t.assert(await noHScroll(), 'no horizontal scroll at 320px with the detail open');
    const dlgBox = await page.locator('#tx-dialog').boundingBox();
    t.assert(dlgBox.width <= 320 && dlgBox.x >= 0, 'detail is a full-width sheet');
    await page.waitForTimeout(350);
    await t.shot('narrow-dialog');
    await page.keyboard.press('Escape');
    await waitClosed();

    t.step('short sheet (landscape phone): the footer actions share one row when they fit');
    await page.setViewportSize({ width: 667, height: 375 });
    await page.waitForTimeout(150);
    for (const lang of ['en', 'es']) {
      await page.evaluate((l) => {
        YES.setLang(l);
        YES.explorer.openTx('TX-260909-2051');
      }, lang);
      await page.waitForTimeout(350);
      const foot = await page.evaluate(() => {
        const d = document.getElementById('tx-dialog');
        d.scrollTop = d.scrollHeight; // the whole sheet scrolls on short viewports
        const mid = (s) => {
          const r = d.querySelector(s).getBoundingClientRect();
          return Math.round((r.top + r.bottom) / 2);
        };
        return { rows: [mid('.tx-pager'), mid('[data-fk="txd-explain"]'), mid('[data-fk="txd-ask"]')], scrolls: d.scrollHeight > d.clientHeight };
      });
      t.assert(Math.max(...foot.rows) - Math.min(...foot.rows) <= 6, `${lang}: pager, Explain and Ask on one row: ${foot.rows}`);
      t.assert(foot.scrolls, `${lang}: the sheet scrolls as a whole`);
      t.assert(await noHScroll(), `${lang}: no horizontal scroll on a short sheet`);
      await page.waitForTimeout(150);
      await t.shot('short-sheet-' + lang);
      await page.keyboard.press('Escape');
      await waitClosed();
    }
    await page.evaluate(() => YES.setLang('en'));
    await page.setViewportSize({ width: 390, height: 844 });
  } else {
    t.step('tablet widths');
    for (const w of [720, 820, 1024]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(120);
      t.assert(await noHScroll(), `no horizontal scroll at ${w}px`);
      const fits = await page.evaluate(() => {
        const wrap = document.querySelector('.tx-table-wrap');
        return wrap ? wrap.scrollWidth <= wrap.clientWidth + 1 : false;
      });
      t.assert(fits, `table fits without scrolling at ${w}px`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    t.step('assistant docked: the narrower view keeps amounts and balances in sight');
    // html.assistant-docked reflows the page by the drawer width at >=1100px (03-shell.css).
    for (const [w, lang] of [[1100, 'en'], [1120, 'es'], [1280, 'es'], [1280, 'en'], [1399, 'en'], [1440, 'es']]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.evaluate((l) => {
        document.documentElement.classList.add('assistant-docked');
        if (YES.i18n.lang !== l) YES.setLang(l);
      }, lang);
      await page.waitForTimeout(200);
      const m = await page.evaluate(() => {
        const root = document.getElementById('transactions-root').getBoundingClientRect();
        const wrap = document.querySelector('#transactions-root .tx-table-wrap');
        const cells = [...document.querySelectorAll('#transactions-root .tx-amount, #transactions-root .tx-balance, #transactions-root .tx-card__amount')].slice(0, 6);
        return {
          fits: wrap ? wrap.scrollWidth <= wrap.clientWidth + 1 : true,
          inView: cells.length > 0 && cells.every((c) => {
            const r = c.getBoundingClientRect();
            return r.width > 0 && r.right <= root.right + 1;
          }),
          mode: wrap ? 'table' : 'cards',
          sidebar: getComputedStyle(document.querySelector('[data-tx-toggle]')).display === 'none'
        };
      });
      t.assert(m.fits && m.inView, `docked at ${w}px (${lang}): amounts visible without sideways scrolling (${m.mode})`);
      t.assert(await noHScroll(), `docked at ${w}px: no page scroll`);
      if (w < 1400) t.assert(!m.sidebar, `docked at ${w}px: filters fold into the Filters button`);
      if (w === 1120) await t.shot('docked-1120-es');
    }
    await page.evaluate(() => {
      document.documentElement.classList.remove('assistant-docked');
      YES.setLang('en');
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(150);
    t.assert(await page.locator('#tx-filter-panel').isVisible() && !(await page.locator('[data-tx-toggle]').isVisible()), 'sidebar back when undocked');
    t.eq(await page.locator('.tx-table').count(), 1, 'table back when undocked');
  }
  t.assert(await noHScroll(), 'no horizontal scroll at the end');

  t.step('themes: dark (device or choice) and light on a dark device, all from the design tokens');
  // Surfaces and ink must come from the tokens, so they follow whichever theme
  // is on screen. Tokens are resolved through a probe element in the live theme.
  const themeCheck = (dialog) =>
    page.evaluate((dlg) => {
      const p = document.createElement('div');
      p.style.cssText = 'position:absolute;width:1px;height:1px';
      (dlg ? document.getElementById('tx-dialog') : document.body).appendChild(p);
      const tok = (v, prop) => {
        p.style.setProperty(prop, v.startsWith('--') ? `var(${v})` : v);
        const c = getComputedStyle(p)[prop === 'color' ? 'color' : 'backgroundColor'];
        p.style.removeProperty(prop);
        return c;
      };
      const cs = (sel) => {
        const e = document.querySelector(sel);
        return e ? getComputedStyle(e) : null;
      };
      const pairs = dlg
        ? [
            ['#tx-dialog', 'backgroundColor', '--surface', 'background-color'],
            // The pending hero is the warning wash mixed into the surface (20-explorer.css).
            ['#tx-dialog .tx-dlg__hero--pending', 'backgroundColor', 'color-mix(in srgb, var(--warn-wash) 70%, var(--surface))', 'background-color'],
            ['#tx-dialog .tx-notin', 'color', '--warn', 'color'],
            ['#tx-dialog-title', 'color', '--ink', 'color'],
            ['#tx-dialog .tx-dlg__eyebrow', 'color', '--muted', 'color']
          ]
        : [
            ['#transactions-root .tx-export', 'backgroundColor', '--surface', 'background-color'],
            ['#transactions-root .tx-open', 'color', '--ink', 'color'],
            ['#transactions-root .tx-total', 'color', '--ink-2', 'color'],
            [document.querySelector('.tx-table-wrap') ? '#transactions-root .tx-row:not(.tx-row--pending) .tx-balance' : '#transactions-root .tx-card:not(.tx-card--pending)', document.querySelector('.tx-table-wrap') ? 'color' : 'backgroundColor', document.querySelector('.tx-table-wrap') ? '--ink-2' : '--surface', document.querySelector('.tx-table-wrap') ? 'color' : 'background-color']
          ];
      const off = pairs.filter(([sel, prop, token, cssProp]) => {
        const c = cs(sel);
        return !c || c[prop] !== tok(token, cssProp);
      }).map(([sel, prop, token]) => `${sel} ${prop} != ${token}`);
      const out = { theme: document.documentElement.getAttribute('data-theme'), surface: tok('--surface', 'background-color'), scheme: getComputedStyle(document.documentElement).colorScheme, off };
      p.remove();
      return out;
    }, dialog);
  const themePass = async (label, scheme, choice, expect, shots) => {
    await page.mouse.move(0, 0); // no row left hovered (hover tints the title on purpose)
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((c) => YES.theme.set(c), choice);
    await page.evaluate(() => YES.explorer.applyFilter({ step: 'outgoing' }, { reset: true }));
    await page.waitForTimeout(900); // let the smooth scroll to the results settle
    const v = await themeCheck(false);
    t.eq(v.theme, expect, `${label}: html[data-theme]`);
    t.eq(v.off, [], `${label}: view colours come from the tokens`);
    t.assert(expect === 'dark' ? v.surface !== 'rgb(255, 255, 255)' : v.surface === 'rgb(255, 255, 255)', `${label}: ${expect} surface (${v.surface})`);
    if (shots) await t.shot(shots + '-list');
    await seriousAxe('#view-transactions', `transactions view (${label})`);
    await page.evaluate(() => YES.explorer.openTx('TX-260930-2247')); // pending: warning colours too
    await page.waitForTimeout(300);
    const d = await themeCheck(true);
    t.eq(d.off, [], `${label}: detail colours come from the tokens`);
    if (shots) await t.shot(shots + '-dialog');
    await seriousAxe('#tx-dialog', `detail dialog (${label})`);
    await page.keyboard.press('Escape');
    await waitClosed();
  };
  await themePass('dark device', 'dark', null, 'dark', 'dark');
  await themePass('dark choice on a light device', 'light', 'dark', 'dark', mobile ? 'dark-choice' : null);
  await themePass('light choice on a dark device', 'dark', 'light', 'light', 'light-on-dark');
  t.eq(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light', 'light choice: native controls are light too');
  await page.evaluate(() => YES.theme.set(null)); // forget the choice (localStorage) before the next page load
  await page.emulateMedia({ colorScheme: 'light' });
  await clearAll();

  t.step('date chips name the chosen day in any statement timezone');
  await fresh('#/transactions');
  const tzChip = await page.evaluate(() => {
    // UTC+14: noon UTC is already the next day there.
    YES.data.statement.timezone = 'Pacific/Kiritimati';
    YES.setLang('es');
    YES.explorer.applyFilter({ from: '2026-09-10' }, { reset: true, navigate: false });
    return document.querySelector('[data-tx-chip="date"]').textContent;
  });
  t.assert(tzChip.includes('10 de septiembre de 2026'), 'from-date chip names 10 September: ' + tzChip);
  await fresh('#/transactions');
}
