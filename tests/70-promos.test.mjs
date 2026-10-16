// "From YES" promotions (70-promos.js): content from YES.config.promotions,
// eligibility and personalisation from this statement's data, the Overview
// card (one at a time, Not now, Next update, never automatic), the in-context
// notes (Fees card, transaction detail), the What's new view (#/whatsnew and
// deep links, the fifth tab, the phone Menu), Ask YES, the demo-only calls to
// action, and the statement of record kept factual (print, PDF, CSV,
// noscript). Also EN/ES parity, axe in light and dark, 320px reflow and the
// masthead fitting five tabs at every width, in both languages, at 200% text.
// What makes it stand out: the new-updates badge on the What's new tab (the
// Menu's dot and count on a phone) and the dot on Ask YES, with their
// accessible names and storage; the teaser inside the balance card; the
// tinted card led by the customer's own figure (the hook) with its preview;
// the one-time entrance; "What's new?" first in Ask YES; the New pills.
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
  t.eq([nb(ov.title), ov.count2, ov.see, ov.inInk], ['You paid 1.00 USBC in network fees this month', '1 of 4', '#/whatsnew/pay-identity', false], 'the hook (the customer\'s own figure) as the title, counter, deep link; outside the statement\'s ink field');
  t.eq(nb(await text('.promo--overview .promo__support')), 'Pay a YES identity, like yes.danielk, instantly and with no network fee.', 'the supporting line under the hook');
  const card = nb(await text('.promo--overview'));
  t.assert(!card.includes('sending to external wallets.'), 'the hook replaces the personal line (no figure said twice)');

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
  t.eq(await state(() => [YES.state.promos.dismissed, JSON.parse(localStorage.getItem('yes.promos')).dismissed, document.activeElement.id, document.querySelectorAll('.wn-hidden').length]), [[], [], 'h-whatsnew', 0], 'restored: dismissals cleared in state and storage, focus on the heading');
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
  t.eq(await state(() => [...document.querySelectorAll('#assistant-drawer .asst-sugg [data-asst-q]')].map((b) => b.textContent.trim()).shift()), "What's new?", 'suggested question "What\'s new?", first');
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
  // Contrast of an element's text against the first opaque background behind
  // `bgSel` (or behind the element itself). Colours from color-mix() come back
  // as color(srgb …), in 0–1.
  const contrast = (fgSel, bgSel) =>
    state(
      ([f, b]) => {
        const parse = (c) => {
          const n = c.match(/[\d.]+/g).map(Number);
          const k = c.startsWith('color(') ? 255 : 1;
          return { rgb: n.slice(0, 3).map((v) => v * k), a: n.length > 3 ? n[3] : 1 };
        };
        const lum = (c) => {
          const g = (x) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
          const m = parse(c).rgb;
          return 0.2126 * g(m[0]) + 0.7152 * g(m[1]) + 0.0722 * g(m[2]);
        };
        const bgOf = (el) => {
          for (let e = el; e; e = e.parentElement) {
            const c = getComputedStyle(e).backgroundColor;
            if (parse(c).a > 0) return c;
          }
          return 'rgb(255, 255, 255)';
        };
        const fe = document.querySelector(f);
        const [x, y] = [lum(getComputedStyle(fe).color), lum(bgOf(b ? document.querySelector(b) : fe))].sort((p, q) => q - p);
        return +((x + 0.05) / (y + 0.05)).toFixed(2);
      },
      [fgSel, bgSel]
    );
  const badge = () =>
    state(() => {
      const tab = document.querySelector('.nav__link[data-nav="whatsnew"]');
      const item = document.querySelector('#mast-menu .mast-menu__link[data-nav="whatsnew"]');
      const menu = document.querySelector('#masthead [data-mast-menu]');
      const ask = document.querySelector('#masthead [data-ask]');
      const num = (el) => (el.querySelector('.nav-badge') ? el.querySelector('.nav-badge').textContent : null);
      const vis = (el) => !!(el && el.getClientRects().length);
      return {
        api: YES.promos.badges(),
        tab: [num(tab), tab.getAttribute('aria-label')],
        item: [num(item), item.getAttribute('aria-label')],
        menu: [!!menu.querySelector('.mast-dot'), menu.getAttribute('aria-label')],
        ask: [!!ask.querySelector('.mast-dot'), ask.getAttribute('aria-label')],
        shown: { tabBadge: vis(tab.querySelector('.nav-badge')), menuDot: vis(menu.querySelector('.mast-dot')), askDot: vis(ask.querySelector('.mast-dot')) },
        hidden: [...document.querySelectorAll('#masthead .nav-badge, #masthead .mast-dot')].every((e) => e.getAttribute('aria-hidden') === 'true')
      };
    });
  const backToOverview = async () => {
    await page.click(desktop ? '.nav__link[data-nav="overview"]' : '.brand');
    await page.waitForFunction(() => YES.state.view === 'overview');
  };
  const goWhatsnew = async () => {
    await state(() => YES.nav.go('whatsnew'));
    await page.waitForFunction(() => YES.state.view === 'whatsnew');
  };

  t.step('new-updates badge: the count, the accessible names, the Menu dot on a phone');
  await clearStore();
  await fresh('');
  let bd = await badge();
  t.eq(bd.api, { whatsnew: 4, ask: true }, 'nothing seen yet: 4 new updates, Ask YES not opened');
  t.eq([bd.tab, bd.item], [['4', "What's new, 4 new updates"], ['4', "What's new, 4 new updates"]], 'the What\'s new tab and its Menu item: a "4" badge, named "What\'s new, 4 new updates"');
  t.eq([bd.menu, bd.ask, bd.hidden], [[true, 'Menu (new updates)'], [true, 'Ask YES about this statement (new)'], true], 'Menu and Ask YES carry a dot, said in their names; the badge and dots themselves are hidden from assistive technology');
  t.eq(bd.shown, desktop ? { tabBadge: true, menuDot: false, askDot: true } : { tabBadge: false, menuDot: true, askDot: true }, desktop ? 'desktop: the badge on the tab, a dot on Ask YES' : 'phone: a dot on Menu and on Ask');
  t.eq(await page.getByRole('button', { name: 'Ask YES about this statement (new)', exact: true }).count(), 1, 'Ask YES: its accessible name');
  if (desktop) {
    t.eq(await page.getByRole('link', { name: "What's new, 4 new updates", exact: true }).count(), 1, 'the tab: its accessible name');
    const bc = await contrast('.nav__link[data-nav="whatsnew"] .nav-badge');
    t.assert(bc >= 4.5, 'the badge\'s number is at least 4.5:1 on its blue: ' + bc);
    const geo = await state(() => {
      const a = document.querySelector('.nav__link[data-nav="whatsnew"]');
      const l = a.querySelector('span').getBoundingClientRect();
      const b = a.querySelector('.nav-badge').getBoundingClientRect();
      return { after: b.left >= l.right, inside: b.right <= a.getBoundingClientRect().right, middle: Math.abs((b.top + b.bottom) / 2 - (l.top + l.bottom) / 2) <= 2 };
    });
    t.eq(geo, { after: true, inside: true, middle: true }, 'the badge sits right after the label, inside the tab, centred on it');
  } else {
    t.eq(await page.getByRole('button', { name: 'Menu (new updates)', exact: true }).count(), 1, 'Menu: its accessible name');
    const dot = await state(() => {
      const m = document.querySelector('#masthead [data-mast-menu]').getBoundingClientRect();
      const d = document.querySelector('#masthead [data-mast-menu] .mast-dot').getBoundingClientRect();
      return d.left >= m.left && d.right <= m.right && d.top >= m.top && d.bottom <= m.bottom && d.width >= 8;
    });
    t.assert(dot, 'the Menu dot sits on the button, inside its box');
    await page.click('#masthead [data-mast-menu]');
    await page.locator('#mast-menu').waitFor({ state: 'visible' });
    const it = await state(() => {
      const a = document.querySelector('#mast-menu .mast-menu__link[data-nav="whatsnew"]');
      const l = a.querySelector('span').getBoundingClientRect();
      const b = a.querySelector('.nav-badge').getBoundingClientRect();
      return { shown: b.width > 0, after: b.left >= l.right && b.left - l.right <= 12, text: a.querySelector('.nav-badge').textContent };
    });
    t.eq(it, { shown: true, after: true, text: '4' }, 'the Menu item shows "4" right after its label');
    t.eq(await page.getByRole('link', { name: "What's new, 4 new updates", exact: true }).count(), 1, 'the Menu item: its accessible name');
    await page.keyboard.press('Escape');
  }

  t.step('badge: a deep link marks one update seen; singular and plural in English and Spanish');
  await fresh('#/whatsnew/trust');
  t.eq(await state(() => [YES.state.promos.seen, JSON.parse(localStorage.getItem('yes.promos')).seen]), [['trust'], ['trust']], 'a deep link marks only that update as seen (state and localStorage)');
  bd = await badge();
  t.eq([bd.api.whatsnew, bd.tab], [3, ['3', "What's new, 3 new updates"]], 'the count goes down to 3');
  await state(() => {
    YES.promos.dismiss('currencies');
    YES.promos.dismiss('interest');
  });
  bd = await badge();
  t.eq([bd.tab, bd.item, bd.menu], [['1', "What's new, 1 new update"], ['1', "What's new, 1 new update"], [true, 'Menu (new updates)']], 'dismissed updates are not counted; one left: "1 new update"');
  await state(() => YES.setLang('es'));
  bd = await badge();
  t.eq([bd.tab, bd.menu, bd.ask], [['1', 'Novedades, 1 novedad nueva'], [true, 'Menú (novedades)'], [true, 'Pregunta a YES sobre este estado de cuenta (nuevo)']], 'Spanish, one: "Novedades, 1 novedad nueva", Menú (novedades), Pregunta a YES … (nuevo)');
  await state(() => YES.promos.restore());
  bd = await badge();
  t.eq([bd.tab, bd.item], [['3', 'Novedades, 3 novedades nuevas'], ['3', 'Novedades, 3 novedades nuevas']], 'Spanish, three: "Novedades, 3 novedades nuevas"');
  await state(() => YES.setLang('en'));

  t.step('badge: opening What\'s new clears it, and that persists');
  await fresh('');
  if (desktop) await page.click('.nav__link[data-nav="whatsnew"]');
  else {
    await page.click('#masthead [data-mast-menu]');
    await page.click('#mast-menu .mast-menu__link[data-nav="whatsnew"]');
  }
  await page.waitForFunction(() => YES.state.view === 'whatsnew');
  bd = await badge();
  t.eq([bd.api.whatsnew, bd.tab, bd.item, bd.menu], [0, [null, null], [null, null], [false, null]], 'visited: no badge, no Menu dot, plain names');
  t.eq(await state(() => [document.activeElement.id, JSON.parse(localStorage.getItem('yes.promos')).seen.slice().sort()]), ['h-whatsnew', IDS.slice().sort()], 'focus on the view heading as before; every update stored as seen');
  await fresh('');
  t.eq((await badge()).api.whatsnew, 0, 'after a reload: still no badge (localStorage)');

  t.step('storage: the old format (dismissed ids only) still loads');
  for (const [raw, dismissed] of [
    [JSON.stringify({ v: 1, dismissed: ['trust'] }), ['trust']],
    [JSON.stringify(['currencies']), ['currencies']],
    [JSON.stringify({ v: 1, dismissed: ['nope', 'interest'] }), ['interest']],
    ['not json', []]
  ]) {
    await state((r) => localStorage.setItem('yes.promos', r), raw);
    await fresh('');
    t.eq(await state(() => [YES.state.promos.dismissed, YES.state.promos.seen, YES.state.promos.ask, YES.promos.badges().whatsnew]), [dismissed, [], false, 4 - dismissed.length], `stored ${raw}: dismissed ${JSON.stringify(dismissed)}, nothing seen, the badge counts ${4 - dismissed.length}`);
  }
  await clearStore();

  t.step('no badge, dots or teaser when promotions are off or nothing is eligible');
  await fresh('');
  const off = await state(() => {
    const c = YES.config.promotions;
    const q = () => ({
      badge: !!document.querySelector('#masthead .nav-badge'),
      dots: document.querySelectorAll('#masthead .mast-dot').length,
      teaser: !!document.querySelector('.promo-teaser'),
      api: YES.promos.badges(),
      first: YES.assistant.questions()[0],
      last: YES.assistant.questions().slice(-1)[0]
    });
    c.enabled = false;
    YES.renderAll();
    const disabled = q();
    c.enabled = true;
    const rules = c.items.map((p) => p.rule);
    c.items.forEach((p) => (p.rule = { kind: 'never' }));
    YES.renderAll();
    const none = q();
    c.items.forEach((p, i) => (p.rule = rules[i]));
    YES.renderAll();
    return { disabled, none, back: q() };
  });
  t.eq(off.disabled, { badge: false, dots: 0, teaser: false, api: { whatsnew: 0, ask: false }, first: 'why_balance', last: 'whats_new' }, 'promotions off: no badge, no dots, no teaser; "What\'s new?" back to the end of the suggestions');
  t.eq([off.none.badge, off.none.dots, off.none.teaser, off.none.api], [false, 0, false, { whatsnew: 0, ask: false }], 'nothing eligible: no badge, no dots, no teaser');
  t.eq([off.back.badge, off.back.dots, off.back.teaser, off.back.first], [true, 2, true, 'whats_new'], 'back on: the badge, both dots and the teaser; "What\'s new?" first');

  /* ------------------------------------------------------------------ */
  t.step('teaser: one line inside the balance card, after the net change');
  await clearStore();
  await fresh('');
  const tz = await state(() => {
    const el = document.querySelector('#overview-root .promo-teaser');
    const r = (e) => e.getBoundingClientRect();
    const link = el.querySelector('a');
    return {
      count: document.querySelectorAll('.promo-teaser').length,
      place: [!!el.closest('.ov-balance.ink-field .ov-balance__side'), r(document.querySelector('.ov-change')).bottom <= r(el).top, r(el).bottom <= r(document.querySelector('.ov-balance__side .ov-actions')).top],
      labels: [el.querySelector('.promo-from').textContent.trim(), !!el.querySelector('.promo-from .icon'), !!el.querySelector('.tag--illustrative')],
      text: el.querySelector('.promo-teaser__text').textContent,
      link: [link.getAttribute('href'), link.getAttribute('aria-label'), link.textContent.trim()],
      divider: [getComputedStyle(el).borderTopStyle, parseFloat(getComputedStyle(el).borderTopWidth)],
      id: el.getAttribute('data-promo'),
      target: r(link).height >= 24
    };
  });
  t.eq(tz.count, 1, 'one teaser');
  t.eq(tz.place, [true, true, true], 'inside the balance card\'s net-change column: after the net change, before the actions');
  t.eq(tz.labels, ['From YES', true, true], 'labelled "From YES" (megaphone) and Illustrative');
  t.eq([tz.id, nb(tz.text)], ['pay-identity', 'Pay a YES identity next time. No network fee.'], 'the top update\'s teaser');
  t.eq(tz.link, ['#/whatsnew/pay-identity', "See what's new: Pay a YES identity", "See what's new"], 'its link, "See what\'s new" (named in full), opens that update in What\'s new');
  t.eq([tz.divider, tz.target], [['solid', 1], true], 'a hairline sets it apart from the figures; the link is at least 24px tall');
  t.eq(await page.getByRole('link', { name: "See what's new: Pay a YES identity", exact: true }).count(), 1, 'the link\'s accessible name');
  const tc = [await contrast('.promo-teaser__text', '.ov-balance'), await contrast('.promo-teaser__link', '.ov-balance'), await contrast('.promo-teaser .promo-from', '.ov-balance')];
  t.assert(tc.every((x) => x >= 4.5), 'teaser text, link and label are at least 4.5:1 on the black card: ' + JSON.stringify(tc));
  await page.locator('[data-fk="promo-teaser-see"]').focus();
  const tf = await state(() => {
    const a = document.activeElement;
    const s = getComputedStyle(a);
    return [a.getAttribute('data-fk'), a.matches(':focus-visible'), s.outlineStyle, parseFloat(s.outlineWidth) >= 2];
  });
  t.eq(tf, ['promo-teaser-see', true, 'solid', true], 'keyboard focus on the link is visible');
  const tfc = await state(() => {
    const parse = (c) => c.match(/[\d.]+/g).map(Number);
    const lum = (c) => {
      const g = (x) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
      const m = parse(c);
      return 0.2126 * g(m[0]) + 0.7152 * g(m[1]) + 0.0722 * g(m[2]);
    };
    const [x, y] = [lum(getComputedStyle(document.activeElement).outlineColor), lum(getComputedStyle(document.querySelector('.ov-balance')).backgroundColor)].sort((p, q) => q - p);
    return +((x + 0.05) / (y + 0.05)).toFixed(2);
  });
  t.assert(tfc >= 3, 'the focus outline is at least 3:1 on the black card: ' + tfc);
  await state(() => document.activeElement.blur());
  await state(() => YES.setLang('es'));
  t.eq(nb(await text('.promo-teaser__text')), 'La próxima vez, paga a una identidad YES. Sin comisión de red.', 'Spanish teaser');
  t.eq(await state(() => [document.querySelector('.promo-teaser__link').textContent.trim(), document.querySelector('.promo-teaser__link').getAttribute('aria-label')]), ['Ver novedades', 'Ver novedades: Paga a una identidad YES'], 'Spanish link');
  await state(() => YES.setLang('en'));
  const trustTeaser = await state(() => {
    const p = YES.config.promotions.items[0];
    const rule = p.rule;
    p.rule = { kind: 'never' };
    YES.renderAll();
    const el = document.querySelector('.promo-teaser');
    const out = el && [el.getAttribute('data-promo'), el.querySelector('.promo-teaser__text').textContent];
    p.rule = rule;
    YES.renderAll();
    return out;
  });
  t.eq(trustTeaser, ['trust', 'Verify your address to reach Gold.'], 'no network fee paid: the trust update leads, with the next level from the data');
  if (desktop) {
    for (const lang of ['en', 'es']) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await fresh('');
      await state((l) => YES.setLang(l), lang);
      const fold = await state(() => {
        const r = document.querySelector('.promo-teaser').getBoundingClientRect();
        return { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY), vh: innerHeight, card: Math.round(document.querySelector('.promo--overview').getBoundingClientRect().top + scrollY) };
      });
      t.assert(fold.bottom <= fold.vh, `${lang}: the teaser is on the first screen at 1280×800: ` + JSON.stringify(fold));
      // It fills the room above the actions: the balance, the pending notice and Statement details stay put.
      const pos = await state(() => {
        const y = () =>
          ['.ov-hero', '.ov-change', '.ov-balance__side .ov-actions .btn', '.ov-notin', '.ov-details', '.ov-balance'].map((s) => {
            const r = document.querySelector(s).getBoundingClientRect();
            return [Math.round(r.top + scrollY), Math.round(r.bottom + scrollY)];
          });
        const c = YES.config.promotions;
        const on = y();
        c.enabled = false;
        YES.renderAll();
        const offPos = y();
        c.enabled = true;
        YES.renderAll();
        return { on, off: offPos };
      });
      t.eq(pos.on, pos.off, `${lang}: at 1280×800 the teaser moves nothing (balance, net change, actions, pending notice, Statement details, the card's bottom)`);
    }
    await state(() => YES.setLang('en'));
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  t.step('teaser: the link, and hidden when the top update is dismissed');
  await fresh('');
  await page.click('[data-fk="promo-teaser-see"]');
  await page.waitForFunction(() => YES.state.view === 'whatsnew');
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'wn-pay-identity-title', null, { timeout: 3000 }).catch(() => {});
  t.eq(await state(() => [location.hash, document.activeElement.id, YES.state.promos.seen, YES.promos.metrics().clicks['pay-identity']]), ['#/whatsnew/pay-identity', 'wn-pay-identity-title', ['pay-identity'], 1], 'the link opens the update in What\'s new and focuses it; it is marked seen; the click is counted in memory');
  await fresh('');
  await page.click('[data-fk="promo-ov-dismiss"]');
  t.eq(await state(() => [YES.promos.current(), document.querySelectorAll('.promo-teaser').length, document.querySelectorAll('.promo-teaser-slot').length]), ['trust', 0, 1], 'the top update dismissed: the card moves on, the teaser goes (its empty slot is not shown)');
  t.eq(await state(() => getComputedStyle(document.querySelector('.promo-teaser-slot')).display), 'none', 'the empty slot takes no room');
  await fresh('');
  t.eq(await state(() => document.querySelectorAll('.promo-teaser').length), 0, 'after a reload: still no teaser');
  await state(() => YES.promos.restore());
  t.eq(await state(() => document.querySelector('.promo-teaser') && document.querySelector('.promo-teaser').getAttribute('data-promo')), 'pay-identity', 'restored: the teaser is back');

  /* ------------------------------------------------------------------ */
  t.step('the card: tinted, led by the customer\'s own figure, with a preview');
  await clearStore();
  await fresh('');
  const cardOf = () =>
    state(() => {
      const c = document.querySelector('.promo--overview');
      const strip = c.cloneNode(true);
      strip.querySelectorAll('.promo__count, .sr-only').forEach((e) => e.remove());
      return {
        id: c.getAttribute('data-promo'),
        h3: c.querySelector('h3').textContent,
        support: c.querySelector('.promo__support') ? c.querySelector('.promo__support').textContent : null,
        visual: !!c.querySelector('.promo__visual'),
        compare: [...c.querySelectorAll('.promo-compare__row')].map((r) => [r.querySelector('.promo-compare__who').textContent.trim(), r.querySelector('.promo-compare__fee').textContent, !!r.querySelector('.promo-compare__mark')]),
        chips: [...c.querySelectorAll('.promo-chips__list')].map((u) => [document.getElementById(u.getAttribute('aria-labelledby')).textContent, [...u.querySelectorAll('.promo-chip')].map((x) => x.textContent.trim())]),
        text: strip.textContent.replace(/ /g, ' ')
      };
    });
  const expect = await state(() => {
    const f = YES.promos.facts();
    return {
      fee: YES.fmt.amount(-YES.calc.tx(f.networkFeeTxIds[0]).amount),
      zero: YES.fmt.amount(0),
      sent: YES.fmt.amount(f.sent),
      limit: YES.fmt.amount(f.monthlySendLimit),
      codes: YES.config.promotions.items.find((p) => p.theme === 'currencies').codes.map((c) => c.code),
      asset: YES.calc.asset().symbol
    };
  });
  let k = await cardOf();
  t.eq([k.id, nb(k.h3), nb(k.support)], ['pay-identity', `You paid ${nb(expect.fee)} in network fees this month`, 'Pay a YES identity, like yes.danielk, instantly and with no network fee.'], 'identity: the hook "You paid 1.00 USBC in network fees this month" leads, the supporting line follows');
  t.eq(k.compare.map((r) => [r[0], nb(r[1]), r[2]]), [['External wallet', `Network fee ${nb(expect.fee)}`, false], ['YES identity', `Network fee ${nb(expect.zero)}`, true]], 'identity: the comparison, figures from YES.calc and YES.fmt (1.00 and 0.00 USBC), a check mark on the YES row');
  t.eq([nb(expect.fee), nb(expect.zero)], ['1.00 USBC', '0.00 USBC'], 'the comparison\'s figures');
  if (desktop) {
    const look = await state(() => {
      const c = getComputedStyle(document.querySelector('.promo--overview'));
      const i = getComputedStyle(document.querySelector('.promo--overview .promo__icon'));
      return { border: [c.borderTopStyle, c.borderTopWidth], bg: c.backgroundColor, tile: [i.backgroundColor, i.color] };
    });
    t.eq(look.border, ['solid', '2px'], 'a 2px accent edge');
    {
      const n = look.bg.match(/[\d.]+/g).map(Number).slice(0, 3).map((v) => (look.bg.startsWith('color(') ? v * 255 : v));
      t.assert([242, 242, 255].every((v, i) => Math.abs(n[i] - v) <= 1.5), 'a light accent tint (#0004FF at 5% on white, about #F2F2FF): ' + look.bg);
    }
    t.eq(look.tile, ['rgb(0, 4, 255)', 'rgb(255, 255, 255)'], 'a solid #0004FF icon tile with a white icon');
    const cc = [await contrast('.promo--overview .promo__eyebrow', '.promo--overview'), await contrast('.promo--overview .promo__support', '.promo--overview'), await contrast('.promo--overview .promo__foot', '.promo--overview'), await contrast('.promo--overview .promo__count', '.promo--overview')];
    t.assert(cc.every((x) => x >= 4.5), 'text on the tint is at least 4.5:1: ' + JSON.stringify(cc));
    const h = await state(() => Math.round(document.querySelector('.promo--overview').getBoundingClientRect().height));
    t.assert(h <= 240, 'the card stays compact at 1280px with its preview: ' + h + 'px');
  }
  await page.click('[data-fk="promo-ov-next"]');
  k = await cardOf();
  t.eq([k.id, nb(k.h3), nb(k.support)], ['trust', `You sent ${nb(expect.sent)} of your ${nb(expect.limit)} monthly limit`, 'Verify your address to reach Gold and raise your limit.'], 'trust: the hook "You sent 450.00 USBC of your 1,000.00 USBC monthly limit", then the supporting line');
  t.eq([nb(expect.sent), nb(expect.limit)], ['450.00 USBC', '1,000.00 USBC'], 'the real figures from the data');
  t.eq([k.visual, await page.locator('.promo--overview .promo__visual .promo-meter__step').count()], [true, 3], 'trust: the Bronze, Silver and Gold meter on the card');
  await page.click('[data-fk="promo-ov-next"]');
  k = await cardOf();
  t.eq([k.id, k.h3, k.support], ['currencies', 'More currencies', null], 'currencies: no hook, the title stays');
  t.eq(k.chips, [['Now', [expect.asset]], ['Planned', expect.codes]], 'currencies: chips for USBC now and EUBC, UKBC, MXBC and NZBC planned (from the config codes)');
  t.eq(expect.codes, ['EUBC', 'UKBC', 'MXBC', 'NZBC'], 'the planned codes');
  await page.click('[data-fk="promo-ov-next"]');
  k = await cardOf();
  t.eq([k.id, k.h3, k.support, k.visual], ['interest', 'Interest on USBC', null, false], 'interest: no hook, no preview');
  t.eq(k.text.match(/\d[\d.,]*\d|\d/g), ['1,147.50'], 'interest: no figure but the closing balance: ' + k.text);
  t.assert(!/%|\bAPY\b|\bTAE\b|per year|a year|annual/i.test(k.text), 'interest: no "%", rate, APY or return on the card');
  if (desktop) {
    const loud = await state(() => {
      const fw = (s) => +getComputedStyle(document.querySelector(s)).fontWeight;
      const fs = (s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize);
      return { title: fs('.promo--overview h3'), hero: fs('.ov-hero__num'), w: fw('.promo--overview h3') };
    });
    t.assert(loud.title < loud.hero / 2, 'never louder than the balance: the card\'s headline is far smaller than the balance figure: ' + JSON.stringify(loud));
  }
  await state(() => YES.setLang('es'));
  await page.click('[data-fk="promo-ov-next"]');
  t.eq(nb(await text('.promo--overview h3')), 'Este mes pagaste 1,00 USBC en comisiones de red', 'Spanish identity hook');
  t.eq(await page.locator('.promo--overview .promo-compare__fee').allInnerTexts().then((a) => a.map(nb)), ['Comisión de red 1,00 USBC', 'Comisión de red 0,00 USBC'], 'Spanish comparison');
  await page.click('[data-fk="promo-ov-next"]');
  t.eq(nb(await text('.promo--overview h3')), 'Enviaste 450,00 USBC de tu límite mensual de 1.000,00 USBC', 'Spanish trust hook');
  t.eq(nb(await text('.promo--overview .promo__support')), 'Verifica tu dirección para llegar a Oro y aumentar tu límite.', 'Spanish supporting line');
  await state(() => YES.setLang('en'));

  t.step('the card\'s one-time entrance');
  await fresh('');
  const pre = await state(() => {
    const c = document.querySelector('.promo--overview');
    return { cls: c.classList.contains('promo--enter'), op: getComputedStyle(c).opacity, below: c.getBoundingClientRect().top > innerHeight };
  });
  // Below the first screen (phones), the card waits fully visible; on a tall
  // screen it is already entering as the page loads.
  if (pre.below) t.eq([pre.cls, pre.op], [false, '1'], 'below the first screen: no entrance yet, and the card is visible (never hidden while it waits)');
  await page.locator('.promo--overview').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.promo--overview').classList.contains('promo--enter'), null, { timeout: 3000 }).catch(() => {});
  const anim = await state(() => {
    const c = document.querySelector('.promo--overview');
    const s = getComputedStyle(c);
    let from = null;
    for (const sh of document.styleSheets) {
      for (const r of sh.cssRules) {
        if (r.type === CSSRule.KEYFRAMES_RULE && r.name === 'promo-enter') from = [r.cssRules[0].style.opacity, r.cssRules[0].style.transform];
      }
    }
    return { cls: c.classList.contains('promo--enter'), name: s.animationName, dur: s.animationDuration, n: s.animationIterationCount, from };
  });
  t.eq(anim, { cls: true, name: 'promo-enter', dur: '0.3s', n: '1', from: ['0', 'translateY(10px)'] }, 'in view: it fades in and lifts 10px over 300ms, once');
  await page.click('[data-fk="promo-ov-next"]');
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(150);
  await page.locator('.promo--overview').scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);
  t.eq(await state(() => [document.querySelector('.promo--overview').getAttribute('data-promo'), document.querySelector('.promo--overview').classList.contains('promo--enter')]), ['trust', false], 'never again: not after Next update, not on scrolling back');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fresh('');
  await page.locator('.promo--overview').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  t.eq(await state(() => [document.querySelector('.promo--overview').classList.contains('promo--enter'), getComputedStyle(document.querySelector('.promo--overview')).animationName, getComputedStyle(document.querySelector('.promo--overview')).opacity]), [false, 'none', '1'], 'reduced motion: no entrance class, no animation, the card simply shows');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  /* ------------------------------------------------------------------ */
  t.step('Ask YES: "What\'s new?" first, and a dot until it is opened once');
  await clearStore();
  await fresh('');
  t.eq((await badge()).ask, [true, 'Ask YES about this statement (new)'], 'a dot on Ask YES, said in its name');
  await page.click('#masthead [data-ask]');
  await page.locator('#assistant-drawer[open]').waitFor();
  const qids = await state(() => [...document.querySelectorAll('#assistant-drawer .asst-sugg [data-asst-q]')].map((b) => b.getAttribute('data-asst-q')));
  t.eq([qids[0], qids.length, await state(() => YES.assistant.questions()[0])], ['whats_new', 8, 'whats_new'], '"What\'s new?" is the first of the eight suggested questions');
  t.eq(await state(() => [YES.state.promos.ask, JSON.parse(localStorage.getItem('yes.promos')).ask]), [true, true], 'opened once: kept in YES.state and localStorage');
  await state(() => YES.assistant.close());
  t.eq((await badge()).ask, [false, 'Ask YES about this statement'], 'the dot is gone, and "(new)" with it');
  t.eq((await badge()).api.whatsnew, 4, 'opening Ask YES does not count as seeing What\'s new');
  await fresh('');
  t.eq((await badge()).ask, [false, 'Ask YES about this statement'], 'after a reload: no dot');
  await state(() => YES.setLang('es'));
  t.eq((await badge()).ask, [false, 'Pregunta a YES sobre este estado de cuenta'], 'Spanish: no "(nuevo)" either');
  await state(() => YES.setLang('en'));

  t.step('What\'s new: New pills on the first visit, gone on the next');
  await clearStore();
  await fresh('#/whatsnew');
  const pills = () => state(() => [...document.querySelectorAll('#whatsnew-root .promo--full')].filter((a) => a.querySelector('.promo-new')).map((a) => a.getAttribute('data-promo')));
  t.eq(await pills(), IDS, 'first visit: every update is New');
  const pill = await state(() => {
    const p = document.querySelector('#whatsnew-root .promo-new');
    return { text: p.textContent, prev: p.previousElementSibling && p.previousElementSibling.className, inTags: !!p.closest('.promo__tags') };
  });
  t.eq(pill, { text: 'New', prev: 'tag tag--illustrative', inTags: true }, 'a "New" pill with the From YES and Illustrative labels');
  const pc = await contrast('#whatsnew-root .promo-new');
  t.assert(pc >= 4.5, 'the pill\'s word is at least 4.5:1: ' + pc);
  t.eq(await state(() => YES.state.promos.seen.slice().sort()), IDS.slice().sort(), 'entering marked every update seen');
  await state(() => YES.setLang('es'));
  t.eq([await pills(), (await text('#whatsnew-root .promo-new')).trim()], [IDS, 'Nuevo'], 'the pills stay for this visit, also after a language switch (Nuevo)');
  await state(() => YES.setLang('en'));
  await backToOverview();
  await goWhatsnew();
  t.eq(await pills(), [], 'the next visit: no New pills');
  await fresh('#/whatsnew');
  t.eq(await pills(), [], 'after a reload: none either');
  await clearStore();
  await fresh('#/whatsnew/trust');
  t.eq(await pills(), IDS, 'a deep link: all four were new when the visit began');
  t.eq(await state(() => YES.state.promos.seen), ['trust'], 'the deep link marked only that update seen');
  await backToOverview();
  await goWhatsnew();
  t.eq(await pills(), ['pay-identity', 'currencies', 'interest'], 'the next visit: the three not seen yet are still New');
  await backToOverview();
  await goWhatsnew();
  t.eq(await pills(), [], 'and then none');

  if (desktop) {
    t.step('forced colours: the badge, the card and the dots keep a visible system-colour edge');
    await clearStore();
    await fresh('');
    await page.emulateMedia({ forcedColors: 'active' });
    const fc = await state(() => {
      const b = getComputedStyle(document.querySelector('.nav__link[data-nav="whatsnew"] .nav-badge'));
      const c = getComputedStyle(document.querySelector('.promo--overview'));
      const d = getComputedStyle(document.querySelector('[data-ask] .mast-dot'));
      return { badge: [b.borderTopStyle, parseFloat(b.borderTopWidth) >= 1], card: [c.borderTopStyle, c.borderTopWidth, c.backgroundImage], dot: [d.forcedColorAdjust, d.backgroundColor !== 'rgba(0, 0, 0, 0)'] };
    });
    t.eq(fc, { badge: ['solid', true], card: ['solid', '2px', 'none'], dot: ['none', true] }, 'forced colours: a bordered badge, a 2px card edge without texture, a system-colour dot');
    await page.emulateMedia({ forcedColors: 'none' });
  }
  await clearStore();

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
      ['eyebrow', 'title', 'body', 'note', 'cta', 'feature', 'footnote', 'teaser', 'hook', 'support'].forEach((f) => {
        if (p[f] && p[f].en === p[f].es) out.same.push(p.id + '.' + f);
      });
    });
    const keys = Object.keys(YES.i18n.dict.en).filter((k) => /^promos\.|^nav\.(whatsnew|newUpdates1|newUpdatesN)$|^menu\.newUpdates$|^ask\.newMark$|^assistant\.(q\.whats_new|fromYes|subject\.whatsnew|whatsnew\.)/.test(k));
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
    const out = new Set(['From YES', "What's new from YES", 'yes.danielk', 'EUBC', 'YES identity', 'Interest on USBC', 'Rates and terms', 'new updates', 'new update', 'novedades nuevas', '(new)', '(nuevo)', 'Network fee per send', 'Comisión de red por envío', 'Identidad YES']);
    ['en', 'es'].forEach((l) => {
      const keep = YES.i18n.lang;
      YES.i18n.lang = l;
      ids.forEach((id) => {
        const m = YES.promos.view(id);
        [m.title, m.body, m.note, m.cta, m.footnote, m.personal, m.teaser, m.hook, m.support].filter(Boolean).forEach((s) => out.add(s.replace(/\u00a0/g, ' ')));
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
      shown: [...document.querySelectorAll('[data-promo], .promo-slot, .promo-note, .promo-teaser-slot, .promo-teaser, .nav-badge, .mast-dot, #view-whatsnew')].filter((e) => getComputedStyle(e).display !== 'none').length,
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
    // Nothing seen yet: the badge, the dots, the teaser and (in What's new) the New pills all show.
    await clearStore();
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
          await clearStore(); // nothing seen: the masthead with its badge and dots, New pills
          await fresh(hash);
          await state((l) => YES.setLang(l, { silent: true }), lang);
          await state((s) => (document.documentElement.style.fontSize = s), size);
          await page.waitForTimeout(150);
          if (!hash) await page.click('[data-fk="promo-ov-next"]'); // the trust meter, the widest content
          const r = await state(() => {
            const vw = document.documentElement.clientWidth;
            const out = [...document.querySelectorAll('.promo-slot *, .promo-note *, .promo-teaser-slot *, #masthead *, #view-whatsnew *')]
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
      // Nothing seen yet: the What's new tab carries its badge, Menu and Ask YES their dots.
      await clearStore();
      await fresh('');
      await state((l) => YES.setLang(l, { silent: true }), lang);
      t.eq(await state(() => [YES.promos.badges().whatsnew, !!document.querySelector('.nav__link[data-nav="whatsnew"] .nav-badge'), !!document.querySelector('[data-mast-menu] .mast-dot'), !!document.querySelector('[data-ask] .mast-dot')]), [4, true, true, true], `${lang}: the masthead is checked with its badge and dots`);
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
