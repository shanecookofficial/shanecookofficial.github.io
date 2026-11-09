/* UI for the opening-hand odds calculator. All math lives in hypergeo.js. */
(function () {
  'use strict';
  var H = window.Hypergeo;
  function $(id) { return document.getElementById(id); }

  var el = {
    deck: $('deck'), hand: $('hand'), extra: $('extra'),
    gridHead: $('grid-head'), gridBody: $('grid-body'), comboHead: $('combo-head'), comboBody: $('combo-body'), comboCount: $('combo-count'),
    addCard: $('add-card'), addCombo: $('add-combo'), share: $('share'), copied: $('copied'), errors: $('errors'),
    pOpen: $('p-open'), pOpenD: $('p-open-d'), pOpenOdds: $('p-open-odds'), pMiss: $('p-miss'), pFull: $('p-full'), pFullD: $('p-full-d'),
    combosOut: $('combos-out'), comboRows: $('combo-rows'), comboNote: $('combo-note'),
    marginals: $('marginals'),
    mullLead: $('mull-lead'), mullRows: $('mull-rows'), mullNote: $('mull-note'),
    seenInputs: $('seen-inputs'), seenSummary: $('seen-summary'), seenRows: $('seen-rows'), seenErrors: $('seen-errors'), seenNote: $('seen-note')
  };

  var MAX_CARDS = H.LIMITS.cards, MAX_COMBOS = H.LIMITS.combos;
  var state = {
    cards: [{ name: '', copies: 4, max: '' }],
    combos: [{ needs: [1] }],
    inHand: [0]
  };

  /* ---------- formatting ---------- */
  function fmtPct(p) {
    if (p !== p) return '—';
    if (p <= 0) return '0%';
    if (p >= 1) return '100%';
    var v = p * 100;
    if (v < 0.01) return '<0.01%';
    if (v > 99.99) return '>99.99%';
    return v.toFixed(2) + '%';
  }
  function fmtOdds(p) {
    if (p !== p) return '—';
    if (p <= 0) return 'Never';
    if (p >= 1) return 'Always';
    var r = 1 / p;
    if (r < 1.05) return '1 in 1';
    if (r < 10) return '1 in ' + r.toFixed(1);
    if (r < 1000) return '1 in ' + Math.round(r);
    return '1 in ' + Math.round(r).toLocaleString('en-US');
  }
  function fmtDelta(p, base) {
    if (p !== p || base !== base) return '—';
    var d = (p - base) * 100;
    if (Math.abs(d) < 0.005) return '±0.00';
    return (d > 0 ? '+' : '−') + Math.abs(d).toFixed(2) + ' pts';
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function plural(n, one, many) { return n === 1 ? one : (many || one + 's'); }
  function joinList(parts) {
    if (parts.length <= 1) return parts.join('');
    if (parts.length === 2) return parts[0] + ' and ' + parts[1];
    return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
  }
  function describeCombo(s, cb) {
    var parts = [];
    cb.needs.forEach(function (v, j) { if (v > 0) parts.push(v + '× ' + esc(s.cards[j].name)); });
    return parts.join(' + ');
  }
  function describeGoal(s) {
    if (s.combos.length === 1) return describeCombo(s, s.combos[0]);
    if (s.combos.length === 2) return '(' + describeCombo(s, s.combos[0]) + ') or (' + describeCombo(s, s.combos[1]) + ')';
    return 'any one of your ' + s.combos.length + ' combos';
  }
  function handPhrase(s) {
    if (s.e === 0) return 'your ' + s.n + '-card opening hand';
    if (s.n === 0) return 'the first ' + s.e + ' cards you draw';
    return 'the first ' + (s.n + s.e) + ' cards you see (' + s.n + '-card hand + ' + s.e + ' ' + plural(s.e, 'draw') + ')';
  }
  function cardLabel(idx) { var c = state.cards[idx]; return c.name && c.name.trim() ? c.name.trim() : 'Card ' + (idx + 1); }

  /* ---------- grid ---------- */
  function numInput(cls, value, attrs) {
    var i = document.createElement('input');
    i.type = 'number'; i.inputMode = 'numeric'; i.step = '1'; i.className = 'inp ' + cls;
    i.value = value === '' || value == null || value !== value ? '' : value;
    for (var k in attrs) i.setAttribute(k, attrs[k]);
    return i;
  }
  function th(text, cls) { var t = document.createElement('th'); if (cls) t.className = cls; t.textContent = text; return t; }
  function cardTitle(card, j) {
    var n = card.name && String(card.name).trim();
    return n || ('Card ' + (j + 1));
  }
  function renderGrid() {
    el.gridHead.innerHTML = ''; el.gridBody.innerHTML = '';
    el.gridHead.appendChild(th('Card', 'c-name'));
    el.gridHead.appendChild(th('In deck', 'c-num'));
    el.gridHead.appendChild(th('Max', 'c-num'));
    el.gridHead.appendChild(th('', 'c-rm'));

    state.cards.forEach(function (card, j) {
      var tr = document.createElement('tr'); tr.dataset.idx = j;
      var tdName = document.createElement('td'); tdName.className = 'c-name';
      var name = document.createElement('input');
      name.type = 'text'; name.className = 'inp name'; name.placeholder = 'Card ' + (j + 1); name.value = card.name; name.maxLength = 40;
      name.setAttribute('aria-label', 'Card ' + (j + 1) + ' name');
      tdName.appendChild(name); tr.appendChild(tdName);
      var tdCopies = document.createElement('td'); tdCopies.className = 'c-num';
      tdCopies.appendChild(numInput('copies', card.copies, { min: 0, max: H.LIMITS.deck, 'aria-label': cardLabel(j) + ' copies in deck' })); tr.appendChild(tdCopies);
      var tdMax = document.createElement('td'); tdMax.className = 'c-num';
      tdMax.appendChild(numInput('max', card.max, { min: 0, placeholder: 'any', 'aria-label': cardLabel(j) + ' max (optional)' })); tr.appendChild(tdMax);
      var tdRm = document.createElement('td'); tdRm.className = 'c-rm';
      var rm = document.createElement('button'); rm.type = 'button'; rm.className = 'icon-btn'; rm.innerHTML = '&times;'; rm.title = 'Remove this card';
      rm.setAttribute('aria-label', 'Remove ' + cardLabel(j));
      rm.disabled = state.cards.length === 1;
      rm.addEventListener('click', function () {
        readGrid();
        state.cards.splice(j, 1); state.inHand.splice(j, 1);
        state.combos.forEach(function (cb) { cb.needs.splice(j, 1); });
        renderGrid(); update();
      });
      tdRm.appendChild(rm); tr.appendChild(tdRm);
      el.gridBody.appendChild(tr);
    });

    el.comboHead.innerHTML = ''; el.comboBody.innerHTML = '';
    el.comboHead.appendChild(th('Combo', 'c-lab'));
    state.cards.forEach(function (card, j) {
      var t = document.createElement('th'); t.className = 'c-card';
      var sp = document.createElement('span'); sp.textContent = cardTitle(card, j);
      t.title = sp.textContent; t.appendChild(sp);
      el.comboHead.appendChild(t);
    });
    el.comboHead.appendChild(th('', 'c-rm'));
    state.combos.forEach(function (cb, i) {
      var tr = document.createElement('tr');
      var lab = document.createElement('td'); lab.className = 'c-lab'; lab.textContent = H.comboLabel(i); tr.appendChild(lab);
      state.cards.forEach(function (card, j) {
        var td = document.createElement('td'); td.className = 'c-combo c-need';
        var v = cb.needs[j] == null ? 0 : cb.needs[j];
        var inp = numInput('need', v, { min: 0, 'data-combo': i, 'data-card': j, 'aria-label': 'Combo ' + H.comboLabel(i) + ' needs how many ' + cardTitle(card, j) });
        if (v === 0) inp.classList.add('zero');
        td.appendChild(inp); tr.appendChild(td);
      });
      var tdRm = document.createElement('td'); tdRm.className = 'c-rm';
      var rm = document.createElement('button'); rm.type = 'button'; rm.className = 'icon-btn'; rm.innerHTML = '&times;';
      rm.title = 'Remove combo ' + H.comboLabel(i);
      rm.setAttribute('aria-label', 'Remove combo ' + H.comboLabel(i));
      rm.disabled = state.combos.length === 1;
      rm.addEventListener('click', function () { readGrid(); state.combos.splice(i, 1); renderGrid(); update(); });
      tdRm.appendChild(rm); tr.appendChild(tdRm);
      el.comboBody.appendChild(tr);
    });

    el.addCard.hidden = state.cards.length >= MAX_CARDS;
    el.addCombo.hidden = state.combos.length >= MAX_COMBOS;
    if (el.comboCount) el.comboCount.textContent = '// ' + state.combos.length + (state.combos.length === 1 ? ' combo' : ' combos');
  }
  function readInt(input) {
    var v = input.value.trim();
    if (v === '') return NaN;
    var n = Number(v);
    return isFinite(n) ? n : NaN;
  }
  function readGrid() {
    var cards = [];
    Array.prototype.forEach.call(el.gridBody.querySelectorAll('tr'), function (row) {
      cards.push({
        name: row.querySelector('.name').value,
        copies: readInt(row.querySelector('.copies')),
        max: row.querySelector('.max').value.trim() === '' ? '' : readInt(row.querySelector('.max'))
      });
    });
    var combos = [];
    Array.prototype.forEach.call(el.comboBody.querySelectorAll('tr'), function (row) {
      var needs = [];
      row.querySelectorAll('.need').forEach(function (inp) {
        var v = inp.value.trim() === '' ? 0 : readInt(inp);
        needs.push(v);
        inp.classList.toggle('zero', v === 0);
      });
      combos.push({ needs: needs });
    });
    state.cards = cards;
    if (combos.length) state.combos = combos;
  }
  function markBad(input, bad) { input.classList.toggle('bad', !!bad); }

  /* ---------- seen-hand inputs ---------- */
  function renderSeenInputs(s) {
    el.seenInputs.innerHTML = '';
    s.cards.forEach(function (card, j) {
      var lab = document.createElement('label'); lab.className = 'field';
      var k = document.createElement('span'); k.className = 'k'; k.textContent = card.name + ' in hand';
      var inp = numInput('inhand', state.inHand[j] || 0, { min: 0, max: Math.min(card.K, s.n), 'data-idx': j });
      var d = document.createElement('span'); d.className = 'd'; d.textContent = 'You run ' + card.K + '.';
      lab.appendChild(k); lab.appendChild(inp); lab.appendChild(d);
      el.seenInputs.appendChild(lab);
    });
  }
  function readSeen() {
    var inputs = el.seenInputs.querySelectorAll('.inhand');
    state.inHand = Array.prototype.map.call(inputs, function (i) { var v = readInt(i); return v !== v ? 0 : v; });
  }
  function seenLabelsStale(s) {
    var ks = el.seenInputs.querySelectorAll('.k');
    if (ks.length !== s.cards.length) return true;
    for (var i = 0; i < ks.length; i++) if (ks[i].textContent !== s.cards[i].name + ' in hand') return true;
    return false;
  }

  /* ---------- rendering results ---------- */
  function clearResults(msg) {
    el.pOpen.textContent = '—'; el.pOpenD.textContent = msg || '';
    el.pOpenOdds.textContent = '—'; el.pMiss.textContent = '—'; el.pFull.textContent = '—';
    el.combosOut.hidden = true; el.comboRows.innerHTML = '';
    el.marginals.innerHTML = ''; el.mullRows.innerHTML = ''; el.mullNote.textContent = '';
    el.seenInputs.innerHTML = ''; el.seenRows.innerHTML = ''; el.seenSummary.textContent = ''; el.seenNote.textContent = ''; el.seenErrors.innerHTML = '';
  }
  function barCell(p, cls) {
    var w = Math.max(0, Math.min(100, (p || 0) * 100));
    return '<td class="barcol"><span class="bar ' + (cls || '') + '"><i style="width:' + w.toFixed(2) + '%"></i></span></td>';
  }
  function renderCombos(s, report) {
    if (s.combos.length < 2) { el.combosOut.hidden = true; return; }
    var per = report.perOpen;
    var mull = report.perFull;
    var mt = report.mull;
    var pAny = report.open;
    var html = '';
    s.combos.forEach(function (cb, i) {
      html += '<tr><td class="val" style="text-align:left">' + cb.label + '</td><td class="dim">' + describeCombo(s, cb) + '</td><td class="val">' + fmtPct(per[i]) + '</td><td class="val">' + (mull ? fmtPct(mull[i]) : '—') + '</td>' + barCell(per[i], 'cy') + '</tr>';
    });
    html += '<tr class="hi"><td class="val" style="text-align:left">Any</td><td class="dim">whichever lands</td><td class="val">' + fmtPct(pAny) + '</td><td class="val">' + (mt.feasible ? fmtPct(mt.full) : '—') + '</td>' + barCell(pAny) + '</tr>';
    el.comboRows.innerHTML = html;
    var sumSingles = per.reduce(function (a, b) { return a + b; }, 0);
    el.comboNote.textContent = 'Hands that complete more than one combo are counted once, so "Any" is less than the column total (' + fmtPct(Math.min(1, sumSingles)) + ') whenever combos overlap.';
    el.combosOut.hidden = false;
  }
  function renderMarginals(s) {
    var draws = s.n + s.e;
    var html = '';
    s.cards.forEach(function (card, idx) {
      var rows = H.marginal(s.N, card.K, draws);
      html += '<div class="marg"><h3 class="sub-h">' + esc(card.name) + ' on its own <span class="mono-note">' + card.K + ' in ' + s.N + ', ' + draws + ' drawn</span></h3>';
      html += '<div class="tblwrap"><table class="tbl compact"><thead><tr><th>Copies</th><th class="val">Exactly</th><th class="val">At least</th><th class="barcol"><span class="sr">Bar</span></th></tr></thead><tbody>';
      // highlight counts that meet the smallest need any combo has for this card
      var minNeed = Infinity;
      s.combos.forEach(function (cb) { if (cb.needs[idx] > 0) minNeed = Math.min(minNeed, cb.needs[idx]); });
      rows.forEach(function (r) {
        var hi = (r.k >= minNeed && r.k <= card.max) ? ' class="hi"' : '';
        html += '<tr' + hi + '><td>' + r.k + '</td><td class="val">' + fmtPct(r.exactly) + '</td><td class="val">' + fmtPct(r.atLeast) + '</td>' + barCell(r.exactly, 'cy') + '</tr>';
      });
      html += '</tbody></table></div></div>';
    });
    el.marginals.innerHTML = html;
  }
  function renderMulligan(s, mt) {
    el.mullLead.innerHTML = 'Your overall chance of ending with ' + describeGoal(s) + ' in ' + handPhrase(s) + ' if, on a miss, you keep the pieces worth keeping and send back <b>up to</b> this many cards.';
    if (!mt.feasible) {
      el.mullRows.innerHTML = '';
      el.mullNote.textContent = 'Mulligan math needs the unseen part of the deck (' + mt.pool + ' cards) to cover a full redraw plus extra draws (' + (s.n + s.e) + '). Shrink the hand or extra draws, or grow the deck.';
      return;
    }
    var html = '';
    for (var X = 0; X <= s.n; X++) {
      var p = mt.rows[X];
      var label = X === 0 ? 'Keep whatever you draw' : (X === s.n ? 'Anything, all ' + s.n + ' if needed' : 'Up to ' + X + ' ' + plural(X, 'card'));
      var cls = X === s.n ? ' class="hi"' : '';
      html += '<tr' + cls + '><td>' + label + '</td><td class="val">' + fmtPct(p) + '</td>' + barCell(p) + '<td class="val dim">' + (X === 0 ? '—' : fmtDelta(p, mt.open)) + '</td></tr>';
    }
    el.mullRows.innerHTML = html;
    el.mullNote.textContent = 'Replacements come from the ' + mt.pool + ' cards you have not seen. Cards you send back go to the bottom and cannot be redrawn.' + (s.combos.length > 1 ? ' For each possible hand the best keep across your combos is used.' : '');
  }
  function renderSeen(s, cfg) {
    var res = H.seenHand(cfg, state.inHand);
    el.seenErrors.innerHTML = res.ok ? '' : res.errors.map(function (m) { return '<div>' + esc(m) + '</div>'; }).join('');
    if (!res.ok) { el.seenRows.innerHTML = ''; el.seenSummary.textContent = ''; el.seenNote.textContent = ''; return; }
    var summary = 'Hand: ' + joinList(s.cards.map(function (card, j) { return state.inHand[j] + '× ' + esc(card.name); }).concat([res.others + ' other ' + plural(res.others, 'card')])) + '. ';
    summary += res.hits ? 'This hand already completes a combo. ' : 'This hand does not complete a combo yet. ';
    summary += 'Sending back more than ' + res.maxSend + ' would mean giving up a piece that is worth more than a fresh card.';
    el.seenSummary.innerHTML = summary;
    var html = '';
    res.rows.forEach(function (r) {
      var keep = s.cards.map(function (card, j) { return r.inHand[j] + '× ' + esc(card.name); }).join(', ') + ', ' + r.othersKept + ' other';
      var label = r.X === 0 ? 'Nothing' : r.X + ' ' + plural(r.X, 'card');
      if (r.sent < r.X) label += ' <span class="dim">(best: send ' + r.sent + ')</span>';
      var cls = r.X === res.maxSend && res.maxSend > 0 ? ' class="hi"' : '';
      html += '<tr' + cls + '><td>' + label + '</td><td class="dim">' + keep + '</td><td class="chase">' + (r.label || '—') + '</td><td class="val">' + fmtPct(r.p) + '</td>' + barCell(r.p) + '</tr>';
    });
    el.seenRows.innerHTML = html;
    if (!res.feasible) el.seenNote.textContent = 'The unseen part of the deck (' + res.pool + ' cards) is too small to cover this redraw plus extra draws.';
    else el.seenNote.textContent = (s.e > 0 ? 'Each row includes the ' + s.e + ' extra ' + plural(s.e, 'draw') + ' after the mulligan. ' : '') + 'Non-target cards are sent back first, then pieces you are not chasing.';
  }

  /* ---------- main update ---------- */
  function currentCfg() {
    return {
      deck: readInt(el.deck), hand: readInt(el.hand), extra: readInt(el.extra),
      cards: state.cards.map(function (c) { return { name: c.name, copies: c.copies, max: c.max === '' ? null : c.max }; }),
      combos: state.combos.map(function (cb) { return { needs: cb.needs.slice() }; })
    };
  }
  var pending = null;
  function scheduleUpdate() {
    if (pending) clearTimeout(pending);
    pending = setTimeout(function () { pending = null; update(); }, 50);
  }

  function update() {
    readGrid();
    var cfg = currentCfg();
    var s = H.normalize(cfg);

    // field-level highlighting
    markBad(el.deck, !(cfg.deck >= 1 && cfg.deck <= H.LIMITS.deck && Math.floor(cfg.deck) === cfg.deck));
    markBad(el.hand, !(cfg.hand >= 0 && cfg.hand <= H.LIMITS.hand && Math.floor(cfg.hand) === cfg.hand));
    var deckCap = cfg.deck >= 1 ? Math.min(cfg.deck, H.LIMITS.draws) : H.LIMITS.draws;
    markBad(el.extra, !(cfg.extra >= 0 && Math.floor(cfg.extra) === cfg.extra && cfg.hand + cfg.extra <= deckCap));
    el.gridBody.querySelectorAll('tr').forEach(function (row, j) {
      var c = state.cards[j], K = c.copies, mx = c.max;
      markBad(row.querySelector('.copies'), !(K >= 0 && Math.floor(K) === K));
      markBad(row.querySelector('.max'), mx !== '' && !(mx >= 0 && Math.floor(mx) === mx));
    });
    el.comboBody.querySelectorAll('tr').forEach(function (row, i) {
      row.querySelectorAll('.need').forEach(function (inp, j) {
        var v = state.combos[i].needs[j];
        var c = state.cards[j], K = c.copies, mx = c.max;
        var cap = mx === '' || mx !== mx ? K : Math.min(K, mx);
        markBad(inp, !(v >= 0 && Math.floor(v) === v && (K !== K || v <= cap)));
      });
    });

    el.errors.innerHTML = s.ok ? '' : s.errors.map(function (m) { return '<div>' + esc(m) + '</div>'; }).join('');
    if (!s.ok) { clearResults('Fix the highlighted fields to see results.'); syncUrl(); return; }

    var report = H.analyze(cfg);
    var pOpen = report.open;
    var mt = report.mull;

    el.pOpen.textContent = fmtPct(pOpen);
    el.pOpenD.innerHTML = 'Chance of ' + describeGoal(s) + ' in ' + handPhrase(s) + '.';
    el.pOpenOdds.textContent = fmtOdds(pOpen);
    el.pMiss.textContent = fmtPct(1 - pOpen);
    el.pFull.textContent = mt.feasible ? fmtPct(mt.full) : '—';
    el.pFullD.textContent = mt.feasible
      ? (s.e > 0 ? 'Keep what is worth keeping, send back the rest, then take the ' + s.e + ' extra ' + plural(s.e, 'draw') + '.' : 'Keep what is worth keeping, send back the rest, draw that many.')
      : 'Deck too small for the mulligan model.';

    renderCombos(s, report);
    renderMarginals(s);
    renderMulligan(s, mt);

    if (seenLabelsStale(s)) renderSeenInputs(s);
    else el.seenInputs.querySelectorAll('.inhand').forEach(function (i, idx) { i.max = Math.min(s.cards[idx].K, s.n); });
    readSeen();
    renderSeen(s, cfg);
    syncUrl();
  }

  /* ---------- URL state ----------
     d=deck h=hand x=extra
     c=copies,max,name|copies,max,name   (name escapes % , | only)
     k=1.1.0|1.0.1                        (one combo per |, needs per card joined by .)
     ih=0,2,0                             (copies in hand, optional)
     Legacy g=copies,min,max,name|... (single combo) is still read. */
  function syncUrl() {
    var p = new URLSearchParams();
    p.set('d', el.deck.value); p.set('h', el.hand.value);
    if (el.extra.value !== '0' && el.extra.value !== '') p.set('x', el.extra.value);
    p.set('c', state.cards.map(function (c) {
      var safeName = c.name.replace(/%/g, '%25').replace(/,/g, '%2C').replace(/\|/g, '%7C');
      return [c.copies === c.copies ? c.copies : '', c.max === '' || c.max !== c.max ? '' : c.max, safeName].join(',');
    }).join('|'));
    p.set('k', state.combos.map(function (cb) { return cb.needs.map(function (v) { return v === v ? v : 0; }).join('.'); }).join('|'));
    if (state.inHand.some(function (v) { return v > 0; })) p.set('ih', state.inHand.join(','));
    var q = '?' + p.toString();
    if (location.search !== q) history.replaceState(null, '', q + location.hash);
  }
  function num(v) { return v === '' || v == null ? NaN : Number(v); }
  function loadUrl() {
    var p = new URLSearchParams(location.search);
    if (!p.has('c') && !p.has('g')) return false;
    var d = Number(p.get('d')), h = Number(p.get('h')), x = Number(p.get('x') || 0);
    if (isFinite(d)) el.deck.value = d;
    if (isFinite(h)) el.hand.value = h;
    if (isFinite(x)) el.extra.value = x;
    function decodeName(raw) { try { return decodeURIComponent(raw).slice(0, 40); } catch (e) { return raw.slice(0, 40); } }
    if (p.has('c')) {
      var cards = p.get('c').split('|').slice(0, MAX_CARDS).map(function (chunk) {
        var parts = chunk.split(',');
        return { copies: num(parts[0]), max: parts[1] === '' || parts[1] == null ? '' : Number(parts[1]), name: decodeName(parts.slice(2).join(',')) };
      });
      var combos = (p.get('k') || '').split('|').filter(Boolean).slice(0, MAX_COMBOS).map(function (chunk) {
        var needs = chunk.split('.').map(function (v) { var n = Number(v); return isFinite(n) && n >= 0 ? Math.floor(n) : 0; });
        while (needs.length < cards.length) needs.push(0);
        return { needs: needs.slice(0, cards.length) };
      });
      if (cards.length) state.cards = cards;
      state.combos = combos.length ? combos : [{ needs: cards.map(function () { return 1; }) }];
    } else {
      var legacy = p.get('g').split('|').slice(0, MAX_CARDS).map(function (chunk) {
        var parts = chunk.split(',');
        return { copies: num(parts[0]), min: num(parts[1]), max: parts[2] === '' || parts[2] == null ? '' : Number(parts[2]), name: decodeName(parts.slice(3).join(',')) };
      });
      state.cards = legacy.map(function (g) { return { copies: g.copies, max: g.max, name: g.name }; });
      state.combos = [{ needs: legacy.map(function (g) { return g.min === g.min ? g.min : 1; }) }];
    }
    var ih = p.get('ih');
    state.inHand = ih ? ih.split(',').map(function (v) { var n = Number(v); return isFinite(n) && n >= 0 ? Math.floor(n) : 0; }) : [];
    while (state.inHand.length < state.cards.length) state.inHand.push(0);
    return true;
  }

  /* ---------- wiring ---------- */
  [el.deck, el.hand, el.extra].forEach(function (i) { i.addEventListener('input', scheduleUpdate); });
  el.gridBody.addEventListener('input', function (e) {
    if (e.target.classList.contains('name')) {
      var tr = e.target.closest('tr');
      var idx = Array.prototype.indexOf.call(el.gridBody.children, tr);
      var head = el.comboHead.children[idx + 1];
      if (head) {
        var label = e.target.value.trim() || ('Card ' + (idx + 1));
        head.querySelector('span').textContent = label;
        head.title = label;
      }
    }
    scheduleUpdate();
  });
  el.comboBody.addEventListener('input', scheduleUpdate);
  el.seenInputs.addEventListener('input', scheduleUpdate);
  el.addCard.addEventListener('click', function () {
    if (state.cards.length >= MAX_CARDS) return;
    readGrid();
    state.cards.push({ name: '', copies: 4, max: '' });
    state.inHand.push(0);
    state.combos.forEach(function (cb, i) { cb.needs.push(i === 0 && state.combos.length === 1 ? 1 : 0); });
    renderGrid();
    var rows = el.gridBody.querySelectorAll('tr');
    rows[rows.length - 1].querySelector('.name').focus();
    update();
  });
  el.addCombo.addEventListener('click', function () {
    if (state.combos.length >= MAX_COMBOS) return;
    readGrid();
    state.combos.push({ needs: state.cards.map(function () { return 0; }) });
    renderGrid();
    var cell = el.comboBody.querySelector('tr:last-child .need');
    if (cell) cell.focus();
    update();
  });
  document.querySelectorAll('.presets .chip').forEach(function (b) {
    b.addEventListener('click', function () {
      el.deck.value = b.dataset.deck; el.hand.value = b.dataset.hand; el.extra.value = 0;
      update();
    });
  });
  el.share.addEventListener('click', function () {
    syncUrl();
    var url = location.href;
    function done(ok) {
      el.copied.textContent = ok ? 'Link copied' : 'Copy failed, grab it from the address bar';
      setTimeout(function () { el.copied.textContent = ''; }, 2400);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); });
    else done(false);
  });

  loadUrl();
  renderGrid();
  update();
})();
