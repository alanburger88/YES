// Shell, offline operation, navigation, language switch, integrity gate, and the
// foundation contracts other modules build on (formatting, routing, focus,
// top-layer toast, masthead layout at every width), plus the light/dark theme,
// the masthead's Download or print, the phone Menu and the UserWay position.
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
  const activeFk = () => state(() => document.activeElement && document.activeElement.getAttribute('data-fk'));
  const menuOpen = () => state(() => document.querySelector('#masthead [data-mast-menu]').getAttribute('aria-expanded') === 'true' && !document.getElementById('mast-menu').hidden);
  const openMenu = async () => {
    if (!(await menuOpen())) await page.click('#masthead [data-mast-menu]');
    await page.waitForSelector('#mast-menu:not([hidden])');
  };
  // Phones reach the sections, the language switch and the theme toggle through the Menu.
  const go = async (v) => {
    if (mobile) {
      await openMenu();
      await page.click(`#mast-menu .mast-menu__link[data-nav="${v}"]`);
    } else {
      await page.click(`.nav__link[data-nav="${v}"]`);
    }
    await page.waitForFunction((x) => YES.state.view === x, v);
  };
  const setLang = async (l) => {
    if (mobile) {
      await openMenu();
      await page.click(`#mast-menu [data-lang="${l}"]`);
      await page.keyboard.press('Escape');
    } else {
      await page.click(`#masthead .mast-wide [data-lang="${l}"]`);
    }
    await page.waitForFunction((x) => YES.i18n.lang === x, l);
  };
  const themeFk = mobile ? 'menu-theme' : 'theme';
  const toggleTheme = async () => {
    if (mobile) await openMenu();
    await page.click(`[data-fk="${themeFk}"]`);
  };
  const theme = () =>
    state(() => ({
      attr: document.documentElement.getAttribute('data-theme'),
      choice: YES.theme.get(),
      effective: YES.theme.effective(),
      stored: (() => {
        try {
          return localStorage.getItem('yes.theme');
        } catch (e) {
          return 'blocked';
        }
      })(),
      bg: getComputedStyle(document.body).backgroundColor,
      scheme: getComputedStyle(document.documentElement).colorScheme
    }));
  // YES brand: a white page on light, a black page on dark.
  const LIGHT_BG = 'rgb(255, 255, 255)';
  const DARK_BG = 'rgb(0, 0, 0)';
  // The header carries no "Illustrative demo data" badge or band (product
  // owner, 2026-10-04). The fictional data stays marked by the footer notice,
  // the document title, the Illustrative tags and the print/PDF watermark.
  const headerDemo = () =>
    state(() => {
      const m = document.getElementById('masthead');
      return {
        badge: m.querySelectorAll('.demo-badge, .has-demo').length,
        words: /illustrative|ilustrativ|demo/i.test(m.innerText),
        skip: getComputedStyle(document.documentElement).getPropertyValue('--mast-skip').trim(),
        top: getComputedStyle(m).top
      };
    });
  const NO_HEADER_DEMO = { badge: 0, words: false, skip: '', top: '0px' };

  t.step('boot');
  t.assert(await state(() => YES.integrity.ok), 'statement reconciles');
  t.eq(await headerDemo(), NO_HEADER_DEMO, 'no demo badge or band in the header; it sticks at the very top');
  t.assert(await page.locator('#site-footer .footer__demo').isVisible(), 'the footer demo notice is shown');
  t.assert((await page.locator('#site-footer .footer__demo').innerText()).includes('Showcase statement with illustrative demo data'), 'footer notice wording');
  t.assert((await page.title()).endsWith('· Illustrative demo'), 'the document title marks the demo: ' + (await page.title()));
  t.eq(await state(() => document.documentElement.lang), 'en', 'html lang');
  t.assert((await page.title()).includes('YES'), 'document title names YES');
  // The device setting is light by default (run with --color-scheme dark to flip it).
  const deviceDark = await state(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const dev = deviceDark ? 'dark' : 'light';
  const th0 = await theme();
  t.eq([th0.attr, th0.choice, th0.stored, th0.bg, th0.scheme], [dev, null, null, deviceDark ? DARK_BG : LIGHT_BG, dev], `follows the (${dev}) device: data-theme="${dev}", no stored choice`);

  t.step('i18n parity');
  t.eq(await state(() => YES.i18n.audit()), {}, 'every string exists in both languages');

  t.step('masthead controls: names, states and layout');
  if (mobile) {
    // Phones: logo, period, Ask and Menu; the rest is in the Menu's panel.
    const btn = page.locator('#masthead [data-mast-menu]');
    t.eq((await btn.innerText()).trim(), 'Menu', 'Menu button shows the word "Menu"');
    t.eq(await page.getByRole('button', { name: 'Menu', exact: true }).count(), 1, 'Menu button named "Menu"');
    t.eq([await btn.getAttribute('aria-expanded'), await btn.getAttribute('aria-controls')], ['false', 'mast-menu'], 'disclosure: aria-expanded false, aria-controls the panel');
    t.assert(!(await page.locator('#mast-menu').isVisible()), 'panel closed at first');
    t.assert(!(await page.locator('#masthead .nav').isVisible()) && !(await page.locator('#masthead .mast-wide').isVisible()), 'no tab row, language switch, theme or download in the phone header');
    t.eq((await page.locator('[data-ask] .btn__label--short').innerText()).trim(), 'Ask', 'Ask YES keeps a visible word on phones');
    t.eq(await page.getByRole('button', { name: 'English', exact: true }).count(), 0, 'language switch only inside the menu');
    await openMenu();
  }
  // Language buttons are named by the language at every width (WCAG 4.1.2).
  t.eq(await page.getByRole('button', { name: 'English', exact: true }).count(), 1, 'button named "English"');
  t.eq(await page.getByRole('button', { name: 'Español', exact: true }).count(), 1, 'button named "Español"');
  const langNames = await page.locator(mobile ? '#mast-menu .seg' : '#masthead .mast-wide .seg').ariaSnapshot();
  t.assert(/button "English" \[pressed\]/.test(langNames) && /button "Español"/.test(langNames), 'aria snapshot names both buttons: ' + langNames);
  const darkBtn = page.getByRole('button', { name: 'Dark mode', exact: true });
  t.eq(await darkBtn.count(), 1, 'one light/dark toggle named "Dark mode"');
  t.eq(await darkBtn.getAttribute('aria-pressed'), String(deviceDark), `pressed only when the theme is dark (now ${dev})`);
  const rec = page.getByRole('button', { name: 'Download or print', exact: true });
  t.eq(await rec.count(), 1, 'one "Download or print" button');
  t.assert((await rec.innerText()).includes(mobile ? 'Download or print' : 'Download or print'), 'shows "Download or print"');
  if (mobile) {
    const links = await page.$$eval('#mast-menu .mast-menu__link', (els) => els.map((e) => [e.getAttribute('data-nav'), e.textContent.trim(), e.getAttribute('aria-current')]));
    t.eq(links, [['overview', 'Overview', 'page'], ['transactions', 'Transactions', null], ['understand', 'Understand', null], ['help', 'Help', null]], 'the four sections, the current one marked');
    t.eq(await page.locator('#mast-menu nav[aria-label="Statement sections"]').count(), 1, 'the sections are a named navigation landmark');
    await axeBad('phone menu open');
    await t.shot('menu-open');
    await page.keyboard.press('Escape');
  } else {
    // With no demo badge in the row, every language shows the full names (with
    // the globe) and "Download or print" from 992px, EN/ES below that, and
    // "Download" below 880px. The width sweep below checks each width.
    t.eq(await page.locator('.mast-wide [data-lang="es"] .seg__long').isVisible(), true, '1280px: full language names');
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.waitForTimeout(150);
    t.eq(await page.locator('.mast-wide [data-lang="es"] .seg__long').isVisible(), true, '1000px: full language names (now that the badge is gone)');
    t.eq((await page.locator('.btn--record .btn__label:not(.btn__label--short)').innerText()).trim(), 'Download or print', '1000px: "Download or print" in full');
    await page.setViewportSize({ width: 960, height: 900 });
    await page.waitForTimeout(150);
    t.assert(await page.locator('.mast-wide [data-lang="es"] .seg__short').isVisible(), '960px: the short code "ES"');
    t.assert(((await page.locator('.mast-wide [data-lang="es"] .seg__long').boundingBox()) || { width: 0 }).width <= 1, 'the full name is visually hidden, not removed');
    t.eq((await page.locator('.btn--record .btn__label:not(.btn__label--short)').innerText()).trim(), 'Download or print', '960px: "Download or print" still in full');
    await page.setViewportSize({ width: 860, height: 900 });
    await page.waitForTimeout(150);
    t.eq((await page.locator('.btn--record .btn__label--short').innerText()).trim(), 'Download', '860px: "Download" shown');
    t.eq(await page.getByRole('button', { name: 'Download or print', exact: true }).count(), 1, 'its name is still "Download or print" (contains the visible word)');
    await page.setViewportSize({ width: 1280, height: 900 });
    // The language switch looks the same in every language at a given width:
    // Spanish shows the full names and the globe too, and "Descargar o imprimir" whole.
    await setLang('es');
    await page.waitForTimeout(150);
    t.eq(await headerDemo(), NO_HEADER_DEMO, 'Spanish: no demo badge or band in the header either');
    for (const w of [1280, 1000]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(150);
      t.eq(await page.locator('.mast-wide [data-lang="en"] .seg__long').isVisible(), true, `${w}px Spanish: full language names, as in English`);
      t.eq(await page.locator('.mast-wide .seg__icon').isVisible(), true, `${w}px Spanish: globe icon, as in English`);
      t.eq(await page.locator('.mast-wide [data-lang="es"] .seg__short').isVisible(), false, `${w}px Spanish: no "EN/ES" codes`);
      t.eq((await page.locator('.btn--record .btn__label:not(.btn__label--short)').innerText()).trim(), 'Descargar o imprimir', `${w}px Spanish: "Descargar o imprimir" in full`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await setLang('en');
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

  t.step('Download or print goes to the record section');
  await state(() => {
    window.__helpCalls = [];
    window.__helpOpen = YES.help.open;
    YES.help.open = (s) => window.__helpCalls.push(s);
  });
  if (mobile) await openMenu();
  await page.click(mobile ? '[data-fk="menu-record"]' : '[data-fk="mast-record"]');
  t.eq(await state(() => window.__helpCalls), ['record'], 'calls YES.help.open("record")');
  if (mobile) t.eq(await menuOpen(), false, 'and closes the menu');
  await state(() => {
    YES.help.open = window.__helpOpen;
  });
  if (mobile) await openMenu();
  await page.click(mobile ? '[data-fk="menu-record"]' : '[data-fk="mast-record"]');
  await page.waitForFunction(() => YES.state.view === 'help');
  t.eq(await state(() => location.hash), '#/help/record', 'arrives at #/help/record');
  await go('overview');

  t.step('navigation');
  for (const v of ['transactions', 'understand', 'help', 'overview']) {
    await go(v);
    await page.waitForFunction((v) => location.hash.startsWith('#/' + v), v);
    t.assert(await state((v) => !document.getElementById('view-' + v).hidden, v), `view ${v} shown`);
    t.eq(await page.$$eval('#masthead [aria-current="page"]', (els) => els.map((e) => e.getAttribute('data-nav'))), [v, v], 'aria-current follows the view in the tabs and in the menu');
    await page.waitForFunction((v) => document.activeElement && document.activeElement.id === 'h-' + v, v).catch(() => {});
    t.eq(await state(() => document.activeElement.id), 'h-' + v, 'focus moves to the view heading');
    if (mobile) t.eq(await menuOpen(), false, 'choosing a section closes the menu');
  }

  t.step('browser Back/Forward move focus to the view and announce it');
  await go('transactions');
  await go('help');
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
  await setLang('es');
  t.eq(await state(() => document.documentElement.lang), 'es', 'html lang es');
  t.eq((await page.locator(`${mobile ? '.mast-menu__link' : '.nav__link'}[data-nav="transactions"]`).textContent()).trim(), 'Movimientos', 'nav translated');
  t.eq(await page.locator(`${mobile ? '#mast-menu' : '.mast-wide'} [data-lang="es"]`).getAttribute('aria-pressed'), 'true', 'es pressed');
  t.eq((await page.locator('#masthead [data-mast-record]').first().getAttribute('aria-label')), 'Descargar o imprimir', 'Download or print translated');
  if (mobile) t.eq((await page.locator('#masthead [data-mast-menu]').innerText()).trim(), 'Menú', 'Menu translated');
  t.eq((await page.locator('.skip-link').textContent()).trim(), 'Ir al estado de cuenta', 'skip link translated');
  t.eq(await headerDemo(), NO_HEADER_DEMO, 'Spanish: no demo badge or band in the header');
  t.assert((await page.locator('#site-footer .footer__demo').innerText()).includes('datos ilustrativos de demostración'), 'the footer demo notice, in Spanish');
  t.assert((await page.title()).endsWith('· Demostración ilustrativa'), 'Spanish document title marks the demo: ' + (await page.title()));

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
  await setLang('en');
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
    copy.assets.USBC.fiat.verified = true;
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
    // The approved artwork ships in the slot; set it aside to exercise every kind.
    const approved = { src: slot.src, srcDark: slot.srcDark };
    delete slot.src;
    delete slot.srcDark;
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
        imgs: [...el.querySelectorAll('img')].map((i) => [i.className, i.getAttribute('alt')]),
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
    Object.assign(slot, approved);
    out.approved = approved;
    out.pair = read(YES.ui.logoHtml({ cls: 'brand__logo' }));
    out.onDark = read(YES.ui.logoHtml({ tone: 'dark' }));
    out.symbol = (() => {
      const tpl = document.createElement('template');
      tpl.innerHTML = YES.ui.symbolHtml({ size: 32 });
      const el = tpl.content.firstElementChild;
      return { hidden: el.getAttribute('aria-hidden'), role: el.getAttribute('role'), style: el.getAttribute('style'), imgs: [...el.querySelectorAll('img')].map((i) => [i.className, i.getAttribute('alt')]) };
    })();
    out.masthead = !!document.querySelector('#masthead .brand > .yes-logo.brand__logo[data-slot="YES_LOGO"][role="img"][aria-label="YES"]');
    return out;
  });
  t.eq(
    logo.placeholder,
    { n: 1, cls: 'yes-logo yes-logo--placeholder brand__logo brand__logo--placeholder', role: 'img', label: 'YES', hidden: null, slot: 'YES_LOGO', text: 'YES', style: null, img: null, imgs: [], svg: false },
    'placeholder: one element, named "YES", modifier on the caller\'s class'
  );
  t.eq([logo.pt, logo.px, logo.unsafe], ['--logo-h: 28pt', '--logo-h: 40px', null], 'size sets --logo-h; anything but a plain length is ignored');
  t.eq([logo.decorative.role, logo.decorative.label, logo.decorative.hidden], [null, null, 'true'], 'decorative: hidden from assistive technology');
  t.eq(logo.remote.cls, 'yes-logo yes-logo--placeholder', 'an image URL that would fetch is ignored (no network)');
  t.eq([logo.dataUri.cls, logo.dataUri.role, logo.dataUri.label, logo.dataUri.img], ['yes-logo yes-logo--art pr-logo pr-logo--art', 'img', 'YES', ['data:image/svg+xml', '']], 'data-URI image: named once, image itself decorative');
  t.eq([logo.svg.cls, logo.svg.svg, logo.svg.text, logo.svg.label], ['yes-logo yes-logo--art pr-logo pr-logo--art', true, '', 'YES'], 'approved SVG markup');
  t.assert(logo.masthead, 'the masthead renders the slot through ui.logoHtml');
  t.assert(/^data:image\/png;base64,/.test(logo.approved.src) && /^data:image\/png;base64,/.test(logo.approved.srcDark), 'the approved YES logo (black and white) is packaged as data: URIs');
  t.eq(
    [logo.pair.cls, logo.pair.role, logo.pair.label, logo.pair.imgs],
    ['yes-logo yes-logo--art brand__logo brand__logo--art', 'img', 'YES', [['yes-art yes-art--light', ''], ['yes-art yes-art--dark', '']]],
    'approved artwork with a dark variant: both images, named once ("YES"), each image decorative'
  );
  t.eq(logo.onDark.imgs, [['', '']], 'tone "dark" (an always-dark surface): only the white artwork');
  t.eq(logo.symbol, { hidden: 'true', role: null, style: '--sym-h: 32px', imgs: [['yes-art yes-art--light', ''], ['yes-art yes-art--dark', '']] }, 'USBC symbol: decorative, light and dark artwork');

  t.step('brand artwork follows the theme (device setting and data-theme); print uses the black version');
  const shownArt = () =>
    state(() => {
      // Computed display, so it also reads in print (where the masthead itself is hidden).
      const vis = (sel) => [...document.querySelectorAll(sel)].filter((i) => getComputedStyle(i).display !== 'none').map((i) => (i.classList.contains('yes-art--dark') ? 'white' : 'black'));
      return { logo: vis('#masthead .brand__logo img'), coin: vis('.ov-hero__coin img, .tx-dlg__coin img') };
    });
  {
    const attr0 = await state(() => document.documentElement.getAttribute('data-theme'));
    const runs = [
      ['light', 'light', 'screen', 'black'],
      ['dark', null, 'screen', 'white'],
      ['light', 'dark', 'screen', 'white'],
      ['dark', 'light', 'screen', 'black'],
      ['dark', 'dark', 'print', 'black']
    ];
    for (const [scheme, attr, media, want] of runs) {
      await page.emulateMedia({ colorScheme: scheme, media });
      // Let YES.theme react to the device change first (it mirrors the theme into data-theme).
      await state(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
      await state((a) => (a ? document.documentElement.setAttribute('data-theme', a) : document.documentElement.removeAttribute('data-theme')), attr);
      const shown = await shownArt();
      t.eq(shown.logo, [want], `masthead logo (device ${scheme}, data-theme ${attr}, ${media})`);
    }
    await page.emulateMedia({ colorScheme: 'light', media: 'screen' });
    await state((a) => document.documentElement.setAttribute('data-theme', a), attr0 || 'light');
  }

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
  t.eq([long.multi, long.radius], [true, '16px'], 'a wrapped message takes the card radius');
  t.assert(long.width > (mobile ? 0.85 : 0.35) * (await state(() => innerWidth)) && long.left >= 15 && long.right >= 15, 'a wrapped toast uses the width (not half the screen) and keeps the gutters: ' + JSON.stringify(long));
  await state(() => document.getElementById('toast').classList.remove('is-visible'));

  t.step('masthead: one brand row at every width, both languages, no horizontal scroll');
  const widths = mobile ? [320, 360, 375, 390, 414, 600, 719] : [720, 768, 832, 860, 880, 900, 960, 992, 1000, 1088, 1280, 1440, 1920];
  // The layout depends on the masthead's width only, never on the language:
  // full names, globe and "Download or print" from 992px, EN/ES below,
  // "Download" below 880px and "Ask" below 832px (default text size; the
  // brand row's own width decides, see 03-shell.css).
  const layoutFor = (cw) => ({ names: cw >= 992, record: cw >= 880, ask: cw >= 832 });
  for (const lang of ['en', 'es']) {
    await setLang(lang);
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: mobile ? 800 : 900 });
      await page.waitForTimeout(120);
      const m = await state(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const list = document.querySelector('.nav__list');
        const tabs = getComputedStyle(document.querySelector('#masthead .nav')).display !== 'none';
        const help = document.querySelector('.nav__link[data-nav="help"]').getBoundingClientRect();
        const shown = [...document.querySelectorAll('.masthead__actions > *:not(.mast-wide), .mast-wide > *')].filter((e) => e.getClientRects().length);
        const wide = (sel) => !!document.querySelector(sel) && document.querySelector(sel).getBoundingClientRect().width > 1;
        return {
          oneRow: r('.masthead__actions').top < r('.brand').bottom - 4 && new Set(shown.map((e) => Math.round(e.getBoundingClientRect().top))).size === 1,
          inside: shown.every((e) => e.getBoundingClientRect().right <= window.innerWidth && e.getBoundingClientRect().left >= 0),
          tabs,
          navFits: !tabs || (list.scrollWidth <= list.clientWidth + 1 && help.right <= window.innerWidth),
          cw: Math.round(document.getElementById('masthead').getBoundingClientRect().width),
          noBadge: !document.querySelector('#masthead .demo-badge'),
          noScroll: document.documentElement.scrollWidth <= window.innerWidth,
          menu: !!document.querySelector('[data-mast-menu]').getClientRects().length,
          layout: { names: wide('.mast-wide [data-lang="es"] .seg__long'), record: wide('.btn--record .btn__label:not(.btn__label--short)'), ask: wide('.btn--ask .btn__label:not(.btn__label--short)') }
        };
      });
      t.assert(m.oneRow && m.inside, `${lang} ${w}px: brand and every control share one row, on screen`);
      t.assert(m.navFits, `${lang} ${w}px: Overview, Transactions, Understand and Help all visible`);
      t.assert(m.noBadge, `${lang} ${w}px: no demo badge in the header`);
      t.assert(m.noScroll, `${lang} ${w}px: no horizontal scroll`);
      t.eq([m.menu, m.tabs], mobile ? [true, false] : [false, true], `${lang} ${w}px: ${mobile ? 'Menu, no tab row' : 'tab row, no Menu'}`);
      if (!mobile) t.eq(m.layout, layoutFor(m.cw), `${lang} ${w}px: the same labels in every language`);
    }
  }
  if (!mobile) {
    // The masthead is a size container: the docked assistant (400px) narrows it.
    for (const lang of ['es', 'en']) {
      await setLang(lang);
      for (const w of [1100, 1280, 1366, 1440, 1920]) {
        await page.setViewportSize({ width: w, height: 900 });
        await state(() => document.documentElement.classList.add('assistant-docked'));
        await page.waitForTimeout(150);
        const d = await state(() => {
          const mast = document.getElementById('masthead').getBoundingClientRect();
          const shown = [...document.querySelectorAll('.masthead__actions > *:not(.mast-wide), .mast-wide > *')].filter((e) => e.getClientRects().length);
          const wide = (sel) => !!document.querySelector(sel) && document.querySelector(sel).getBoundingClientRect().width > 1;
          return {
            cw: Math.round(mast.width),
            ok:
              shown.every((e) => e.getBoundingClientRect().right <= mast.right + 0.5) &&
              new Set(shown.map((e) => Math.round(e.getBoundingClientRect().top))).size === 1 &&
              document.querySelector('.masthead__actions').getBoundingClientRect().top < document.querySelector('.brand').getBoundingClientRect().bottom - 4,
            menu: !!document.querySelector('[data-mast-menu]').getClientRects().length,
            layout: { names: wide('.mast-wide [data-lang="es"] .seg__long'), record: wide('.btn--record .btn__label:not(.btn__label--short)'), ask: wide('.btn--ask .btn__label:not(.btn__label--short)') }
          };
        });
        t.assert(d.ok, `${lang} ${w}px docked: one row inside the narrowed masthead`);
        if (d.cw < 720) t.eq(d.menu, true, `${lang} ${w}px docked (${d.cw}px): the phone layout`);
        else t.eq(d.layout, layoutFor(d.cw), `${lang} ${w}px docked (${d.cw}px): the labels for that width`);
        await state(() => document.documentElement.classList.remove('assistant-docked'));
      }
    }
  }
  await setLang('en');
  if (mobile) {
    // With the sections in the Menu and no demo band (removed 2026-10-04), the
    // phone header is one slim row: under 60px of the first screen (it was 80
    // with the band and 125 with the tab row). It stays pinned at the very top,
    // and --masthead-h (scroll-padding) reserves exactly its height.
    for (const lang of ['en', 'es']) {
      await setLang(lang);
      for (const [w, h] of [
        [320, 640],
        [360, 640],
        [390, 844]
      ]) {
        await page.setViewportSize({ width: w, height: h });
        await state(() => window.scrollTo(0, 0));
        await page.waitForTimeout(150);
        const first = await state(() => {
          const r = document.getElementById('masthead').getBoundingClientRect();
          return { top: r.top, total: r.height };
        });
        t.assert(first.top === 0 && first.total <= 60, `${lang} ${w}px: the header takes under 60px of the first screen: ${JSON.stringify(first)}`);
        await state(() => window.scrollTo(0, 900));
        await page.waitForTimeout(150);
        const pinned = await state(() => ({
          top: document.getElementById('masthead').getBoundingClientRect().top,
          bottom: document.getElementById('masthead').getBoundingClientRect().bottom,
          reserved: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--masthead-h'))
        }));
        t.assert(pinned.top === 0 && pinned.bottom <= 60 && Math.abs(pinned.bottom - first.total) <= 1, `${lang} ${w}px: the whole header stays pinned when scrolled: ${JSON.stringify(pinned)}`);
        t.assert(Math.abs(pinned.bottom - pinned.reserved) <= 1, `${lang} ${w}px: --masthead-h equals the pinned height: ${JSON.stringify(pinned)}`);
      }
    }
    await setLang('en');
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
      s.textContent = '#masthead .brand { min-height: 220px; }'; // as tall as very large text makes it
      document.head.appendChild(s);
    });
    await page.waitForTimeout(250);
    t.eq(await pinState(), ['relative', '0px'], 'a masthead taller than 30% of the screen is not pinned and reserves nothing');
    await state(() => document.getElementById('tall-mast').remove());
    await page.waitForTimeout(250);
    const again = await pinState();
    t.assert(again[0] === 'sticky' && parseFloat(again[1]) > 40 && parseFloat(again[1]) <= 60, 'back to normal: pinned again, --masthead-h follows: ' + again);
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
    // Desktop: the brand row and the tabs stay pinned at the very top, and
    // --masthead-h reserves exactly their height.
    await page.setViewportSize({ width: 1280, height: 900 });
    await state(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(150);
    const pin = await state(() => {
      const r = document.getElementById('masthead').getBoundingClientRect();
      return { top: r.top, height: Math.ceil(r.height), reserved: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--masthead-h')) };
    });
    t.assert(pin.top === 0 && pin.height <= 110 && Math.abs(pin.height - pin.reserved) <= 1, '1280px: brand row and tabs pinned, --masthead-h equals their height: ' + JSON.stringify(pin));
    await state(() => window.scrollTo(0, 0));
    // Very large text on a desktop window: the em breakpoints move to the
    // roomier layouts (here the phone Menu) instead of overflowing the tabs.
    await state(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await page.waitForTimeout(250);
    const big = await state(() => ({
      menu: !!document.querySelector('[data-mast-menu]').getClientRects().length,
      noScroll: document.documentElement.scrollWidth <= innerWidth
    }));
    t.eq(big, { menu: true, noScroll: true }, '200% text at 1280px: the Menu layout, no horizontal scroll');
    // Large text on a wide screen: the brand row stops at the page's 1120px
    // column, and the labels follow the room inside it (not the screen's width),
    // so the row never wraps. Spanish is the longest.
    await state(() => document.documentElement.style.removeProperty('font-size'));
    await page.waitForTimeout(150);
    await setLang('es');
    for (const [fs, w, want] of [
      ['125%', 1920, { names: false, record: true, ask: true }],
      ['150%', 1920, { names: false, record: false, ask: false }]
    ]) {
      await state((f) => {
        document.documentElement.style.fontSize = f;
      }, fs);
      await page.setViewportSize({ width: w, height: 1000 });
      await page.waitForTimeout(250);
      const row = await state(() => {
        const shown = [...document.querySelectorAll('.masthead__actions > *:not(.mast-wide), .mast-wide > *')].filter((e) => e.getClientRects().length);
        const wide = (sel) => !!document.querySelector(sel) && document.querySelector(sel).getBoundingClientRect().width > 1;
        return {
          oneRow: new Set(shown.map((e) => Math.round(e.getBoundingClientRect().top))).size === 1 && document.querySelector('.masthead__actions').getBoundingClientRect().top < document.querySelector('.brand').getBoundingClientRect().bottom - 4,
          menu: !!document.querySelector('[data-mast-menu]').getClientRects().length,
          noScroll: document.documentElement.scrollWidth <= innerWidth,
          labels: { names: wide('.mast-wide [data-lang="es"] .seg__long'), record: wide('.btn--record .btn__label:not(.btn__label--short)'), ask: wide('.btn--ask .btn__label:not(.btn__label--short)') }
        };
      });
      t.eq(row, { oneRow: true, menu: false, noScroll: true, labels: want }, `es, ${fs} text at ${w}px: one row with the labels that fit`);
    }
    await state(() => document.documentElement.style.removeProperty('font-size'));
    await setLang('en');
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  if (mobile) {
    t.step('phone menu: keyboard, Escape, outside click, Tab out, route changes');
    await fresh();
    const btn = page.locator('#masthead [data-mast-menu]');
    await btn.focus();
    await page.keyboard.press('Enter');
    t.eq(await menuOpen(), true, 'Enter opens it');
    t.eq(await btn.getAttribute('aria-expanded'), 'true', 'aria-expanded true');
    t.eq(await activeFk(), 'menu', 'focus stays on the Menu button');
    await page.keyboard.press('Tab');
    t.eq(await activeFk(), 'menu-nav-overview', 'Tab moves into the panel: the first section');
    await page.keyboard.press('Escape');
    t.eq([await menuOpen(), await activeFk()], [false, 'menu'], 'Escape closes it and returns focus to the Menu button');
    await page.keyboard.press(' ');
    t.eq(await menuOpen(), true, 'Space opens it');
    await page.keyboard.press(' ');
    t.eq(await menuOpen(), false, 'Space closes it');
    await openMenu();
    const vp = page.viewportSize();
    await page.mouse.click(4, vp.height - 4); // the page gutter, below the panel
    t.eq(await menuOpen(), false, 'a click outside closes it');
    t.assert((await activeFk()) !== 'menu', 'an outside click does not pull focus back to the button');
    await openMenu();
    await page.focus('[data-fk="menu-theme"]');
    await page.keyboard.press('Tab');
    t.eq(await menuOpen(), false, 'tabbing out of the masthead closes it');
    await openMenu();
    await state(() => YES.nav.go('help'));
    t.eq(await menuOpen(), false, 'any navigation closes it');
    await go('overview');

    t.step('phone menu: language and theme keep it open, focus stays on the pressed control');
    await openMenu();
    await page.click('#mast-menu [data-lang="es"]');
    await page.waitForFunction(() => YES.i18n.lang === 'es');
    t.eq(await menuOpen(), true, 'still open after switching language');
    t.eq(await activeFk(), 'menu-lang-es', 'focus on "Español"');
    t.eq(await page.locator('#mast-menu [data-lang="es"]').getAttribute('aria-pressed'), 'true', 'Español pressed');
    t.eq((await page.locator('#mast-menu .mast-menu__link[aria-current="page"]').textContent()).trim(), 'Resumen', 'sections in Spanish, current one marked');
    t.eq((await btn.innerText()).trim(), 'Menú', 'Menu button in Spanish');
    await t.shot('menu-es');
    await page.click('#mast-menu [data-lang="en"]');
    await page.waitForFunction(() => YES.i18n.lang === 'en');
    t.eq([await menuOpen(), await activeFk()], [true, 'menu-lang-en'], 'back to English, still open, focus kept');
    const was = (await theme()).effective;
    const flipped = was === 'dark' ? 'light' : 'dark';
    await page.click('[data-fk="menu-theme"]');
    t.eq(await menuOpen(), true, 'still open after switching theme');
    t.eq(await activeFk(), 'menu-theme', 'focus on the theme toggle');
    t.eq((await theme()).attr, flipped, 'the theme switched to ' + flipped);
    t.eq(await page.locator('[data-fk="menu-theme"]').getAttribute('aria-pressed'), String(flipped === 'dark'), 'pressed exactly when dark');
    t.eq((await page.locator('[data-fk="menu-theme"] .switch__text').innerText()).trim(), flipped === 'dark' ? 'On' : 'Off', 'the switch says On when dark');
    await axeBad('phone menu open, ' + flipped);
    await t.shot('menu-' + flipped);
    await page.keyboard.press('Space');
    t.eq((await theme()).attr, was, 'Space on the toggle switches back');
    await page.keyboard.press('Escape');

    t.step('phone menu: fits narrow screens, scrolls inside itself, respects reduced motion');
    for (const lang of ['en', 'es']) {
      for (const w of [320, 390]) {
        await page.setViewportSize({ width: w, height: 700 });
        await page.waitForTimeout(100);
        if (lang === 'es' && w === 320) await setLang('es');
        await openMenu();
        const fit = await state(() => {
          const p = document.getElementById('mast-menu').getBoundingClientRect();
          const kids = [...document.querySelectorAll('#mast-menu a, #mast-menu button')];
          return {
            panel: p.left >= 0 && p.right <= innerWidth + 0.5,
            kids: kids.every((k) => k.getBoundingClientRect().right <= p.right + 0.5 && k.getBoundingClientRect().left >= p.left - 0.5),
            noScroll: document.documentElement.scrollWidth <= innerWidth,
            targets: kids.every((k) => k.getBoundingClientRect().height >= 44 - 0.5 || k.closest('.seg'))
          };
        });
        t.eq(fit, { panel: true, kids: true, noScroll: true, targets: true }, `${lang} ${w}px: the panel and its controls fit, no horizontal scroll, 44px rows`);
        await page.keyboard.press('Escape');
      }
    }
    await setLang('en');
    await page.setViewportSize({ width: 360, height: 400 });
    await page.waitForTimeout(200);
    await openMenu();
    const tall = await state(() => {
      const p = document.getElementById('mast-menu');
      const before = p.scrollTop;
      p.scrollTop = 9999;
      return { scrolls: p.scrollHeight > p.clientHeight + 1 && p.scrollTop > before, bottom: p.getBoundingClientRect().bottom, vh: innerHeight };
    });
    t.assert(tall.scrolls && tall.bottom <= tall.vh + 1, 'taller than the screen: the panel scrolls inside itself and ends on screen: ' + JSON.stringify(tall));
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openMenu();
    const slow = await state(() => document.getAnimations().filter((a) => document.getElementById('mast-menu').contains(a.effect && a.effect.target)).map((a) => a.effect.getComputedTiming().duration));
    t.assert(slow.every((d) => d <= 1), 'reduced motion: the panel appears without animation: ' + JSON.stringify(slow));
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Rotating to a wider layout leaves the menu nothing to show: it closes.
    await openMenu();
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.waitForTimeout(250);
    t.eq(await state(() => document.querySelector('[data-mast-menu]').getAttribute('aria-expanded')), 'false', 'switching to the tab layout closes the menu');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
  }

  t.step('theme: follows the device live until the visitor chooses');
  await state(() => YES.theme.set(null)); // forget any choice made above
  await fresh();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(100);
  let th = await theme();
  t.eq([th.attr, th.choice, th.effective, th.bg, th.scheme], ['dark', null, 'dark', DARK_BG, 'dark'], 'a dark device turns the page dark (live)');
  if (mobile) await openMenu();
  t.eq(await page.locator(`[data-fk="${themeFk}"]`).getAttribute('aria-pressed'), 'true', 'the toggle shows it');
  if (mobile) await page.keyboard.press('Escape');
  if (!mobile) await t.shot('dark-device');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(100);
  t.eq((await theme()).attr, 'light', 'and light again when the device is light');

  t.step('theme: the visitor’s choice wins, is remembered and applies before the first paint');
  await toggleTheme();
  th = await theme();
  t.eq([th.attr, th.choice, th.stored, th.bg], ['dark', 'dark', 'dark', DARK_BG], 'toggle: dark, remembered in localStorage "yes.theme"');
  t.eq(await activeFk(), themeFk, 'focus stays on the toggle after the re-render');
  t.eq(await page.locator(`[data-fk="${themeFk}"]`).getAttribute('aria-pressed'), 'true', 'pressed');
  if (mobile) await page.keyboard.press('Escape');
  await page.emulateMedia({ colorScheme: 'light' });
  t.eq((await theme()).attr, 'dark', 'a light device does not override the choice');
  await axeBad('dark theme');
  await t.shot('dark-chosen');
  // Reload: the head script applies the choice before <body> exists (no flash).
  await page.addInitScript(() => {
    window.__themeAtFirstSet = undefined;
    // Init scripts run before <html> exists: watch the whole document.
    new MutationObserver((list, obs) => {
      if (!list.some((m) => m.target === document.documentElement)) return;
      window.__themeAtFirstSet = { value: document.documentElement.getAttribute('data-theme'), bodyParsed: !!document.body };
      obs.disconnect();
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme'] });
  });
  await fresh();
  t.eq(await state(() => window.__themeAtFirstSet), { value: 'dark', bodyParsed: false }, 'reload: dark is applied in <head>, before the body is parsed');
  th = await theme();
  t.eq([th.attr, th.choice, th.bg], ['dark', 'dark', DARK_BG], 'reload: still dark');
  if (mobile) await openMenu();
  t.eq(await page.locator(`[data-fk="${themeFk}"]`).getAttribute('aria-pressed'), 'true', 'reload: the toggle is pressed');
  if (mobile) await page.keyboard.press('Escape');
  // A light choice on a dark device.
  await page.emulateMedia({ colorScheme: 'dark' });
  await toggleTheme();
  if (mobile) await page.keyboard.press('Escape');
  th = await theme();
  t.eq([th.attr, th.choice, th.bg, th.scheme], ['light', 'light', LIGHT_BG, 'light'], 'light chosen on a dark device stays light');

  t.step('theme: both dark entry points are identical; print is always light');
  const tokens = await state(() => {
    const names = [];
    const walk = (rules) => {
      for (const r of rules) {
        if (r.cssRules && !r.selectorText) walk(r.cssRules);
        else if (r.selectorText && /:root\[data-theme=['"]?dark['"]?\]$/.test(r.selectorText.trim())) for (const n of r.style) names.push(n);
      }
    };
    for (const sh of document.styleSheets) walk(sh.cssRules);
    return names;
  });
  t.assert(tokens.length >= 40, 'the dark block declares the token set: ' + tokens.length);
  const read = (names) => state((ns) => ns.map((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()), names);
  await page.emulateMedia({ colorScheme: 'dark' });
  await state(() => document.documentElement.removeAttribute('data-theme')); // as before boot
  const viaDevice = await read(tokens);
  await page.emulateMedia({ colorScheme: 'light' });
  await state(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const viaChoice = await read(tokens);
  t.eq(viaChoice, viaDevice, 'device dark and data-theme="dark" give the same tokens');
  t.eq(await state(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()), '#000000', 'and they are the dark tokens');
  for (const [scheme, attr] of [
    ['light', 'dark'],
    ['dark', 'dark'],
    ['dark', null]
  ]) {
    await page.emulateMedia({ colorScheme: scheme, media: 'print' });
    await state((a) => (a ? document.documentElement.setAttribute('data-theme', a) : document.documentElement.removeAttribute('data-theme')), attr);
    const pr = await state(() => ({
      bg: getComputedStyle(document.body).backgroundColor,
      ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
      surface: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),
      scheme: getComputedStyle(document.documentElement).colorScheme,
      record: getComputedStyle(document.getElementById('print-root')).color
    }));
    t.eq(pr, { bg: 'rgb(255, 255, 255)', ink: '#000', surface: '#fff', scheme: 'light', record: 'rgb(0, 0, 0)' }, `print is light (device ${scheme}, data-theme ${attr})`);
  }
  await page.emulateMedia({ colorScheme: 'light', media: 'screen' });
  await state(() => YES.theme.set(null));
  th = await theme();
  t.eq([th.attr, th.choice, th.stored], ['light', null, null], 'YES.theme.set(null) follows the device again and forgets the choice');

  t.step('theme: blocked storage never breaks the page');
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
    const r = await p2.evaluate(() => {
      const a = YES.theme.toggle();
      return [a, document.documentElement.getAttribute('data-theme'), YES.theme.get()];
    });
    const other = deviceDark ? 'light' : 'dark';
    t.eq(r, [other, other, other], 'the toggle still works for this page view');
    t.eq(errs, [], 'no errors with storage blocked');
    await p2.close();
  }

  t.step('forced colours keep a visible focus indicator');
  await fresh();
  await page.emulateMedia({ forcedColors: 'active' });
  const outlines = [];
  const fks = mobile ? ['ask-yes', 'menu', 'ov-explore'] : ['lang-es', 'theme', 'mast-record', 'ask-yes', 'ov-explore'];
  for (const fk of fks) {
    await page.focus(`[data-fk="${fk}"]`);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    outlines.push(await state(() => [document.activeElement.getAttribute('data-fk'), getComputedStyle(document.activeElement).outlineStyle]));
  }
  t.eq(outlines, fks.map((k) => [k, 'solid']), 'focused controls draw an outline under forced colours');
  await page.emulateMedia({ forcedColors: 'none' });

  t.step('form fields and placeholders meet contrast');
  await go('transactions');
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

  t.step('userway graceful offline, launcher bottom left');
  await page.waitForFunction(() => ['unavailable', 'loaded', 'host', 'disabled'].includes(YES.userway.status), null, { timeout: 12000 });
  t.eq(await state(() => YES.userway.status), 'unavailable', 'widget unavailable offline');
  const uw = await state(() => {
    const s = document.querySelectorAll('script[data-yes-userway]');
    return { n: s.length, src: s[0] && s[0].getAttribute('src'), account: s[0] && s[0].getAttribute('data-account'), position: s[0] && s[0].getAttribute('data-position'), cfg: YES.config.userway.position };
  });
  t.eq(uw, { n: 1, src: 'https://cdn.userway.org/widget.js', account: 'B3W9A2mgGs', position: '5', cfg: 5 }, 'one official loader, account ID, data-position="5" (bottom left, clear of the Ask YES close button)');
  t.assert(t.external.some((u) => /cdn\.userway\.org/.test(u)), 'the (blocked) request was the UserWay loader');
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
  t.eq(await page.locator('#masthead [data-mast-record]:visible, #masthead [data-ask]:visible').count(), 0, 'no Download or print and no Ask YES while withheld');
  if (mobile) {
    await openMenu();
    t.eq(await page.locator('#mast-menu .mast-menu__link:visible').count(), 0, 'withheld: the menu offers no sections');
    t.assert(await page.locator('#mast-menu [data-lang="es"]').isVisible(), 'withheld: the menu still offers the language switch');
    await page.keyboard.press('Escape');
  }
  await setLang('es');
  t.eq(await state(() => document.getElementById('overview-root').innerHTML.length), 0, 'a language switch renders no withheld figures');
  t.assert((await page.title()).startsWith('Estado de cuenta retenido'), 'Spanish withheld title');
  await t.shot('withheld');
}
