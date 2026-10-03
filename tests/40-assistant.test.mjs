// Ask YES drawer and deterministic demo explanations (PRD 2 AI row, 5.5, 5.6, 9).
// Runs against the isolated build (other modules stubbed) and the full build.
export const meta = { name: 'assistant', viewports: ['desktop', 'mobile', 'narrow'] };

const BAD = ['serious', 'critical'];
const TRANSFERS_OUT = ['TX-260903-1127', 'TX-260909-2051', 'TX-260918-2011', 'TX-260924-1327', 'TX-260929-1952'];
const QUESTIONS_EN = [
  'Why did my balance change?',
  'What did I pay in fees?',
  'What was my largest movement?',
  'What is pending?',
  'Is my statement balance my live balance?',
  'Is one token always worth one US dollar?',
  'Where did I send money on-chain?'
];
// Amounts may carry a no-break space; compare on plain spaces and plain apostrophes.
const norm = (s) => String(s).replace(/ /g, ' ').replace(/’/g, "'");
const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));

export default async function (t) {
  const { page } = t;
  const vp = t.viewport;
  const wide = vp === 'desktop';

  /* ---------------------------------------------------------------- helpers */
  const isOpen = () => page.evaluate(() => document.getElementById('assistant-drawer').open);
  const isModal = () => page.evaluate(() => document.getElementById('assistant-drawer').matches(':modal'));
  const mode = () => page.evaluate(() => YES.assistant.mode());
  const activeFk = () => page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-fk'));
  const activeInDrawer = () => page.evaluate(() => document.getElementById('assistant-drawer').contains(document.activeElement));
  const waitOpen = () => page.waitForFunction(() => document.getElementById('assistant-drawer').open, null, { timeout: 3000 });
  const waitClosed = () => page.waitForFunction(() => !document.getElementById('assistant-drawer').open && YES.assistant.mode() === null, null, { timeout: 3000 });
  const waitFocusFk = (fk) => page.waitForFunction((k) => document.activeElement && document.activeElement.getAttribute('data-fk') === k, fk, { timeout: 3000 }).catch(() => {});
  const threadLen = () => page.evaluate(() => (YES.state.assistant ? YES.state.assistant.thread.length : 0));
  const lastId = () => page.evaluate(() => YES.state.assistant.thread[YES.state.assistant.thread.length - 1].id);
  const LATEST = '#assistant-drawer .asst-turn:last-child';
  const latestText = async () => norm(await page.locator(LATEST).innerText());
  const latestTitle = async () => norm(await page.locator(LATEST + ' .asst-ans__title').innerText()).trim();
  const latestRows = () => page.$$eval(LATEST + ' [data-asst-tx]', (els) => els.map((e) => e.getAttribute('data-asst-tx')));
  const allLatestRows = async () => {
    const more = page.locator(LATEST + ' [data-asst-more]');
    if ((await more.count()) && (await more.getAttribute('aria-expanded')) === 'false') await more.click();
    return latestRows();
  };
  const ctxText = async () => norm(await page.locator('#assistant-drawer [data-asst-ctx] [aria-hidden="true"], #assistant-drawer [data-asst-ctx]').first().textContent());
  const openCtx = async (topic, id) => {
    await page.evaluate(([tp, i]) => YES.assistant.open({ topic: tp, id: i, trigger: document.querySelector('[data-ask]') }), [topic, id || null]);
    await waitOpen();
  };
  // The thread is capped, so wait on the latest entry id rather than the length.
  const waitNewEntry = (before) =>
    page.waitForFunction(
      (id) => {
        const th = YES.state.assistant && YES.state.assistant.thread;
        return th && th.length && th[th.length - 1].id !== id;
      },
      before,
      { timeout: 3000 }
    );
  const typeAsk = async (text) => {
    const before = await lastId().catch(() => null);
    await page.fill('#asst-input', text);
    await page.press('#asst-input', 'Enter');
    await waitNewEntry(before);
  };
  const axeOk = async (label) => {
    const v = await t.axe('#assistant-drawer');
    const bad = v.filter((x) => BAD.includes(x.impact));
    t.eq(bad, [], `axe serious/critical (${label})`);
    const minor = v.filter((x) => !BAD.includes(x.impact));
    if (minor.length) console.log(`    (axe ${label}, ${vp}: ${minor.map((x) => x.id + '/' + x.impact).join(', ')})`);
  };
  const shot = async (name) => {
    await settle(page);
    await page.waitForTimeout(150);
    await t.shot(name);
  };
  const noHScroll = () =>
    page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const offenders = [];
      document.querySelectorAll('#assistant-drawer *').forEach((el) => {
        if (el.closest('.sr-only') || el.ownerSVGElement || !el.getClientRects().length) return;
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > vw + 1 || r.left < -1)) offenders.push((el.className && el.className.baseVal === undefined ? el.className : el.tagName) + ' ' + Math.round(r.left) + '→' + Math.round(r.right));
      });
      const body = document.querySelector('#assistant-drawer .asst__body');
      return {
        page: document.documentElement.scrollWidth <= window.innerWidth + 1,
        body: !body || body.scrollWidth <= body.clientWidth + 1,
        offenders: offenders.slice(0, 6)
      };
    });
  const installSpies = () =>
    page.evaluate(() => {
      window.__calls = [];
      window.__orig = window.__orig || { openTx: YES.explorer.openTx, showRows: YES.explorer.showRows, help: YES.help.open, topic: YES.understand.openTopic };
      const fk = (o) => (o && o.trigger && o.trigger.getAttribute ? o.trigger.getAttribute('data-fk') : null);
      YES.explorer.openTx = (id, o) => __calls.push({ fn: 'openTx', id, fk: fk(o) });
      YES.explorer.showRows = (ids, label) => __calls.push({ fn: 'showRows', ids, label });
      YES.help.open = (s) => __calls.push({ fn: 'help', s });
      YES.understand.openTopic = (id) => __calls.push({ fn: 'openTopic', id });
    });
  const restoreSpies = () =>
    page.evaluate(() => {
      if (!window.__orig) return;
      YES.explorer.openTx = __orig.openTx;
      YES.explorer.showRows = __orig.showRows;
      YES.help.open = __orig.help;
      YES.understand.openTopic = __orig.topic;
    });
  const calls = () => page.evaluate(() => window.__calls.splice(0));
  const ensureOpen = async () => {
    if (!(await isOpen())) await openCtx('general');
  };

  /* ------------------------------------------------------------------ */
  t.step('boot');
  t.eq(await page.evaluate(() => typeof YES.assistant.match), 'function', 'assistant module replaced the stub');
  t.eq(await page.evaluate(() => YES.i18n.audit()), {}, 'every string exists in both languages');
  t.assert(!(await isOpen()), 'drawer starts closed');
  t.eq(await page.getAttribute('#assistant-drawer', 'aria-labelledby'), 'asst-title', 'drawer labelled by its heading');
  t.eq(await page.evaluate(() => document.querySelector('#assistant-root > dialog#assistant-drawer') !== null), true, 'dialog lives in #assistant-root');

  /* ------------------------------------------------------------------ */
  t.step('open from masthead');
  await page.click('[data-ask]');
  await waitOpen();
  await settle(page);
  t.assert(await activeInDrawer(), 'focus moves into the drawer');
  t.eq(await page.evaluate(() => document.activeElement.id), 'asst-title', 'general topic focuses the drawer heading');
  t.eq(norm(await page.locator('#asst-title').innerText()).trim(), 'Ask YES', 'heading text');
  if (wide) {
    t.eq(await mode(), 'docked', 'docks at 1280');
    t.assert(!(await isModal()), 'docked drawer is non-modal');
    t.assert(await page.evaluate(() => document.documentElement.classList.contains('assistant-docked')), 'html.assistant-docked while open');
  } else {
    t.eq(await mode(), 'modal', 'modal on small screens');
    t.assert(await isModal(), 'full-screen sheet is modal');
    const r = await page.evaluate(() => {
      const b = document.getElementById('assistant-drawer').getBoundingClientRect();
      return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), vw: window.innerWidth, vh: window.innerHeight };
    });
    t.eq([r.x, r.y, r.w, r.h], [0, 0, r.vw, r.vh], 'sheet covers the full viewport');
  }
  const head = norm(await page.locator('#assistant-drawer .asst__head').innerText());
  t.assert(head.includes('Demo explanation'), 'header shows the "Demo explanation" label');
  t.assert(await page.locator('#assistant-drawer .asst__head .tag--ai').isVisible(), 'demo tag visible');
  const privacy = norm(await page.locator('#assistant-drawer .asst__privacy').innerText());
  t.assert(privacy.includes('computed in this browser from this statement only'), 'privacy: computed locally from this statement');
  t.assert(privacy.includes('Nothing you ask is sent'), 'privacy: nothing sent');
  await page.click('#assistant-drawer [data-asst-privacy] > summary');
  await page.waitForFunction(() => YES.state.assistant.privacyOpen === true, null, { timeout: 2000 }).catch(() => {});
  const prod = norm(await page.locator('#assistant-drawer .asst__prod').innerText());
  t.assert(/governed AI service/.test(prod) && /privacy notice/.test(prod) && /retention policy/.test(prod) && /audit trail/.test(prod), 'production privacy notice: governed service, notice, retention, audit');
  t.eq(await page.evaluate(() => YES.state.assistant.privacyOpen), true, 'privacy disclosure state kept in YES.state');
  t.assert(/no live AI model/i.test(norm(await page.locator('#asst-hint').innerText())), 'input hint says no live AI model is used');
  t.assert(/nothing is sent/i.test(norm(await page.locator('#asst-hint').innerText())), 'input hint says nothing is sent');
  t.assert((await latestTitle()).startsWith('Hello, Sam.'), 'welcome answer');
  t.assert((await latestText()).includes('as of Sep 30, 2026'), 'welcome names the statement "as of" time');
  const qs = await page.$$eval('#assistant-drawer .asst-sugg [data-asst-q]', (els) => els.map((e) => e.textContent.trim()));
  t.eq(qs, QUESTIONS_EN, 'seven suggested questions');
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#assistant-drawer button, #assistant-drawer input, #assistant-drawer summary'))
      .filter((el) => el.getClientRects().length && !el.closest('.sr-only'))
      .map((el) => ({ fk: el.getAttribute('data-fk') || el.tagName, h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) }))
      .filter((r) => r.h < 44 || r.w < 44)
  );
  t.eq(small, [], 'every control is at least 44×44px');
  t.eq(await page.evaluate(() => document.querySelectorAll('#assistant-drawer [href^="http"], #assistant-drawer [src^="http"]').length), 0, 'no external links');
  await axeOk('welcome');
  await shot('welcome');

  /* ------------------------------------------------------------------ */
  t.step('escape closes and focus returns to Ask YES');
  await page.keyboard.press('Escape');
  await waitClosed();
  await waitFocusFk('ask-yes');
  t.eq(await activeFk(), 'ask-yes', 'focus returns to the masthead button');
  t.assert(!(await page.evaluate(() => document.documentElement.classList.contains('assistant-docked'))), 'docked class removed');
  t.assert(!(await page.evaluate(() => document.documentElement.classList.contains('has-modal'))), 'has-modal cleared');
  t.eq(await page.evaluate(() => YES.state.assistant.open), false, 'state records closed');

  t.step('close button');
  await page.click('[data-ask]');
  await waitOpen();
  await page.click('#assistant-drawer [data-asst-close]');
  await waitClosed();
  await waitFocusFk('ask-yes');
  t.eq(await activeFk(), 'ask-yes', 'close button returns focus to the trigger');

  /* ------------------------------------------------------------------ */
  t.step('real explorer integration (full build only)');
  const realExplorer = await page.evaluate(() => YES.explorer.openTx.toString().indexOf('not available') === -1);
  if (realExplorer) {
    await openCtx('step', 'transfers_out');
    const rowFk = await page.getAttribute(LATEST + ' [data-asst-tx="TX-260909-2051"]', 'data-fk');
    await page.click(LATEST + ' [data-asst-tx="TX-260909-2051"]');
    await page.waitForFunction(() => document.getElementById('tx-dialog').open, null, { timeout: 3000 });
    t.assert(await page.evaluate(() => document.getElementById('tx-dialog').matches(':modal')), 'transaction detail opens above the drawer');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('tx-dialog').open, null, { timeout: 3000 });
    await waitFocusFk(rowFk);
    t.eq(await activeFk(), rowFk, 'closing the detail returns focus to the supporting row in the drawer');
    t.assert(await isOpen(), 'drawer still open after the detail closes');
    await page.click(LATEST + ' [data-asst-tx="TX-260909-2051"]');
    await page.waitForFunction(() => document.getElementById('tx-dialog').open, null, { timeout: 3000 });
    const n0 = await lastId();
    await page.click('#tx-dialog [data-explain="transaction"]');
    await waitNewEntry(n0);
    await waitOpen();
    t.assert((await latestText()).includes('Illustrative reference — no live blockchain verification'), '"Explain with AI" from the detail adds the transaction answer');
    t.assert(await activeInDrawer(), 'focus is in the drawer after the hand-off');
    await page.keyboard.press('Escape');
    await waitClosed();
  }
  await installSpies();

  /* ------------------------------------------------------------------ */
  t.step('step: outgoing transfers');
  await openCtx('step', 'transfers_out');
  t.eq(await latestTitle(), 'Outgoing transfers: −450.00 EXUSD', 'answer title names the selected fact');
  const stepText = await latestText();
  t.assert(stepText.includes('450.00'), 'shows 450.00');
  t.assert(stepText.includes('5 transactions in this category reduced your balance by 450.00 EXUSD'), 'concise explanation with count');
  t.assert(stepText.includes('A linked fee of 1.00 EXUSD is counted separately under Fees'), 'linked fee explained separately');
  t.eq(await latestRows(), TRANSFERS_OUT, 'five supporting rows, the exact transactions');
  t.assert(norm(await page.locator(LATEST + ' .asst-sum').textContent()).includes('−120.00 − 200.00 − 60.00 − 45.50 − 24.50 = −450.00 EXUSD'), 'arithmetic adds up from the rows');
  const figs = norm(await page.locator(LATEST + ' .asst-figs').innerText());
  t.assert(figs.includes('Figures used') || (await page.locator(LATEST + ' .asst-sec__h').first().innerText()).match(/Figures used/i), 'figures used section');
  t.assert(figs.includes('−450.00 EXUSD') && figs.includes('5 transactions') && figs.includes('TX-260909-2051'), 'figures list total, count and largest');
  const ctx = await ctxText();
  t.assert(ctx.includes('About:') && ctx.includes('Outgoing transfers') && ctx.includes('−450.00 EXUSD'), 'context chip: About: Outgoing transfers · −450.00 EXUSD');
  t.assert((await latestText()).includes('Demo explanation'), 'answer carries the Demo explanation label');
  t.assert(stepText.includes('as of Sep 30, 2026') && stepText.includes('not your live account'), 'answer distinguishes statement data from live data');
  const sid = await lastId();
  t.eq(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('asst-ans__title')), true, 'focus moves to the latest answer');
  t.eq(await activeFk(), `asst-${sid}-h`, 'focused answer heading has a stable focus key');
  const stored = await page.evaluate(() => YES.state.assistant.thread[YES.state.assistant.thread.length - 1]);
  t.eq([stored.topic, stored.tid, stored.via], ['step', 'transfers_out', 'context'], 'state stores the intent, not rendered text');
  t.assert(!JSON.stringify(stored).includes('450'), 'no rendered figures in state');
  await axeOk('step answer');
  await shot('step');

  await page.click(LATEST + ' [data-asst-tx="TX-260903-1127"]');
  let c = await calls();
  t.eq(c, [{ fn: 'openTx', id: 'TX-260903-1127', fk: `asst-${sid}-tx-TX-260903-1127` }], 'supporting row opens the transaction with the row as trigger');
  t.assert(await isOpen(), 'drawer stays open behind the transaction detail');
  await page.click(LATEST + ' [data-asst-rows]');
  c = await calls();
  t.eq(c.length, 1, 'show rows called once');
  t.eq(c[0] && c[0].fn, 'showRows', 'Show these rows in Transactions → explorer.showRows');
  t.eq(c[0] && c[0].ids, TRANSFERS_OUT, 'exact row ids passed');
  t.assert(c[0] && /Outgoing transfers/.test(c[0].label), 'label names the explained fact');
  if (wide) t.assert(await isOpen(), 'docked drawer stays open while rows are shown');
  else {
    await waitClosed();
    t.assert(!(await isOpen()), 'modal sheet closes so the rows are visible');
  }

  /* ------------------------------------------------------------------ */
  t.step('transaction: on-chain reference');
  await openCtx('transaction', 'TX-260909-2051');
  let tx = await latestText();
  t.assert(tx.includes('Illustrative reference — no live blockchain verification'), 'mentions the illustrative reference label');
  t.assert(tx.includes('no explorer link'), 'no explorer link');
  t.assert(tx.includes('posted on September 9, 2026 at 10:34 AM EDT, taking your statement balance from 1,175.00 EXUSD to 975.00 EXUSD'), 'posted time and balance before/after from the running balance');
  t.assert(tx.includes('TX-260909-2052'), 'links its separate fee line');
  t.eq(await latestRows(), ['TX-260909-2051', 'TX-260909-2052'], 'rows: the transfer and its fee');
  t.assert(await page.locator(LATEST + ' .tag--illustrative').isVisible(), 'illustrative tag on on-chain details');
  t.assert((await ctxText()).includes('Sent to an external wallet on a blockchain network · Sep 9 · −200.00 EXUSD'), 'context chip names the transaction, date and amount');

  t.step('transaction: fee line explains its parent');
  await openCtx('transaction', 'TX-260909-2052');
  tx = await latestText();
  t.assert(tx.includes('This is a network transfer fee for TX-260909-2051'), 'fee names its parent');
  t.assert(tx.includes('Sent to an external wallet on a blockchain network'), 'fee names the parent description');
  t.eq(await latestRows(), ['TX-260909-2052', 'TX-260909-2051'], 'rows: the fee and its parent');

  t.step('transaction: pending is not in the balance');
  await openCtx('transaction', 'TX-260930-2247');
  tx = await latestText();
  t.assert(tx.includes('still pending at the statement cut-off'), 'pending at cut-off');
  t.assert(tx.includes('not included in the statement balance of 1,147.50 EXUSD'), 'not in balance');
  t.assert(tx.includes('Pending, not included in statement balance'), 'row states pending explicitly');

  t.step('transaction: prior-period deposit');
  await openCtx('transaction', 'TX-260901-0418');
  tx = await latestText();
  t.assert(tx.includes('in the previous period') && tx.includes('Statements use the posted date'), 'posted-date rule');

  t.step('transaction: unknown id');
  await openCtx('transaction', 'TX-999999-9999');
  t.eq(await latestTitle(), "I couldn't find that transaction", 'no invented facts for unknown ids');

  /* ------------------------------------------------------------------ */
  t.step('balance');
  await openCtx('balance');
  const bal = await latestText();
  t.eq(await latestTitle(), 'Why your balance changed', 'balance title');
  t.assert(bal.includes('went from 1,000.00 EXUSD to 1,147.50 EXUSD'), 'opening → closing');
  t.assert(bal.includes('Incoming activity added 700.00 EXUSD across 6 transactions'), 'incoming with count');
  t.assert(bal.includes('Outgoing activity and fees took away 552.50 EXUSD across 9 transactions'), 'outgoing with count');
  t.assert(bal.includes('1 transaction of 30.00 EXUSD was still pending'), 'pending excluded');
  t.assert(norm(await page.locator(LATEST + ' .asst-sum').textContent()).includes('1,000.00 + 500.00 + 200.00 − 450.00 − 100.00 − 2.50 = 1,147.50 EXUSD'), 'bridge arithmetic');
  t.eq((await latestRows()).length, 6, 'first six of the posted rows shown');
  t.eq(await page.getAttribute(LATEST + ' [data-asst-more]', 'aria-expanded'), 'false', 'more rows collapsed');
  await page.click(LATEST + ' [data-asst-more]');
  t.eq((await latestRows()).length, 15, 'all 15 posted rows after expanding');
  t.eq(await page.getAttribute(LATEST + ' [data-asst-more]', 'aria-expanded'), 'true', 'expanded state exposed');
  t.eq(await activeFk(), `asst-${await lastId()}-more`, 'focus stays on the toggle');

  t.step('fees');
  await openCtx('fees');
  const fees = await latestText();
  t.assert(fees.includes('You paid 2.50 EXUSD in fees in September 2026, across 3 transactions'), 'fee total and count');
  t.assert(fees.includes('for TX-260909-2051') && fees.includes('for TX-260912-0805') && fees.includes('for TX-260920-0900'), 'each fee line names its parent');
  t.assert(fees.includes('No fees were charged in any other asset'), 'no other-asset fees');
  t.eq(await latestRows(), ['TX-260909-2052', 'TX-260912-0806', 'TX-260920-0901'], 'fee rows');

  t.step('chart');
  await openCtx('chart');
  const chart = await latestText();
  t.assert(chart.includes('highest at 1,250.00 EXUSD on September 1, 2026'), 'highest running balance and date');
  t.assert(chart.includes('lowest at 974.00 EXUSD on September 9, 2026'), 'lowest running balance and date');

  t.step('pending topic');
  await openCtx('pending');
  t.assert((await latestText()).includes('1 transaction had not posted by the statement cut-off'), 'pending summary');
  t.eq(await latestRows(), ['TX-260930-2247'], 'pending row');

  t.step('every step and group');
  const expect = await page.evaluate(() => {
    const out = {};
    YES.calc.categories().forEach((c) => (out[c.id] = { total: YES.fmt.amount(c.total, { sign: 'always' }), ids: c.txIds }));
    const g = YES.calc.groups();
    ['incoming', 'outgoing'].forEach((k) => (out[k] = { total: YES.fmt.amount(g[k].total, { sign: 'always' }), ids: g[k].txIds }));
    return out;
  });
  for (const id of ['deposits', 'transfers_in', 'redemptions', 'fees', 'incoming', 'outgoing']) {
    await openCtx('step', id);
    const title = await latestTitle();
    if (id === 'fees') t.eq(title, 'What you paid in fees', 'fees step uses the fee explanation');
    else t.assert(norm(title).endsWith(norm(expect[id].total)), `${id}: title total from calc (${title})`);
    t.eq(await allLatestRows(), expect[id].ids, `${id}: rows from calc`);
  }
  await openCtx('step', 'deposits');
  t.assert((await latestText()).includes('TX-260901-0418 was started on August 31, 2026, in the previous period'), 'deposits explain the prior-period posting');
  await openCtx('step', 'redemptions');
  t.assert((await latestText()).includes('A further 30.00 EXUSD (1 transaction) was pending'), 'redemptions mention the pending one');

  /* ------------------------------------------------------------------ */
  t.step('education topics');
  const EDU = {
    token_units: ['Token units', '1,147.50 token units'],
    usd_equivalent: ['USD equivalent', 'illustrative demo rate of 1.0000 USD per token'],
    onchain_vs_internal: ['On-chain versus internal transfers', 'Illustrative reference — no live blockchain verification'],
    tx_status: ['Transaction status', 'never counted'],
    fees: ['Fees', 'There are none in this statement'],
    redemption: ['Redemption', 'A further 30.00 EXUSD'],
    statement_vs_live: ['Statement balance versus live balance', 'snapshot as of Sep 30, 2026'],
    transparency: ['Reserves and transparency', 'Illustrative layout; no reserve assertion']
  };
  for (const [id, [title, phrase]] of Object.entries(EDU)) {
    await openCtx('edu', id);
    t.eq(await latestTitle(), title, `edu ${id}: title`);
    t.assert((await latestText()).includes(phrase), `edu ${id}: uses statement example ("${phrase}")`);
  }
  await page.click(LATEST + ' [data-asst-read]');
  c = await calls();
  t.eq(c.filter((x) => x.fn === 'openTopic'), [{ fn: 'openTopic', id: 'transparency' }], 'Read more opens the Understand topic');
  await ensureOpen();

  /* ------------------------------------------------------------------ */
  t.step('suggested questions');
  for (let i = 0; i < QUESTIONS_EN.length; i++) {
    await page.locator('#assistant-drawer .asst-sugg [data-asst-q]').nth(i).click();
    await page.waitForFunction((q) => {
      const th = YES.state.assistant.thread;
      return th.length && th[th.length - 1].via === 'suggested';
    }, null);
    t.eq(norm(await page.locator(LATEST + ' .asst-you').innerText()).replace(/^You:\s*/, ''), QUESTIONS_EN[i], `bubble shows "${QUESTIONS_EN[i]}"`);
    t.assert(await activeInDrawer(), 'focus stays in the drawer');
  }
  await page.click('#assistant-drawer .asst-sugg [data-asst-q="peg"]');
  const peg = await latestText();
  t.assert(peg.includes("I can't guarantee that a token will always be worth one US dollar"), 'peg: cannot guarantee');
  t.assert(peg.includes("can't give investment advice"), 'peg: no investment advice');
  t.assert(peg.includes('illustrative demo rate of 1.0000 USD per token'), 'peg: rate is illustrative');
  t.assert(peg.includes('approved issuer disclosures'), 'peg: points to approved disclosures');
  await page.click('#assistant-drawer .asst-sugg [data-asst-q="onchain_sent"]');
  t.eq(await latestRows(), ['TX-260909-2051', 'TX-260909-2052'], 'on-chain send rows');
  await page.click('#assistant-drawer .asst-sugg [data-asst-q="largest"]');
  t.assert((await latestText()).includes('Deposit from linked bank account'), 'largest movement from calc.largest');
  await page.click('#assistant-drawer .asst-sugg [data-asst-q="statement_vs_live"]');
  t.eq(await latestTitle(), 'Statement balance versus live balance', 'statement vs live');

  t.step('ask() API');
  await page.evaluate(() => YES.assistant.close());
  await waitClosed();
  await page.evaluate(() => YES.assistant.ask('fees_paid'));
  await waitOpen();
  t.eq(await latestTitle(), 'What you paid in fees', 'ask(questionId) opens with the answer');
  t.assert(await activeInDrawer(), 'ask() moves focus into the drawer');

  /* ------------------------------------------------------------------ */
  t.step('free text');
  await typeAsk('should I buy more');
  t.eq(await latestTitle(), "I can't give investment advice", 'investment advice refused');
  t.eq(norm(await page.locator(LATEST + ' .asst-you').innerText()).replace(/^You:\s*/, ''), 'should I buy more', 'question shown verbatim');
  t.eq(await page.inputValue('#asst-input'), '', 'input cleared after asking');
  await typeAsk('send 50 to Daniel');
  t.eq(await latestTitle(), "I can't move money or start transactions", 'cannot initiate transactions');
  const actionId = await lastId();
  await typeAsk('qwzx blorf plim');
  t.eq(await latestTitle(), 'I can only answer questions about this statement', 'honest fallback');
  const fb = await latestText();
  t.assert(fb.includes("I won't guess or make up an answer"), 'fallback does not invent');
  t.eq(await page.locator(LATEST + ' .asst-inline-q [data-asst-q]').count(), 3, 'fallback offers suggestions');
  t.assert(await page.locator(LATEST + ' [data-asst-talk]').isVisible(), 'fallback offers the human-help route');
  await typeAsk('Where did I send money on-chain?');
  t.eq(await latestTitle(), 'Where you sent money on-chain', 'typed on-chain question');
  await typeAsk('¿Por qué cambió mi saldo?');
  t.eq(await latestTitle(), 'Why your balance changed', 'Spanish question matched (answer in the current language)');
  await typeAsk('What is TX-260912-0806?');
  t.eq(await latestTitle(), 'Fee for depositing by debit card', 'transaction id in free text');
  const n1 = await lastId();
  await page.fill('#asst-input', '   ');
  await page.press('#asst-input', 'Enter');
  await page.waitForTimeout(100);
  t.eq(await lastId(), n1, 'empty question is not added');
  t.eq(await page.evaluate(() => document.activeElement.id), 'asst-input', 'focus stays in the input');

  const matched = await page.evaluate(() =>
    [
      'Will the price go up next month?',
      'Is EXUSD a good investment?',
      'Can you transfer 20 to Sofia?',
      'cancel my pending redemption',
      'Is one token always worth one dollar?',
      'How much did I send to Daniel?',
      'What are my fees?',
      'what are fees',
      'what is pending',
      'When was my balance highest?',
      'What was my biggest transaction?',
      'what does on-chain mean',
      'Who holds the reserves?',
      'What is my live balance right now?',
      'I want to talk to a person',
      'How much did I deposit?',
      'what is a redemption',
      'envía 50 a Daniel',
      '¿Debería comprar más?',
      '¿Un token siempre vale un dólar?',
      '¿Cuánto pagué en comisiones?',
      '¿A dónde envié dinero en cadena?',
      '¿Qué está pendiente?',
      '¿Cuál fue mi mayor movimiento?',
      'hola',
      'why is the sky blue'
    ].map((q) => {
      const m = YES.assistant.match(q);
      return m.topic + (m.id ? ':' + m.id : '');
    })
  );
  t.eq(
    matched,
    [
      'advice',
      'advice',
      'action',
      'action',
      'peg',
      'counterparty:daniel',
      'fees',
      'edu:fees',
      'pending',
      'chart',
      'largest',
      'edu:onchain_vs_internal',
      'edu:transparency',
      'edu:statement_vs_live',
      'human',
      'step:deposits',
      'edu:redemption',
      'action',
      'advice',
      'peg',
      'fees',
      'onchain_sent',
      'pending',
      'largest',
      'general',
      'fallback'
    ],
    'deterministic EN/ES intent matching'
  );

  /* ------------------------------------------------------------------ */
  t.step('feedback');
  const fid = await lastId();
  await page.click(LATEST + ' [data-asst-fb="yes"]');
  t.eq(await page.evaluate((id) => YES.state.assistant.helpful[id], fid), 'yes', 'feedback recorded in YES.state');
  t.eq(await page.getAttribute(LATEST + ' [data-asst-fb="yes"]', 'aria-pressed'), 'true', 'choice exposed with aria-pressed');
  t.eq(await page.getAttribute(LATEST + ' [data-asst-fb="no"]', 'aria-pressed'), 'false', 'other choice not pressed');
  t.assert((await latestText()).includes('kept only in this browser session'), 'says feedback stays local');
  await page.waitForFunction(() => document.getElementById('live-polite').textContent.includes('Nothing was sent'), null, { timeout: 2000 }).catch(() => {});
  t.assert((await page.locator('#live-polite').textContent()).includes('Nothing was sent'), 'feedback confirmation announced');
  t.eq(await activeFk(), `asst-${fid}-fb-yes`, 'focus stays on the feedback button');

  t.step('talk to a person');
  await calls();
  await page.click(LATEST + ' [data-asst-talk]');
  t.eq(await calls(), [{ fn: 'help', s: 'contact' }], 'opens Help › contact');
  if (wide) t.assert(await isOpen(), 'docked drawer stays open');
  else await waitClosed();
  await ensureOpen();

  /* ------------------------------------------------------------------ */
  t.step('language switch re-renders the thread');
  await openCtx('step', 'transfers_out');
  await typeAsk('send 50 to Daniel');
  const fid2 = await lastId();
  await page.click(LATEST + ' [data-asst-fb="no"]');
  await page.fill('#asst-input', 'draft question');
  await page.evaluate(() => document.querySelector('#assistant-drawer .asst__body').scrollTo(0, 0));
  const idsBefore = await page.evaluate(() => YES.state.assistant.thread.map((e) => e.id));
  if (wide) await page.click('[data-lang="es"]');
  else await page.evaluate(() => YES.setLang('es'));
  await page.waitForFunction(() => document.documentElement.lang === 'es');
  t.assert(await isOpen(), 'drawer stays open');
  t.eq(await page.evaluate(() => YES.state.assistant.thread.map((e) => e.id)), idsBefore, 'thread preserved');
  t.eq(norm(await page.locator('#asst-title').innerText()).trim(), 'Pregunta a YES', 'heading translated');
  t.assert(norm(await page.locator('#assistant-drawer .asst__head').innerText()).includes('Explicación de demostración'), 'demo label translated');
  const all = norm(await page.locator('#assistant-drawer .asst-thread').innerText());
  t.assert(all.includes('Transferencias enviadas: −450,00 EXUSD'), 'earlier step answer re-rendered with 450,00');
  t.assert(all.includes('No puedo mover dinero ni iniciar movimientos'), 'refusal re-rendered in Spanish');
  t.assert(all.includes('send 50 to Daniel'), "visitor's own words kept verbatim");
  t.assert(!all.includes('Outgoing transfers:'), 'no English answer left behind');
  t.eq(await page.inputValue('#asst-input'), 'draft question', 'draft survives the switch');
  t.eq(await page.getAttribute(`[data-fk="asst-${fid2}-fb-no"]`, 'aria-pressed'), 'true', 'feedback survives the switch');
  const qsEs = await page.$$eval('#assistant-drawer .asst-sugg [data-asst-q]', (els) => els.map((e) => e.textContent.trim()));
  t.eq(qsEs[5], '¿Un token siempre vale un dólar estadounidense?', 'suggestions translated');
  t.assert(norm(await page.locator('#assistant-drawer [data-asst-ctx]').innerText()).includes('Sobre:'), 'context chip translated');
  await typeAsk('¿Debería comprar más?');
  t.eq(await latestTitle(), 'No puedo darte consejos de inversión', 'Spanish refusal');
  await openCtx('step', 'transfers_out');
  t.assert((await latestText()).includes('450,00'), 'Spanish figures use 450,00');
  t.eq(await page.evaluate(() => YES.i18n.audit()), {}, 'i18n audit still clean');
  await axeOk('Spanish');
  await shot('es');
  if (wide) await page.click('[data-lang="en"]');
  else await page.evaluate(() => YES.setLang('en'));
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  t.assert(norm(await page.locator('#assistant-drawer .asst-thread').innerText()).includes('Outgoing transfers: −450.00 EXUSD'), 'back to English');

  /* ------------------------------------------------------------------ */
  t.step('layout');
  t.eq(await page.evaluate(() => { const d = document.getElementById('assistant-drawer'); return d.scrollHeight <= d.clientHeight + 1 && d.scrollTop === 0; }), true, 'the drawer itself never scrolls (only its body)');
  const h = await noHScroll();
  t.assert(h.page, 'no horizontal page scroll with the drawer open');
  t.assert(h.body, 'drawer body does not scroll sideways');
  t.eq(h.offenders, [], 'nothing in the drawer overflows the viewport');
  if (wide) {
    const geo = await page.evaluate(() => {
      const d = document.getElementById('assistant-drawer').getBoundingClientRect();
      const main = document.querySelector('#main .container:not([hidden])') || document.getElementById('main');
      const bal = document.querySelector('.ov-balance');
      const mast = document.querySelector('.masthead__bar');
      return {
        left: Math.round(d.left),
        right: Math.round(d.right),
        vw: window.innerWidth,
        mainRight: Math.round(main.getBoundingClientRect().right),
        balRight: bal ? Math.round(bal.getBoundingClientRect().right) : null,
        mastRight: Math.round(mast.getBoundingClientRect().right)
      };
    });
    t.eq(geo.right, geo.vw, 'drawer on the right edge');
    t.assert(geo.mainRight <= geo.left, `page content reflows beside the drawer (${geo.mainRight} ≤ ${geo.left})`);
    t.assert(geo.mastRight <= geo.left, 'masthead reflows too');
    if (geo.balRight !== null) t.assert(geo.balRight <= geo.left, 'the balance card is not covered');
    // The page stays usable while docked (non-modal).
    await page.click('.nav__link[data-nav="help"]');
    t.assert(await isOpen(), 'docked drawer stays open while navigating');
    await page.click('.nav__link[data-nav="overview"]');
    await shot('docked');
  } else {
    await shot('sheet');
  }

  /* ------------------------------------------------------------------ */
  t.step('stacked above another modal dialog');
  await page.evaluate(() => YES.assistant.close({ returnFocus: false }));
  await waitClosed();
  await page.evaluate(() => {
    const d = document.createElement('dialog');
    d.id = 'probe-dlg';
    d.className = 'dlg';
    d.setAttribute('aria-labelledby', 'probe-h');
    d.innerHTML = '<div class="dlg__body"><h2 id="probe-h">Probe dialog</h2><button type="button" class="btn" id="probe-explain" data-explain="transaction" data-explain-id="TX-260909-2051">Explain</button></div>';
    document.body.appendChild(d);
    YES.ui.openDialog(d, { trigger: document.querySelector('[data-ask]'), initialFocus: '#probe-explain' });
  });
  await page.click('#probe-explain');
  await waitOpen();
  t.eq(await mode(), 'stacked', 'opened as a stacked modal');
  t.assert(await isModal(), 'stacked drawer is modal (interactive above the other dialog)');
  t.assert(await activeInDrawer(), 'focus inside the stacked drawer');
  t.assert((await latestText()).includes('Illustrative reference — no live blockchain verification'), 'stacked drawer shows the transaction answer');
  await page.keyboard.press('Escape');
  await waitClosed();
  t.assert(await page.evaluate(() => document.getElementById('probe-dlg').open), 'the underlying dialog stays open');
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'probe-explain', null, { timeout: 2000 }).catch(() => {});
  t.eq(await page.evaluate(() => document.activeElement.id), 'probe-explain', 'focus returns inside the underlying dialog');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('probe-dlg').open);
  await page.evaluate(() => document.getElementById('probe-dlg').remove());

  /* ------------------------------------------------------------------ */
  if (wide) {
    t.step('intermediate width: modal side drawer');
    await page.setViewportSize({ width: 900, height: 900 });
    await page.click('[data-ask]');
    await waitOpen();
    await settle(page);
    t.eq(await mode(), 'modal', 'modal between 720 and 1099px');
    t.assert(await isModal(), 'is :modal (backdrop, page inert)');
    t.assert(!(await page.evaluate(() => document.documentElement.classList.contains('assistant-docked'))), 'not docked');
    const r9 = await page.evaluate(() => {
      const b = document.getElementById('assistant-drawer').getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height), vh: window.innerHeight };
    });
    t.eq(r9.right, 900, 'drawer on the right edge');
    t.assert(r9.left > 400, 'side drawer, not full screen');
    t.eq(r9.h, r9.vh, 'full height');
    t.assert(await activeInDrawer(), 'focus moves into the modal drawer');
    await axeOk('900px modal');
    await shot('tablet');
    await page.keyboard.press('Escape');
    await waitClosed();
    await waitFocusFk('ask-yes');
    t.eq(await activeFk(), 'ask-yes', 'Escape closes and returns focus');

    t.step('backdrop click closes');
    await page.click('[data-ask]');
    await waitOpen();
    await page.mouse.click(40, 500);
    await waitClosed();
    t.assert(!(await isOpen()), 'clicking the backdrop closes the modal drawer');

    t.step('resizing switches between docked and modal');
    await page.click('[data-ask]');
    await waitOpen();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => YES.assistant.mode() === 'docked', null, { timeout: 2000 }).catch(() => {});
    t.eq(await mode(), 'docked', 'docks when widened');
    t.assert(await page.evaluate(() => document.documentElement.classList.contains('assistant-docked')), 'docked class applied');
    t.assert(await activeInDrawer(), 'focus kept in the drawer');
    await page.setViewportSize({ width: 900, height: 900 });
    await page.waitForFunction(() => YES.assistant.mode() === 'modal', null, { timeout: 2000 }).catch(() => {});
    t.eq(await mode(), 'modal', 'becomes modal when narrowed');
    t.assert(await isModal(), 'is :modal again');
    t.assert(await activeInDrawer(), 'focus kept in the drawer after narrowing');
    await page.keyboard.press('Escape');
    await waitClosed();
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  /* ------------------------------------------------------------------ */
  t.step('clear conversation');
  await openCtx('general');
  await page.click('#assistant-drawer [data-asst-clear]');
  t.eq(await threadLen(), 1, 'only the welcome remains');
  t.assert((await latestTitle()).startsWith('Hello, Sam.'), 'welcome shown again');
  t.assert(await activeInDrawer(), 'focus stays in the drawer');
  await page.waitForFunction(() => document.getElementById('live-polite').textContent === 'Conversation cleared', null, { timeout: 2000 }).catch(() => {});
  t.eq(await page.locator('#live-polite').textContent(), 'Conversation cleared', 'clearing is announced');

  /* ------------------------------------------------------------------ */
  t.step('dark colour scheme');
  await page.emulateMedia({ colorScheme: 'dark' });
  await openCtx('transaction', 'TX-260909-2051');
  await axeOk('dark');
  await shot('dark');
  await page.emulateMedia({ colorScheme: 'light' });

  t.step('reduced motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCtx('step', 'fees');
  t.assert(await isOpen(), 'works with reduced motion');
  const dur = await page.evaluate(() => getComputedStyle(document.getElementById('assistant-drawer')).animationDuration);
  t.assert(parseFloat(dur) < 0.01, `no drawer animation under reduced motion (${dur})`);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.keyboard.press('Escape');
  await waitClosed();
  await restoreSpies();
  t.eq(await page.evaluate(() => YES.i18n.audit()), {}, 'i18n audit clean at the end');
}
