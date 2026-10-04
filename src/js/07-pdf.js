/*
 * PDF writer: a small, dependency-free PDF 1.4 writer that runs in the page,
 * offline (PRD 5.3, 5.9: a downloadable statement of record). It knows exactly
 * what the statement needs and nothing more:
 *
 *   - pages (US Letter or A4), coordinates in points from the TOP-LEFT corner
 *   - text in the standard fonts Helvetica and Helvetica-Bold (WinAnsiEncoding,
 *     no embedding, so the text is real and selectable), left/right/centre
 *     aligned with exact Adobe AFM advance widths, so amounts line up
 *   - word wrapping, lines and rectangles
 *   - a light-grey rotated watermark under the content of every page
 *   - document information (title, author, subject, creator, producer, creation
 *     date), the catalog's /Lang and /ViewerPreferences << /DisplayDocTitle true >>
 *
 * Text is written in Windows-1252 (WinAnsi). Characters outside it are written
 * as their plain-text equivalent (U+2212 minus → "-", no-break and thin spaces
 * → space, "≈" → "~", "→" → "->", "✓" → "OK"); anything else becomes "?".
 * Composition (what goes on which page) belongs to the caller; the help module
 * composes the statement of record.
 *
 *   var doc = YES.pdf.create({ size: 'letter', margin: 54, title: 'Statement', lang: 'en-US' });
 *   doc.text('Closing balance', doc.margin.left, 120, { font: 'bold', size: 12 });
 *   doc.text('1,147.50 EXUSD', doc.width - doc.margin.right, 120, { align: 'right' });
 *   doc.watermark('ILLUSTRATIVE DEMO DATA');
 *   YES.ui.download('statement.pdf', doc.save(), 'application/pdf');
 */
(function (root) {
  'use strict';
  var YES = (root.YES = root.YES || {});

  var PAGE_SIZES = { letter: [612, 792], a4: [595.28, 841.89] };

  /*
   * Advance widths (1/1000 em) of WinAnsi codes 32–255, from Adobe's AFM files
   * for the standard fonts (Helvetica.afm, Helvetica-Bold.afm, Adobe Core 14 AFM
   * set, 1997). A reader draws these fonts with exactly these widths, so
   * measure() matches what is printed. Unused codes carry the bullet's width,
   * as WinAnsiEncoding draws them as a bullet.
   */
  var W_REGULAR = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 350,
    556, 350, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 350, 611, 350,
    350, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 350, 500, 667,
    278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
    400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500
  ];
  var W_BOLD = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 350,
    556, 350, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 350, 611, 350,
    350, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 350, 500, 667,
    278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333,
    400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
    611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556
  ];
  var FONTS = {
    regular: { key: 'F1', base: 'Helvetica', widths: W_REGULAR },
    bold: { key: 'F2', base: 'Helvetica-Bold', widths: W_BOLD }
  };
  /* Helvetica's ascender and descender (AFM, 1/1000 em). With the default
     baseline 'top', text hangs from y: its baseline is ASCENT × size below it. */
  var ASCENT = 0.718;
  var DESCENT = 0.207;

  /* --------------------------------------------------------------- Encoding */
  /* Unicode → Windows-1252 for the codes 0x80–0x9F (the rest of 0x20–0xFF is Latin-1). */
  var CP1252 = {
    0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
    0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
    0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
    0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f
  };
  /* Characters outside Windows-1252 that the statement uses, as plain text. */
  var SUBST = {
    '\u2212': '-', // minus sign (YES.fmt.amount)
    '\u2010': '-', // hyphen
    '\u2011': '-', // non-breaking hyphen
    '\u00a0': ' ', // no-break space (between amount and unit)
    '\u2002': ' ', // en space
    '\u2003': ' ', // em space
    '\u2007': ' ', // figure space
    '\u2008': ' ', // punctuation space
    '\u2009': ' ', // thin space
    '\u200a': ' ', // hair space
    '\u202f': ' ', // narrow no-break space (some locales' times and groups)
    '\u2248': '~', // almost equal to (USD equivalent)
    '\u2192': '->', // rightwards arrow
    '\u2190': '<-', // leftwards arrow
    '\u2713': 'OK', // check mark
    '\u2714': 'OK', // heavy check mark
    '\u00ad': '', // soft hyphen
    '\u200b': '', // zero-width space
    '\u200c': '', // zero-width non-joiner
    '\u200d': '', // zero-width joiner
    '\u2060': '', // word joiner
    '\ufeff': '', // byte-order mark
    '\t': ' ',
    '\r': ' ',
    '\n': ' '
  };

  /**
   * Text as WinAnsi bytes (a string of char codes 0x20–0xFF): Latin-1 as is,
   * the Windows-1252 extras (€ ‘ ’ “ ” • – — …) mapped, SUBST for the rest,
   * "?" for anything that cannot be written.
   */
  function encode(str) {
    var s = String(str == null ? '' : str);
    if (s.normalize) s = s.normalize('NFC'); // "é" written as e + combining accent → one character
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var c = s.charCodeAt(i);
      if (Object.prototype.hasOwnProperty.call(SUBST, ch)) out += SUBST[ch];
      else if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff)) out += ch;
      else if (CP1252[c]) out += String.fromCharCode(CP1252[c]);
      else {
        if (c >= 0xd800 && c <= 0xdbff) i++; // one "?" for a whole astral character (emoji)
        out += '?';
      }
    }
    return out;
  }

  function fontOf(name) {
    return FONTS[name] || FONTS.regular;
  }

  /** Width in points of `str` set in `font` ('regular' | 'bold') at `size`. */
  function measure(str, font, size) {
    var w = fontOf(font).widths;
    var bytes = encode(str);
    var units = 0;
    for (var i = 0; i < bytes.length; i++) units += w[bytes.charCodeAt(i) - 32] || 0;
    return (units * (size || 10)) / 1000;
  }

  /**
   * Lines of `str` that fit `maxWidth` points. Breaks at ordinary spaces and at
   * "\n" (never at a no-break space, so "1,147.50 EXUSD" stays together); a word
   * longer than the line is split between characters.
   */
  function wrap(str, font, size, maxWidth) {
    var lines = [];
    String(str == null ? '' : str)
      .split(/\r?\n/)
      .forEach(function (para) {
        var words = para.split(/[ \t]+/).filter(Boolean);
        var line = '';
        if (!words.length) {
          lines.push('');
          return;
        }
        words.forEach(function (word) {
          var next = line ? line + ' ' + word : word;
          if (measure(next, font, size) <= maxWidth) {
            line = next;
            return;
          }
          if (line) lines.push(line);
          line = word;
          // A single word wider than the line: split it between characters.
          while (measure(line, font, size) > maxWidth && line.length > 1) {
            var cut = line.length - 1;
            while (cut > 1 && measure(line.slice(0, cut), font, size) > maxWidth) cut--;
            lines.push(line.slice(0, cut));
            line = line.slice(cut);
          }
        });
        lines.push(line);
      });
    return lines;
  }

  /* -------------------------------------------------------- PDF primitives */
  function num(n) {
    var r = Math.round((+n || 0) * 100) / 100;
    return String(r === 0 ? 0 : r);
  }
  /** Literal string of WinAnsi bytes: ( ) \ escaped, bytes ≥ 0x80 as octal, so the file stays 7-bit. */
  function pdfString(bytes) {
    var out = '(';
    for (var i = 0; i < bytes.length; i++) {
      var c = bytes.charCodeAt(i);
      var ch = bytes.charAt(i);
      if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
      else if (c < 0x20 || c > 0x7e) out += '\\' + ('00' + c.toString(8)).slice(-3);
      else out += ch;
    }
    return out + ')';
  }
  /** Text string for /Info and /Lang: UTF-16BE with a byte-order mark, as hex. */
  function pdfText(str) {
    var s = String(str == null ? '' : str);
    var hex = 'FEFF';
    for (var i = 0; i < s.length; i++) hex += ('000' + s.charCodeAt(i).toString(16).toUpperCase()).slice(-4);
    return '<' + hex + '>';
  }
  function pdfDate(d) {
    function p(n) {
      return (n < 10 ? '0' : '') + n;
    }
    return 'D:' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + "+00'00'";
  }
  /** '#rgb' | '#rrggbb' | grey 0–1 | [r, g, b] in 0–1 → "r g b". */
  function rgb(color, fallback) {
    var c = color == null ? fallback : color;
    if (typeof c === 'number') return [c, c, c].map(num).join(' ');
    if (Object.prototype.toString.call(c) === '[object Array]') return c.slice(0, 3).map(num).join(' ');
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || ''));
    if (!m) return '0 0 0';
    var h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return [0, 2, 4]
      .map(function (k) {
        return num(Math.round((parseInt(h.substr(k, 2), 16) / 255) * 1000) / 1000);
      })
      .join(' ');
  }
  function margins(m) {
    if (m == null) m = 54;
    if (typeof m === 'number') return { top: m, right: m, bottom: m, left: m };
    return { top: +m.top || 0, right: +m.right || 0, bottom: +m.bottom || 0, left: +m.left || 0 };
  }
  /* Short document ID for the trailer (FNV-1a over the content): stable for identical output. */
  function docId(s) {
    var h1 = 0x811c9dc5;
    var h2 = 0x01000193;
    for (var i = 0; i < s.length; i++) {
      h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
      h2 = Math.imul(h2 ^ s.charCodeAt(s.length - 1 - i), 2246822507) >>> 0;
    }
    function hex(n) {
      return ('0000000' + n.toString(16)).slice(-8);
    }
    // >>> 0 keeps every part unsigned: a negative number would print a "-" into the hex string.
    return hex(h1) + hex(h2) + hex((h1 ^ h2) >>> 0) + hex((h1 + s.length) >>> 0);
  }

  /* ---------------------------------------------------------------- Document */
  /**
   * New document with one blank page.
   *   opts.size    'letter' (default) | 'a4'
   *   opts.margin  points, or { top, right, bottom, left } (default 54 = 0.75 in);
   *                stored on doc.margin for the caller's layout
   *   opts.title, opts.author, opts.subject, opts.keywords, opts.creator — /Info
   *   opts.lang    BCP 47 tag for the catalog's /Lang (e.g. 'en-US', 'es-ES')
   *   opts.date    creation date (Date or ISO string; default now)
   */
  function create(opts) {
    opts = opts || {};
    var size = PAGE_SIZES[opts.size] || PAGE_SIZES.letter;
    var W = size[0];
    var H = size[1];
    var pages = [];
    var mark = null; // watermark { text, size, color, angle }
    var created = opts.date ? new Date(opts.date) : new Date();
    if (isNaN(created.getTime())) created = new Date();

    var doc = {
      width: W,
      height: H,
      margin: margins(opts.margin),
      page: 0,
      measure: measure,
      wrap: wrap,
      /** Baseline offset below `y` for text drawn with baseline 'top'. */
      ascent: function (size) {
        return ASCENT * (size || 10);
      },
      /** Add a page and make it current. */
      addPage: function () {
        pages.push([]);
        doc.page = pages.length - 1;
        return doc;
      },
      /** Make an existing page current (0-based), e.g. to add "Page n of N" footers at the end. */
      setPage: function (i) {
        if (i >= 0 && i < pages.length) doc.page = i;
        return doc;
      },
      pageCount: function () {
        return pages.length;
      },
      /**
       * Draw one line of text.
       *   x, y      points from the top-left; y is the top of the text (the
       *             ascender line) unless opts.baseline is 'alphabetic'
       *   opts.font 'regular' | 'bold'; opts.size (default 10); opts.color
       *   opts.align 'left' (x is the start) | 'right' (x is the end) |
       *             'center' (x is the middle); with opts.width, the text is
       *             aligned inside the box [x, x + width] instead
       */
      text: function (str, x, y, o) {
        o = o || {};
        var f = fontOf(o.font);
        var sz = o.size || 10;
        var bytes = encode(str);
        if (!bytes) return doc;
        var w = measure(str, o.font, sz);
        var left = x;
        var align = o.align || 'left';
        if (o.width != null) {
          if (align === 'right') left = x + o.width - w;
          else if (align === 'center') left = x + (o.width - w) / 2;
        } else if (align === 'right') left = x - w;
        else if (align === 'center') left = x - w / 2;
        var base = o.baseline === 'alphabetic' ? y : y + ASCENT * sz;
        pages[doc.page].push('BT /' + f.key + ' ' + num(sz) + ' Tf ' + rgb(o.color, 0) + ' rg 1 0 0 1 ' + num(left) + ' ' + num(H - base) + ' Tm ' + pdfString(bytes) + ' Tj ET');
        return doc;
      },
      /**
       * Wrapped text in a column of opts.width points (other opts as text(),
       * plus opts.lineHeight, default 1.3 × size). Returns the y below the last line.
       */
      paragraph: function (str, x, y, o) {
        o = o || {};
        var sz = o.size || 10;
        var lh = o.lineHeight || sz * 1.3;
        var width = o.width || W - doc.margin.right - x;
        wrap(str, o.font, sz, width).forEach(function (line) {
          doc.text(line, x, y, { font: o.font, size: sz, color: o.color, align: o.align, width: o.align && o.align !== 'left' ? width : undefined });
          y += lh;
        });
        return y;
      },
      /** Straight line; opts.width (default 0.75), opts.color, opts.dash ([on, off]). */
      line: function (x1, y1, x2, y2, o) {
        o = o || {};
        pages[doc.page].push(
          'q ' + num(o.width || 0.75) + ' w ' + rgb(o.color, 0) + ' RG ' + (o.dash ? '[' + o.dash.map(num).join(' ') + '] 0 d ' : '') + num(x1) + ' ' + num(H - y1) + ' m ' + num(x2) + ' ' + num(H - y2) + ' l S Q'
        );
        return doc;
      },
      /** Rectangle from its top-left corner; opts.fill and/or opts.stroke colours, opts.lineWidth. */
      rect: function (x, y, w, h, o) {
        o = o || {};
        var fill = o.fill != null;
        var stroke = o.stroke != null || !fill;
        var ops = 'q ' + (fill ? rgb(o.fill) + ' rg ' : '') + (stroke ? rgb(o.stroke, 0) + ' RG ' + num(o.lineWidth || 0.75) + ' w ' : '');
        ops += num(x) + ' ' + num(H - y - h) + ' ' + num(w) + ' ' + num(h) + ' re ' + (fill && stroke ? 'B' : fill ? 'f' : 'S') + ' Q';
        pages[doc.page].push(ops);
        return doc;
      },
      /**
       * Light-grey rotated text across the middle of EVERY page (including
       * pages added later), drawn beneath the content.
       *   opts.size  largest font size (default 64; shrinks to fit the page)
       *   opts.color default '#dadada'; opts.angle degrees (default: the page diagonal)
       *   Pass null to remove it.
       */
      watermark: function (str, o) {
        o = o || {};
        if (str == null || str === '') {
          mark = null;
          return doc;
        }
        var angle = o.angle != null ? o.angle : (Math.atan2(H, W) * 180) / Math.PI;
        var room = Math.sqrt(W * W + H * H) * 0.72;
        var size = Math.min(o.size || 64, room / Math.max(1, measure(str, 'bold', 1)));
        mark = { bytes: encode(str), width: measure(str, 'bold', size), size: size, color: o.color || '#dadada', angle: angle };
        return doc;
      },
      /** The finished file as bytes. */
      save: function () {
        return toBytes(serialize());
      }
    };

    function watermarkOps() {
      if (!mark) return '';
      var a = (mark.angle * Math.PI) / 180;
      var cos = Math.cos(a);
      var sin = Math.sin(a);
      var h = ASCENT * mark.size;
      // Centre the text's box on the page centre, then rotate about it.
      var tx = W / 2 - (mark.width / 2) * cos + (h / 2) * sin;
      var ty = H / 2 - (mark.width / 2) * sin - (h / 2) * cos;
      return 'q BT /F2 ' + num(mark.size) + ' Tf ' + rgb(mark.color) + ' rg ' + [cos, sin, -sin, cos].map(function (v) {
        return String(Math.round(v * 10000) / 10000);
      }).join(' ') + ' ' + num(tx) + ' ' + num(ty) + ' Tm ' + pdfString(mark.bytes) + ' Tj ET Q\n';
    }

    function serialize() {
      // Objects: 1 catalog, 2 page tree, 3–4 fonts, 5 info, then page + content pairs.
      var objs = [];
      var kids = [];
      var lang = opts.lang || 'en';
      objs[1] = '<< /Type /Catalog /Pages 2 0 R /Lang ' + pdfText(lang) + ' /ViewerPreferences << /DisplayDocTitle true >> >>';
      objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
      objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
      var info = ['/Title ' + pdfText(opts.title || ''), '/Producer ' + pdfText('YES.pdf (dependency-free PDF 1.4 writer)'), '/Creator ' + pdfText(opts.creator || 'YES interactive statement')];
      if (opts.author) info.push('/Author ' + pdfText(opts.author));
      if (opts.subject) info.push('/Subject ' + pdfText(opts.subject));
      if (opts.keywords) info.push('/Keywords ' + pdfText(opts.keywords));
      info.push('/CreationDate (' + pdfDate(created) + ')', '/ModDate (' + pdfDate(created) + ')');
      objs[5] = '<< ' + info.join(' ') + ' >>';
      var wm = watermarkOps();
      pages.forEach(function (ops, i) {
        var pageNo = 6 + i * 2;
        var content = wm + ops.join('\n') + '\n';
        kids.push(pageNo + ' 0 R');
        objs[pageNo] =
          '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(W) + ' ' + num(H) + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /ProcSet [/PDF /Text] >> /Contents ' + (pageNo + 1) + ' 0 R >>';
        objs[pageNo + 1] = '<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream';
      });
      objs[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>';

      // Header with a binary comment (marks the file as 8-bit for transfer tools).
      var out = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n';
      var offsets = [];
      for (var n = 1; n < objs.length; n++) {
        offsets[n] = out.length; // one char = one byte: every char code here is ≤ 0xFF
        out += n + ' 0 obj\n' + objs[n] + '\nendobj\n';
      }
      var xref = out.length;
      out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
      for (var k = 1; k < objs.length; k++) out += ('000000000' + offsets[k]).slice(-10) + ' 00000 n \n';
      var id = docId(out);
      out += 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R /Info 5 0 R /ID [<' + id + '> <' + id + '>] >>\nstartxref\n' + xref + '\n%%EOF\n';
      return out;
    }

    doc.addPage();
    return doc;
  }

  function toBytes(s) {
    var bytes = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
    return bytes;
  }

  YES.pdf = {
    create: create,
    measure: measure,
    wrap: wrap,
    encode: encode,
    sizes: PAGE_SIZES,
    ascent: ASCENT,
    descent: DESCENT
  };
})(typeof window !== 'undefined' ? window : globalThis);
