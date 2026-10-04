// PDF writer (src/js/07-pdf.js): builds documents IN THE PAGE (offline, no
// library), saves them under test-results/ and checks them with the installed
// poppler tools: pdfinfo (structure, metadata, pages, no syntax errors),
// pdftotext -layout (selectable text, Spanish accents, mapped characters,
// right-aligned amounts) and pdftoppm (page 1 rendered to
// test-results/screens/pdf-desktop-page1.png for a visual check).
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const meta = { name: 'pdf', viewports: ['desktop'] };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'test-results');
const SHOTS = join(OUT, 'screens');

function tool(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'latin1' });
  if (r.error) throw new Error(`${cmd} is not installed (poppler-utils): ${r.error.message}`);
  return { out: r.stdout, err: r.stderr, code: r.status };
}

export default async function (t) {
  const { page } = t;
  mkdirSync(SHOTS, { recursive: true });

  t.step('encoding, metrics and wrapping');
  const unit = await page.evaluate(() => {
    const P = YES.pdf;
    const codes = (s) => Array.from(P.encode(s)).map((c) => c.charCodeAt(0));
    return {
      minus: P.encode('\u2212'),
      spaces: P.encode('a\u00a0b\u2009c\u202fd'),
      approx: P.encode('≈'),
      arrow: P.encode('→'),
      check: P.encode('✓'),
      emoji: P.encode('x\ud83d\ude00y'),
      cjk: P.encode('\u4e2d'),
      euro: codes('€'),
      quotes: codes('‘’“”•–—…'),
      latin: codes('ñáéíóúü¿¡'),
      decomposed: P.encode('e\u0301'), // NFC: one é
      m1: P.measure('1,147.50', 'regular', 10),
      m2: P.measure('1,147.50', 'bold', 10),
      mMinus: [P.measure('\u22122.50', 'regular', 12), P.measure('-2.50', 'regular', 12)],
      // The column holds "1,147.50 EXUSD" but not "Total 1,147.50 EXUSD" (and would
      // hold "Total 1,147.50" if the no-break space were a break opportunity).
      nbsp: P.wrap('Total 1,147.50\u00a0EXUSD', 'regular', 10, P.measure('1,147.50 EXUSD', 'regular', 10) + 2),
      hard: P.wrap('one\ntwo three', 'regular', 10, 1000),
      long: P.wrap('Supercalifragilistic', 'bold', 10, 40),
      longFits: P.wrap('Supercalifragilistic', 'bold', 10, 40).every((l) => P.measure(l, 'bold', 10) <= 40)
    };
  });
  t.eq(unit.minus, '-', 'U+2212 minus → "-"');
  t.eq(unit.spaces, 'a b c d', 'no-break, thin and narrow no-break spaces → space');
  t.eq([unit.approx, unit.arrow, unit.check], ['~', '->', 'OK'], '≈ → ~, → → ->, ✓ → OK');
  t.eq([unit.emoji, unit.cjk], ['x?y', '?'], 'anything else unmappable → "?" (one per character)');
  t.eq(unit.euro, [0x80], '€ is WinAnsi 0x80');
  t.eq(unit.quotes, [0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x85], 'typographic quotes, bullet, dashes and ellipsis map to Windows-1252');
  t.eq(unit.latin, [0xf1, 0xe1, 0xe9, 0xed, 0xf3, 0xfa, 0xfc, 0xbf, 0xa1], 'Spanish letters and punctuation are Latin-1');
  t.eq(unit.decomposed, 'é', 'decomposed accents are composed first');
  t.eq(unit.m1, 38.92, 'Helvetica AFM widths: "1,147.50" at 10pt = (6×556 + 2×278)/100');
  t.eq(unit.m2, 38.92, 'Helvetica-Bold digits share the 556 advance');
  t.eq(unit.mMinus[0], unit.mMinus[1], 'the minus sign is measured as the "-" it is written as');
  t.eq(unit.nbsp, ['Total', '1,147.50\u00a0EXUSD'], 'wrap never breaks at a no-break space (amount and unit stay together)');
  t.eq(unit.hard, ['one', 'two three'], 'wrap honours line breaks');
  t.assert(unit.long.length > 1 && unit.longFits, 'a word wider than the column is split between characters: ' + JSON.stringify(unit.long));

  t.step('build a three-page document in the page');
  const built = await page.evaluate(() => {
    const doc = YES.pdf.create({
      size: 'letter',
      margin: 54,
      title: 'YES PDF writer test — año',
      author: 'YES (illustrative)',
      subject: 'Statement of record (test)',
      lang: 'es-ES',
      date: '2026-10-04T12:00:00Z'
    });
    const L = doc.margin.left;
    const R = doc.width - doc.margin.right;
    doc.watermark('ILLUSTRATIVE DEMO DATA');
    doc.text('Estado de cuenta de YES', L, 54, { font: 'bold', size: 18 });
    doc.text('¿Qué tal? ¡Sí! Año, ñandú: á é í ó ú Á É Í Ó Ú ü — 20 € “comillas” …', L, 84, { size: 11 });
    doc.text('Escapes: (parentheses) and \\backslash', L, 104, { size: 11 });
    const rows = [
      ['Depósito', '+500,00\u00a0EXUSD'],
      ['Comisión', '\u22122,50\u00a0EXUSD'],
      ['Saldo final ≈ → ✓', '1.147,50\u00a0EXUSD']
    ];
    let y = 136;
    doc.rect(L, y - 6, R - L, rows.length * 22 + 8, { fill: '#f0f2f5' });
    rows.forEach(([label, amount], i) => {
      doc.text(label, L + 8, y, { font: i === 2 ? 'bold' : 'regular' });
      doc.text(amount, R - 8, y, { align: 'right', font: i === 2 ? 'bold' : 'regular' });
      doc.line(L, y + 16, R, y + 16, { color: '#bbbbbb', width: 0.5 });
      y += 22;
    });
    doc.text('Centrado', L, y + 10, { align: 'center', width: R - L, size: 9, color: '#5d6874' });
    y = doc.paragraph(
      'Este párrafo es lo bastante largo como para partirse en varias líneas dentro de una columna de doscientos cincuenta puntos, y mantiene juntos 1.147,50\u00a0EXUSD.',
      L,
      y + 34,
      { width: 250, size: 10 }
    );
    doc.addPage();
    doc.text('Página dos', L, 54, { font: 'bold', size: 14 });
    doc.addPage();
    doc.text('Page three', L, 54, { font: 'bold', size: 14 });
    for (let i = 0; i < doc.pageCount(); i++) {
      doc.setPage(i).text('Página ' + (i + 1) + ' de ' + doc.pageCount(), R, doc.height - 40, { align: 'right', size: 8 });
    }
    const bytes = doc.save();
    // Same document while the screen is dark: the PDF must not change.
    const html = document.documentElement;
    const before = html.getAttribute('data-theme');
    html.setAttribute('data-theme', 'dark');
    const again = YES.pdf.create({ size: 'a4', title: 'A4 check', lang: 'en-US', date: '2026-10-04T12:00:00Z' });
    again.text('A4 page', 54, 54);
    const a4 = again.save();
    html.setAttribute('data-theme', before);
    return {
      bytes: Array.from(bytes),
      a4: Array.from(a4),
      pages: doc.pageCount(),
      right: R - 8,
      amountWidth: YES.pdf.measure('1.147,50\u00a0EXUSD', 'bold', 10)
    };
  });
  t.eq(built.pages, 3, 'three pages');
  const pdf = Buffer.from(built.bytes);
  const file = join(OUT, 'pdf-writer-test.pdf');
  writeFileSync(file, pdf);
  writeFileSync(join(OUT, 'pdf-writer-a4.pdf'), Buffer.from(built.a4));
  const raw = pdf.toString('latin1');

  t.step('file structure: header, byte-exact xref, trailer, catalog');
  t.assert(raw.startsWith('%PDF-1.4\n'), 'PDF 1.4 header');
  t.assert(raw.trimEnd().endsWith('%%EOF'), 'ends with %%EOF');
  const startxref = +raw.match(/startxref\n(\d+)\n%%EOF\s*$/)[1];
  t.eq(raw.slice(startxref, startxref + 4), 'xref', 'startxref points at the xref table');
  const xref = raw.slice(startxref).match(/^xref\n0 (\d+)\n([\s\S]*?)trailer/);
  const count = +xref[1];
  const entries = xref[2].match(/.{20}/gs);
  t.eq(entries.length, count, 'xref has one 20-byte entry per object');
  const offBad = [];
  for (let n = 1; n < count; n++) {
    const off = +entries[n].slice(0, 10);
    if (!raw.startsWith(`${n} 0 obj`, off)) offBad.push(n);
  }
  t.eq(offBad, [], 'every xref offset is byte-exact');
  t.assert(new RegExp(`/Size ${count} /Root 1 0 R /Info 5 0 R`).test(raw), 'trailer names the catalog and info');
  t.assert(/\/ID \[<([0-9a-f]{32})> <\1>\]/.test(raw), 'trailer /ID is two equal 16-byte hex strings');
  // The ID mixes two 32-bit hashes; an XOR can be negative in JavaScript, which
  // once printed a "-" into the hex string. Check many documents, not one.
  const ids = await page.evaluate(() =>
    Array.from({ length: 400 }, (_, i) => {
      const d = YES.pdf.create({ title: 'id ' + i, date: '2026-10-04T12:00:00Z' });
      d.text('Row ' + i, 54, 54);
      const s = Array.from(d.save(), (b) => String.fromCharCode(b)).join('');
      return (s.match(/\/ID \[<([^>]*)>/) || [])[1];
    })
  );
  t.eq(ids.filter((id) => !/^[0-9a-f]{32}$/.test(id || '')), [], 'every /ID is 32 lowercase hex digits (400 documents)');
  t.assert(raw.includes('/ViewerPreferences << /DisplayDocTitle true >>'), 'viewer shows the document title');
  const langHex = 'FEFF' + [...'es-ES'].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('');
  t.assert(raw.includes(`/Lang <${langHex}>`), 'catalog /Lang es-ES');
  t.assert(/\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/.test(raw) && /\/BaseFont \/Helvetica-Bold \/Encoding \/WinAnsiEncoding/.test(raw), 'standard fonts with WinAnsiEncoding');
  const lengthsOk = [...raw.matchAll(/<< \/Length (\d+) >>\nstream\n/g)].every((m) => raw.slice(m.index + m[0].length + +m[1], m.index + m[0].length + +m[1] + 9) === 'endstream');
  t.assert(lengthsOk, 'every stream /Length is exact');
  t.assert(/\/CreationDate \(D:20261004120000\+00'00'\)/.test(raw), 'creation date');
  // Right alignment: the amount's start + its AFM width = the right edge.
  const m = raw.match(/\/F2 10 Tf [\d. ]+ rg 1 0 0 1 ([\d.]+) [\d.]+ Tm \(1\.147,50 EXUSD\) Tj/);
  t.assert(!!m && Math.abs(+m[1] + built.amountWidth - built.right) < 0.011, 'right-aligned amount ends exactly at the right edge: ' + (m && m[1]));
  // The watermark comes first on every page, so it is drawn beneath the content.
  const streams = [...raw.matchAll(/stream\n([\s\S]*?)endstream/g)].map((x) => x[1]);
  t.eq(streams.length, 3, 'one content stream per page');
  t.assert(streams.every((s) => s.startsWith('q BT /F2 ') && s.includes('(ILLUSTRATIVE DEMO DATA) Tj')), 'watermark on every page, before (beneath) the content');
  t.assert(!/[^\x09\x0a\x0d\x20-\x7e]/.test(raw.slice(15)), 'body is 7-bit: WinAnsi bytes above 0x7E are written as octal escapes');

  t.step('pdfinfo: valid, three pages, metadata');
  const info = tool('pdfinfo', [file]);
  t.eq(info.code, 0, 'pdfinfo exit code');
  t.eq(info.err.trim(), '', 'pdfinfo reports no errors');
  const infoText = Buffer.from(info.out, 'latin1').toString('utf8');
  const field = (k) => ((infoText.match(new RegExp('^' + k + ':\\s+(.*)$', 'm')) || [])[1] || '').trim();
  t.eq(field('Pages'), '3', 'Pages');
  t.eq(field('Title'), 'YES PDF writer test — año', 'Title (UTF-16 text string)');
  t.eq(field('Author'), 'YES (illustrative)', 'Author');
  t.eq(field('Subject'), 'Statement of record (test)', 'Subject');
  t.eq(field('Creator'), 'YES interactive statement', 'Creator');
  t.assert(field('Producer').startsWith('YES.pdf'), 'Producer');
  t.eq(field('PDF version'), '1.4', 'PDF version');
  t.assert(field('Page size').startsWith('612 x 792 pts'), 'US Letter: ' + field('Page size'));
  t.assert(field('CreationDate').includes('2026'), 'CreationDate');
  const a4 = tool('pdfinfo', [join(OUT, 'pdf-writer-a4.pdf')]);
  t.eq([a4.code, a4.err.trim()], [0, ''], 'A4 document is valid');
  t.assert(/Page size:\s+595\.2\d? x 841\.8\d? pts \(A4\)/.test(a4.out), 'A4 size: ' + (a4.out.match(/Page size:.*/) || [''])[0]);

  t.step('pdftotext: real, selectable text');
  const text = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8' });
  for (const s of [
    'Estado de cuenta de YES',
    '¿Qué tal? ¡Sí! Año, ñandú: á é í ó ú Á É Í Ó Ú ü — 20 € “comillas” …',
    'Escapes: (parentheses) and \\backslash',
    'Depósito',
    'Comisión',
    'Saldo final ~ -> OK',
    'Centrado',
    'Página dos',
    'Page three',
    'Página 3 de 3'
  ]) {
    t.assert(text.includes(s), 'text layer has: ' + s);
  }
  t.assert(/Comisión\s+-2,50 EXUSD/.test(text), 'the minus sign is written as "-" and the amount stays with its unit');
  t.assert(/\+500,00 EXUSD/.test(text) && /1\.147,50 EXUSD/.test(text), 'amounts with their units');
  // (The diagonal watermark is real text too; poppler extracts diagonal text one
  // letter per line, on lines of its own, so it never splits a content line.)
  t.eq(text.split('\f').filter((p) => p.trim()).length, 3, 'three pages of text');

  t.step('pdftoppm: page 1 renders');
  const prefix = join(SHOTS, 'pdf-desktop-page1');
  execFileSync('pdftoppm', ['-png', '-r', '60', '-f', '1', '-l', '1', '-singlefile', file, prefix]);
  t.assert(existsSync(prefix + '.png'), 'page 1 rendered to ' + prefix + '.png');

  t.step('no network, no library');
  t.eq(t.external.filter((u) => !/cdn\.userway\.org/.test(u)), [], 'the writer made no network request');
  t.eq(await page.evaluate(() => typeof window.jsPDF + typeof window.PDFDocument + typeof window.pdfMake), 'undefinedundefinedundefined', 'no PDF library on the page');
}
