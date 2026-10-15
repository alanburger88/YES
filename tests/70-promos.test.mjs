// "From YES" promotions (70-promos.js): content from YES.config.promotions,
// eligibility and personalisation from this statement's data, the Overview
// card (one at a time, Not now, Next update, never automatic), the in-context
// notes (Fees card, transaction detail), the What's new view (#/whatsnew and
// deep links, the fifth tab, the phone Menu), Ask YES, the demo-only calls to
// action, and the statement of record kept factual (print, PDF, CSV,
// noscript). Also EN/ES parity, axe in light and dark, 320px reflow and the
// masthead fitting five tabs at every width, in both languages, at 200% text.
import { readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const meta = { name: 'promos', viewports: ['desktop', 'mobile', 'narrow'] };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS = join(ROOT, 'test-results');
mkdirSync(RESULTS, { recursive: true });
const IDS = ['pay-identity', 'trust', 'currencies', 'interest'];
const nb = (s) => String(s).replace(/\u00a0/g, ' ');

export default async function (t) {
  const { page } = t;
  const vp = t.viewport;
  const desktop = vp === 'desktop';
  const state = (fn, arg) => page.evaluate(fn, arg);
  const text = async (sel) => nb(await page.locator(sel).first().innerText());
  const settle = async (ms = 120) => {
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
    await page.waitForTimeout(ms);
  };
  const fresh = async (hash = '') => {
    await page.goto('about:blank');
    await t.goto(hash);
  };
  const clearStore = () => state(() => localStorage.removeItem('yes.promos'));
  const toastSays = async (str) => {
    await page.waitForFunction((x) => document.getElementById('toast').textContent.includes(x), str, { timeout: 3000 }).catch(() => {});
    return nb(await page.evaluate(() => document.getElementById('toast').textContent));
  };
  const axeOk = async (label, include) => {
    await settle();
    const v = await t.axe(include);
    t.eq(v.map((x) => `${x.id}/${x.impact}: ${x.nodes.join(' ; ')}`), [], `axe: no violations (${label})`);
  };

  await clearStore();
  await fresh('');

  /* ------------------------------------------------------------------ */
  t.step('data: the trigger, the figures and the eligibility rules');
  const data = await state(() => {
    const send = YES.calc.tx('TX-260909-2051');
    const fee = YES.calc.tx('TX-260909-2052');
    return {
      send: { amount: send.amount, cp: send.counterparty.en, rail: send.rail, method: send.method, fees: send.fees },
      fee: { amount: fee.amount, kind: fee.feeKind, parent: fee.parentId, status: fee.status },
      daniel: YES.calc.posted().filter((x) => x.counterparty.en === 'Daniel K.').map((x) => [x.type, x.rail]),
      transfersOut: YES.calc.category('transfers_out').total,
      closing: YES.data.statement.closing,
      trust: YES.data.statement.customer.trust,
      facts: YES.promos.facts(),
      eligible: YES.config.promotions.items.map((p) => [p.id, YES.promos.eligible(p.id)]),
      overview: YES.promos.list('overview'),
      whatsnew: YES.promos.list('whatsnew'),
      current: YES.promos.current()
    };
  });
  t.eq(data.send, { amount: -20000, cp: 'External wallet 0x9C1D…44B7', rail: 'onchain', method: 'network_send', fees: [{ asset: 'USBC', amount: 100, kind: 'network_transfer', feeTxId: 'TX-260909-2052' }] }, 'the trigger: a 200.00 USBC send to External wallet 0x9C1D…44B7');
  t.eq(data.fee, { amount: -100, kind: 'network_transfer', parent: 'TX-260909-2051', status: 'posted' }, 'with its 1.00 USBC network fee, posted');
  t.eq(data.daniel, [['transfer_out', 'internal'], ['transfer_out', 'internal']], 'Sam also pays Daniel K. inside YES (internal transfers)');
  t.eq([data.facts.networkFees, data.facts.networkFeeTxIds, data.facts.networkSendIds], [100, ['TX-260909-2052'], ['TX-260909-2051']], 'network fees this period come from the ledger');
  t.eq([data.facts.sent, data.facts.sent], [-data.transfersOut, 45000], 'sent this month = the outgoing transfers step (450.00 USBC)');
  t.eq([data.facts.closing, data.facts.trustLevel, data.facts.monthlySendLimit], [data.closing, 'silver', 100000], 'closing balance, trust level and limit from the data');
  t.eq(data.trust.illustrative, true, 'the trust level is marked illustrative in the data');
  t.assert(data.facts.sent < data.facts.monthlySendLimit, 'the figures are coherent: 450.00 sent is within the 1,000.00 Silver limit');
  t.eq(data.eligible, IDS.map((id) => [id, true]), 'all four updates are eligible for this statement');
  t.eq(data.overview, IDS, 'Overview order by priority: identity, trust, currencies, interest');
  t.eq(data.whatsnew, IDS, 'What\'s new lists all four');
  t.eq(data.current, 'pay-identity', 'the Overview shows the highest-priority update');

  t.step('personalised copy (English)');
  const views = await state((ids) => ids.map((id) => YES.promos.view(id)), IDS);
  const v = Object.fromEntries(views.map((x) => [x.id, x]));
  t.eq(nb(v['pay-identity'].body), 'Send to a YES identity, like yes.danielk, instantly and with no network fee.', 'identity: body');
  t.eq(nb(v['pay-identity'].personal), 'You paid 1.00 USBC in network fees this month sending to external wallets.', 'identity: personalised with the fee from the ledger');
  t.eq(nb(v['pay-identity'].footnote).startsWith('yes.danielk is an example handle.'), true, 'identity: the handle is labelled as an example');
  t.eq(nb(v.trust.title), "You're at Silver", 'trust: level from the data');
  t.eq(nb(v.trust.body), 'Verify your address to reach Gold and raise your monthly send limit.', 'trust: next level');
  t.eq(nb(v.trust.personal), 'You sent 450.00 USBC this month. Your Silver limit is 1,000.00 USBC a month.', 'trust: sent and limit');
  t.eq(nb(v.currencies.body), 'Coming soon: hold EUBC, UKBC, MXBC and NZBC alongside USBC.', 'currencies: general (no cross-border activity in the data)');
  t.eq(nb(v.interest.body), 'Coming soon: earn interest on your USBC balance.', 'interest: body');
  t.eq(nb(v.interest.footnote), 'Subject to regulatory approval. Rates and terms to be confirmed.', 'interest: the regulatory footnote');
  t.eq(nb(v.interest.personal), 'Your statement balance: 1,147.50 USBC.', 'interest: a neutral balance line, never multiplied by a rate');
  {
    const all = await state(() =>
      YES.config.promotions.items
        .filter((p) => p.theme === 'interest')
        .flatMap((p) => Object.values(p).filter((x) => x && typeof x === 'object' && !Array.isArray(x) && 'en' in x).flatMap((x) => [x.en, x.es]))
        .join(' | ')
    );
    t.assert(!/%|\bAPY\b|\bTAE\b|\d+(?:[.,]\d+)?\s*(?:percent|por ciento)|per year|al año|anual|annual/i.test(all), 'interest copy states no rate, APY or return: ' + all);
  }

  t.step('rules follow the data');
  const rules = await state(() => {
    const keep = YES.data;
    const out = {};
    const run = (mutate) => {
      const copy = JSON.parse(JSON.stringify(keep));
      mutate(copy);
      YES.data = copy;
      return YES.config.promotions.items.map((p) => YES.promos.eligible(p.id));
    };
    out.noNetworkFee = run((d) => d.transactions.forEach((x) => x.feeKind === 'network_transfer' && (x.feeKind = 'other')));
    out.gold = run((d) => (d.statement.customer.trust.level = 'gold'));
    out.noTrust = run((d) => delete d.statement.customer.trust);
    out.empty = run((d) => (d.statement.closing = 0));
    YES.data = keep;
    const p = YES.config.promotions.items[0];
    const rule = p.rule;
    p.rule = { kind: 'somethingNew' };
    out.unknown = YES.promos.eligible(p.id);
    p.rule = rule;
    return out;
  });
  t.eq(rules.noNetworkFee, [false, true, true, true], 'no network fee paid: no "Pay a YES identity"');
  t.eq(rules.gold, [true, false, true, true], 'already Gold: no trust update');
  t.eq(rules.noTrust, [true, false, true, true], 'no trust level in the data: no trust update');
  t.eq(rules.empty, [true, true, true, false], 'zero balance: no interest update');
  t.eq(rules.unknown, false, 'an unknown rule is never eligible');

  /* ------------------------------------------------------------------ */
  t.step('Overview: one update, after the balance card, before the journey');
  const ov = await state(() => {
    const card = document.querySelector('#overview-root .promo--overview');
    const top = (s) => document.querySelector(s).getBoundingClientRect().top;
    return {
      count: document.querySelectorAll('#overview-root .promo--overview').length,
      id: card && card.getAttribute('data-promo'),
      order: top('.ov-balance') < top('.promo--overview') && top('.promo--overview') < top('.ov-journey'),
      afterNotice: document.querySelector('.ov-balance .ov-notin').getBoundingClientRect().bottom <= top('.promo--overview'),
      heading: card.querySelector('h2').textContent.trim(),
      labelled: card.getAttribute('aria-labelledby'),
      tag: !!card.querySelector('.tag--illustrative'),
      title: card.querySelector('.promo__title').textContent,
      count2: card.querySelector('.promo__count').textContent,
      see: card.querySelector('[data-promo-action="see"]').getAttribute('href'),
      inInk: !!card.closest('.ink-field')
    };
  });
  t.eq([ov.count, ov.id, ov.order, ov.afterNotice], [1, 'pay-identity', true, true], 'one card, below the balance card and its pending notice, above the journey');
  t.eq([ov.heading, ov.labelled, ov.tag], ["What's new from YES", 'promo-ov-h', true], 'labelled "What\'s new from YES" with an Illustrative tag');
  t.eq([ov.title, ov.count2, ov.see, ov.inInk], ['Pay a YES identity', '1 of 4', '#/whatsnew/pay-identity', false], 'title, counter, deep link; outside the statement\'s ink field');
  const card = nb(await text('.promo--overview'));
  t.assert(card.includes('You paid 1.00 USBC in network fees this month sending to external wallets.'), 'personalised line on the card');

  t.step('never rotates on its own');
  await page.waitForTimeout(3200);
  t.eq(await state(() => document.querySelector('.promo--overview').getAttribute('data-promo')), 'pay-identity', 'still the same update after 3 seconds');

  t.step('Next update rotates (focus stays on it)');
  await page.click('[data-fk="promo-ov-next"]');
  t.eq(await state(() => [document.querySelector('.promo--overview').getAttribute('data-promo'), document.activeElement.getAttribute('data-fk')]), ['trust', 'promo-ov-next'], 'Next update: the trust update, focus kept on Next update');
  t.eq(await text('.promo--overview .promo__count'), '2 of 4', 'counter 2 of 4');
  const meter = await state(() =>
    [...document.querySelectorAll('.promo--overview .promo-meter__step')].map((li) => [li.getAttribute('data-tier'), li.querySelector('.promo-meter__name').textContent.trim(), li.querySelector('.promo-meter__state').textContent.trim(), li.getAttribute('aria-current')])
  );
  t.eq(meter, [['bronze', 'Bronze', 'Reached', null], ['silver', 'Silver', "You're here", 'step'], ['gold', 'Gold', 'Next', null]], 'trust meter: every level labelled, the current one marked in words');
  if (desktop) {
    // WCAG 1.4.11: each meter mark has a ≥3:1 boundary; text is ≥4.5:1 (axe checks text).
    const marks = await state(() => {
      const lum = (c) => {
        const m = c.match(/[\d.]+/g).map(Number);
        const f = (x) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
      };
      const cr = (a, b) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05);
      };
      const bg = getComputedStyle(document.querySelector('.promo--overview')).backgroundColor;
      return [...document.querySelectorAll('.promo--overview .promo-meter__bar')].map((b) => +cr(getComputedStyle(b).borderTopColor, bg).toFixed(2));
    });
    t.assert(marks.length === 3 && marks.every((r) => r >= 3), 'meter marks have ≥3:1 outlines against the card: ' + JSON.stringify(marks));
  }
  await page.click('[data-fk="promo-ov-next"]');
  await page.click('[data-fk="promo-ov-next"]');
  t.eq(await state(() => document.querySelector('.promo--overview').getAttribute('data-promo')), 'interest', 'then currencies, then interest');
  t.assert((await text('.promo--overview')).includes('Subject to regulatory approval. Rates and terms to be confirmed.'), 'the interest card carries its footnote');
  await page.click('[data-fk="promo-ov-next"]');
  t.eq(await state(() => document.querySelector('.promo--overview').getAttribute('data-promo')), 'pay-identity', 'and round again');

  t.step('Not now: hides it, shows the next, persists');
  await page.click('[data-fk="promo-ov-next"]'); // trust
  await page.click('[data-fk="promo-ov-dismiss"]');
  const afterDismiss = await state(() => ({
    id: document.querySelector('.promo--overview').getAttribute('data-promo'),
    focus: document.activeElement.id,
    state: YES.state.promos.dismissed,
    stored: JSON.parse(localStorage.getItem('yes.promos')).dismissed,
    count: document.querySelector('.promo--overview .promo__count').textContent
  }));
  t.eq(afterDismiss, { id: 'currencies', focus: 'promo-ov-title', state: ['trust'], stored: ['trust'], count: '2 of 3' }, 'Not now: the next update, focus on its title, kept in YES.state and localStorage');
  await state(() => YES.setLang('es'));
  t.eq(await state(() => [document.querySelector('.promo--overview').getAttribute('data-promo'), YES.state.promos.dismissed]), ['currencies', ['trust']], 'a language switch keeps the dismissal and the current update');
  t.eq(await text('.promo--overview .promo__heading'), 'Novedades de YES', 'the card in Spanish');
  await state(() => YES.setLang('en'));
  await fresh('');
  t.eq(await state(() => [YES.promos.current(), YES.state.promos.dismissed, document.querySelectorAll('.promo--overview').length]), ['pay-identity', ['trust'], 1], 'after a reload: still dismissed (localStorage)');
  // Blocked storage never breaks the page.
  {
    const p2 = await page.context().newPage();
    const errs = [];
    p2.on('pageerror', (e) => errs.push(e.message));
    await p2.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('storage blocked');
        }
      });
    });
    await p2.goto(page.url().split('#')[0]);
    await p2.waitForFunction(() => window.YES && YES.ready);
    await p2.click('[data-fk="promo-ov-dismiss"]');
    t.eq([await p2.evaluate(() => YES.state.promos.dismissed), errs], [['pay-identity'], []], 'blocked storage: dismissal still applies to this page view, no errors');
    await p2.close();
  }

  t.step('dismissing them all leaves one quiet line, then nothing');
  for (let i = 0; i < 3; i++) await page.click('[data-fk="promo-ov-dismiss"]');
  t.eq(await state(() => [document.querySelectorAll('.promo--overview').length, document.activeElement.getAttribute('data-fk')]), [0, 'promo-ov-cleared'], 'no card; focus on the way to What\'s new');
  t.assert((await text('.promo-cleared')).includes("You're all caught up."), 'a quiet "all caught up" line');
  t.eq(await state(() => document.querySelectorAll('#overview-root .promo-note').length), 0, 'a dismissed update also leaves the Fees card');
  await fresh('');
  t.eq(await state(() => document.querySelector('[data-promo-slot]') && document.querySelector('[data-promo-slot]').innerHTML), '', 'after a reload: nothing at all');

  t.step('What\'s new: "Show dismissed updates again"');
  await fresh('#/whatsnew');
  t.assert((await text('.wn-hidden')).includes('You hid 4 updates from your Overview.'), 'the view says how many are hidden');
  t.eq(await page.locator('#whatsnew-root .promo__hidden').count(), 4, 'each hidden update is marked');
  await page.click('[data-fk="wn-restore"]');
  t.eq(await state(() => [YES.state.promos.dismissed, localStorage.getItem('yes.promos'), document.activeElement.id, document.querySelectorAll('.wn-hidden').length]), [[], null, 'h-whatsnew', 0], 'restored: state and storage cleared, focus on the heading');
  await page.click(desktop ? '.nav__link[data-nav="overview"]' : '.brand');
  t.eq(await state(() => YES.promos.current()), 'pay-identity', 'the Overview shows updates again');

  /* ------------------------------------------------------------------ */
  t.step('in-context note: the Fees card, beside the network fee');
  await fresh('');
  const feeNote = await state(() => {
    const notes = [...document.querySelectorAll('#overview-root .promo-note')];
    const n = notes[0];
    const li = n && n.closest('li');
    const link = n && n.querySelector('a');
    return {
      count: notes.length,
      inFees: !!(n && n.closest('.ov-fees')),
      beside: li && li.querySelector('[data-ov-tx]').getAttribute('data-ov-tx'),
      text: n && n.textContent.replace(/\s+/g, ' ').trim(),
      from: !!(n && n.querySelector('.promo-from')),
      tag: !!(n && n.querySelector('.tag--illustrative')),
      href: link && link.getAttribute('href'),
      name: link && link.textContent.trim()
    };
  });
  t.eq([feeNote.count, feeNote.inFees, feeNote.beside, feeNote.from, feeNote.tag], [1, true, 'TX-260909-2052', true, true], 'one note, in the Fees card, in the network fee\'s row, with From YES and Illustrative');
  t.eq([feeNote.href, feeNote.name], ['#/whatsnew/pay-identity', 'See how: Pay a YES identity'], 'its link goes to the update (named in full for assistive technology)');
  t.assert(feeNote.text.includes('Next time, pay a YES identity. No network fee.'), 'one short line: ' + feeNote.text);

  t.step('in-context note: the transaction detail of that send (and its fee), nowhere else');
  const dlgNote = async (id) => {
    await state((x) => YES.explorer.openTx(x), id);
    await page.locator('#tx-dialog[open]').waitFor();
    const r = await state(() => {
      const n = document.querySelector('#tx-dialog .promo-note');
      return n ? { inFees: !!n.closest('section[aria-labelledby="txd-fees-h"]'), from: !!n.querySelector('.promo-from'), tag: !!n.querySelector('.tag--illustrative') } : null;
    });
    return r;
  };
  t.eq(await dlgNote('TX-260909-2051'), { inFees: true, from: true, tag: true }, 'the external-wallet send: a note in its Fees section');
  t.eq(await dlgNote('TX-260909-2052'), { inFees: true, from: true, tag: true }, 'its network fee: the same note');
  for (const id of ['TX-260903-1127', 'TX-260912-0806', 'TX-260930-2247', 'TX-260915-1648']) t.eq(await dlgNote(id), null, `no note on ${id}`);
  await state(() => YES.explorer.openTx('TX-260909-2051'));
  await page.click('#tx-dialog .promo-note__link');
  await page.waitForFunction(() => YES.state.view === 'whatsnew' && !document.getElementById('tx-dialog').open);
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'wn-pay-identity-title', null, { timeout: 3000 }).catch(() => {});
  t.eq(await state(() => [location.hash, document.activeElement.id, YES.promos.metrics().clicks['pay-identity']]), ['#/whatsnew/pay-identity', 'wn-pay-identity-title', 1], 'See how: the detail closes, the update is focused, the click counted in memory');

  /* ------------------------------------------------------------------ */
  t.step('What\'s new: the view, its routes and deep links');
  await fresh('#/whatsnew');
  const wn = await state(() => ({
    h1: [document.querySelectorAll('#view-whatsnew h1').length, document.querySelector('#view-whatsnew h1').id, document.querySelector('#view-whatsnew h1').textContent, document.querySelector('#view-whatsnew h1').hasAttribute('data-view-heading')],
    title: document.title,
    cards: [...document.querySelectorAll('#whatsnew-root .promo--full')].map((a) => [a.id, !!a.querySelector('.promo-from'), !!a.querySelector('.tag--illustrative'), !!a.querySelector('.promo__foot'), a.querySelector('[data-promo-action="cta"]').textContent.trim()]),
    note: document.querySelector('.wn-note').textContent,
    views: [...document.querySelectorAll('main > .view')].filter((s) => !s.hidden).map((s) => s.id)
  }));
  t.eq(wn.h1, [1, 'h-whatsnew', "What's new", true], 'one h1 that follows the view contract');
  t.eq(wn.title, "What's new · YES statement, September 2026 · Illustrative demo", 'document title names the section');
  t.eq(wn.views, ['view-whatsnew'], 'only the What\'s new view shows');
  t.eq(
    wn.cards,
    [
      ['wn-pay-identity', true, true, true, 'Find a YES identity'],
      ['wn-trust', true, true, true, 'Verify your address'],
      ['wn-currencies', true, true, true, 'Notify me'],
      ['wn-interest', true, true, true, 'Notify me']
    ],
    'four cards, each with From YES, Illustrative, a footnote and a call to action'
  );
  t.assert(wn.note.includes('Updates are illustrative and subject to YES approval.'), 'the illustrative note');
  t.eq(await page.locator('#wn-currencies .promo-codes__code').allInnerTexts(), ['EUBC', 'UKBC', 'MXBC', 'NZBC'], 'the planned currencies');
  for (const id of IDS) {
    await fresh('#/whatsnew/' + id);
    await page.waitForFunction((x) => document.activeElement && document.activeElement.id === 'wn-' + x + '-title', id, { timeout: 3000 }).catch(() => {});
    t.eq(await state(() => [YES.state.view, document.activeElement.id]), ['whatsnew', 'wn-' + id + '-title'], `deep link #/whatsnew/${id} focuses that update`);
  }
  await fresh('#/whatsnew/nope');
  t.eq(await state(() => YES.state.view), 'whatsnew', 'an unknown update id still opens the view');

  t.step('navigation: the fifth tab, and the phone Menu');
  await fresh('');
  if (desktop) {
    t.eq(await page.$$eval('.nav__link', (els) => els.map((e) => e.getAttribute('data-nav'))), ['overview', 'transactions', 'understand', 'help', 'whatsnew'], 'five tabs, What\'s new last');
    await page.click('.nav__link[data-nav="whatsnew"]');
    t.eq(await state(() => [location.hash, document.activeElement.id, document.querySelector('.nav__link[data-nav="whatsnew"]').getAttribute('aria-current')]), ['#/whatsnew', 'h-whatsnew', 'page'], 'the tab opens the view and focuses its heading');
  } else {
    await page.click('#masthead [data-mast-menu]');
    await page.locator('#mast-menu').waitFor({ state: 'visible' });
    t.eq(await page.$$eval('#mast-menu .mast-menu__link', (els) => els.map((e) => [e.getAttribute('data-nav'), e.textContent.trim()])), [['overview', 'Overview'], ['transactions', 'Transactions'], ['understand', 'Understand'], ['help', 'Help'], ['whatsnew', "What's new"]], 'the Menu lists the five sections');
    await page.click('#mast-menu .mast-menu__link[data-nav="whatsnew"]');
    t.eq(await state(() => [location.hash, document.activeElement.id, document.getElementById('mast-menu').hidden]), ['#/whatsnew', 'h-whatsnew', true], 'Menu → What\'s new: the menu closes and the heading is focused');
    await state(() => YES.setLang('es'));
    await page.click('#masthead [data-mast-menu]');
    t.eq((await page.locator('#mast-menu .mast-menu__link[data-nav="whatsnew"]').textContent()).trim(), 'Novedades', 'the Menu in Spanish: Novedades');
    await page.keyboard.press('Escape');
    await state(() => YES.setLang('en'));
  }

  /* ------------------------------------------------------------------ */
  t.step('calls to action: a toast, nothing sent, no navigation');
  await fresh('#/whatsnew');
  const before = await state(() => location.href);
  await page.click('[data-fk="wn-pay-identity-cta"]');
  t.eq(await toastSays('In the YES app'), 'In the YES app, this would open YES identities. Nothing was sent.', 'CTA toast');
  t.eq(await state(() => [location.href, YES.state.view]), [before, 'whatsnew'], 'no navigation');
  await page.click('[data-fk="wn-interest-cta"]');
  t.eq(await toastSays('interest'), 'In the YES app, this would open interest updates. Nothing was sent.', 'interest CTA toast');
  t.eq(await state(() => YES.promos.metrics().clicks), { 'pay-identity': 1, interest: 1 }, 'clicks counted in memory only');
  t.eq(t.external.filter((u) => !/cdn\.userway\.org/.test(u)), [], 'no network request');
  t.eq(await state(() => Object.keys(localStorage).filter((k) => /promo/i.test(k) && k !== 'yes.promos')), [], 'nothing else stored');
  await state(() => YES.setLang('es'));
  await page.click('[data-fk="wn-pay-identity-cta"]');
  t.eq(await toastSays('En la app'), 'En la app de YES, esto abriría las identidades YES. No se envió nada.', 'Spanish CTA toast');
  await state(() => YES.setLang('en'));

  /* ------------------------------------------------------------------ */
  t.step('Ask YES: "What\'s new?" and typed questions');
  const matches = await state(() =>
    ["What's new?", 'what is new', 'Any new features?', 'Will I earn interest on my USBC?', 'what are my limits', 'How do I pay a YES identity?', 'Can I hold EUBC?', '¿Qué hay de nuevo?', '¿Hay intereses?', 'límite de envío'].map((q) => {
      const m = YES.assistant.match(q);
      return [q, m.topic, m.id];
    })
  );
  t.eq(
    matches.map((m) => [m[1], m[2]]),
    [
      ['whatsnew', null],
      ['whatsnew', null],
      ['whatsnew', null],
      ['whatsnew', 'interest'],
      ['whatsnew', 'trust'],
      ['whatsnew', 'identity'],
      ['whatsnew', 'currencies'],
      ['whatsnew', null],
      ['whatsnew', 'interest'],
      ['whatsnew', 'trust']
    ],
    'typed questions match: ' + JSON.stringify(matches)
  );
  t.eq(await state(() => YES.assistant.match('What APY will I get?').topic), 'advice', 'a rate or yield question gets the no-advice answer');
  await state(() => YES.assistant.ask('whats_new'));
  await page.locator('#assistant-drawer[open]').waitFor();
  const LATEST = '#assistant-drawer .asst-turn:last-child';
  const ans = await state((sel) => {
    const a = document.querySelector(sel + ' .asst-ans');
    return { title: a.querySelector('.asst-ans__title').textContent, bullets: a.querySelectorAll('.asst-ans__list li').length, text: a.textContent.replace(/\u00a0/g, ' '), from: !!a.querySelector('.asst-tag-yes'), tag: !!a.querySelector('.tag--illustrative'), btn: a.querySelector('[data-asst-whatsnew]') && a.querySelector('[data-asst-whatsnew]').textContent.trim() };
  }, LATEST);
  t.eq([ans.title, ans.bullets, ans.from, ans.tag, ans.btn], ["What's new from YES", 4, true, true, "Open What's new"], 'the answer lists the four updates, From YES and Illustrative, with a link to the view');
  t.assert(ans.text.includes('You paid 1.00 USBC in network fees') && ans.text.includes('Subject to regulatory approval. Rates and terms to be confirmed.'), 'personalised and with the interest footnote');
  t.assert(ans.text.includes('subject to YES approval'), 'says the updates are illustrative and subject to approval');
  t.eq(await state(() => [...document.querySelectorAll('#assistant-drawer .asst-sugg [data-asst-q]')].map((b) => b.textContent.trim()).pop()), "What's new?", 'suggested question "What\'s new?"');
  await state(() => YES.assistant.askText('Will I earn interest on my USBC?'));
  const interest = await state((sel) => document.querySelector(sel + ' .asst-ans').textContent.replace(/\u00a0/g, ' '), LATEST);
  t.assert(interest.includes('Interest on USBC') && interest.includes('Subject to regulatory approval. Rates and terms to be confirmed.') && !/%|APY/.test(interest), 'interest: footnote, no rate: ' + interest);
  await page.click(LATEST + ' [data-asst-whatsnew]');
  await page.waitForFunction(() => YES.state.view === 'whatsnew');
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'wn-interest-title', null, { timeout: 3000 }).catch(() => {});
  t.eq(await state(() => [location.hash, document.activeElement.id]), ['#/whatsnew/interest', 'wn-interest-title'], 'the answer opens that update in What\'s new');
  if (await state(() => YES.assistant.isOpen())) await state(() => YES.assistant.close());
  await state(() => YES.setLang('es'));
  await state(() => YES.assistant.ask('whats_new'));
  t.eq(await state((sel) => document.querySelector(sel + ' .asst-ans__title').textContent, LATEST), 'Novedades de YES', 'Spanish answer');
  t.eq(await state(() => document.querySelector('#assistant-drawer .asst-sugg [data-asst-q="whats_new"]').textContent.trim()), '¿Qué hay de nuevo?', 'Spanish suggestion');
  await state(() => YES.assistant.close());
  await state(() => YES.setLang('en'));

  /* ------------------------------------------------------------------ */
  t.step('EN/ES parity, every string translated, no em dashes');
  const parity = await state(() => {
    const out = { missing: [], same: [], dashes: [], fields: 0 };
    YES.config.promotions.items.forEach((p) => {
      const walk = (o, path) => {
        if (o && typeof o === 'object' && 'en' in o && 'es' in o) {
          out.fields++;
          if (!o.en || !o.es) out.missing.push(path);
          if (/[\u2014]/.test(o.en + o.es)) out.dashes.push(path);
          return;
        }
        if (o && typeof o === 'object') Object.keys(o).forEach((k) => walk(o[k], path + '.' + k));
      };
      walk(p, p.id);
      ['eyebrow', 'title', 'body', 'note', 'cta', 'feature', 'footnote'].forEach((f) => {
        if (p[f] && p[f].en === p[f].es) out.same.push(p.id + '.' + f);
      });
    });
    const keys = Object.keys(YES.i18n.dict.en).filter((k) => /^promos\.|^nav\.whatsnew$|^assistant\.(q\.whats_new|fromYes|subject\.whatsnew|whatsnew\.)/.test(k));
    out.keys = keys.length;
    keys.forEach((k) => {
      ['en', 'es'].forEach((l) => {
        const s = YES.i18n.dict[l][k];
        if (typeof s !== 'string' || !s) out.missing.push(l + ':' + k);
        else if (/[\u2014]/.test(s)) out.dashes.push(l + ':' + k);
      });
    });
    out.audit = YES.i18n.audit();
    return out;
  });
  t.assert(parity.fields >= 30 && parity.keys >= 30, `every promotion field and string checked (${parity.fields} fields, ${parity.keys} keys)`);
  t.eq([parity.missing, parity.same, parity.dashes, parity.audit], [[], [], [], {}], 'both languages for every field and string, Spanish really translated, no em dashes, i18n audit clean');
  await state(() => YES.setLang('es'));
  await fresh('#/whatsnew');
  const es = await state(() => ({
    h1: document.getElementById('h-whatsnew').textContent,
    titles: [...document.querySelectorAll('#whatsnew-root .promo__title')].map((h) => h.textContent),
    from: document.querySelector('#whatsnew-root .promo-from').textContent,
    tag: document.querySelector('#whatsnew-root .tag--illustrative').textContent,
    text: document.getElementById('whatsnew-root').textContent.replace(/\u00a0/g, ' ')
  }));
  t.eq([es.h1, es.titles, es.from, es.tag], ['Novedades', ['Paga a una identidad YES', 'Estás en el nivel Plata', 'Más monedas', 'Intereses en USBC'], 'De YES', 'Ilustrativo'], 'Spanish view');
  t.assert(es.text.includes('Este mes pagaste 1,00 USBC en comisiones de red') && es.text.includes('Este mes enviaste 450,00 USBC. Tu límite Plata es de 1.000,00 USBC al mes.'), 'Spanish figures in Spanish format');
  t.assert(es.text.includes('Sujeto a aprobación regulatoria. Tasas y condiciones por confirmar.'), 'Spanish interest footnote');
  t.assert(!/\{\w+\}/.test(es.text), 'no unfilled placeholder');
  await state(() => YES.setLang('en'));

  /* ------------------------------------------------------------------ */
  t.step('the statement of record stays factual: print, PDF, CSV, noscript');
  const promoStrings = await state((ids) => {
    const out = new Set(['From YES', "What's new from YES", 'yes.danielk', 'EUBC', 'YES identity', 'Interest on USBC', 'Rates and terms']);
    ['en', 'es'].forEach((l) => {
      const keep = YES.i18n.lang;
      YES.i18n.lang = l;
      ids.forEach((id) => {
        const m = YES.promos.view(id);
        [m.title, m.body, m.note, m.cta, m.footnote, m.personal].filter(Boolean).forEach((s) => out.add(s.replace(/\u00a0/g, ' ')));
      });
      YES.i18n.lang = keep;
    });
    return [...out];
  }, IDS);
  const leaks = (str) => promoStrings.filter((s) => nb(str).includes(s));
  if (desktop) {
    await fresh('');
    await page.emulateMedia({ media: 'print' });
    const pr = await state(() => ({
      shown: [...document.querySelectorAll('[data-promo], .promo-slot, .promo-note, #view-whatsnew')].filter((e) => getComputedStyle(e).display !== 'none').length,
      record: document.getElementById('print-root').innerText
    }));
    t.eq(pr.shown, 0, 'print: every promotion is hidden');
    t.eq(leaks(pr.record), [], 'print view: no promotional text');
    await page.emulateMedia({ media: 'screen' });
    // The 90-print.css rules themselves.
    t.assert(/@media print[\s\S]*\[data-promo\][\s\S]*display:\s*none\s*!important/.test(await state(() => [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n'))), 'print styles hide [data-promo]');

    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), state(() => YES.help.downloadPdf())]);
    const path = join(RESULTS, `promos-${vp}.pdf`);
    await dl.saveAs(path);
    const raw = readFileSync(path).toString('latin1');
    t.eq(raw.slice(0, 8), '%PDF-1.4', 'a real PDF');
    t.eq(leaks(raw), [], 'PDF bytes: no promotional text');
    const pt = spawnSync('pdftotext', ['-raw', '-enc', 'UTF-8', path, '-'], { encoding: 'utf8' });
    if (!pt.error && pt.status === 0) {
      t.assert(pt.stdout.includes('1,147.50'), 'pdftotext reads the statement');
      t.eq(leaks(pt.stdout), [], 'PDF text: no promotional text');
    }
    const csv = await state(() => YES.explorer.csv('all'));
    t.assert(csv.includes('TX-260909-2051'), 'CSV has the ledger');
    t.eq(leaks(csv), [], 'CSV: no promotional text');
    const html = readFileSync(join(ROOT, 'dist', 'yes-statement.html'), 'utf8');
    const noscript = html.slice(html.indexOf('<noscript>'), html.indexOf('</noscript>'));
    t.assert(noscript.includes('1,147.50'), 'noscript summary found');
    t.eq(leaks(noscript), [], 'noscript summary: no promotional text');
  }

  /* ------------------------------------------------------------------ */
  t.step('axe: no violations, light and dark');
  for (const theme of ['light', 'dark']) {
    await fresh('');
    await state((th) => YES.theme.set(th), theme);
    await axeOk(`${theme}, Overview`);
    await page.click('[data-fk="promo-ov-next"]');
    await axeOk(`${theme}, Overview, trust meter`, '.promo-slot');
    await state(() => YES.explorer.openTx('TX-260909-2051'));
    await page.locator('#tx-dialog[open]').waitFor();
    await axeOk(`${theme}, transaction detail with its note`, '#tx-dialog');
    await state(() => YES.explorer.closeTx());
    await fresh('#/whatsnew');
    await axeOk(`${theme}, What's new`);
    await state(() => YES.assistant.ask('whats_new'));
    await page.locator('#assistant-drawer[open]').waitFor();
    await axeOk(`${theme}, Ask YES answer`, '#assistant-drawer');
    await state(() => YES.assistant.close());
  }
  await state(() => YES.theme.set(null));

  /* ------------------------------------------------------------------ */
  if (vp === 'narrow') {
    t.step('320px: no horizontal scroll (Overview card, notes, What\'s new), in both languages, also at 200% text');
    for (const lang of ['en', 'es']) {
      for (const size of ['100%', '200%']) {
        for (const hash of ['', '#/whatsnew']) {
          await fresh(hash);
          await state((l) => YES.setLang(l, { silent: true }), lang);
          await state((s) => (document.documentElement.style.fontSize = s), size);
          await page.waitForTimeout(150);
          if (!hash) await page.click('[data-fk="promo-ov-next"]'); // the trust meter, the widest content
          const r = await state(() => {
            const vw = document.documentElement.clientWidth;
            const out = [...document.querySelectorAll('.promo-slot *, .promo-note *, #view-whatsnew *')]
              .filter((e) => !e.closest('.sr-only') && !e.ownerSVGElement && e.getClientRects().length)
              .filter((e) => {
                const b = e.getBoundingClientRect();
                return b.width && (b.right > vw + 1 || b.left < -1);
              })
              .map((e) => (e.className && e.className.baseVal === undefined ? e.className : e.tagName) + ' →' + Math.round(e.getBoundingClientRect().right));
            return { scroll: document.documentElement.scrollWidth <= vw, out: out.slice(0, 5) };
          });
          t.eq(r, { scroll: true, out: [] }, `${lang} ${size} ${hash || '#/overview'}: nothing past the 320px edge`);
        }
      }
    }
    await state(() => (document.documentElement.style.fontSize = ''));
    await state(() => YES.setLang('en', { silent: true }));
  }

  if (desktop) {
    t.step('masthead: five tabs fit at every width, both languages, also at 200% text');
    const mast = () =>
      state(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const tabsShown = getComputedStyle(document.querySelector('#masthead .nav')).display !== 'none';
        const list = document.querySelector('.nav__list');
        const tabs = [...document.querySelectorAll('.nav__link')].map((a) => a.getBoundingClientRect());
        const shown = [...document.querySelectorAll('.masthead__actions > *:not(.mast-wide), .mast-wide > *')].filter((e) => e.getClientRects().length);
        return {
          oneRow: r('.masthead__actions').top < r('.brand').bottom - 4 && new Set(shown.map((e) => Math.round(e.getBoundingClientRect().top))).size === 1,
          inside: shown.every((e) => e.getBoundingClientRect().right <= innerWidth + 0.5 && e.getBoundingClientRect().left >= -0.5),
          tabsShown,
          tabsFit: !tabsShown || (list.scrollWidth <= list.clientWidth + 1 && tabs.length === 5 && tabs.every((b) => b.left >= 0 && b.right <= innerWidth && b.width > 1)),
          menu: !!document.querySelector('[data-mast-menu]').getClientRects().length,
          noScroll: document.documentElement.scrollWidth <= innerWidth
        };
      });
    const menuFits = async () => {
      await page.click('#masthead [data-mast-menu]');
      await page.locator('#mast-menu').waitFor({ state: 'visible' });
      const m = await state(() => {
        const links = [...document.querySelectorAll('#mast-menu .mast-menu__link')];
        const p = document.getElementById('mast-menu').getBoundingClientRect();
        return { n: links.length, inside: p.left >= -0.5 && p.right <= innerWidth + 0.5 && links.every((a) => a.getBoundingClientRect().right <= innerWidth + 0.5), noScroll: document.documentElement.scrollWidth <= innerWidth };
      });
      await page.keyboard.press('Escape');
      return m;
    };
    for (const lang of ['en', 'es']) {
      await fresh('');
      await state((l) => YES.setLang(l, { silent: true }), lang);
      for (const w of [320, 390, 720, 880, 992, 1100, 1280]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(150);
        const m = await mast();
        t.assert(m.oneRow && m.inside && m.noScroll, `${lang} ${w}px: one brand row, every control on screen, no horizontal scroll: ${JSON.stringify(m)}`);
        t.eq([m.menu, m.tabsShown], w < 720 ? [true, false] : [false, true], `${lang} ${w}px: ${w < 720 ? 'the Menu' : 'the tab row'}`);
        t.assert(m.tabsFit, `${lang} ${w}px: all five tabs in view, none scrolled away`);
        if (m.menu) {
          const mf = await menuFits();
          t.eq(mf, { n: 5, inside: true, noScroll: true }, `${lang} ${w}px: the Menu lists five sections inside the screen`);
        }
      }
      // 200% text: the em breakpoints move to the roomier layouts.
      await state(() => (document.documentElement.style.fontSize = '200%'));
      for (const w of [320, 390, 720, 880, 992, 1100, 1280]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(150);
        const m = await mast();
        t.assert(m.inside && m.noScroll && m.tabsFit, `${lang} ${w}px at 200% text: controls on screen, no horizontal scroll, tabs (if shown) all in view: ${JSON.stringify(m)}`);
        if (m.menu) {
          const mf = await menuFits();
          t.eq(mf, { n: 5, inside: true, noScroll: true }, `${lang} ${w}px at 200% text: the Menu lists five sections inside the screen`);
        }
      }
      await state(() => (document.documentElement.style.fontSize = ''));
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await state(() => YES.setLang('en', { silent: true }));
  }

  await clearStore();
}
