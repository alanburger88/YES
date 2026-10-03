// Transactions explorer: search, filters, sort, table/cards, detail dialog,
// deep links, language switch, CSV export, print, accessibility.
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
  const waitClosed = () => page.waitForFunction(() => !document.getElementById('tx-dialog').open && YES.state.selectedTx === null, null, { timeout: 3000 });
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
  // A real page load (t.goto with only a new hash is a same-document navigation).
  const fresh = async (hash) => {
    await page.goto('about:blank');
    await t.goto(hash);
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
  t.assert((await page.locator('#transactions-root [data-tx-total]').innerText().then(nbsp)).includes('+147.50 EXUSD'), 'net change from calc');
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
  t.eq(await searchFor('groceries'), ['TX-260924-1327'], 'memo search');
  t.eq((await searchFor('transfer_out')).sort(), TRANSFERS_OUT.slice().sort(), 'canonical type search');
  t.eq((await searchFor('on-chain')).sort(), ['TX-260909-2051', 'TX-260915-1648'], 'rail search');
  t.eq((await searchFor('debit card')).length, 2, 'method/counterparty multi-word search');
  t.eq((await searchFor('Received')).length, 3, 'customer type label search');
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
  t.assert((await page.locator('[data-tx-chip="amount"]').innerText().then(nbsp)).includes('100.00 EXUSD to 200.00 EXUSD'), 'amount chip');
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

  t.step('initiated-date basis');
  await sortBy('initiated:asc');
  await page.waitForTimeout(80);
  t.eq((await ids())[0], 'TX-260901-0418', 'earliest initiated first (31 Aug deposit)');
  t.assert((await page.locator('[data-tx-row="TX-260901-0418"]').innerText().then(nbsp)).includes('Previous period'), 'prior-period initiation tagged');
  t.assert(await page.locator('.tx-basis-note').isVisible(), 'basis change is explained');
  if (!mobile) t.eq((await page.locator('.tx-table thead th').first().innerText().then(nbsp)).trim(), 'Initiated', 'date column switches to Initiated');
  t.assert((await page.locator('.tx-caption').innerText().then(nbsp)).includes('initiated date'), 'caption names the initiated basis');
  await openPanel();
  t.eq(await page.getAttribute('#tx-from', 'min'), '2026-08-31', 'date bounds follow the initiated basis');
  t.assert((await page.locator('#tx-date-legend').innerText().then(nbsp)).includes('initiated date'), 'date legend follows the basis');
  await page.fill('#tx-from', '2026-08-31');
  await page.fill('#tx-to', '2026-08-31');
  await waitCount('Showing 1 of 16 transactions');
  t.eq(await ids(), ['TX-260901-0418'], 'initiated date filter');
  await clearAll();
  await sortBy('posted:desc');

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
  t.assert(total.includes('Filtered total') && total.includes('−450.00 EXUSD') && total.includes('5 posted transactions'), 'filtered total ' + total);
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
  for (const s of ['−120.00 EXUSD', 'token units', 'Posted', 'Initiated', 'EDT', 'Event type', 'transfer_out', 'Internal (YES)', 'YES transfer', 'Daniel K.', '“Rent share”', '1,130.00 EXUSD', 'REF-T3M8-4LZ1', 'TX-260903-1127', 'No fees']) {
    t.assert(dtext.includes(s), 'detail shows ' + s);
  }
  t.eq(await page.locator('#tx-dialog .tx-onchain').count(), 0, 'no blockchain section for an internal transfer');
  t.eq(await page.locator('#tx-dialog [data-txd-copy]').count(), 2, 'copy buttons for reference and id');
  await page.click('[data-txd-copy="ref"]');
  await page.waitForFunction(() => /Copied|Copy is not available/.test(document.getElementById('toast').textContent), null, { timeout: 3000 });
  await page.waitForTimeout(300);
  await t.shot('dialog');
  await seriousAxe('#tx-dialog', 'detail dialog');
  await page.keyboard.press('Escape');
  await waitClosed();
  await expectFocus('tx-open-TX-260903-1127', 'focus returns to the row that opened it');
  t.eq(await page.evaluate(() => location.hash), '#/transactions', 'route param cleared on close');
  t.eq(await page.evaluate(() => YES.state.selectedTx), null, 'selectedTx cleared');

  t.step('open detail by keyboard; next/previous');
  await page.focus('[data-fk="tx-open-TX-260905-0733"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('tx-dialog').open);
  t.eq(await page.evaluate(() => document.activeElement.id), 'tx-dialog-title', 'focus moves into the dialog');
  t.eq((await page.locator('.tx-pager__pos').innerText().then(nbsp)).trim(), '14 of 16', 'position in list');
  await page.click('[data-fk="txd-next"]');
  t.eq((await page.locator('#tx-dialog-title').innerText().then(nbsp)).trim(), 'Transfer to another YES customer', 'next transaction');
  t.eq(await page.evaluate(() => YES.state.selectedTx), 'TX-260903-1127', 'selectedTx follows next');
  t.eq(await page.evaluate(() => location.hash), '#/transactions/TX-260903-1127', 'route follows next');
  await page.click('[data-fk="txd-prev"]');
  t.eq(await page.evaluate(() => YES.state.selectedTx), 'TX-260905-0733', 'previous transaction');
  await page.click('[data-txd-close]');
  await waitClosed();
  await expectFocus('tx-open-TX-260905-0733', 'close button returns focus to the row');

  t.step('fee links both ways');
  await page.click('[data-tx-row="TX-260909-2051"] [data-tx-open]', { force: true });
  await page.waitForFunction(() => document.getElementById('tx-dialog').open);
  const fees = await page.locator('#tx-dialog .tx-fees').innerText().then(nbsp);
  t.assert(fees.includes('Network transfer fee') && fees.includes('−1.00 EXUSD') && fees.includes('TX-260909-2052'), 'parent lists its fee line');
  t.assert((await page.locator('#tx-dialog .tx-fees__total').innerText().then(nbsp)).includes('−201.00 EXUSD'), 'total including fees');
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
    YES.inquiry.start = (id, o) => window.__inq.push([id, !!(o && o.trigger)]);
    YES.assistant.open = (ctx) => {
      window.__ai = { topic: ctx.topic, id: ctx.id, trigger: ctx.trigger && ctx.trigger.getAttribute('data-fk') };
    };
  });
  await page.click('[data-tx-row="TX-260918-2011"] [data-tx-open]', { force: true });
  await page.waitForFunction(() => document.getElementById('tx-dialog').open);
  t.eq((await page.locator('[data-fk="txd-ask"]').innerText().then(nbsp)).trim(), 'Ask about this transaction', 'ask label');
  await page.click('[data-fk="txd-ask"]');
  t.eq(await page.evaluate(() => window.__inq), [['TX-260918-2011', true]], 'inquiry.start called with id and trigger');
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
  t.eq(await page.evaluate(() => location.hash), '#/transactions/TX-260930-2247', 'route follows openTx');
  await page.evaluate(() => YES.explorer.openTx('TX-260901-0418'));
  const pp = await page.locator('#tx-dialog').innerText().then(nbsp);
  t.assert(pp.includes('Previous period') && pp.includes('Started on 31 August'), 'prior-period note');
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
  t.step('language switch keeps filters, sort and the open dialog');
  await fresh('#/transactions');
  await page.evaluate(() => YES.explorer.applyFilter({ step: 'transfers_out' }, { reset: true }));
  await page.click('[data-tx-row="TX-260903-1127"] [data-tx-open]', { force: true });
  await page.waitForFunction(() => document.getElementById('tx-dialog').open);
  await page.evaluate(() => YES.setLang('es'));
  t.assert(await dialogOpen(), 'dialog still open after switching language');
  t.eq((await page.locator('#tx-dialog-title').innerText().then(nbsp)).trim(), 'Transferencia a otro cliente de YES', 'dialog re-rendered in Spanish');
  const esDlg = await page.locator('#tx-dialog').innerText().then(nbsp);
  t.assert(esDlg.includes('−120,00 EXUSD') && esDlg.includes('Preguntar por este movimiento'), 'Spanish amounts and actions');
  t.eq(await page.evaluate(() => YES.state.filters.step), 'transfers_out', 'filters kept in state');
  t.eq(await count(), 'Mostrando 5 de 16 movimientos', 'Spanish count, same filter');
  t.assert((await page.locator('[data-tx-total]').innerText().then(nbsp)).includes('−450,00 EXUSD'), 'Spanish filtered total 450,00');
  t.eq((await page.locator('[data-tx-chip="step"]').innerText().then(nbsp)).trim(), 'Paso: Transferencias enviadas', 'Spanish chip');
  t.eq(await page.evaluate(() => YES.i18n.audit()), {}, 'i18n parity after switch');
  await page.waitForTimeout(300);
  await t.shot('es-dialog');
  await page.keyboard.press('Escape');
  await waitClosed();
  await expectFocus('tx-open-TX-260903-1127', 'focus returns to the re-rendered row');
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
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Nothing was sent'), null, { timeout: 3000 });

  t.step('CSV — current view + escaping');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-fk="tx-csv-view"]')]);
  t.assert(dl2.suggestedFilename().includes('current-view') && dl2.suggestedFilename().includes('DEMO'), 'current-view filename');
  const lines2 = readFileSync(await dl2.path(), 'utf8').replace(/^﻿/, '').split('\r\n').filter(Boolean);
  t.eq(lines2.length, 6, 'header + 5 filtered rows');
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
  }
  t.assert(await noHScroll(), 'no horizontal scroll at the end');

  t.step('dark colour scheme');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => YES.explorer.applyFilter({ step: 'outgoing' }, { reset: true }));
  await page.waitForTimeout(900); // let the smooth scroll to the results settle
  await t.shot('dark-list');
  await seriousAxe('#view-transactions', 'transactions view (dark)');
  await page.evaluate(() => YES.explorer.openTx('TX-260909-2051'));
  await page.waitForTimeout(300);
  await t.shot('dark-dialog');
  await seriousAxe('#tx-dialog', 'detail dialog (dark)');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ colorScheme: 'light' });
}
