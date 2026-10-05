/*
 * 60-json.js — WT.json, the data-requirements explorer (SPEC section 7).
 * Owner: data view.
 *
 *   var x = WT.json.mount(el, { features: ['journey', 'fees'], mode: 'tree', compact: false });
 *   x.update({ features: [...] });   // keeps the tab, search, expansion and selection
 *
 * It merges the field paths of the given features with WT.dataReq.$common (a
 * path shared by several features appears once and records every feature that
 * needs it) and shows them as:
 * - a WAI-ARIA tree view (roving tabindex; arrows, Home/End, *, type-ahead,
 *   Enter/Space to select) with key, type, required/optional and an example;
 * - a details pane for the selected node: path (copy), type in plain language
 *   and technically, required, description, source, example and "Needed by"
 *   links to #/tour/<id> and #/results/<id>;
 * - a search filter (key, description or source) with highlighted matches, a
 *   count and a polite announcement; expand all / collapse all;
 * - a "Sample JSON" tab (copy, download yes-statement-sample.json), a "By
 *   source" summary, and a JSON Schema (draft 2020-12) download.
 * opts.mode is the first tab: 'tree' (default) | 'sample' | 'sources'.
 * opts.compact (or mode: 'compact') is the dense layout for the tour's dialog.
 *
 * Pure helpers for other modules and tests: WT.json.merge(ids), sample(ids),
 * schema(ids), stats(ids), plainType(type). WT.json.openDialog({ features,
 * trigger }) shows the compact explorer in a standard dialog.
 */
(function (WT) {
  'use strict';

  var doc = document;
  var SAMPLE_FILE = 'yes-statement-sample.json';
  var SCHEMA_FILE = 'yes-statement-data-requirements.schema.json';
  var ENUM_RE = /^string<enum:\s*([^>]*)>$/;
  var NULLABLE_RE = /\bnull\b/;
  var LANG_NAMES = { en: 'English', es: 'Spanish' };
  var TABS = ['tree', 'sample', 'sources'];

  /* ================================================================== */
  /* Types in plain language                                             */
  /* ================================================================== */

  var PLAIN = {
    string: 'Text',
    'string<date-time>': 'Text (date and time)',
    'string<date>': 'Text (date)',
    'string<currency>': 'Text (currency code)',
    'string<uri>': 'Text (web link)',
    'string<masked>': 'Text (masked)',
    'integer<minor units>': 'Whole number (minor units)',
    integer: 'Whole number',
    number: 'Number',
    boolean: 'Yes or no',
    object: 'Group of fields',
    array: 'List'
  };
  var PLURAL = {
    string: 'text',
    'string<date-time>': 'dates and times',
    'string<date>': 'dates',
    'string<currency>': 'currency codes',
    'string<uri>': 'web links',
    'string<masked>': 'masked text',
    'integer<minor units>': 'whole numbers (minor units)',
    integer: 'whole numbers',
    number: 'numbers',
    boolean: 'yes or no values',
    object: 'records'
  };
  var HELP = {
    string: 'Plain text.',
    'string<date-time>': 'An ISO 8601 date and time with its UTC offset, such as 2026-09-01T00:00:00-04:00.',
    'string<date>': 'An ISO 8601 calendar date, YYYY-MM-DD.',
    'string<currency>': 'An upper-case currency or asset code, such as USD or USBC.',
    'string<uri>': 'A full web address, starting with https://.',
    'string<masked>': 'Text that YES masks before sending it, so only a few characters stay visible.',
    'integer<minor units>': 'A whole number in the asset’s smallest unit: 100000 means 1,000.00. Never a decimal.',
    integer: 'A whole number, such as a count. Never a decimal.',
    number: 'A number.',
    boolean: 'true or false.',
    enum: 'Exactly one of the allowed values below.'
  };

  function enumValues(type) {
    var m = ENUM_RE.exec(String(type || ''));
    return m
      ? m[1]
          .split('|')
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean)
      : null;
  }
  /** 'string<date-time>' → 'Text (date and time)'. */
  function plainType(type) {
    var e = enumValues(type);
    if (e) return 'Text (one of ' + e.length + ' options)';
    return PLAIN[type] || String(type || '');
  }
  function plainList(itemType) {
    var e = enumValues(itemType);
    return 'List of ' + (e ? 'text (one of ' + e.length + ' options)' : PLURAL[itemType] || itemType);
  }
  function jsonTypeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
    if (typeof v === 'boolean') return 'boolean';
    if (typeof v === 'object') return 'object';
    return 'string';
  }
  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  /* ================================================================== */
  /* Merge and tree model                                                */
  /* ================================================================== */

  /** Known feature ids that have data requirements, in tour order. */
  function scopeIds(features) {
    var list = typeof features === 'string' ? [features] : Array.isArray(features) ? features : [];
    var want = {};
    list.forEach(function (id) {
      want[id] = true;
    });
    var dr = WT.dataReq || {};
    return (WT.features || [])
      .map(function (f) {
        return f.id;
      })
      .filter(function (id) {
        return want[id] && dr[id] && Array.isArray(dr[id].fields);
      });
  }

  function featureTitle(id) {
    var f = WT.feature(id);
    return f ? f.title : id;
  }

  /** Group descriptions for the details pane and the schema. */
  var GROUP_DESC = {
    statement: 'The statement itself: its number, version, period, balances and checks.',
    'statement.period': 'The dates the statement covers.',
    'statement.controlTotals': 'YES’s own totals for the period, so InfoSlips can check its sums against them.',
    'statement.correction': 'Details of a corrected reissue.',
    customer: 'Who the statement is for.',
    'customer.contact': 'Contact details on file, masked by YES.',
    account: 'The account the statement covers.',
    'account.liveBalance': 'The balance right now, shown apart from the statement figures.',
    asset: 'The bank-issued digital dollar the statement is in.',
    'asset.fiat': 'An optional fiat-currency equivalent and the rate behind it.',
    transactions: 'Every transaction in the statement period, one record each.',
    'transactions.fees': 'The fees charged for a transaction.',
    'transactions.notes': 'Explanatory notes on a transaction.',
    'transactions.onchain': 'Verified blockchain details of an on-chain transfer.',
    content: 'Approved copy, links and media that YES manages.',
    'content.issuer': 'The issuing bank or partner behind the bank-issued digital dollar.',
    'content.education': 'Approved explanations of key terms, one record each.',
    'content.evidence': 'Verified transparency facts, one record each.',
    'content.i18n': 'Language and formatting settings for the approved copy.',
    'content.glossary': 'Approved glossary terms, one record each.',
    'content.video': 'The 60-second video: script version, poster, voiceover and captions.',
    'content.video.voiceover': 'Recorded narration, one record per language.',
    'content.video.captions': 'Caption tracks, one record per language.',
    brand: 'YES brand assets: logos, colours and font.',
    preferences: 'Choices the customer made in the YES app.',
    'preferences.accessibility': 'Accessibility choices the customer made.',
    accessibility: 'Accessibility tools and links.',
    'accessibility.userway': 'The UserWay accessibility widget.',
    support: 'Support contacts, feedback and inquiries.',
    'support.feedback': 'The “Was this statement clear?” feedback.',
    'support.inquiry': 'How customers raise an inquiry from the statement.',
    'support.cases': 'Inquiries already open on a transaction, one record each.',
    document: 'Statement-of-record settings.',
    ai: 'YES’s governed AI service and how it may be used.',
    'ai.guardrails': 'Limits the AI service runs with.'
  };

  function groupDescription(n) {
    var k = n.path.replace(/\[\]/g, '');
    if (GROUP_DESC[k]) return GROUP_DESC[k];
    var keys = n.children.map(function (c) {
      return c.key;
    });
    if (
      keys.length &&
      keys.every(function (key) {
        return LANG_NAMES[key];
      })
    ) {
      return (
        'The same text in each language: ' +
        keys
          .map(function (key) {
            return key + ' (' + LANG_NAMES[key] + ')';
          })
          .join(' and ') +
        '.'
      );
    }
    return 'A group of ' + WT.fmt.plural(n.leafCount, 'related field') + '.';
  }

  /**
   * Build the merged model: fields (deduplicated, with neededBy) and a tree of
   * nodes { key, path, kind: 'object'|'records'|'list'|'value', children, … }.
   */
  function model(features) {
    var ids = scopeIds(features);
    var dr = WT.dataReq || {};
    var byPath = {};
    var all = [];
    var seq = 0;
    var order = {};
    ids.forEach(function (id, i) {
      order[id] = i;
    });
    function take(f) {
      var m = byPath[f.path];
      if (!m) {
        m = byPath[f.path] = {
          path: String(f.path),
          type: String(f.type),
          required: !!f.required,
          example: clone(f.example),
          description: f.description || '',
          source: f.source || '',
          common: false,
          listedBy: [],
          neededBy: [],
          explicit: Infinity,
          commonAt: Infinity
        };
        all.push(m);
      }
      return m;
    }
    ids.forEach(function (id) {
      dr[id].fields.forEach(function (f) {
        var m = take(f);
        if (m.listedBy.indexOf(id) === -1) m.listedBy.push(id);
        if (m.explicit === Infinity) m.explicit = seq++;
      });
    });
    if (ids.length && dr.$common && Array.isArray(dr.$common.fields)) {
      dr.$common.fields.forEach(function (f, i) {
        var m = take(f);
        m.common = true;
        if (m.commonAt === Infinity) m.commonAt = i;
      });
    }
    all.forEach(function (m) {
      m.neededBy = m.common ? ids.slice() : m.listedBy.slice();
      m.ord = m.common ? m.commonAt : 1000 + m.explicit;
    });

    /* ---- tree ---- */
    var root = { children: [], idx: {} };
    all.forEach(function (f) {
      var segs = f.path.split('.');
      var parent = root;
      segs.forEach(function (seg, i) {
        var arr = seg.slice(-2) === '[]';
        var key = arr ? seg.slice(0, -2) : seg;
        var node = parent.idx[key];
        if (!node) {
          node = { key: key, array: arr, path: (parent.path ? parent.path + '.' : '') + seg, parent: parent === root ? null : parent, children: [], idx: {}, field: null };
          parent.idx[key] = node;
          parent.children.push(node);
        }
        if (i === segs.length - 1) node.field = f;
        parent = node;
      });
    });

    function finish(n, level) {
      n.level = level;
      n.children.forEach(function (c) {
        finish(c, level + 1);
      });
      var leaves = [];
      if (n.children.length) {
        n.kind = n.array ? 'records' : 'object';
        n.children.forEach(function (c) {
          leaves = leaves.concat(c.leaves);
        });
        n.required = n.children.some(function (c) {
          return c.required;
        });
      } else {
        var f = n.field;
        n.kind = n.array || f.type === 'array' ? 'list' : 'value';
        n.required = f.required;
        leaves = [f];
      }
      n.leaves = leaves;
      n.leafCount = leaves.length;
      n.reqCount = leaves.filter(function (f) {
        return f.required;
      }).length;
      n.ord = Math.min.apply(
        null,
        leaves.map(function (f) {
          return f.ord;
        })
      );
      n.explicitMin = Math.min.apply(
        null,
        leaves.map(function (f) {
          return f.explicit;
        })
      );
      var src = [];
      var need = {};
      leaves.forEach(function (f) {
        if (f.source && src.indexOf(f.source) === -1) src.push(f.source);
        f.neededBy.forEach(function (id) {
          need[id] = true;
        });
      });
      n.sources = src;
      n.neededBy = ids.filter(function (id) {
        return need[id];
      });
      n.common = leaves.some(function (f) {
        return f.common;
      });
      n.commonOnly = leaves.every(function (f) {
        return f.common && !f.listedBy.length;
      });
      if (n.kind === 'value') n.tech = n.field.type;
      else if (n.kind === 'list') {
        n.itemType = n.array ? n.field.type : jsonTypeOf(Array.isArray(n.field.example) ? n.field.example[0] : undefined);
        n.tech = 'array<' + n.itemType + '>';
      } else n.tech = n.kind === 'records' ? 'array<object>' : 'object';
      n.plain = n.kind === 'value' ? plainType(n.tech) : n.kind === 'list' ? plainList(n.itemType) : n.kind === 'records' ? 'List of records' : 'Group of fields';
      n.description = n.field && !n.children.length ? n.field.description : '';
    }
    root.children.forEach(function (c) {
      finish(c, 1);
    });

    // Order: inside a group, envelope fields first, then fields in the order the
    // features list them. At the top, groups holding the chosen features' own
    // fields come before groups that only hold the envelope.
    function sortTree(list, top) {
      list.forEach(function (n, i) {
        n._i = i;
        n._rank = top ? (n.explicitMin !== Infinity ? n.explicitMin : 1e6 + n.ord) : n.ord;
      });
      list.sort(function (a, b) {
        return a._rank - b._rank || a._i - b._i;
      });
      list.forEach(function (n) {
        sortTree(n.children, false);
      });
    }
    sortTree(root.children, true);

    var nodes = [];
    var fields = [];
    (function flat(list) {
      list.forEach(function (n, i) {
        n.i = nodes.length;
        n.posinset = i + 1;
        n.setsize = list.length;
        nodes.push(n);
        if (!n.children.length) fields.push(n.field);
        else n.description = groupDescription(n);
        flat(n.children);
      });
    })(root.children);

    return { features: ids, roots: root.children, nodes: nodes, fields: fields, byPath: byPath };
  }

  /* ================================================================== */
  /* Sample payload, JSON Schema, counts                                 */
  /* ================================================================== */

  function sampleOf(n) {
    if (n.kind === 'value') return clone(n.field.example);
    if (n.kind === 'list') return n.array ? [clone(n.field.example)] : clone(n.field.example);
    var o = {};
    n.children.forEach(function (c) {
      o[c.key] = sampleOf(c);
    });
    return n.kind === 'records' ? [o] : o;
  }
  function sampleFromModel(m) {
    var o = {};
    m.roots.forEach(function (n) {
      o[n.key] = sampleOf(n);
    });
    return o;
  }

  function baseSchema(type) {
    var e = enumValues(type);
    if (e) return { type: 'string', enum: e };
    switch (type) {
      case 'string<date-time>':
        return { type: 'string', format: 'date-time' };
      case 'string<date>':
        return { type: 'string', format: 'date' };
      case 'string<uri>':
        return { type: 'string', format: 'uri' };
      case 'string<currency>':
        return { type: 'string', pattern: '^[A-Z][A-Z0-9]{2,9}$' };
      case 'integer<minor units>':
      case 'integer':
        return { type: 'integer' };
      case 'number':
        return { type: 'number' };
      case 'boolean':
        return { type: 'boolean' };
      case 'object':
        return { type: 'object' };
      default:
        return { type: 'string' };
    }
  }

  function neededComment(n) {
    var src = n.sources.length ? 'Source: ' + n.sources.join(', ') + '.' : '';
    if (n.children.length) return src;
    var who = n.commonOnly
      ? 'Needed by every feature (statement envelope).'
      : 'Needed by: ' + n.neededBy.map(featureTitle).join(', ') + '.';
    return (src + ' ' + who).trim();
  }

  function nodeSchema(n) {
    var s;
    if (n.kind === 'value') {
      s = baseSchema(n.field.type);
      if (NULLABLE_RE.test(n.field.description)) s.type = [s.type, 'null'];
      s.description = n.field.description;
      s.examples = [clone(n.field.example)];
    } else if (n.kind === 'list') {
      var items = n.array ? baseSchema(n.field.type) : { type: n.itemType };
      s = { type: 'array', items: items, description: n.field.description, examples: [sampleOf(n)] };
    } else {
      var obj = { type: 'object', required: [], properties: {} };
      n.children.forEach(function (c) {
        obj.properties[c.key] = nodeSchema(c);
        if (c.required) obj.required.push(c.key);
      });
      if (n.kind === 'records') {
        s = { type: 'array', description: n.description, items: obj };
      } else {
        s = { type: 'object', description: n.description, required: obj.required, properties: obj.properties };
      }
    }
    var c = neededComment(n);
    if (c) s.$comment = c;
    return s;
  }

  function schemaFromModel(m) {
    var dr = WT.dataReq || {};
    var root = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'urn:infoslips:yes-statement:data-requirements',
      title: 'YES statement data requirements',
      description:
        'The data YES supplies to InfoSlips for these statement features: ' +
        m.features.map(featureTitle).join(', ') +
        '. It includes the statement envelope every feature needs. Examples are fictional.',
      type: 'object',
      required: [],
      properties: {}
    };
    var notes = (dr.$common && dr.$common.notes) || [];
    if (notes.length) root.$comment = notes.join(' ');
    m.roots.forEach(function (n) {
      root.properties[n.key] = nodeSchema(n);
      if (n.required) root.required.push(n.key);
    });
    return root;
  }

  function statsFromModel(m) {
    var by = {};
    var list = [];
    var req = 0;
    m.fields.forEach(function (f) {
      if (f.required) req++;
      var s = f.source || 'Other';
      if (!by[s]) {
        by[s] = { source: s, fields: 0, required: 0, optional: 0 };
        list.push(by[s]);
      }
      by[s].fields++;
      if (f.required) by[s].required++;
      else by[s].optional++;
    });
    list.sort(function (a, b) {
      return b.fields - a.fields || (a.source < b.source ? -1 : 1);
    });
    return { fields: m.fields.length, required: req, optional: m.fields.length - req, sources: list };
  }

  function publicField(f) {
    return {
      path: f.path,
      type: f.type,
      required: f.required,
      example: clone(f.example),
      description: f.description,
      source: f.source,
      common: f.common,
      neededBy: f.neededBy.slice(),
      listedBy: f.listedBy.slice()
    };
  }

  /* ================================================================== */
  /* HTML helpers                                                        */
  /* ================================================================== */

  var esc = WT.esc;

  /** Escape text and wrap every case-insensitive occurrence of q in <mark>. */
  function mark(text, q) {
    text = String(text);
    if (!q) return esc(text);
    var lower = text.toLowerCase();
    var out = '';
    var at = 0;
    var i = lower.indexOf(q);
    while (i !== -1) {
      out += esc(text.slice(at, i)) + '<mark class="wt-jx__mark">' + esc(text.slice(i, i + q.length)) + '</mark>';
      at = i + q.length;
      i = lower.indexOf(q, at);
    }
    return out + esc(text.slice(at));
  }

  /** A short excerpt of text around the first match of q, with the match marked. */
  function excerpt(text, q, room) {
    room = room || 44;
    var i = text.toLowerCase().indexOf(q);
    if (i === -1) return esc(text);
    var start = Math.max(0, i - room);
    var end = Math.min(text.length, i + q.length + room);
    if (start > 0) {
      var sp = text.indexOf(' ', start);
      if (sp !== -1 && sp < i) start = sp + 1;
    }
    return (start > 0 ? '…' : '') + mark(text.slice(start, end), q) + (end < text.length ? '…' : '');
  }

  /** JSON.stringify(v, null, 2) as highlighted HTML (its text is exactly that string). */
  function jsonHtml(v) {
    function p(s) {
      return '<span class="wt-jx__p">' + esc(s) + '</span>';
    }
    function ind(d) {
      return new Array(d + 1).join('  ');
    }
    function ser(x, d) {
      if (x === null) return '<span class="wt-jx__b">null</span>';
      if (Array.isArray(x)) {
        if (!x.length) return p('[]');
        return (
          p('[') +
          '\n' +
          x
            .map(function (y, i) {
              return ind(d + 1) + ser(y, d + 1) + (i < x.length - 1 ? p(',') : '');
            })
            .join('\n') +
          '\n' +
          ind(d) +
          p(']')
        );
      }
      if (typeof x === 'object') {
        var keys = Object.keys(x);
        if (!keys.length) return p('{}');
        return (
          p('{') +
          '\n' +
          keys
            .map(function (k, i) {
              return ind(d + 1) + '<span class="wt-jx__k">' + esc(JSON.stringify(k)) + '</span>' + p(':') + ' ' + ser(x[k], d + 1) + (i < keys.length - 1 ? p(',') : '');
            })
            .join('\n') +
          '\n' +
          ind(d) +
          p('}')
        );
      }
      if (typeof x === 'string') return '<span class="wt-jx__s">' + esc(JSON.stringify(x)) + '</span>';
      if (typeof x === 'number') return '<span class="wt-jx__n">' + esc(JSON.stringify(x)) + '</span>';
      if (typeof x === 'boolean') return '<span class="wt-jx__b">' + String(x) + '</span>';
      return esc(JSON.stringify(x));
    }
    return ser(v, 0);
  }

  /** One-line preview of an example value. */
  function preview(n) {
    if (n.kind === 'object') return '{ ' + WT.fmt.plural(n.leafCount, 'field') + ' }';
    if (n.kind === 'records') return '[ { ' + WT.fmt.plural(n.leafCount, 'field') + ' } ]';
    var s = JSON.stringify(sampleOf(n));
    if (n.kind === 'list') s = s.replace(/","/g, '", "');
    return s;
  }

  function reqBadge(required, big) {
    return (
      '<span class="wt-jx__req wt-jx__req--' + (required ? 'yes' : 'no') + (big ? ' wt-jx__req--lg' : '') + '">' +
      (required ? 'Required' : 'Optional') +
      '</span>'
    );
  }

  function typeBadge(n) {
    return '<span class="wt-jx__type" title="' + esc(n.tech) + '">' + esc(n.plain) + '</span>';
  }

  /* ================================================================== */
  /* Explorer instance                                                   */
  /* ================================================================== */

  function normalise(opts, prev, el) {
    opts = opts || {};
    prev = prev || {};
    var o = {};
    o.features = opts.features !== undefined ? opts.features : prev.features || [];
    var mode = opts.mode !== undefined ? opts.mode : prev.mode;
    // Compact by default inside a dialog (the tour's "View data requirements").
    var inDialog = !!(el && el.closest && el.closest('dialog, .wt-dialog'));
    o.compact = opts.compact !== undefined ? !!opts.compact : mode === 'compact' ? true : prev.compact !== undefined ? !!prev.compact : inDialog;
    o.mode = TABS.indexOf(mode) !== -1 ? mode : 'tree';
    o.headingLevel = Math.min(5, Math.max(2, Number(opts.headingLevel || prev.headingLevel || 3)));
    o.label = opts.label || prev.label || 'Data fields';
    return o;
  }

  function Explorer(el, opts) {
    this.el = el;
    this.uid = WT.uid('jx');
    this.opts = {};
    this.key = null;
    this.m = null;
    this.st = { tab: null, query: '', expanded: {}, selected: '', active: '' };
    this.typed = '';
    this.typedTimer = null;
    this.announceSearch = WT.debounce(this._announceSearch.bind(this), 700);
    this.runSearch = WT.debounce(this._runSearch.bind(this), 120);
    this._bind();
    this.update(opts);
  }

  Explorer.prototype.update = function (opts) {
    if (this.destroyed) return this;
    var o = normalise(opts, this.opts, this.el);
    var ids = scopeIds(o.features);
    var key = ids.join(',') + '|' + (o.compact ? 'c' : 'f') + '|' + o.headingLevel;
    var first = !this.m;
    this.opts = o;
    if (first || this.st.tab === null) this.st.tab = o.mode;
    if (!first && key === this.key) return this;
    var featuresChanged = first || this.m.features.join(',') !== ids.join(',');
    this.key = key;
    this.m = model(ids);
    if (featuresChanged) this.st.expanded = this._defaultExpanded();
    if (this.st.selected && !this._byPath(this.st.selected)) this.st.selected = '';
    if (this.st.active && !this._byPath(this.st.active)) this.st.active = '';
    this.render();
    return this;
  };

  Explorer.prototype._defaultExpanded = function () {
    var ex = {};
    var all = this.m.nodes.length <= 80;
    this.m.nodes.forEach(function (n) {
      if (n.children.length && (all || n.level === 1)) ex[n.path] = true;
    });
    return ex;
  };

  Explorer.prototype._byPath = function (path) {
    var m = this.m;
    for (var i = 0; i < m.nodes.length; i++) if (m.nodes[i].path === path) return m.nodes[i];
    return null;
  };

  /* ---------------- rendering ---------------- */

  Explorer.prototype.render = function () {
    var m = this.m;
    var o = this.opts;
    var P = this.uid;
    var had = this.el.contains(doc.activeElement);
    var hadTree = had && doc.activeElement.getAttribute('role') === 'treeitem';
    if (!m.features.length) {
      WT.render(
        this.el,
        '<div class="wt-jx wt-jx--empty' + (o.compact ? ' wt-jx--compact' : '') + '">' +
          '<p class="wt-jx__empty">' + WT.icon('braces') + '<span>No features are selected, so there is no data to show.</span></p>' +
        '</div>'
      );
      this.root = this.tree = this.details = this.count = this.nomatch = null;
      return;
    }
    var stats = statsFromModel(m);
    var tab = this.st.tab;
    var tabBtn = function (id, label, icon) {
      var on = tab === id;
      return (
        '<button class="wt-tab" type="button" role="tab" id="' + P + '-tab-' + id + '" aria-controls="' + P + '-panel-' + id + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-jx-tab="' + id + '" data-fk="' + P + '-tab-' + id + '">' +
          WT.icon(icon, { size: 18 }) + '<span>' + esc(label) + '</span>' +
        '</button>'
      );
    };
    var html =
      '<div class="wt-jx' + (o.compact ? ' wt-jx--compact' : '') + '" data-jx="' + P + '">' +
        '<div class="wt-jx__head">' +
          '<dl class="wt-jx__stats">' +
            this._stat('Fields', stats.fields, 'fields') +
            this._stat('Required', stats.required, 'required') +
            this._stat('Optional', stats.optional, 'optional') +
            this._stat('Source systems', stats.sources.length, 'sources') +
          '</dl>' +
          '<button class="wt-btn wt-btn--secondary wt-btn--sm wt-jx__schema" type="button" data-jx-act="schema" data-fk="' + P + '-schema">' +
            WT.icon('download', { size: 18 }) + '<span>Download JSON Schema</span>' +
          '</button>' +
        '</div>' +
        '<div class="wt-tabs wt-jx__tabs" role="tablist" aria-label="Ways to view the data requirements">' +
          tabBtn('tree', 'Fields', 'list') + tabBtn('sample', 'Sample JSON', 'braces') + tabBtn('sources', 'By source', 'layers') +
        '</div>' +
        this._treePanel(tab === 'tree') +
        this._samplePanel(tab === 'sample') +
        this._sourcesPanel(tab === 'sources', stats) +
      '</div>';
    WT.render(this.el, html);
    this.root = this.el.firstElementChild;
    this.tree = this.root.querySelector('[role="tree"]');
    this.details = this.root.querySelector('.wt-jx__details');
    this.count = this.root.querySelector('.wt-jx__count');
    this.nomatch = this.root.querySelector('.wt-jx__nomatch');
    var items = WT.$$('[role="treeitem"]', this.tree);
    m.nodes.forEach(function (n, i) {
      n.el = items[i];
      n.row = items[i].firstElementChild;
      n.labelEl = n.row.querySelector('.wt-jx__label');
      n.groupEl = n.children.length ? items[i].lastElementChild : null;
    });
    WT.ui.tabs(this.root.querySelector('[role="tablist"]'), this._onTab.bind(this));
    this._applyQuery();
    this._apply();
    this._renderDetails();
    this._paintBars();
    if (hadTree) {
      var a = this._activeNode();
      if (a && doc.activeElement !== a.el && !this.el.contains(doc.activeElement)) a.el.focus({ preventScroll: true });
    } else if (had && !this.el.contains(doc.activeElement)) {
      var t = this.root.querySelector('[role="tab"][aria-selected="true"]');
      if (t) t.focus({ preventScroll: true });
    }
  };

  Explorer.prototype._stat = function (label, n, kind) {
    return '<div class="wt-jx__stat wt-jx__stat--' + kind + '"><dt>' + esc(label) + '</dt><dd class="wt-num">' + esc(WT.fmt.num(n)) + '</dd></div>';
  };

  Explorer.prototype._treePanel = function (on) {
    var P = this.uid;
    return (
      '<div class="wt-tabpanel wt-jx__panel" role="tabpanel" id="' + P + '-panel-tree" aria-labelledby="' + P + '-tab-tree"' + (on ? '' : ' hidden') + '>' +
        '<div class="wt-jx__toolbar">' +
          '<div class="wt-jx__search">' +
            '<label class="wt-sr-only" for="' + P + '-q">Search fields</label>' +
            WT.icon('search', { size: 18, cls: 'wt-jx__search-icon' }) +
            '<input class="wt-input wt-jx__q" id="' + P + '-q" type="search" autocomplete="off" spellcheck="false" placeholder="Search name, description, source" aria-describedby="' + P + '-count" data-fk="' + P + '-q" value="' + esc(this.st.query) + '" />' +
          '</div>' +
          '<div class="wt-jx__tools">' +
            '<button class="wt-btn wt-btn--ghost wt-btn--sm" type="button" data-jx-act="expand" data-fk="' + P + '-expand">' + WT.icon('expand', { size: 18 }) + '<span>Expand all</span></button>' +
            '<button class="wt-btn wt-btn--ghost wt-btn--sm" type="button" data-jx-act="collapse" data-fk="' + P + '-collapse">' + WT.icon('collapse', { size: 18 }) + '<span>Collapse all</span></button>' +
          '</div>' +
          '<p class="wt-jx__count" id="' + P + '-count"></p>' +
        '</div>' +
        '<div class="wt-jx__body">' +
          '<div class="wt-jx__treewrap">' +
            '<ul class="wt-jx__tree" role="tree" aria-label="' + esc(this.opts.label) + '" aria-describedby="' + P + '-keys">' + this._nodesHtml(this.m.roots) + '</ul>' +
            '<div class="wt-jx__nomatch" hidden></div>' +
            '<p class="wt-sr-only" id="' + P + '-keys">Use the arrow keys to move and to open or close groups, Enter to show details, and type a letter to jump to a field.</p>' +
          '</div>' +
          '<section class="wt-jx__details" aria-label="Field details" data-fk="' + P + '-details"></section>' +
        '</div>' +
      '</div>'
    );
  };

  Explorer.prototype._nodesHtml = function (list) {
    var self = this;
    var P = this.uid;
    return list
      .map(function (n) {
        var group = n.children.length > 0;
        var id = P + '-n' + n.i;
        return (
          '<li class="wt-jx__item' + (group ? ' wt-jx__item--group' : '') + '" role="treeitem" id="' + id + '" aria-level="' + n.level + '" aria-setsize="' + n.setsize + '" aria-posinset="' + n.posinset + '"' +
            (group ? ' aria-expanded="false"' : '') + ' aria-selected="false" tabindex="-1" aria-labelledby="' + id + '-l" data-fk="' + esc(P + ':' + n.path) + '" data-i="' + n.i + '">' +
            '<div class="wt-jx__row">' +
              '<span class="wt-jx__twisty" aria-hidden="true">' + (group ? WT.icon('chevron-right', { size: 16 }) : '') + '</span>' +
              '<span class="wt-jx__label" id="' + id + '-l">' + self._labelInner(n, '') + '</span>' +
            '</div>' +
            (group ? '<ul class="wt-jx__group" role="group">' + self._nodesHtml(n.children) + '</ul>' : '') +
          '</li>'
        );
      })
      .join('');
  };

  Explorer.prototype._labelInner = function (n, q) {
    var sep = '<span class="wt-sr-only">, </span>';
    var snip = '';
    if (q && n.match && !n.mKey) {
      snip = n.mDesc
        ? '<span class="wt-jx__snip"><span class="wt-jx__snip-k">Description:</span> ' + excerpt(n.description, q) + '</span>'
        : '<span class="wt-jx__snip"><span class="wt-jx__snip-k">Source:</span> ' + mark(n.field ? n.field.source : '', q) + '</span>';
      snip = sep + snip;
    }
    return (
      '<span class="wt-jx__key">' + mark(n.key, q) + (n.array ? '<span class="wt-jx__brackets">[]</span>' : '') + '</span>' +
      sep + '<span class="wt-jx__meta">' + typeBadge(n) + sep + reqBadge(n.required) + '</span>' +
      sep + '<span class="wt-jx__ex"><span class="wt-sr-only">' + (n.children.length ? 'contains ' : 'example ') + '</span>' + esc(preview(n)) + '</span>' +
      snip
    );
  };

  Explorer.prototype._samplePanel = function (on) {
    var P = this.uid;
    var sample = sampleFromModel(this.m);
    return (
      '<div class="wt-tabpanel wt-jx__panel" role="tabpanel" id="' + P + '-panel-sample" aria-labelledby="' + P + '-tab-sample"' + (on ? '' : ' hidden') + '>' +
        '<div class="wt-jx__sample-head">' +
          '<p class="wt-jx__note">' + WT.icon('info', { size: 18 }) + '<span>A sample payload built from the fictional examples. Each list shows one item.</span></p>' +
          '<div class="wt-jx__sample-actions">' +
            '<button class="wt-btn wt-btn--secondary wt-btn--sm" type="button" data-jx-act="copy-json" data-fk="' + P + '-copy-json">' + WT.icon('copy', { size: 18 }) + '<span>Copy JSON</span></button>' +
            '<button class="wt-btn wt-btn--secondary wt-btn--sm" type="button" data-jx-act="download-sample" data-fk="' + P + '-dl-sample">' + WT.icon('download', { size: 18 }) + '<span>Download sample</span></button>' +
          '</div>' +
        '</div>' +
        '<pre class="wt-jx__code wt-jx__sample" tabindex="0" role="region" aria-label="Sample JSON payload" data-fk="' + P + '-sample"><code>' + jsonHtml(sample) + '</code></pre>' +
      '</div>'
    );
  };

  Explorer.prototype._sourcesPanel = function (on, stats) {
    var P = this.uid;
    var max = stats.sources.reduce(function (a, s) {
      return Math.max(a, s.fields);
    }, 1);
    var rows = stats.sources
      .map(function (s) {
        return (
          '<tr>' +
            '<th scope="row">' + esc(s.source) + '</th>' +
            '<td class="is-num"><span class="wt-jx__barcell"><span class="wt-jx__bar" aria-hidden="true" data-w="' + (s.fields / max).toFixed(4) + '"></span><span>' + s.fields + '</span></span></td>' +
            '<td class="is-num">' + s.required + '</td>' +
            '<td class="is-num">' + s.optional + '</td>' +
          '</tr>'
        );
      })
      .join('');
    var table =
      '<table class="wt-table wt-table--compact wt-jx__srctable">' +
        '<caption class="wt-sr-only">Fields by source system</caption>' +
        '<thead><tr><th scope="col">Source system</th><th scope="col" class="is-num">Fields</th><th scope="col" class="is-num">Required</th><th scope="col" class="is-num">Optional</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '<tfoot><tr><th scope="row">All sources</th><td class="is-num">' + stats.fields + '</td><td class="is-num">' + stats.required + '</td><td class="is-num">' + stats.optional + '</td></tr></tfoot>' +
      '</table>';
    return (
      '<div class="wt-tabpanel wt-jx__panel" role="tabpanel" id="' + P + '-panel-sources" aria-labelledby="' + P + '-tab-sources"' + (on ? '' : ' hidden') + '>' +
        '<p class="wt-jx__note">' + WT.icon('info', { size: 18 }) + '<span>Where YES would get each field. <strong>Required</strong> fields must always be sent for these features; <strong>optional</strong> ones are used when YES has them.</span></p>' +
        WT.ui.tableWrap(table, 'Fields by source system', 'wt-jx__srcwrap') +
      '</div>'
    );
  };

  Explorer.prototype._paintBars = function () {
    if (!this.root) return;
    WT.$$('.wt-jx__bar[data-w]', this.root).forEach(function (b) {
      b.style.setProperty('--w', Math.max(0.02, Number(b.getAttribute('data-w'))).toString());
    });
  };

  /* ---------------- details pane ---------------- */

  Explorer.prototype._renderDetails = function () {
    if (!this.details) return;
    var n = this.st.selected ? this._byPath(this.st.selected) : null;
    WT.render(this.details, n ? this._detailsHtml(n) : this._introHtml());
  };

  Explorer.prototype._introHtml = function () {
    var H = this.opts.headingLevel;
    return (
      '<div class="wt-jx__intro">' +
        '<span class="wt-jx__intro-icon" aria-hidden="true">' + WT.icon('braces', { size: 22 }) + '</span>' +
        '<h' + H + ' class="wt-jx__dtitle wt-jx__dtitle--intro">Select a field</h' + H + '>' +
        '<p>Choose any field to see what it means, where YES would get it and which features need it.</p>' +
        '<ul class="wt-jx__legend">' +
          '<li>' + reqBadge(true) + '<span>YES must always send it for these features.</span></li>' +
          '<li>' + reqBadge(false) + '<span>Used when YES has it.</span></li>' +
          '<li><span class="wt-jx__type">Text (date and time)</span><span>The kind of value, in plain words. The technical type is in the details.</span></li>' +
        '</ul>' +
        '<p class="wt-jx__kbd-help"><kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>←</kbd> <kbd>→</kbd> close or open · <kbd>Enter</kbd> details · type a letter to jump</p>' +
      '</div>'
    );
  };

  Explorer.prototype._featureLinks = function (ids) {
    return (
      '<ul class="wt-jx__nb" role="list">' +
      ids
        .map(function (id) {
          var t = featureTitle(id);
          var e = encodeURIComponent(id);
          return (
            '<li class="wt-jx__nb-item">' +
              '<span class="wt-jx__nb-title">' + esc(t) + '</span>' +
              '<span class="wt-jx__nb-links">' +
                '<a href="#/tour/' + e + '">Walkthrough<span class="wt-sr-only">: ' + esc(t) + '</span></a>' +
                '<a href="#/results/' + e + '">Results<span class="wt-sr-only">: ' + esc(t) + '</span></a>' +
              '</span>' +
            '</li>'
          );
        })
        .join('') +
      '</ul>'
    );
  };

  Explorer.prototype._detailsHtml = function (n) {
    var H = this.opts.headingLevel;
    var P = this.uid;
    var group = n.children.length > 0;
    var kind = n.kind === 'value' ? 'Field' : n.kind === 'list' ? 'List field' : n.kind === 'records' ? 'List of records' : 'Group';
    var e = enumValues(n.tech);
    var rows = [];
    var typeHelp = group
      ? n.kind === 'records'
        ? 'A list: YES sends one record like this for each item.'
        : 'A group that holds the fields inside it.'
      : n.kind === 'list'
        ? 'A list of values. ' + (HELP[enumValues(n.itemType) ? 'enum' : n.itemType] || '')
        : HELP[e ? 'enum' : n.tech] || '';
    rows.push(
      ['Type',
        '<span class="wt-jx__plain">' + esc(n.plain) + '</span> <code class="wt-jx__tech">' + esc(n.tech) + '</code>' +
        (typeHelp ? '<span class="wt-jx__help">' + esc(typeHelp.trim()) + '</span>' : '')]
    );
    rows.push(
      ['Required?',
        reqBadge(n.required, true) +
        '<span class="wt-jx__help">' +
          esc(group
            ? n.required ? 'It holds ' + WT.fmt.plural(n.reqCount, 'required field') + '.' : 'Every field inside it is optional.'
            : n.required ? 'YES must always send it for these features.' : 'The feature works without it, or uses it only when YES has it.') +
        '</span>']
    );
    if (group) {
      rows.push(['Contains', esc(WT.fmt.plural(n.leafCount, 'field')) + ' <span class="wt-jx__help">' + esc(n.reqCount + ' required, ' + (n.leafCount - n.reqCount) + ' optional') + '</span>']);
    }
    rows.push([n.sources.length > 1 ? 'Source systems' : 'Source system', n.sources.map(function (s) {
      return '<span class="wt-jx__src">' + esc(s) + '</span>';
    }).join(' ')]);
    if (e) {
      rows.push(['Allowed values', '<span class="wt-jx__enum">' + e.map(function (v) {
        return '<code>' + esc(v) + '</code>';
      }).join(' ') + '</span>']);
    }
    var sample = sampleOf(n);
    rows.push([group ? 'Example' : 'Example', '<pre class="wt-jx__code wt-jx__code--sm" tabindex="0" role="region" aria-label="Example value"><code>' + jsonHtml(sample) + '</code></pre>']);

    var need;
    if (n.commonOnly || (n.common && !group && !n.field.listedBy.length)) {
      need =
        '<p class="wt-jx__common">' + WT.icon('layers', { size: 18 }) + '<span>Every feature needs this: it’s part of the statement envelope.</span></p>' +
        (n.neededBy.length > 4
          ? '<details class="wt-details wt-jx__more"><summary>Show all ' + n.neededBy.length + ' features</summary>' + this._featureLinks(n.neededBy) + '</details>'
          : this._featureLinks(n.neededBy));
    } else if (n.neededBy.length > 6) {
      need = this._featureLinks(n.neededBy.slice(0, 5)) +
        '<details class="wt-details wt-jx__more"><summary>Show ' + (n.neededBy.length - 5) + ' more</summary>' + this._featureLinks(n.neededBy.slice(5)) + '</details>';
    } else {
      need = this._featureLinks(n.neededBy);
    }

    return (
      '<p class="wt-jx__eyebrow">' + esc(kind) + '</p>' +
      '<h' + H + ' class="wt-jx__dtitle"><code>' + esc(n.key) + (n.array ? '[]' : '') + '</code></h' + H + '>' +
      (n.description ? '<p class="wt-jx__ddesc">' + esc(n.description) + '</p>' : '') +
      '<div class="wt-jx__path">' +
        '<span class="wt-jx__path-label" id="' + P + '-path-l">Full path</span>' +
        '<div class="wt-jx__path-row">' +
          '<code class="wt-jx__path-code" id="' + P + '-path">' + esc(n.path) + '</code>' +
          '<button class="wt-btn wt-btn--secondary wt-btn--sm" type="button" data-jx-act="copy-path" data-fk="' + P + '-copy-path">' + WT.icon('copy', { size: 18 }) + '<span>Copy path</span></button>' +
        '</div>' +
      '</div>' +
      '<dl class="wt-jx__dl">' +
        rows.map(function (r) {
          return '<div class="wt-jx__dl-row"><dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd></div>';
        }).join('') +
      '</dl>' +
      '<h' + (H + 1) + ' class="wt-jx__nb-h">Needed by <span class="wt-jx__nb-n">' + n.neededBy.length + '</span></h' + (H + 1) + '>' +
      need
    );
  };

  /* ---------------- state → DOM ---------------- */

  Explorer.prototype._applyQuery = function () {
    var q = this.st.query.trim().toLowerCase();
    var self = this;
    var nodes = this.m.nodes;
    var count = 0;
    nodes.forEach(function (n) {
      n.mKey = !!q && n.key.toLowerCase().indexOf(q) !== -1;
      n.mDesc = !!q && n.description.toLowerCase().indexOf(q) !== -1;
      n.mSrc = !!q && !n.children.length && n.field.source.toLowerCase().indexOf(q) !== -1;
      n.match = n.mKey || n.mDesc || n.mSrc;
      if (n.match) count++;
      n.descMatch = false;
    });
    for (var i = nodes.length - 1; i >= 0; i--) {
      var n = nodes[i];
      if ((n.match || n.descMatch) && n.parent) n.parent.descMatch = true;
    }
    nodes.forEach(function (n) {
      n.ancMatch = !!(n.parent && (n.parent.match || n.parent.ancMatch));
      n.shownByFilter = !q || n.match || n.descMatch || n.ancMatch;
      if (q && n.descMatch) self.st.expanded[n.path] = true;
      if (n.labelEl && (q || n._marked)) {
        n.labelEl.innerHTML = self._labelInner(n, q);
        n._marked = !!q;
      }
    });
    this.matches = count;
    this.q = q;
  };

  Explorer.prototype._shown = function (n) {
    for (var p = n; p; p = p.parent) {
      if (!p.shownByFilter) return false;
      if (p !== n && !this.st.expanded[p.path]) return false;
    }
    return true;
  };

  Explorer.prototype._shownNodes = function () {
    var self = this;
    return this.m.nodes.filter(function (n) {
      return self._shown(n);
    });
  };

  Explorer.prototype._activeNode = function () {
    var a = this.st.active ? this._byPath(this.st.active) : null;
    if (a && this._shown(a)) return a;
    var sel = this.st.selected ? this._byPath(this.st.selected) : null;
    if (sel && this._shown(sel)) return sel;
    var list = this._shownNodes();
    return list[0] || null;
  };

  Explorer.prototype._apply = function () {
    var st = this.st;
    var m = this.m;
    if (!this.tree) return;
    m.nodes.forEach(function (n) {
      n.el.hidden = !n.shownByFilter;
      if (n.groupEl) {
        var open = !!st.expanded[n.path];
        n.el.setAttribute('aria-expanded', open ? 'true' : 'false');
        n.groupEl.hidden = !open;
      }
      n.el.setAttribute('aria-selected', n.path === st.selected ? 'true' : 'false');
    });
    // Position among the siblings that are shown.
    var fix = function (list) {
      var vis = list.filter(function (n) {
        return n.shownByFilter;
      });
      vis.forEach(function (n, i) {
        n.el.setAttribute('aria-setsize', String(vis.length));
        n.el.setAttribute('aria-posinset', String(i + 1));
      });
      list.forEach(function (n) {
        if (n.children.length) fix(n.children);
      });
    };
    fix(m.roots);
    var active = this._activeNode();
    st.active = active ? active.path : '';
    m.nodes.forEach(function (n) {
      n.el.tabIndex = n === active ? 0 : -1;
    });
    // Count and "no matches".
    if (this.count) {
      this.count.textContent = this.q
        ? this.matches
          ? WT.fmt.plural(this.matches, 'match', 'matches') + ' for “' + this.st.query.trim() + '”'
          : 'No matches for “' + this.st.query.trim() + '”'
        : WT.fmt.plural(m.fields.length, 'field') + ' in ' + WT.fmt.plural(m.roots.length, 'group');
      this.count.setAttribute('data-state', this.q ? (this.matches ? 'match' : 'none') : '');
    }
    if (this.nomatch) {
      var none = !!this.q && !this.matches;
      this.nomatch.hidden = !none;
      this.tree.hidden = none;
      if (none) {
        WT.render(
          this.nomatch,
          '<p>' + WT.icon('search', { size: 20 }) + '<span>No field names, descriptions or sources match “' + esc(this.st.query.trim()) + '”.</span></p>' +
          '<button class="wt-btn wt-btn--secondary wt-btn--sm" type="button" data-jx-act="clear" data-fk="' + this.uid + '-clear">Clear the search</button>'
        );
      }
    }
  };

  /* ---------------- actions ---------------- */

  Explorer.prototype.select = function (path, how) {
    var n = this._byPath(path);
    if (!n) return;
    this.st.selected = n.path;
    this.st.active = n.path;
    this._apply();
    this._renderDetails();
    if (how === 'keyboard') WT.announce('Details shown for ' + n.path);
  };

  Explorer.prototype.toggle = function (n, open) {
    if (!n || !n.children.length) return;
    this.st.expanded[n.path] = open === undefined ? !this.st.expanded[n.path] : !!open;
    this._apply();
  };

  Explorer.prototype.expandAll = function () {
    var ex = this.st.expanded;
    this.m.nodes.forEach(function (n) {
      if (n.children.length) ex[n.path] = true;
    });
    this._apply();
    WT.announce('All groups expanded');
  };

  Explorer.prototype.collapseAll = function () {
    this.st.expanded = {};
    this._apply();
    WT.announce('All groups collapsed');
  };

  Explorer.prototype.search = function (q) {
    this.st.query = String(q || '');
    var input = this.root && this.root.querySelector('.wt-jx__q');
    if (input && input.value !== this.st.query) input.value = this.st.query;
    this._runSearch();
  };

  Explorer.prototype._runSearch = function () {
    if (!this.tree) return;
    this._applyQuery();
    this._apply();
    this.announceSearch();
  };

  Explorer.prototype._announceSearch = function () {
    if (!this.root || !this.root.isConnected) return;
    var q = this.st.query.trim();
    if (!q) WT.announce('Search cleared. Showing all ' + WT.fmt.plural(this.m.fields.length, 'field') + '.');
    else if (this.matches) WT.announce(WT.fmt.plural(this.matches, 'match', 'matches') + ' for ' + q);
    else WT.announce('No fields match ' + q);
  };

  Explorer.prototype.focusNode = function (n) {
    if (!n) return;
    this.st.active = n.path;
    this.m.nodes.forEach(function (x) {
      x.el.tabIndex = x === n ? 0 : -1;
    });
    n.el.focus({ preventScroll: true });
    try {
      n.row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch (e) {
      n.row.scrollIntoView(false);
    }
  };

  Explorer.prototype.sample = function () {
    return sampleFromModel(this.m);
  };
  Explorer.prototype.schema = function () {
    return schemaFromModel(this.m);
  };

  Explorer.prototype._onTab = function (tab) {
    this.st.tab = tab.getAttribute('data-jx-tab');
  };

  Explorer.prototype._flash = function (btn, text) {
    if (!btn) return;
    var span = btn.querySelector('span');
    if (!span) return;
    if (!btn._label) btn._label = span.textContent;
    span.textContent = text;
    btn.classList.add('is-done');
    clearTimeout(btn._flash);
    btn._flash = setTimeout(function () {
      span.textContent = btn._label;
      btn.classList.remove('is-done');
    }, 2000);
  };

  Explorer.prototype._act = function (act, btn) {
    var self = this;
    if (act === 'expand') return this.expandAll();
    if (act === 'collapse') return this.collapseAll();
    if (act === 'clear') {
      this.search('');
      var input = this.root.querySelector('.wt-jx__q');
      if (input) input.focus();
      return;
    }
    if (act === 'copy-path') {
      var path = this.st.selected;
      return WT.copy(path).then(function (ok) {
        if (ok) self._flash(btn, 'Copied');
        WT.toast(ok ? 'Path copied: ' + path : 'We couldn’t copy the path. Select it and copy it yourself.', { kind: ok ? 'success' : 'error' });
      });
    }
    if (act === 'copy-json') {
      return WT.copy(JSON.stringify(this.sample(), null, 2)).then(function (ok) {
        if (ok) self._flash(btn, 'Copied');
        WT.toast(ok ? 'Sample JSON copied' : 'We couldn’t copy the JSON. Download it instead.', { kind: ok ? 'success' : 'error' });
      });
    }
    if (act === 'download-sample') {
      WT.download(SAMPLE_FILE, JSON.stringify(this.sample(), null, 2) + '\n', 'application/json');
      WT.toast('Downloading ' + SAMPLE_FILE, { kind: 'success' });
      return;
    }
    if (act === 'schema') {
      WT.download(SCHEMA_FILE, JSON.stringify(this.schema(), null, 2) + '\n', 'application/schema+json');
      WT.toast('Downloading ' + SCHEMA_FILE, { kind: 'success' });
    }
  };

  /* ---------------- events ---------------- */

  Explorer.prototype._node = function (el) {
    var item = el && el.closest ? el.closest('[role="treeitem"]') : null;
    if (!item || !this.tree || !this.tree.contains(item)) return null;
    return this.m.nodes[Number(item.getAttribute('data-i'))] || null;
  };

  /** Remove listeners and timers and empty the element. */
  Explorer.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    var el = this.el;
    (this._handlers || []).forEach(function (h) {
      el.removeEventListener(h[0], h[1]);
    });
    this._handlers = [];
    this.announceSearch.cancel();
    this.runSearch.cancel();
    clearTimeout(this.typedTimer);
    if (el._wtJson === this) delete el._wtJson;
    el.innerHTML = '';
    this.root = this.tree = this.details = this.count = this.nomatch = null;
  };

  Explorer.prototype._bind = function () {
    var self = this;
    var el = this.el;
    this._handlers = [];
    var on = function (type, fn) {
      self._handlers.push([type, fn]);
      el.addEventListener(type, fn);
    };
    on('click', function (e) {
      var btn = e.target.closest('[data-jx-act]');
      if (btn && el.contains(btn)) {
        self._act(btn.getAttribute('data-jx-act'), btn);
        return;
      }
      var link = e.target.closest('a[href^="#/"]');
      if (link && el.contains(link)) {
        // Inside a dialog (the tour's data dialog), leave the dialog when following a link.
        var dlg = link.closest('dialog[open]');
        if (dlg) WT.dialog.close(dlg, 'navigate');
        return;
      }
      var row = e.target.closest('.wt-jx__row');
      var n = row && self._node(row);
      if (!n) return;
      self.focusNode(n);
      if (e.target.closest('.wt-jx__twisty') && n.children.length) {
        self.toggle(n);
        return;
      }
      self.select(n.path, 'click');
      if (n.children.length) self.toggle(n);
    });
    on('focusin', function (e) {
      var n = e.target.getAttribute && e.target.getAttribute('role') === 'treeitem' ? self._node(e.target) : null;
      if (n && self.st.active !== n.path) {
        self.st.active = n.path;
        self.m.nodes.forEach(function (x) {
          x.el.tabIndex = x === n ? 0 : -1;
        });
      }
    });
    on('input', function (e) {
      if (e.target.classList && e.target.classList.contains('wt-jx__q')) {
        self.st.query = e.target.value;
        self.runSearch();
      }
    });
    on('keydown', function (e) {
      if (e.target.classList && e.target.classList.contains('wt-jx__q')) {
        if (e.key === 'Escape' && e.target.value) {
          e.preventDefault();
          e.stopPropagation();
          self.search('');
        } else if (e.key === 'Enter') {
          e.preventDefault();
          self.runSearch.cancel();
          self._runSearch();
        } else if (e.key === 'ArrowDown') {
          var first = self._shownNodes()[0];
          if (first) {
            e.preventDefault();
            self.focusNode(first);
          }
        }
        return;
      }
      if (e.target.getAttribute && e.target.getAttribute('role') === 'treeitem') self._key(e);
    });
  };

  Explorer.prototype._key = function (e) {
    var n = this._node(e.target);
    if (!n || e.altKey || e.ctrlKey || e.metaKey) return;
    var list = this._shownNodes();
    var i = list.indexOf(n);
    var to = null;
    var handled = true;
    switch (e.key) {
      case 'ArrowDown':
        to = list[i + 1] || null;
        break;
      case 'ArrowUp':
        to = list[i - 1] || null;
        break;
      case 'ArrowRight':
        if (n.children.length) {
          if (!this.st.expanded[n.path]) this.toggle(n, true);
          else {
            var kids = n.children.filter(function (c) {
              return c.shownByFilter;
            });
            to = kids[0] || null;
          }
        }
        break;
      case 'ArrowLeft':
        if (n.children.length && this.st.expanded[n.path]) this.toggle(n, false);
        else to = n.parent;
        break;
      case 'Home':
        to = list[0];
        break;
      case 'End':
        to = list[list.length - 1];
        break;
      case 'Enter':
        this.select(n.path, 'keyboard');
        if (n.children.length) this.toggle(n);
        break;
      case ' ':
      case 'Spacebar':
        this.select(n.path, 'keyboard');
        break;
      case '*':
        var sibs = n.parent ? n.parent.children : this.m.roots;
        var ex = this.st.expanded;
        var any = false;
        sibs.forEach(function (s) {
          if (s.children.length && s.shownByFilter && !ex[s.path]) {
            ex[s.path] = true;
            any = true;
          }
        });
        if (any) this._apply();
        break;
      default:
        handled = false;
        if (e.key && e.key.length === 1 && /\S/.test(e.key)) {
          handled = true;
          to = this._typeahead(e.key, n, list);
        }
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
    // Any other key ends a type-ahead word.
    if (!(e.key && e.key.length === 1 && /\S/.test(e.key) && e.key !== '*')) {
      clearTimeout(this.typedTimer);
      this.typed = '';
    }
    if (to) this.focusNode(to);
  };

  Explorer.prototype._typeahead = function (ch, n, list) {
    var self = this;
    clearTimeout(this.typedTimer);
    this.typed += ch.toLowerCase();
    this.typedTimer = setTimeout(function () {
      self.typed = '';
    }, 600);
    var q = this.typed;
    // A repeated single letter cycles; a longer string searches from the current node.
    var same = q.split('').every(function (c) {
      return c === q[0];
    });
    var needle = same ? q[0] : q;
    var start = list.indexOf(n) + (same || q.length === 1 ? 1 : 0);
    for (var k = 0; k < list.length; k++) {
      var c = list[(start + k) % list.length];
      if (c.key.toLowerCase().indexOf(needle) === 0) return c;
    }
    return null;
  };

  /* ================================================================== */
  /* Public API                                                          */
  /* ================================================================== */

  WT.json = {
    /** Mount (or update) an explorer in el. Returns the instance. */
    mount: function (el, opts) {
      if (!el) return null;
      if (el._wtJson && el._wtJson.el === el && !el._wtJson.destroyed) return el._wtJson.update(opts || {});
      var x = new Explorer(el, opts || {});
      el._wtJson = x;
      return x;
    },
    /** { features, fields: [{ path, type, required, example, description, source, common, neededBy, listedBy }] } in tree order. */
    merge: function (features) {
      var m = model(features);
      return { features: m.features.slice(), fields: m.fields.map(publicField) };
    },
    /** Sample payload built from the examples. */
    sample: function (features) {
      return sampleFromModel(model(features));
    },
    /** JSON Schema (draft 2020-12). */
    schema: function (features) {
      return schemaFromModel(model(features));
    },
    /** { fields, required, optional, sources: [{ source, fields, required, optional }] } */
    stats: function (features) {
      return statsFromModel(model(features));
    },
    plainType: plainType,
    files: { sample: SAMPLE_FILE, schema: SCHEMA_FILE },
    /**
     * Open the compact explorer in a standard dialog.
     * { features, trigger, title } — returns the <dialog>.
     */
    openDialog: function (o) {
      o = o || {};
      var ids = scopeIds(o.features);
      var one = ids.length === 1 ? WT.feature(ids[0]) : null;
      var dlg = WT.dialog.create({
        id: 'wt-json-dialog',
        title: o.title || (one ? 'Data requirements: ' + one.title : 'Data requirements'),
        wide: true,
        body:
          (one && WT.dataReq[one.id] ? '<p class="wt-dialog__text">' + esc(WT.dataReq[one.id].summary) + '</p>' : '') +
          '<div class="wt-jx-host"></div>',
        foot:
          '<a class="wt-btn wt-btn--secondary" href="#/data' + (one ? '/' + encodeURIComponent(one.id) : '') + '" data-wt-close="navigate">' + WT.icon('braces', { size: 18 }) + '<span>Open in Data requirements</span></a>' +
          '<button class="wt-btn wt-btn--primary" type="button" data-wt-close="done">Done</button>'
      });
      dlg.classList.add('wt-json-dialog');
      var x = WT.json.mount(dlg.querySelector('.wt-jx-host'), { features: ids, compact: true });
      WT.dialog.open(dlg, { trigger: o.trigger, initialFocus: x && x.root ? x.root.querySelector('[role="treeitem"][tabindex="0"]') : null });
      var body = dlg.querySelector('.wt-dialog__body');
      if (body) body.scrollTop = 0;
      return dlg;
    }
  };
})(window.WT = window.WT || {});
