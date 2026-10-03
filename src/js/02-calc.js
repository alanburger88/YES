/*
 * Statement arithmetic and reconciliation (PRD 5.2, 6).
 *
 * Pure functions over the canonical data object: no DOM access, so the same code
 * runs in the browser and in the build's release gate (build.mjs).
 * All totals, the balance journey, the running-balance chart and the
 * explanations derive from these functions — nothing is typed in twice.
 */
(function (root) {
  'use strict';
  var YES = (root.YES = root.YES || {});

  function d() {
    return YES.data;
  }
  function time(iso) {
    return iso ? Date.parse(iso) : NaN;
  }
  function chrono(a, b) {
    return time(a.postedAt) - time(b.postedAt) || a.seq - b.seq;
  }
  function sum(list) {
    var s = 0;
    for (var i = 0; i < list.length; i++) s += list[i].amount;
    return s;
  }
  function ids(list) {
    return list.map(function (t) {
      return t.id;
    });
  }

  var calc = (YES.calc = {});

  calc.asset = function (data) {
    data = data || d();
    return data.assets[data.statement.assetId];
  };

  /** Every transaction (posted and not posted), in canonical data order. */
  calc.all = function (data) {
    return (data || d()).transactions.slice();
  };

  /** Posted transactions in this statement, chronological (postedAt, then seq). */
  calc.posted = function (data) {
    return (data || d()).transactions
      .filter(function (t) {
        return t.status === 'posted';
      })
      .sort(chrono);
  };

  /** Transactions not included in the statement balance (pending, failed, unknown). */
  calc.notInBalance = function (data) {
    return (data || d()).transactions.filter(function (t) {
      return t.status !== 'posted';
    });
  };

  calc.tx = function (id, data) {
    var list = (data || d()).transactions;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  calc.inBalance = function (t) {
    return t.status === 'posted';
  };

  calc.categoryOf = function (t, data) {
    var cats = (data || d()).categories;
    for (var i = 0; i < cats.length; i++) if (cats[i].types.indexOf(t.type) !== -1) return cats[i].id;
    return null;
  };

  /** Balance-journey categories with totals derived from posted transactions. */
  calc.categories = function (data) {
    data = data || d();
    var posted = calc.posted(data);
    return data.categories.map(function (c) {
      var rows = posted.filter(function (t) {
        return c.types.indexOf(t.type) !== -1;
      });
      return { id: c.id, group: c.group, types: c.types.slice(), total: sum(rows), count: rows.length, txIds: ids(rows) };
    });
  };

  calc.category = function (id, data) {
    var cats = calc.categories(data);
    for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i];
    return null;
  };

  /** Incoming / outgoing groups (PRD 4: opening → incoming → outgoing & fees → closing). */
  calc.groups = function (data) {
    var cats = calc.categories(data);
    function group(g) {
      var members = cats.filter(function (c) {
        return c.group === g;
      });
      var txIds = [];
      members.forEach(function (c) {
        txIds = txIds.concat(c.txIds);
      });
      return {
        id: g,
        categories: members.map(function (c) {
          return c.id;
        }),
        total: members.reduce(function (s, c) {
          return s + c.total;
        }, 0),
        count: txIds.length,
        txIds: txIds
      };
    }
    return { incoming: group('incoming'), outgoing: group('outgoing') };
  };

  /**
   * Bridge steps: opening, each category as a floating delta, closing.
   * `start`/`end` are the running levels the step moves between.
   */
  calc.journey = function (data) {
    data = data || d();
    var s = data.statement;
    var level = s.opening;
    var steps = [{ id: 'opening', kind: 'total', value: s.opening, start: 0, end: s.opening, txIds: [], count: 0 }];
    calc.categories(data).forEach(function (c) {
      steps.push({ id: c.id, kind: 'delta', group: c.group, value: c.total, start: level, end: level + c.total, txIds: c.txIds, count: c.count });
      level += c.total;
    });
    steps.push({ id: 'closing', kind: 'total', value: s.closing, start: 0, end: s.closing, txIds: [], count: 0 });
    return steps;
  };

  /** Running balance after each posted transaction, starting from the opening balance. */
  calc.running = function (data) {
    data = data || d();
    var level = data.statement.opening;
    return calc.posted(data).map(function (t) {
      level += t.amount;
      return { txId: t.id, at: t.postedAt, delta: t.amount, balance: level, stated: t.balanceAfter };
    });
  };

  calc.netChange = function (data) {
    return sum(calc.posted(data));
  };

  calc.feesTotal = function (data) {
    var c = calc.category('fees', data);
    return c ? c.total : 0;
  };

  /** Fees whose asset differs from the statement asset (shown separately, never bridged). */
  calc.foreignFees = function (data) {
    data = data || d();
    var out = [];
    data.transactions.forEach(function (t) {
      (t.fees || []).forEach(function (f) {
        if (f.asset !== data.statement.assetId) out.push({ txId: t.id, fee: f });
      });
    });
    return out;
  };

  /** Largest single posted movement by absolute size (fees excluded). */
  calc.largest = function (data) {
    var best = null;
    calc.posted(data).forEach(function (t) {
      if (t.type === 'fee') return;
      if (!best || Math.abs(t.amount) > Math.abs(best.amount)) best = t;
    });
    return best;
  };

  /** Convert a statement-asset amount to fiat minor units using the declared rate. */
  calc.fiat = function (minor, data) {
    var f = calc.asset(data).fiat;
    if (!f || !f.rateMicros || !f.source || !f.at) return null;
    return Math.round((minor * f.rateMicros) / 1000000);
  };

  /** Child fee transactions linked to a parent transaction. */
  calc.feesFor = function (txId, data) {
    return (data || d()).transactions.filter(function (t) {
      return t.parentId === txId;
    });
  };

  /**
   * Release gate (PRD 5.2, 6). Returns every check with its outcome so the UI can
   * show what was verified, and `ok: false` if any check fails.
   */
  calc.reconcile = function (data) {
    data = data || d();
    var s = data.statement;
    var asset = data.assets[s.assetId];
    var checks = [];
    function check(id, ok, detail) {
      checks.push({ id: id, ok: !!ok, detail: detail || {} });
    }

    var all = data.transactions;
    var posted = calc.posted(data);

    // 1. Unique transaction IDs.
    var seen = {};
    var dupes = [];
    all.forEach(function (t) {
      if (seen[t.id]) dupes.push(t.id);
      seen[t.id] = true;
    });
    check('unique_ids', dupes.length === 0, { duplicates: dupes });

    // 2. Exact precision: integer minor units only.
    var bad = all.filter(function (t) {
      return !Number.isInteger(t.amount) || (t.balanceAfter !== null && t.balanceAfter !== undefined && !Number.isInteger(t.balanceAfter));
    });
    check('precision', bad.length === 0 && Number.isInteger(s.opening) && Number.isInteger(s.closing) && !!asset, {
      precision: asset ? asset.precision : null,
      offending: ids(bad)
    });

    // 3. One asset in the bridge; other-asset fees are excluded (rule 4).
    var foreign = posted.filter(function (t) {
      return t.asset !== s.assetId;
    });
    check('single_asset', foreign.length === 0, { asset: s.assetId, offending: ids(foreign) });

    // 4. Period basis: every posted transaction's posted date lies in the period.
    var start = time(s.periodStart);
    var end = time(s.periodEnd);
    var outside = posted.filter(function (t) {
      var p = time(t.postedAt);
      return !(p >= start && p <= end);
    });
    check('period_basis', outside.length === 0, { basis: s.dateBasis, offending: ids(outside) });

    // 5. Opening + signed posted movements = closing.
    var net = sum(posted);
    check('equation', s.opening + net === s.closing, { opening: s.opening, net: net, computed: s.opening + net, closing: s.closing });

    // 6. Running balances reconcile in chronological order; ties need a distinct seq.
    var level = s.opening;
    var mismatches = [];
    var ties = [];
    posted.forEach(function (t, i) {
      level += t.amount;
      if (t.balanceAfter !== level) mismatches.push({ id: t.id, stated: t.balanceAfter, computed: level });
      var prev = posted[i - 1];
      if (prev && time(prev.postedAt) === time(t.postedAt) && prev.seq === t.seq) ties.push(t.id);
    });
    check('running_balance', mismatches.length === 0 && ties.length === 0, { mismatches: mismatches, unresolvedTies: ties });

    // 7. Every posted transaction belongs to exactly one journey category, and the
    //    category totals add up to the net change.
    var uncategorised = posted.filter(function (t) {
      return (
        data.categories.filter(function (c) {
          return c.types.indexOf(t.type) !== -1;
        }).length !== 1
      );
    });
    var catSum = calc.categories(data).reduce(function (a, c) {
      return a + c.total;
    }, 0);
    check('categories', uncategorised.length === 0 && catSum === net, { offending: ids(uncategorised), categorySum: catSum, net: net });

    // 8. Fees link both ways with matching amounts.
    var feeProblems = [];
    all.forEach(function (t) {
      if (t.type === 'fee') {
        var parent = calc.tx(t.parentId, data);
        var link =
          parent &&
          (parent.fees || []).filter(function (f) {
            return f.feeTxId === t.id && f.amount === -t.amount && f.asset === t.asset;
          }).length === 1;
        if (!link) feeProblems.push(t.id);
      }
      (t.fees || []).forEach(function (f) {
        if (f.asset === s.assetId && !calc.tx(f.feeTxId, data)) feeProblems.push(t.id);
      });
    });
    check('fee_links', feeProblems.length === 0, { offending: feeProblems });

    // 9. Pending / unposted transactions carry no posted date or balance.
    var leaking = calc.notInBalance(data).filter(function (t) {
      return t.postedAt || (t.balanceAfter !== null && t.balanceAfter !== undefined);
    });
    check('pending_excluded', leaking.length === 0, { offending: ids(leaking) });

    return {
      ok: checks.every(function (c) {
        return c.ok;
      }),
      checks: checks,
      summary: { opening: s.opening, net: net, closing: s.closing, postedCount: posted.length, pendingCount: all.length - posted.length }
    };
  };

  /**
   * Integrity preview (showcase only): a deep copy with one amount altered by a
   * single minor unit, used to demonstrate that a non-reconciling statement is
   * withheld instead of being "fixed" visually.
   */
  calc.simulateMismatch = function (data) {
    var copy = JSON.parse(JSON.stringify(data || d()));
    var target = copy.transactions.filter(function (t) {
      return t.type === 'transfer_out' && t.status === 'posted';
    })[0];
    if (target) target.amount -= 1;
    copy.simulated = { kind: 'mismatch', txId: target ? target.id : null };
    return copy;
  };
})(typeof window !== 'undefined' ? window : globalThis);
