/* ============================================================
   Hypergeometric engine for the opening-hand odds calculator.
   Pure functions, no DOM. Loaded in the browser as window.Hypergeo
   and in Node (for the test suite) via module.exports.

   Model
   -----
   A deck of N cards holds m card lines with K_1..K_m copies, plus
   R = N - sum(K_j) other cards. You draw n cards (the opening hand)
   and optionally e more. A "combo" is a vector of needs, one per
   card line (0 = not part of the combo). The hand hits when at
   least one combo has every need met, and no card line exceeds its
   optional Max.

   P(c_1..c_m) = prod C(K_j, c_j) * C(R, n - sum c_j) / C(N, n)

   The sum over hitting count vectors adds up every hand exactly
   once and asks whether any combo is complete, so every term is
   positive and nothing is lost to cancellation. With a short draw
   the hands are listed directly. With a long draw and few combos
   the same sum is done by a dynamic program over card lines that
   tracks, as a bitmask, which combos are still satisfied.

   Mulligan (Neuroscape CR 103.5b): once, put any number of hand
   cards on the bottom of the deck, then draw that many from the
   top. Bottomed cards are out of reach for the rest of the opening
   sequence, so every redraw comes from the N - n cards that were
   never in hand. Strategy modeled: for every non-empty set of
   combos you might chase, keep the copies that count toward those
   combos (up to each need) and send back everything else
   (non-target cards first, then unwanted copies), but never more
   than X cards. Distinct keeps are generated as the componentwise
   maxima of those sets, so the work tracks the cards in hand rather
   than 2^(combos). The plan with the best success chance is used.
   For "at least" targets this family contains the optimal decision;
   with Max caps it is a strong heuristic.

   Numerics
   --------
   Binomial coefficients are computed exactly as BigInt integers
   and converted to doubles once (correctly rounded). Every
   probability is a sum of positive terms (no cancellation), so
   results carry ~1e-13 relative accuracy or better. Totals are
   never obtained as 1 - P(miss).
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.Hypergeo = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITS = { deck: 1000, hand: 12, draws: 40, cards: 6, combos: 48 };
  /* Above this many compositions, listing every hand is slower than the
     bitmask DP, which itself only fits 12 combos in a JS bitwise mask
     (31 bits would fit, 12 keeps the big-draw mulligan responsive). */
  var ENUM_LIMIT = 30000;

  /* ---------- exact binomial coefficients ---------- */
  var bigMemo = new Map();
  function chooseBig(n, k) {
    if (k < 0 || k > n) return 0n;
    if (k > n - k) k = n - k;
    if (k === 0) return 1n;
    var key = n * 4096 + k;
    var hit = bigMemo.get(key);
    if (hit !== undefined) return hit;
    // r is C(n-k+i, i) after step i, so the division is always exact.
    var r = 1n;
    for (var i = 1; i <= k; i++) r = (r * BigInt(n - k + i)) / BigInt(i);
    bigMemo.set(key, r);
    return r;
  }
  var numMemo = new Map();
  function choose(n, k) {
    if (k < 0 || k > n) return 0;
    if (k > n - k) k = n - k;
    if (k === 0) return 1;
    var key = n * 4096 + k;
    var hit = numMemo.get(key);
    if (hit !== undefined) return hit;
    var v = Number(chooseBig(n, k)); // Number(BigInt) is correctly rounded
    numMemo.set(key, v);
    return v;
  }

  function zeros(len) { var a = new Array(len); for (var i = 0; i < len; i++) a[i] = 0; return a; }

  /* ---------- counting with a combo bitmask DP ----------
     lines: [{ size, hi, ok }] where ok[c] is the bitmask of combos whose
     need for this line is <= c (c = 0..min(size, hi, draws)).
     others: number of unconstrained cards. draws: total cards drawn.
     allMask: bitmask of all combos.
     Returns the number of ways to draw `draws` cards such that at least
     one combo is fully satisfied and no line exceeds its hi. */
  function favorableWays(lines, others, draws, allMask) {
    // state: Map(mask -> poly), poly[d] = weighted ways using d cards so far
    var states = new Map();
    states.set(allMask, [1]);
    for (var j = 0; j < lines.length; j++) {
      var L = lines[j];
      var top = Math.min(L.size, L.hi, draws);
      var next = new Map();
      states.forEach(function (poly, mask) {
        for (var c = 0; c <= top; c++) {
          var m2 = mask & L.ok[c];
          if (m2 === 0) continue; // no combo can still be completed
          var w = choose(L.size, c);
          var out = next.get(m2);
          if (!out) { out = zeros(draws + 1); next.set(m2, out); }
          for (var d = 0; d < poly.length && d + c <= draws; d++) {
            if (poly[d] !== 0) out[d + c] += poly[d] * w;
          }
        }
      });
      states = next;
      if (states.size === 0) return 0;
    }
    var total = 0;
    states.forEach(function (poly) {
      for (var d = 0; d < poly.length; d++) if (poly[d] !== 0) total += poly[d] * choose(others, draws - d);
    });
    return total;
  }

  /* Build the ok-mask table for one line given the combos' needs and an
     offset already held (kept copies). ok[c] has bit i set when
     needs_i <= held + c. */
  function okTable(needs, held, top, mask) {
    var ok = new Array(top + 1);
    for (var c = 0; c <= top; c++) {
      var m = 0;
      for (var i = 0; i < needs.length; i++) if ((mask >> i) & 1) { if (needs[i] <= held + c) m |= (1 << i); }
      ok[c] = m;
    }
    return ok;
  }

  /* ---------- input normalisation ---------- */
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  /* A, B, … Z, AA, AB, … so labels keep working past 26 combos. */
  function comboLabel(i) {
    var s = '';
    i += 1;
    while (i > 0) { i -= 1; s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26); }
    return s;
  }
  /* Upper bound on hands of `draws` cards across `lines` lines: C(draws + lines, lines). */
  function compositionBound(lines, draws) {
    if (lines <= 0 || draws <= 0) return 1;
    var bound = 1;
    for (var i = 1; i <= lines; i++) {
      bound = bound * (draws + i) / i;
      if (bound > ENUM_LIMIT) return bound;
    }
    return bound;
  }
  function useEnum(lines, draws, nCombos) {
    if (nCombos > 12) return true;
    return compositionBound(lines, draws) <= ENUM_LIMIT;
  }

  /* cfg: { deck, hand, extra,
            cards: [{ name, copies, max }],      max may be null/''/undefined = no cap
            combos: [{ needs: [int per card] }] }
     Returns { ok, errors, N, n, e, R, cards: [{K,max,name}], combos: [{needs,label}], allMask } */
  function normalize(cfg) {
    var errors = [];
    var N = cfg.deck, n = cfg.hand, e = cfg.extra == null ? 0 : cfg.extra;
    if (!isInt(N) || N < 1) errors.push('Deck size must be a whole number of at least 1.');
    else if (N > LIMITS.deck) errors.push('Deck size is capped at ' + LIMITS.deck + ' cards.');
    if (!isInt(n) || n < 0) errors.push('Opening hand must be a whole number (0 or more).');
    else if (n > LIMITS.hand) errors.push('Opening hand is capped at ' + LIMITS.hand + ' cards.');
    if (!isInt(e) || e < 0) errors.push('Extra draws must be a whole number (0 or more).');
    if (isInt(N) && isInt(n) && isInt(e)) {
      if (n + e > N) errors.push('You cannot draw more cards than are in the deck.');
      if (n + e > LIMITS.draws) errors.push('Total cards drawn is capped at ' + LIMITS.draws + '.');
    }
    var cards = [], sumK = 0, i, j;
    var srcCards = cfg.cards || [];
    if (srcCards.length === 0) errors.push('Add at least one card.');
    if (srcCards.length > LIMITS.cards) errors.push('At most ' + LIMITS.cards + ' card lines are supported.');
    for (j = 0; j < srcCards.length; j++) {
      var g = srcCards[j];
      var label = g.name && String(g.name).trim() ? String(g.name).trim() : ('Card ' + (j + 1));
      var K = g.copies;
      var mx = (g.max === null || g.max === undefined || g.max === '') ? null : g.max;
      var bad = false;
      if (!isInt(K) || K < 0) { errors.push(label + ': copies in deck must be a whole number (0 or more).'); bad = true; }
      if (mx !== null && (!isInt(mx) || mx < 0)) { errors.push(label + ': "max" must be a whole number (0 or more).'); bad = true; }
      if (bad) { cards.push({ K: 0, max: 0, name: label, bad: true }); continue; }
      sumK += K;
      cards.push({ K: K, max: mx === null ? K : Math.min(mx, K), maxExplicit: mx !== null, name: label });
    }
    if (isInt(N) && sumK > N) errors.push('The card lines add up to ' + sumK + ' cards, more than the ' + N + '-card deck.');

    var combos = [];
    var srcCombos = cfg.combos || [];
    if (srcCombos.length === 0) errors.push('Add at least one combo.');
    if (srcCombos.length > LIMITS.combos) errors.push('At most ' + LIMITS.combos + ' combos are supported.');
    if (srcCombos.length > 12 && isInt(n) && isInt(e) && compositionBound(srcCards.length, n + e) > ENUM_LIMIT) {
      errors.push('More than 12 combos can only be totaled exactly for a shorter draw. Lower the opening hand or extra draws, or drop to 12 combos.');
    }
    for (i = 0; i < srcCombos.length; i++) {
      var cl = 'Combo ' + comboLabel(i);
      var needs = [], any = false, broken = false;
      for (j = 0; j < srcCards.length; j++) {
        var v = (srcCombos[i].needs && srcCombos[i].needs[j] != null) ? srcCombos[i].needs[j] : 0;
        if (!isInt(v) || v < 0) { errors.push(cl + ': the count for ' + cards[j].name + ' must be a whole number (0 or more).'); broken = true; v = 0; }
        if (!cards[j].bad) {
          if (v > cards[j].K) { errors.push(cl + ' asks for ' + v + ' ' + cards[j].name + ' but you only run ' + cards[j].K + '.'); broken = true; }
          else if (cards[j].maxExplicit && v > cards[j].max) { errors.push(cl + ' asks for ' + v + ' ' + cards[j].name + ' but Max is ' + cards[j].max + '.'); broken = true; }
        }
        if (v > 0) any = true;
        needs.push(v);
      }
      if (!any && !broken) errors.push(cl + ' has no cards in it. Put a count on at least one card, or remove the combo.');
      combos.push({ needs: needs, label: comboLabel(i) });
    }
    // Bitwise masks are only used for the <=12 combo DP path. Past 30 the
    // shift stops meaning "all combos", so leave it unset.
    var allMask = combos.length < 31 ? ((1 << combos.length) - 1) : 0;
    return { ok: errors.length === 0, errors: errors, N: N, n: n, e: e, R: N - sumK, cards: cards, combos: combos, allMask: allMask };
  }

  /* ---------- counting hands ---------- */
  var BIT = 31;
  function nChunks(n) { return Math.max(1, Math.ceil(n / BIT)); }
  function setBit(chunks, i) { chunks[(i / BIT) | 0] |= 1 << (i % BIT); }

  /* ok[j][c] = bit chunks of combos still satisfied if `c` more of card j
     are drawn on top of `held`. Counts above hi[j] satisfy nothing (Max). */
  function buildOk(needs, held, tops, hi) {
    var C = needs.length, m = tops.length, ch = nChunks(C);
    var ok = new Array(m);
    for (var j = 0; j < m; j++) {
      ok[j] = new Array(tops[j] + 1);
      for (var c = 0; c <= tops[j]; c++) {
        var chunks = zeros(ch);
        if (c <= hi[j]) {
          for (var i = 0; i < C; i++) if (needs[i][j] <= held[j] + c) setBit(chunks, i);
        }
        ok[j][c] = chunks;
      }
    }
    return ok;
  }
  function maskedHit(ok, counts) {
    var ch = ok[0][0].length;
    for (var k = 0; k < ch; k++) {
      var mask = ~0;
      for (var j = 0; j < counts.length; j++) mask &= ok[j][counts[j]][k];
      if (mask) return true;
    }
    return false;
  }
  /* Every way to draw exactly `draws` cards from `sizes` plus `others`
     fillers. Weights sum to C(sum(sizes) + others, draws). */
  function outcomeList(cache, sizes, others, draws) {
    var key = sizes.join(',') + '|' + others + '|' + draws;
    var hit = cache.get(key);
    if (hit) return hit;
    var m = sizes.length, c = new Array(m), out = [];
    (function rec(j, used) {
      if (j === m) {
        var need = draws - used;
        if (need < 0 || need > others) return;
        var w = choose(others, need);
        for (var t = 0; t < m; t++) w *= choose(sizes[t], c[t]);
        if (w) out.push({ c: c.slice(), w: w });
        return;
      }
      var lim = Math.min(sizes[j], draws - used);
      for (var v = 0; v <= lim; v++) { c[j] = v; rec(j + 1, used + v); }
    })(0, 0);
    cache.set(key, out);
    return out;
  }
  function scoreList(list, ok) {
    var total = 0;
    for (var i = 0; i < list.length; i++) if (maskedHit(ok, list[i].c)) total += list[i].w;
    return total;
  }
  /* Ways in `list` that finish each combo, and that finish any combo.
     `held` copies are already in hand; drawn counts sit on top. */
  function tally(list, needs, held, hi) {
    var C = needs.length, m = held.length;
    var per = zeros(C), any = 0, t, i, j;
    for (t = 0; t < list.length; t++) {
      var c = list[t].c, over = false, hitAny = false;
      for (j = 0; j < m; j++) if (c[j] > hi[j]) { over = true; break; }
      if (over) continue;
      for (i = 0; i < C; i++) {
        var good = true;
        for (j = 0; j < m; j++) if (held[j] + c[j] < needs[i][j]) { good = false; break; }
        if (good) { per[i] += list[t].w; hitAny = true; }
      }
      if (hitAny) any += list[t].w;
    }
    return { any: any, per: per };
  }
  /* Bitmask DP for one combo (which = index) or every combo (which = null).
     lines: [{ size, hi }] of the pool being drawn from. */
  function dpWays(lines, needs, which, held, draws, others) {
    var use = which == null ? needs : [needs[which]];
    var mask = (1 << use.length) - 1;
    var built = new Array(lines.length), j;
    for (j = 0; j < lines.length; j++) {
      if (lines[j].hi < 0) return 0;
      var top = Math.min(lines[j].size, lines[j].hi, draws);
      var col = new Array(use.length);
      for (var i = 0; i < use.length; i++) col[i] = use[i][j];
      built[j] = { size: lines[j].size, hi: lines[j].hi, ok: okTable(col, held[j], top, mask) };
    }
    return favorableWays(built, others, draws, mask);
  }
  function needVectors(s) { return s.combos.map(function (cb) { return cb.needs; }); }

  /* Ways to draw `draws` from a pool and complete the target.
     pool: { sizes, hi, held, others }. which = null means any combo. */
  function hitWays(pool, needs, which, draws, cache) {
    var j;
    for (j = 0; j < pool.hi.length; j++) if (pool.hi[j] < 0) return 0;
    if (draws === 0) {
      var held = pool.held, m = held.length;
      if (which == null) {
        for (var i = 0; i < needs.length; i++) {
          var good = true;
          for (j = 0; j < m; j++) if (held[j] < needs[i][j] || held[j] > pool.hiBase[j]) { good = false; break; }
          if (good) return 1;
        }
        return 0;
      }
      for (j = 0; j < m; j++) if (held[j] < needs[which][j] || held[j] > pool.hiBase[j]) return 0;
      return 1;
    }
    var lines = pool.sizes.map(function (size, idx) { return { size: size, hi: pool.hi[idx] }; });
    var targeting = which == null ? needs.length : 1;
    // One combo is a plain "at least this many" count; the bitmask DP does
    // that in negligible time, while listing every hand does not.
    if (targeting === 1 || !useEnum(lines.length, draws, targeting)) {
      return dpWays(lines, needs, which, pool.held, draws, pool.others);
    }
    var list = outcomeList(cache, pool.sizes, pool.others, draws);
    if (which == null) {
      var ok = buildOk(needs, pool.held, pool.sizes, pool.hi);
      return scoreList(list, ok);
    }
    var one = tally(list, [needs[which]], pool.held, pool.hi);
    return one.any;
  }

  /* Opening-hand pool: drawing n + e from the full deck, nothing held yet. */
  function openingPool(s) {
    var m = s.cards.length;
    return {
      sizes: s.cards.map(function (card) { return card.K; }),
      hi: s.cards.map(function (card) { return card.max; }),
      hiBase: s.cards.map(function (card) { return card.max; }),
      held: zeros(m),
      others: s.R
    };
  }
  /* Pool left after an opening hand `c`, keeping `inHand`. */
  function redrawPool(s, c, inHand) {
    var sizes = new Array(c.length), hi = new Array(c.length), used = 0, j;
    for (j = 0; j < c.length; j++) {
      used += c[j];
      sizes[j] = s.cards[j].K - c[j];
      hi[j] = s.cards[j].max - inHand[j];
    }
    return { sizes: sizes, hi: hi, hiBase: s.cards.map(function (card) { return card.max; }), held: inHand, others: s.R - (s.n - used) };
  }

  /* { any, per } probabilities for the opening hand (plus extra draws). */
  function openCount(s, cache) {
    var draws = s.n + s.e;
    var needs = needVectors(s);
    var denom = choose(s.N, draws);
    var pool = openingPool(s);
    if (!useEnum(s.cards.length, draws, s.combos.length)) {
      return {
        any: dpWays(pool.sizes.map(function (size, j) { return { size: size, hi: pool.hi[j] }; }), needs, null, pool.held, draws, pool.others) / denom,
        per: needs.map(function (_, i) {
          return dpWays(pool.sizes.map(function (size, j) { return { size: size, hi: pool.hi[j] }; }), needs, i, pool.held, draws, pool.others) / denom;
        })
      };
    }
    var list = outcomeList(cache, pool.sizes, pool.others, draws);
    var t = tally(list, needs, pool.held, pool.hi);
    return { any: t.any / denom, per: t.per.map(function (w) { return w / denom; }) };
  }
  function openingHand(cfg) {
    var s = normalize(cfg);
    if (!s.ok) return null;
    return openCount(s, new Map()).any;
  }
  function comboOdds(cfg) {
    var s = normalize(cfg);
    if (!s.ok) return null;
    return openCount(s, new Map()).per;
  }

  /* Marginal distribution of a single card line, ignoring everything else.
     Returns [{k, exactly, atLeast, atMost}] for k = 0..min(K, draws). */
  function marginal(N, K, draws) {
    var denom = choose(N, draws);
    var top = Math.min(K, draws);
    var exact = [];
    for (var k = 0; k <= top; k++) exact.push(choose(K, k) * choose(N - K, draws - k) / denom);
    var rows = [], atMost = 0;
    var suffix = zeros(top + 2);
    for (var j = top; j >= 0; j--) suffix[j] = suffix[j + 1] + exact[j];
    for (var i = 0; i <= top; i++) {
      atMost += exact[i];
      rows.push({ k: i, exactly: exact[i], atLeast: suffix[i], atMost: Math.min(1, atMost) });
    }
    return rows;
  }

  /* ---------- mulligan machinery ---------- */
  function handHits(s, c) {
    for (var j = 0; j < s.cards.length; j++) if (c[j] > s.cards[j].max) return false;
    for (var i = 0; i < s.combos.length; i++) {
      var ok = true;
      for (j = 0; j < s.cards.length; j++) if (c[j] < s.combos[i].needs[j]) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }
  /* Candidate keep-plans for hand c. Keeping toward a set of combos means
     holding, for each card, the most that any chased combo still wants
     (and no more than you actually hold). Every such keep is a
     componentwise max of per-combo contributions, so the list stays
     the size of the hand rather than 2^(combos). */
  function keepPlans(s, c) {
    var m = s.cards.length, C = s.combos.length, i, j, p;
    var contribs = new Array(C);
    for (i = 0; i < C; i++) {
      var v = new Array(m);
      for (j = 0; j < m; j++) v[j] = Math.min(c[j], s.combos[i].needs[j]);
      contribs[i] = v;
    }
    var seen = new Map(), list = [];
    function add(vec) {
      var key = vec.join(',');
      if (seen.has(key)) return;
      seen.set(key, true);
      list.push(vec);
    }
    for (i = 0; i < C; i++) add(contribs[i].slice());
    for (p = 0; p < list.length; p++) {
      for (i = 0; i < C; i++) {
        var cur = list[p], src = contribs[i], changed = false, next = new Array(m);
        for (j = 0; j < m; j++) {
          next[j] = cur[j] > src[j] ? cur[j] : src[j];
          if (next[j] !== cur[j]) changed = true;
        }
        if (changed) add(next);
      }
    }
    var plans = new Array(list.length);
    for (p = 0; p < list.length; p++) plans[p] = { keep: list[p], label: '' };
    return plans;
  }
  /* Apply a keep-plan with a cap of X cards sent back. Non-target cards go
     first, then unwanted copies in line order. Returns the copies that
     stay in hand per line plus how many were sent. */
  function applyPlan(s, c, keep, X) {
    var used = 0, keepTotal = 0, j;
    for (j = 0; j < c.length; j++) { used += c[j]; keepTotal += keep[j]; }
    var others = s.n - used;
    var disposable = s.n - keepTotal;
    var sent = Math.max(0, Math.min(X, disposable));
    var inHand = c.slice();
    var remaining = sent - others;
    for (j = 0; j < c.length && remaining > 0; j++) {
      var t = Math.min(c[j] - keep[j], remaining);
      inHand[j] -= t; remaining -= t;
    }
    return { inHand: inHand, sent: sent, disposable: disposable, others: others, othersKept: others - Math.min(sent, others) };
  }
  /* Probability that, holding `inHand` (from an original hand c of n cards),
     drawing `draws` cards from the N - n unseen cards ends in a hit. */
  function afterDraw(s, c, inHand, draws, cache) {
    var poolN = s.N - s.n;
    if (draws > poolN) return NaN;
    if (!cache) cache = new Map();
    var ways = hitWays(redrawPool(s, c, inHand), needVectors(s), null, draws, cache);
    if (draws === 0) return ways;
    var denom = choose(poolN, draws);
    return denom === 0 ? 0 : ways / denom;
  }
  /* Enumerate every opening hand composition: c_j in [0, K_j], sum <= n. */
  function enumerateHands(s, cb) {
    var m = s.cards.length, c = new Array(m), n = s.n;
    (function rec(j, used) {
      if (j === m) { cb(c, used); return; }
      var lim = Math.min(s.cards[j].K, n - used);
      for (var v = 0; v <= lim; v++) { c[j] = v; rec(j + 1, used + v); }
    })(0, 0);
  }
  /* Best plan for hand c when allowed to send back up to X cards.
     cache: per-hand memo keyed by inHand+sent. Returns {p, plan, applied}. */
  function bestPlan(s, c, plans, X, pcache, ocache) {
    var best = null;
    for (var k = 0; k < plans.length; k++) {
      var ap = applyPlan(s, c, plans[k].keep, X);
      var key = ap.inHand.join(',') + '|' + ap.sent;
      var p = pcache[key];
      if (p === undefined) { p = afterDraw(s, c, ap.inHand, ap.sent + s.e, ocache); pcache[key] = p; }
      if (best === null || p > best.p + 1e-15) best = { p: p, plan: plans[k], applied: ap };
    }
    best.label = chasedLabel(s, c, best.applied.inHand);
    return best;
  }
  /* Which combos are still being chased with what stays in hand: those
     for which every copy you held toward them was kept. */
  function chasedLabel(s, c, inHand) {
    var out = [];
    for (var i = 0; i < s.combos.length; i++) {
      var ok = true;
      for (var j = 0; j < c.length; j++) if (inHand[j] < Math.min(c[j], s.combos[i].needs[j])) { ok = false; break; }
      if (ok) out.push(s.combos[i].label);
    }
    return out.join('+');
  }

  /* Before you see your hand. Returns:
     { rows: [P for X = 0..n], open, full, pool: N - n, feasible } */
  function mulliganTableFrom(s, cache) {
    if (!cache) cache = new Map();
    var n = s.n, e = s.e;
    var feasible = (s.N - n) >= (n + e);
    var rows = zeros(n + 1);
    if (!feasible) return { rows: rows, open: openCount(s, cache).any, full: NaN, pool: s.N - n, feasible: false };
    var denom = choose(s.N, n);
    enumerateHands(s, function (c, used) {
      var others = n - used;
      if (others > s.R) return;
      var w = choose(s.R, others);
      for (var j = 0; j < c.length; j++) w *= choose(s.cards[j].K, c[j]);
      if (w === 0) return;
      w /= denom; // P(this hand composition)
      if (handHits(s, c)) {
        var pKeep = afterDraw(s, c, c.slice(), e, cache);
        for (var X0 = 0; X0 <= n; X0++) rows[X0] += w * pKeep;
        return;
      }
      var plans = keepPlans(s, c), pcache = {};
      for (var X = 0; X <= n; X++) rows[X] += w * bestPlan(s, c, plans, X, pcache, cache).p;
    });
    for (var r = 0; r <= n; r++) rows[r] = Math.min(1, rows[r]);
    return { rows: rows, open: rows[0], full: rows[n], pool: s.N - n, feasible: true };
  }
  function mulliganTable(cfg) {
    var s = normalize(cfg);
    if (!s.ok) return null;
    return mulliganTableFrom(s);
  }
  /* One combo, chased on its own, willing to send the whole hand back.
     Same decision as running the mulligan with only that combo loaded. */
  function perComboFull(s, cache) {
    var nC = s.combos.length, per = zeros(nC), i;
    if ((s.N - s.n) < (s.n + s.e)) { for (i = 0; i < nC; i++) per[i] = NaN; return per; }
    var needs = needVectors(s);
    var denom = choose(s.N, s.n);
    enumerateHands(s, function (c, used) {
      var others = s.n - used;
      if (others > s.R) return;
      var w = choose(s.R, others), j;
      for (j = 0; j < c.length; j++) w *= choose(s.cards[j].K, c[j]);
      if (w === 0) return;
      w /= denom;
      for (var ci = 0; ci < nC; ci++) {
        var have = true;
        for (j = 0; j < c.length; j++) if (c[j] < needs[ci][j] || c[j] > s.cards[j].max) { have = false; break; }
        var one = { cards: s.cards, combos: [s.combos[ci]], n: s.n, e: s.e, N: s.N, R: s.R, allMask: 1 };
        var p;
        if (have) p = afterDraw(one, c, c.slice(), s.e, cache);
        else {
          var keep = new Array(c.length);
          for (j = 0; j < c.length; j++) keep[j] = Math.min(c[j], needs[ci][j]);
          var ap = applyPlan(s, c, keep, s.n);
          p = afterDraw(one, c, ap.inHand, ap.sent + s.e, cache);
        }
        per[ci] += w * p;
      }
    });
    for (i = 0; i < nC; i++) per[i] = Math.min(1, per[i]);
    return per;
  }
  function comboMulligan(cfg) {
    var s = normalize(cfg);
    if (!s.ok) return null;
    return perComboFull(s, new Map());
  }
  /* Opening odds, the mulligan table, and each combo on its own, sharing
     one enumeration of the deck. What the page asks for on every edit. */
  function analyze(cfg) {
    var s = normalize(cfg);
    if (!s.ok) return null;
    var cache = new Map();
    var open = openCount(s, cache);
    var mt = mulliganTableFrom(s, cache);
    return { open: open.any, perOpen: open.per, mull: mt, perFull: mt.feasible ? perComboFull(s, cache) : null };
  }

  /* You are holding a specific hand. inHand: copies of each card line in
     the n-card hand. Returns { ok, errors, hits, others, rows } where
     rows = [{ X, sent, inHand, othersKept, label, p }] for X = 0..maxSend. */
  function seenHand(cfg, inHand) {
    var s = normalize(cfg);
    if (!s.ok) return { ok: false, errors: s.errors };
    var errors = [], used = 0, j;
    var c = [];
    for (j = 0; j < s.cards.length; j++) {
      var v = inHand[j] == null ? 0 : inHand[j];
      if (!isInt(v) || v < 0) errors.push(s.cards[j].name + ': copies in hand must be a whole number (0 or more).');
      else if (v > s.cards[j].K) errors.push(s.cards[j].name + ': you only run ' + s.cards[j].K + ', so you cannot hold ' + v + '.');
      c.push(isInt(v) ? v : 0);
      used += c[j];
    }
    if (used > s.n) errors.push('The copies in hand add up to ' + used + ', more than the ' + s.n + '-card hand.');
    if (errors.length) return { ok: false, errors: errors };
    var others = s.n - used;
    var plans = keepPlans(s, c), pcache = {}, ocache = new Map();
    var maxSend = 0;
    for (var k = 0; k < plans.length; k++) maxSend = Math.max(maxSend, applyPlan(s, c, plans[k].keep, s.n).disposable);
    var feasible = (s.N - s.n) >= (maxSend + s.e);
    var rows = [];
    for (var X = 0; X <= maxSend; X++) {
      var b = bestPlan(s, c, plans, X, pcache, ocache);
      rows.push({ X: X, sent: b.applied.sent, inHand: b.applied.inHand, othersKept: b.applied.othersKept, label: b.label, p: feasible ? b.p : NaN });
    }
    return { ok: true, errors: [], hits: handHits(s, c), others: others, rows: rows, maxSend: maxSend, feasible: feasible, pool: s.N - s.n };
  }

  return {
    LIMITS: LIMITS,
    choose: choose,
    chooseBig: chooseBig,
    comboLabel: comboLabel,
    normalize: normalize,
    openingHand: openingHand,
    comboOdds: comboOdds,
    comboMulligan: comboMulligan,
    analyze: analyze,
    marginal: marginal,
    mulliganTable: mulliganTable,
    seenHand: seenHand,
    _internal: { favorableWays: favorableWays, keepPlans: keepPlans, applyPlan: applyPlan, afterDraw: afterDraw, enumerateHands: enumerateHands, handHits: handHits }
  };
});
