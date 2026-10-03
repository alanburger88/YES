// Shell, offline operation, navigation, language switch, integrity gate, and the
// foundation contracts other modules build on (formatting, routing, focus,
// top-layer toast, masthead layout at every width).
export const meta = { name: 'shell', viewports: ['desktop', 'mobile'] };

const BAD = ['serious', 'critical'];

export default async function (t) {
  const { page } = t;
  const mobile = t.viewport !== 'desktop';
  const state = (fn, arg) => page.evaluate(fn, arg);
  const fresh = async (hash = '') => {
    await page.goto('about:blank');
    await t.goto(hash);
  };
  const axeBad = async (label) => {
    await state(() => window.scrollTo(0, 0));
    const v = await t.axe();
    t.eq(
      v.filter((x) => BAD.includes(x.impact)).map((x) => `${x.id}: ${x.nodes.join(' ; ')}`),
      [],
      `no serious/critical axe violations on the whole document (${label})`
    );
    return v;
  };
  const langNames = async () => page.locator('#masthead .seg').ariaSnapshot();

  t.step('boot');
  t.assert(await state(() => YES.integrity.ok), 'statement reconciles');
  t.assert(await page.locator('.demo-badge').first().isVisible(), 'demo badge is visible');
  t.eq(await state(() => document.documentElement.lang), 'en', 'html lang');
  t.assert((await page.title()).includes('YES'), 'document title names YES');

  t.step('i18n parity');
  t.eq(await state(() => YES.i18n.audit()), {}, 'every string exists in both languages');

  t.step('language buttons are named at every width (WCAG 4.1.2)');
  // Phones show "EN"/"ES"; the name stays the language's own name.
  t.eq(await page.getByRole('button', { name: 'English', exact: true }).count(), 1, 'button named "English"');
  t.eq(await page.getByRole('button', { name: 'Español', exact: true }).count(), 1, 'button named "Español"');
  t.assert(/button "English" \[pressed\]/.test(await langNames()) && /button "Español"/.test(await langNames()), 'aria snapshot names both buttons: ' + (await langNames()));
  if (mobile) {
    t.assert(await page.locator('[data-lang="es"] .seg__short').isVisible(), 'phones show the short code "ES"');
    t.assert(((await page.locator('[data-lang="es"] .seg__long').boundingBox()) || { width: 0 }).width <= 1, 'the full name is visually hidden, not removed');
    t.eq((await page.locator('[data-ask] .btn__label--short').innerText()).trim(), 'Ask', 'Ask YES keeps a visible word on phones');
  }
  await axeBad('first screen');
  if (!mobile) {
    await page.click('[data-fk="ask-yes"]');
    await page.waitForFunction(() => document.documentElement.classList.contains('assistant-docked'));
    t.eq(await page.getByRole('button', { name: 'Español', exact: true }).count(), 1, 'still named while the assistant is docked');
    await axeBad('assistant docked');
    await page.click('#assistant-root [data-asst-close]');
    await page.waitForFunction(() => !document.documentElement.classList.contains('assistant-docked'));
  }

  t.step('navigation');
  for (const v of ['transactions', 'understand', 'help', 'overview']) {
    await page.click(`.nav__link[data-nav="${v}"]`);
    await page.waitForFunction((v) => location.hash.startsWith('#/' + v), v);
    t.assert(await state((v) => !document.getElementById('view-' + v).hidden, v), `view ${v} shown`);
    t.eq(await page.locator('.nav__link[aria-current="page"]').getAttribute('data-nav'), v, 'aria-current follows view');
  }

  t.step('browser Back/Forward move focus to the view and announce it');
  await page.click('.nav__link[data-nav="transactions"]');
  await page.click('.nav__link[data-nav="help"]');
  await page.goBack();
  await page.waitForFunction(() => YES.state.view === 'transactions');
  await page.waitForTimeout(200);
  t.eq(await state(() => document.activeElement.id), 'h-transactions', 'Back: focus on the Transactions heading');
  await page.waitForFunction(() => /Transactions section/.test(document.getElementById('live-polite').textContent));
  await page.goForward();
  await page.waitForFunction(() => YES.state.view === 'help');
  await page.waitForTimeout(200);
  t.eq(await state(() => document.activeElement.id), 'h-help', 'Forward: focus on the Help heading');

  t.step('skip link keeps the current view and is localised');
  await fresh('#/transactions');
  await page.keyboard.press('Tab');
  t.eq(await state(() => document.activeElement.className), 'skip-link', 'skip link is the first stop');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  t.eq(await state(() => [location.hash, YES.state.view, document.activeElement.id]), ['#/transactions', 'transactions', 'h-transactions'], 'stays on Transactions, focus on its heading');
  await state(() => {
    location.hash = '#main'; // an in-page anchor is not a route
  });
  await page.waitForTimeout(150);
  t.eq(await state(() => YES.state.view), 'transactions', '#main does not navigate to Overview');

  t.step('setParam never overwrites a navigation the router has not applied yet');
  // e.g. a late dialog 'close' clearing its param while a new address is queued.
  await state(() => {
    location.hash = '#/help/contact';
    YES.nav.setParam(null); // runs before the queued 'hashchange'
  });
  await page.waitForFunction(() => YES.state.view === 'help');
  t.eq(await state(() => location.hash), '#/help/contact', 'the newer address survives');

  t.step('language switch');
  await fresh();
  await page.click('[data-lang="es"]');
  t.eq(await state(() => document.documentElement.lang), 'es', 'html lang es');
  t.eq((await page.locator('.nav__link[data-nav="transactions"]').innerText()).trim(), 'Movimientos', 'nav translated');
  t.eq(await page.locator('[data-lang="es"]').getAttribute('aria-pressed'), 'true', 'es pressed');
  t.eq((await page.locator('.skip-link').textContent()).trim(), 'Ir al estado de cuenta', 'skip link translated');

  t.step('Spanish formatting');
  const es = await state(() => ({
    fiat: YES.fmt.fiat(114750, 'USD'),
    amount: YES.fmt.amount(114750),
    ovFiat: (document.querySelector('.ov-fiat__value') || document.querySelector('.ov-fiat') || { textContent: '' }).textContent,
    range: YES.fmt.range(YES.data.statement.periodStart, YES.data.statement.periodEnd),
    cross: YES.fmt.range('2026-09-30T12:00:00-04:00', '2026-10-02T12:00:00-04:00'),
    masked: YES.fmt.maskedSpoken('Tarjeta de débito •••• 1190')
  }));
  t.eq(es.fiat.replace(/ /g, ' '), '1.147,50 USD', 'USD equivalent grouped like token amounts');
  t.assert(es.amount.replace(/ /g, ' ').startsWith('1.147,50'), 'token amount grouped');
  if (es.ovFiat) t.assert(es.ovFiat.includes('1.147,50') && !/\b1147,50\b/.test(es.ovFiat), 'overview USD equivalent grouped: ' + es.ovFiat);
  t.eq(es.range, '1 al 30 de septiembre de 2026', 'period reads naturally after "del"');
  t.eq(es.cross, '30 de septiembre al 2 de octubre de 2026', 'cross-month range');
  t.eq(es.masked, 'Tarjeta de débito que termina en 1190', 'masked identifier spoken without bullets');
  await page.click('[data-lang="en"]');
  t.eq(await state(() => document.documentElement.lang), 'en', 'back to en');
  t.eq((await state(() => YES.fmt.range(YES.data.statement.periodStart, YES.data.statement.periodEnd))).replace(/\s/g, ''), 'September1–30,2026', 'English range');

  t.step('shared contracts: type labels, masked ids, fiat gating');
  const c = await state(() => {
    const pending = YES.calc.tx('TX-260930-2247');
    const posted = YES.calc.tx('TX-260920-0900');
    const copy = JSON.parse(JSON.stringify(YES.data));
    const demo = YES.config.demo;
    const out = {
      pendingLabel: YES.ui.typeLabel(pending),
      postedLabel: YES.ui.typeLabel(posted),
      facet: YES.ui.typeLabel('redemption'),
      masked: YES.ui.maskedHtml('Debit card •••• 1190'),
      demoIllustrative: YES.calc.fiat(100, copy)
    };
    YES.config.demo = false;
    out.prodUnverified = YES.calc.fiat(100, copy);
    copy.assets.EXUSD.fiat.verified = true;
    out.prodVerified = YES.calc.fiat(100, copy);
    YES.config.demo = demo;
    return out;
  });
  t.eq(c.pendingLabel, 'Redemption requested', 'pending redemption is never labelled "Redeemed"');
  t.eq(c.postedLabel, 'Redeemed', 'posted redemption keeps the PRD label');
  t.eq(c.facet, 'Redeemed', 'bare type keeps the canonical label');
  t.assert(c.masked.includes('<span aria-hidden="true">•••• 1190</span>') && c.masked.includes('ending in 1190'), 'masked id: bullets hidden, spoken alternative');
  t.eq([c.demoIllustrative, c.prodUnverified, c.prodVerified], [100, null, 100], 'fiat shown only when verified (or illustrative in demo mode)');
  const df = await state(() => YES.defaultFilters());
  t.eq([df.ids, df.idsLabel, df.amountLang, df.step], [null, null, null, null], 'default filters name every key a module sets (ids label, amount language)');

  t.step('logo slot helper: artwork, data-URI image or the named text placeholder');
  const logo = await state(() => {
    const slot = YES.config.slots.YES_LOGO;
    const read = (html) => {
      const tpl = document.createElement('template'); // inert: nothing loads
      tpl.innerHTML = html;
      const el = tpl.content.firstElementChild;
      const img = el.querySelector('img');
      return {
        n: tpl.content.childElementCount,
        cls: el.className,
        role: el.getAttribute('role'),
        label: el.getAttribute('aria-label'),
        hidden: el.getAttribute('aria-hidden'),
        slot: el.getAttribute('data-slot'),
        text: el.textContent,
        style: el.getAttribute('style'),
        img: img ? [img.getAttribute('src').slice(0, 18), img.getAttribute('alt')] : null,
        svg: !!el.querySelector('svg')
      };
    };
    const out = {
      placeholder: read(YES.ui.logoHtml({ cls: 'brand__logo' })),
      pt: read(YES.ui.logoHtml({ size: '28pt' })).style,
      px: read(YES.ui.logoHtml({ size: 40 })).style,
      unsafe: read(YES.ui.logoHtml({ size: '1px;color:red' })).style,
      decorative: read(YES.ui.logoHtml({ decorative: true }))
    };
    slot.src = 'https://cdn.example.com/logo.png';
    out.remote = read(YES.ui.logoHtml());
    slot.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 90 30%22/%3E';
    out.dataUri = read(YES.ui.logoHtml({ cls: 'pr-logo' }));
    delete slot.src;
    slot.svg = '<svg viewBox="0 0 120 40" aria-hidden="true" focusable="false"><rect width="120" height="40" rx="8"/></svg>';
    out.svg = read(YES.ui.logoHtml({ cls: 'pr-logo' }));
    delete slot.svg;
    out.masthead = !!document.querySelector('#masthead .brand > .yes-logo.brand__logo[data-slot="YES_LOGO"][role="img"][aria-label="YES"]');
    return out;
  });
  t.eq(
    logo.placeholder,
    { n: 1, cls: 'yes-logo yes-logo--placeholder brand__logo brand__logo--placeholder', role: 'img', label: 'YES', hidden: null, slot: 'YES_LOGO', text: 'YES', style: null, img: null, svg: false },
    'placeholder: one element, named "YES", modifier on the caller\'s class'
  );
  t.eq([logo.pt, logo.px, logo.unsafe], ['--logo-h: 28pt', '--logo-h: 40px', null], 'size sets --logo-h; anything but a plain length is ignored');
  t.eq([logo.decorative.role, logo.decorative.label, logo.decorative.hidden], [null, null, 'true'], 'decorative: hidden from assistive technology');
  t.eq(logo.remote.cls, 'yes-logo yes-logo--placeholder', 'an image URL that would fetch is ignored (no network)');
  t.eq([logo.dataUri.cls, logo.dataUri.role, logo.dataUri.label, logo.dataUri.img], ['yes-logo yes-logo--art pr-logo pr-logo--art', 'img', 'YES', ['data:image/svg+xml', '']], 'data-URI image: named once, image itself decorative');
  t.eq([logo.svg.cls, logo.svg.svg, logo.svg.text, logo.svg.label], ['yes-logo yes-logo--art pr-logo pr-logo--art', true, '', 'YES'], 'approved SVG markup');
  t.assert(logo.masthead, 'the masthead renders the slot through ui.logoHtml');

  t.step('toast: one line is a pill; a wrapped message is a rounded rectangle across the width');
  const toast = async (msg) => {
    await state((m) => YES.ui.toast(m), msg);
    await page.waitForTimeout(300);
    return state(() => {
      const el = document.getElementById('toast');
      const r = el.getBoundingClientRect();
      return { multi: el.classList.contains('is-multiline'), radius: getComputedStyle(el).borderRadius, width: r.width, left: r.left, right: innerWidth - r.right };
    });
  };
  const short = await toast('Copied to clipboard');
  t.eq([short.multi, short.radius], [false, '999px'], 'one line keeps the pill');
  t.assert(Math.abs(short.left - short.right) <= 1, 'one-line toast is centred');
  const long = await toast(
    'Your inquiry draft is kept on this device only, so you can come back to it at any time. Nothing was sent, and no service case exists for this demo statement.'
  );
  t.eq([long.multi, long.radius], [true, '10px'], 'a wrapped message takes the card radius');
  t.assert(long.width > (mobile ? 0.85 : 0.35) * (await state(() => innerWidth)) && long.left >= 15 && long.right >= 15, 'a wrapped toast uses the width (not half the screen) and keeps the gutters: ' + JSON.stringify(long));
  await state(() => document.getElementById('toast').classList.remove('is-visible'));

  t.step('masthead: one brand row, all four sections fit, small pinned area');
  const widths = mobile ? [320, 360, 375, 390, 414, 600, 719] : [720, 768, 900, 1000, 1280];
  for (const lang of ['en', 'es']) {
    await page.click(`[data-lang="${lang}"]`);
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: mobile ? 800 : 900 });
      await page.waitForTimeout(120);
      const m = await state(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const list = document.querySelector('.nav__list');
        const help = document.querySelector('.nav__link[data-nav="help"]').getBoundingClientRect();
        const badge = document.querySelector('.demo-badge');
        const b = r('.demo-badge');
        return {
          oneRow: r('.masthead__actions').top < r('.brand').bottom - 4,
          navFits: list.scrollWidth <= list.clientWidth + 1 && help.right <= window.innerWidth,
          badgeVisible: b.height > 0 && b.left >= 0 && b.right <= window.innerWidth && badge.scrollWidth <= badge.clientWidth + 1
        };
      });
      t.assert(m.oneRow, `${lang} ${w}px: brand and actions share one row`);
      t.assert(m.navFits, `${lang} ${w}px: Overview, Transactions, Understand and Help all visible`);
      t.assert(m.badgeVisible, `${lang} ${w}px: demo badge shown in full`);
    }
  }
  await page.click('[data-lang="en"]');
  if (mobile) {
    // PRD 4.1: the badge is on the first screen, fully worded; the masthead
    // stays small so the first-screen facts start high, and what stays pinned
    // is under 100px and is exactly what --masthead-h (scroll-padding) reserves.
    for (const [w, h] of [
      [320, 640],
      [360, 640],
      [390, 844]
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await state(() => window.scrollTo(0, 0));
      await page.waitForTimeout(150);
      const first = await state(() => {
        const badge = document.querySelector('.demo-badge');
        const b = badge.getBoundingClientRect();
        return { total: document.getElementById('masthead').getBoundingClientRect().height, top: b.top, bottom: b.bottom, text: badge.innerText.trim() };
      });
      t.assert(first.total <= 128, `${w}px: masthead takes at most ~125px of the first screen (was 139): ${first.total}`);
      t.assert(first.top >= 0 && first.bottom <= 32 && first.text === 'Illustrative demo data', `${w}px: demo badge leads the first screen, fully worded: ${JSON.stringify(first)}`);
      await state(() => window.scrollTo(0, 900));
      await page.waitForTimeout(150);
      const pinned = await state(() => ({
        bottom: document.getElementById('masthead').getBoundingClientRect().bottom,
        reserved: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--masthead-h')),
        badgeGone: document.querySelector('.demo-badge').getBoundingClientRect().bottom <= 0
      }));
      t.assert(pinned.bottom <= 100, `${w}px: under 100px stays pinned when scrolled (was 101–193): ${pinned.bottom}`);
      t.assert(Math.abs(pinned.bottom - pinned.reserved) <= 1, `${w}px: --masthead-h equals the pinned height: ${JSON.stringify(pinned)}`);
      t.assert(pinned.badgeGone, `${w}px: the badge band scrolls away with the page`);
    }
    await state(() => window.scrollTo(0, 0));
    await t.shot('masthead-first-screen');
    // A pinned area over 30% of the screen (very large text) scrolls away instead,
    // and the skip link stays fully off screen until focused, at any text size.
    await page.setViewportSize({ width: 360, height: 640 });
    await state(() => window.scrollTo(0, 0));
    const pinState = () =>
      state(() => [getComputedStyle(document.getElementById('masthead')).position, getComputedStyle(document.documentElement).getPropertyValue('--masthead-h').trim()]);
    await state(() => {
      const s = document.createElement('style');
      s.id = 'tall-mast';
      s.textContent = '#masthead .nav__link { min-height: 160px; }'; // as tall as very large text makes it
      document.head.appendChild(s);
    });
    await page.waitForTimeout(250);
    t.eq(await pinState(), ['relative', '0px'], 'a masthead taller than 30% of the screen is not pinned and reserves nothing');
    await state(() => document.getElementById('tall-mast').remove());
    await page.waitForTimeout(250);
    const again = await pinState();
    t.assert(again[0] === 'sticky' && parseFloat(again[1]) > 80 && parseFloat(again[1]) <= 100, 'back to normal: pinned again, --masthead-h follows: ' + again);
    await state(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await page.waitForTimeout(250);
    t.assert((await state(() => document.querySelector('.skip-link').getBoundingClientRect().bottom)) <= 0, '200% text: the unfocused skip link does not peek over the page');
    await state(() => document.documentElement.style.removeProperty('font-size'));
    await page.waitForTimeout(250);
    await page.setViewportSize({ width: 320, height: 256 }); // 1280×1024 at 400%
    await page.waitForTimeout(150);
    t.eq(await state(() => getComputedStyle(document.getElementById('masthead')).position), 'relative', 'short viewports: masthead does not stick');
    await page.setViewportSize({ width: 390, height: 844 });
  } else {
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  t.step('forced colours keep a visible focus indicator');
  await fresh();
  await page.emulateMedia({ forcedColors: 'active' });
  const outlines = [];
  for (const fk of ['lang-es', 'ask-yes', 'ov-explore']) {
    await page.focus(`[data-fk="${fk}"]`);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    outlines.push(await state(() => [document.activeElement.getAttribute('data-fk'), getComputedStyle(document.activeElement).outlineStyle]));
  }
  t.eq(outlines, [['lang-es', 'solid'], ['ask-yes', 'solid'], ['ov-explore', 'solid']], 'focused controls draw an outline under forced colours');
  await page.emulateMedia({ forcedColors: 'none' });

  t.step('form fields and placeholders meet contrast');
  await page.click('.nav__link[data-nav="transactions"]');
  const fieldContrast = await state(() => {
    const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = (c) => {
      const [r, g, b] = c.map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const cr = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const input = document.querySelector('#transactions-root input.input');
    const page = rgb(getComputedStyle(document.body).backgroundColor);
    const field = rgb(getComputedStyle(input).backgroundColor);
    const border = rgb(getComputedStyle(input).borderTopColor);
    const ph = rgb(getComputedStyle(input, '::placeholder').color);
    return { border: Math.min(cr(border, page), cr(border, field)), placeholder: cr(ph, field) };
  });
  t.assert(fieldContrast.border >= 3, 'input boundary ≥ 3:1 (WCAG 1.4.11): ' + fieldContrast.border.toFixed(2));
  t.assert(fieldContrast.placeholder >= 4.5, 'placeholder ≥ 4.5:1: ' + fieldContrast.placeholder.toFixed(2));

  t.step('toast paints above an open modal dialog');
  await page.locator('[data-tx-row]').first().click();
  await page.waitForFunction(() => document.getElementById('tx-dialog').open);
  await state(() => YES.ui.toast('Copied to clipboard'));
  t.assert(await state(() => document.getElementById('toast').matches(':popover-open')), 'toast is in the top layer (shown after the dialog)');
  await page.keyboard.press('Escape');

  t.step('malformed links never stop the statement from booting');
  for (const h of ['#/transactions/100%', '#/help/%E0%A4%A', '#/overview?x=%ZZ']) {
    await fresh(h);
    t.assert(await state(() => YES.ready && !!document.querySelector('.nav__link') && document.getElementById('overview-root').innerHTML.length > 0), 'boots with ' + h);
  }

  t.step('userway graceful offline');
  await page.waitForFunction(() => ['unavailable', 'loaded', 'host', 'disabled'].includes(YES.userway.status), null, { timeout: 12000 });
  t.eq(await state(() => YES.userway.status), 'unavailable', 'widget unavailable offline');
  t.assert((await page.locator('.footer__demo').innerText()).includes('UserWay'), 'demo notice names the third-party widget it loads');

  t.step('integrity gate');
  await fresh('#/overview?simulate=mismatch');
  t.assert(await page.locator('#withheld-title').isVisible(), 'withheld state shown on mismatch');
  t.assert(!(await page.locator('#main').isVisible()), 'statement content suppressed on mismatch');
  t.assert((await page.title()).startsWith('Statement withheld'), 'document title says the statement is withheld: ' + (await page.title()));
  t.eq(await page.getByRole('main').count(), 1, 'the withheld message is the main landmark');
  const withheldText = await page.locator('#integrity-root').innerText();
  t.assert(withheldText.includes('nothing was sent') && !withheldText.includes('It has been routed'), 'a simulated failure does not claim it was routed');
  t.assert((await page.locator('#integrity-root .check--fail').count()) >= 1, 'failed checks are marked');
  const v = await axeBad('withheld');
  t.eq(v.filter((x) => x.id === 'landmark-one-main').length, 0, 'document has a main landmark');
  await page.evaluate(() => document.querySelector('.skip-link').focus());
  await page.keyboard.press('Enter');
  t.eq(await state(() => [document.activeElement.id, location.hash]), ['withheld-title', '#/overview?simulate=mismatch'], 'skip link lands on the withheld message');
  await page.click('[data-lang="es"]');
  t.eq(await state(() => document.getElementById('overview-root').innerHTML.length), 0, 'a language switch renders no withheld figures');
  t.assert((await page.title()).startsWith('Estado de cuenta retenido'), 'Spanish withheld title');
  await t.shot('withheld');
}
