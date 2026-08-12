const $ = id => document.getElementById(id);

const CFG = {
  stake: 0.35,
  historyCount: 1400,
  bufferMax: 1800,
  durations: [5, 10, 20, 30],
  cycleMs: 12000,
  proposalTop: 3,
  proposalGapMs: 1000,
  discoveryAfterMs: 90000,
  discoveryGapMs: 120000,
  maxDiscoveryPerModel: 2,
  sessionLossCap: -1.40,
  maxTrades: 20,
  strongBank: 3.00,
  evidenceKey: 'sani_structured_evidence_v3'
};

const S = {
  publicWs: null,
  tradeWs: null,
  pubPending: new Map(),
  tradePending: new Map(),
  pubReq: 1000,
  tradeReq: 9000,
  account: null,
  running: false,
  starting: false,
  generation: 0,
  symbols: [],
  catalog: new Map(),
  focus: [],
  buffers: new Map(),
  tickAt: new Map(),
  models: new Map(),
  modelStats: new Map(),
  structural: 0,
  quoted: 0,
  dropped: 0,
  pnl: 0,
  trades: 0,
  wins: 0,
  losses: 0,
  active: null,
  timer: null,
  heartbeat: null,
  current: null,
  runStartedAt: 0,
  lastDiscoveryAt: 0,
  buyBlockedUntil: 0,
  buyBackoff: 60000,
  proposalBlockedUntil: 0,
  proposalBackoff: 30000,
  idleCycles: 0
};

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const money = v => `${v > 0 ? '+' : v < 0 ? '-' : ''}$${Math.abs(v || 0).toFixed(3)}`;
const pct = v => Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function log(text, cls = '') {
  const el = $('log');
  if (!el) return;
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  el.prepend(d);
  while (el.children.length > 160) el.lastElementChild.remove();
}

function phase(n) {
  for (let i = 1; i <= 7; i++) $(`p${i}`)?.classList.toggle('on', i === n);
}

function status(title, detail, p = 0) {
  if ($('status')) $('status').textContent = title;
  if ($('detail')) $('detail').textContent = detail;
  if (p) phase(p);
}

function decision(name, text, mode = 'rest') {
  if ($('decisionName')) $('decisionName').textContent = name;
  if ($('decisionText')) $('decisionText').textContent = text;
  if ($('decisionMode')) {
    $('decisionMode').textContent = mode.toUpperCase();
    $('decisionMode').className = `mode ${mode}`;
  }
}

function defaultStats() {
  return { trades: 0, wins: 0, losses: 0, pnl: 0, lossStreak: 0, dropped: false, discovery: 0, verified: 0 };
}

function loadEvidence() {
  try {
    const raw = JSON.parse(localStorage.getItem(CFG.evidenceKey) || '{}');
    for (const [k, v] of Object.entries(raw)) S.modelStats.set(k, { ...defaultStats(), ...v });
  } catch {}
}

function persistEvidence() {
  try {
    const rows = [...S.modelStats.entries()]
      .sort((a, b) => (b[1].trades || 0) - (a[1].trades || 0))
      .slice(0, 240);
    localStorage.setItem(CFG.evidenceKey, JSON.stringify(Object.fromEntries(rows)));
  } catch {}
}

function stats(key) {
  return S.modelStats.get(key) || defaultStats();
}

function saveStats(key, value) {
  S.modelStats.set(key, value);
  persistEvidence();
}

function render() {
  if ($('pnl')) $('pnl').textContent = money(S.pnl);
  if ($('trades')) $('trades').textContent = String(S.trades);
  if ($('wl')) $('wl').textContent = `${S.wins} / ${S.losses}`;
  if ($('symbols')) $('symbols').textContent = String(S.symbols.length);
  if ($('models')) $('models').textContent = String(S.models.size);
  if ($('quoted')) $('quoted').textContent = String(S.quoted);
  if ($('structural')) $('structural').textContent = String(S.structural);
  if ($('dropped')) $('dropped').textContent = String(S.dropped);
  if ($('contractTypes')) $('contractTypes').textContent = String(new Set([...S.catalog.values()].flatMap(x => x.types)).size);
  if ($('scanPulse')) {
    $('scanPulse').textContent = S.active ? 'SETTLING' : S.running
      ? Date.now() < S.buyBlockedUntil ? 'BUY COOLDOWN'
      : Date.now() < S.proposalBlockedUntil ? 'PRICING COOLDOWN'
      : 'WATCHING'
      : 'IDLE';
  }
  renderCurrent();
  renderTape();
}

function renderCurrent() {
  const c = S.current;
  if (!c?.proposal) {
    if ($('candidateTitle')) $('candidateTitle').textContent = 'Nothing selected yet';
    if ($('candidatePill')) $('candidatePill').textContent = 'WATCHING';
    if ($('candidateArea')) $('candidateArea').innerHTML = '<div class="box"><span>CONTRACT</span><strong>—</strong></div><div class="box"><span>OOS SAMPLE</span><strong>—</strong></div><div class="box"><span>VALIDATION / TEST</span><strong>—</strong></div><div class="box"><span>REALIZED P/L</span><strong>—</strong></div><div class="box"><span>STATUS</span><strong>—</strong></div>';
    for (const id of ['breakEven', 'modelProb', 'confFloor', 'expectedEdge']) if ($(id)) $(id).textContent = '—';
    return;
  }
  const st = stats(c.key);
  if ($('candidateTitle')) $('candidateTitle').textContent = `${c.label} · ${c.symbolName}`;
  if ($('candidatePill')) $('candidatePill').textContent = st.dropped ? 'DROPPED' : c.mode || 'WATCH';
  if ($('candidateArea')) $('candidateArea').innerHTML = `<div class="box"><span>CONTRACT</span><strong>${c.contractType}</strong></div><div class="box"><span>OOS SAMPLE</span><strong>${c.sample}</strong></div><div class="box"><span>VALIDATION / TEST</span><strong>${pct(c.valP)} / ${pct(c.testP)}</strong></div><div class="box"><span>REALIZED P/L</span><strong>${money(st.pnl)}</strong></div><div class="box"><span>STATUS</span><strong>${st.dropped ? 'DROPPED' : c.mode || 'WATCH'}</strong></div>`;
  if ($('breakEven')) $('breakEven').textContent = pct(c.proposal.breakEven);
  if ($('modelProb')) $('modelProb').textContent = pct(c.p);
  if ($('confFloor')) $('confFloor').textContent = pct(c.lower);
  if ($('expectedEdge')) $('expectedEdge').textContent = money(c.proposal.confExpected);
}

function renderTape() {
  if (!$('tradeTape')) return;
  const rows = [...S.modelStats.entries()]
    .filter(([, v]) => v.trades)
    .sort((a, b) => b[1].pnl - a[1].pnl)
    .slice(0, 10);
  $('tradeTape').innerHTML = rows.map(([k, v]) => `<div class="tradeLine"><span>${k}</span><strong class="${v.pnl >= 0 ? 'good' : 'bad'}">${v.wins}W/${v.losses}L · ${money(v.pnl)} · D${v.discovery || 0}/V${v.verified || 0}${v.dropped ? ' · DROPPED' : ''}</strong></div>`).join('');
}

function wsRequest(ws, pending, seqKey, payload, timeout = 10000) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(Error('WebSocket not connected'));
  const id = ++S[seqKey];
  payload.req_id = id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error('Deriv request timed out'));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    try { ws.send(JSON.stringify(payload)); }
    catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e);
    }
  });
}

const publicRequest = (payload, timeout) => wsRequest(S.publicWs, S.pubPending, 'pubReq', payload, timeout);
const tradeRequest = (payload, timeout) => wsRequest(S.tradeWs, S.tradePending, 'tradeReq', payload, timeout);

function pushTick(symbol, quote) {
  const q = num(quote);
  if (!symbol || q === null) return;
  const a = S.buffers.get(symbol) || [];
  a.push(q);
  if (a.length > CFG.bufferMax) a.splice(0, a.length - CFG.bufferMax);
  S.buffers.set(symbol, a);
  S.tickAt.set(symbol, Date.now());
}

function route(map, event, trade = false) {
  let msg;
  try { msg = JSON.parse(event.data); } catch { return; }
  if (msg.msg_type === 'tick' && msg.tick?.symbol) pushTick(msg.tick.symbol, msg.tick.quote);
  const p = map.get(msg.req_id);
  if (msg.error) {
    if (p) {
      clearTimeout(p.timer);
      map.delete(msg.req_id);
      p.reject(Error(msg.error.message || msg.error.code || 'Deriv error'));
    } else log(msg.error.message || msg.error.code, 'bad');
    return;
  }
  if (p) {
    clearTimeout(p.timer);
    map.delete(msg.req_id);
    p.resolve(msg);
  }
  if (trade && msg.msg_type === 'proposal_open_contract') contractUpdate(msg);
}

async function loadSession() {
  const r = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || !b.authenticated || !b.demoAccount) throw Error('Login with Deriv first.');
  S.account = b.demoAccount;
  if ($('account')) $('account').textContent = `${b.demoAccount.account_id} · ${b.demoAccount.currency || 'USD'} · Demo`;
}

async function connectPublic() {
  if (S.publicWs?.readyState === WebSocket.OPEN) return;
  await new Promise((resolve, reject) => {
    let done = false;
    const ws = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
    const timer = setTimeout(() => {
      if (!done) { done = true; reject(Error('Public market-data socket timeout')); }
    }, 10000);
    ws.onopen = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      S.publicWs = ws;
      ws.onmessage = e => route(S.pubPending, e, false);
      resolve();
    };
    ws.onerror = () => {
      if (!done) { done = true; clearTimeout(timer); reject(Error('Could not open public market-data socket')); }
    };
    ws.onclose = () => { if (S.publicWs === ws) S.publicWs = null; };
  });
  log('Public market-data socket connected.', 'good');
}

async function connectTrade() {
  if (S.tradeWs?.readyState === WebSocket.OPEN) return;
  const r = await fetch('/api/demo-otp', { method: 'POST', credentials: 'same-origin' });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || !b.url) throw Error(b.error || 'Could not open Demo trading socket');
  await new Promise((resolve, reject) => {
    let done = false;
    const ws = new WebSocket(b.url);
    const timer = setTimeout(() => {
      if (!done) { done = true; reject(Error('Demo trading socket timeout')); }
    }, 10000);
    ws.onopen = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      S.tradeWs = ws;
      ws.onmessage = e => route(S.tradePending, e, true);
      S.heartbeat = setInterval(() => {
        try { ws.send(JSON.stringify({ ping: 1, req_id: ++S.tradeReq })); } catch {}
      }, 30000);
      resolve();
    };
    ws.onerror = () => {
      if (!done) { done = true; clearTimeout(timer); reject(Error('Could not open Demo trading socket')); }
    };
    ws.onclose = () => {
      clearInterval(S.heartbeat);
      if (S.tradeWs === ws) S.tradeWs = null;
      S.running = false;
      clearTimeout(S.timer);
      status('TRADING CONNECTION CLOSED', 'Demo trading connection closed. No new entries will be sent.');
      if ($('start')) $('start').disabled = !!S.active;
      if ($('stop')) $('stop').disabled = true;
    };
  });
  log('Demo trading socket connected.', 'good');
}

function familyOf(symbol) {
  const n = String(symbol?.name || '').toLowerCase();
  if (n.includes('skew step')) return 'skew';
  if (n.includes('range break')) return 'range';
  if (n.includes('drift')) return 'drift';
  if (n.includes('trek')) return 'trek';
  if (n.includes('crash')) return 'crash';
  if (n.includes('boom')) return 'boom';
  if (n.includes('bull market')) return 'bull';
  if (n.includes('bear market')) return 'bear';
  return null;
}

async function mapUniverse() {
  status('MAPPING', 'Mapping everything, then isolating structured markets for the trading tournament.', 1);
  const a = await publicRequest({ active_symbols: 'brief' }, 12000);
  const rows = Array.isArray(a.active_symbols) ? a.active_symbols : [];
  S.symbols = rows.map(x => ({
    code: x.underlying_symbol,
    name: x.underlying_symbol_name || x.underlying_symbol,
    type: x.underlying_symbol_type || '',
    pip: num(x.pip_size) || 0.01
  })).filter(x => x.code);

  S.catalog.clear();
  let cursor = 0;
  const workers = Array.from({ length: 5 }, async () => {
    while (cursor < S.symbols.length) {
      const s = S.symbols[cursor++];
      try {
        const r = await publicRequest({ contracts_for: s.code }, 10000);
        const available = Array.isArray(r?.contracts_for?.available) ? r.contracts_for.available : [];
        const types = [...new Set(available.map(x => x.contract_type).filter(Boolean))];
        S.catalog.set(s.code, { symbol: s, types, available });
      } catch {
        S.catalog.set(s.code, { symbol: s, types: [], available: [] });
      }
      render();
    }
  });
  await Promise.all(workers);

  S.structural = [...S.catalog.values()].reduce((n, x) => n + x.types.length * (x.types.length - 1) / 2, 0);
  S.focus = [...S.catalog.values()].map(x => x.symbol).filter(s => {
    const family = familyOf(s);
    const types = S.catalog.get(s.code)?.types || [];
    return family && types.includes('CALL') && types.includes('PUT');
  });
  log(`Mapped ${S.symbols.length} symbols. ${S.focus.length} verified structured symbols support CALL/PUT research.`, 'good');
  render();
}

async function seedBuffers(gen) {
  status('STATISTICAL TEST', 'Loading history once. Live ticks will keep the structured-market buffers fresh.', 3);
  S.buffers.clear();
  let cursor = 0;
  const workers = Array.from({ length: 2 }, async () => {
    while (cursor < S.focus.length && S.running && gen === S.generation) {
      const s = S.focus[cursor++];
      try {
        const r = await publicRequest({ ticks_history: s.code, end: 'latest', count: CFG.historyCount, style: 'ticks' }, 15000);
        const prices = (r?.history?.prices || []).map(Number).filter(Number.isFinite);
        if (prices.length) S.buffers.set(s.code, prices.slice(-CFG.bufferMax));
      } catch (e) { log(`${s.code} history · ${e.message}`, 'warn'); }
    }
  });
  await Promise.all(workers);

  const codes = S.focus.filter(s => S.buffers.has(s.code)).map(s => s.code);
  if (!codes.length) return;
  try {
    await publicRequest({ ticks: codes, subscribe: 1 }, 10000);
    log(`Live ticks subscribed for ${codes.length} structured markets.`, 'good');
  } catch (e) {
    log(`Multi-symbol live subscription failed · ${e.message}. Falling back to individual streams.`, 'warn');
    for (const code of codes) {
      try { await publicRequest({ ticks: code, subscribe: 1 }, 8000); }
      catch (err) { log(`${code} live tick stream · ${err.message}`, 'warn'); }
      await sleep(200);
    }
  }
}

function absMedian(values) {
  const a = values.map(Math.abs).filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return 0;
  const i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
}

function trendScore(prices, lookback = 30, end = prices.length - 1) {
  if (end < lookback) return 0;
  let net = 0, gross = 0;
  for (let i = end - lookback + 1; i <= end; i++) {
    const d = prices[i] - prices[i - 1];
    net += d;
    gross += Math.abs(d);
  }
  return gross ? net / gross : 0;
}

function rangePosition(prices, lookback = 80, end = prices.length - 1) {
  if (end < lookback) return 0.5;
  const w = prices.slice(end - lookback + 1, end + 1);
  const lo = Math.min(...w), hi = Math.max(...w);
  return hi === lo ? 0.5 : (prices[end] - lo) / (hi - lo);
}

function recentSpike(prices, direction, end = prices.length - 1) {
  if (end < 50) return false;
  const deltas = [];
  for (let i = end - 49; i <= end; i++) deltas.push(prices[i] - prices[i - 1]);
  const med = absMedian(deltas) || 1e-9;
  const recent = deltas.slice(-8);
  return direction === 'down' ? Math.min(...recent) < -6 * med : Math.max(...recent) > 6 * med;
}

function eligibleDirectionAt(s, family, prices, end) {
  const name = s.name.toLowerCase();
  const t = trendScore(prices, 30, end);
  if (family === 'trek' || family === 'skew') {
    if (/up|bull|rise/.test(name)) return 'CALL';
    if (/down|bear|fall/.test(name)) return 'PUT';
    return t > 0.20 ? 'CALL' : t < -0.20 ? 'PUT' : null;
  }
  if (family === 'bull') return 'CALL';
  if (family === 'bear') return 'PUT';
  if (family === 'crash') return recentSpike(prices, 'down', end) ? null : 'CALL';
  if (family === 'boom') return recentSpike(prices, 'up', end) ? null : 'PUT';
  if (family === 'drift') return t > 0.18 ? 'CALL' : t < -0.18 ? 'PUT' : null;
  if (family === 'range') {
    const pos = rangePosition(prices, 80, end);
    if (pos > 0.76 && t > 0.16) return 'CALL';
    if (pos < 0.24 && t < -0.16) return 'PUT';
    return null;
  }
  return null;
}

function wilsonLower(w, n, z = 2.58) {
  if (!n) return 0;
  const p = w / n, z2 = z * z, den = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const adj = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (centre - adj) / den);
}

function evaluateModel(s, family, prices, type, horizon) {
  const current = eligibleDirectionAt(s, family, prices, prices.length - 1);
  if (current !== type) return null;
  const c1 = Math.floor(prices.length * 0.60);
  const c2 = Math.floor(prices.length * 0.80);
  let trn = 0, trw = 0, vn = 0, vw = 0, tn = 0, tw = 0;
  for (let i = 90; i < prices.length - horizon; i++) {
    if (eligibleDirectionAt(s, family, prices, i) !== type) continue;
    const win = type === 'CALL' ? prices[i + horizon] > prices[i] : prices[i + horizon] < prices[i];
    if (i < c1) { trn++; if (win) trw++; }
    else if (i < c2) { vn++; if (win) vw++; }
    else { tn++; if (win) tw++; }
  }
  if (vn < 12 || tn < 12) return null;
  const n = vn + tn, w = vw + tw;
  const p = w / n, valP = vw / vn, testP = tw / tn, trainP = trn ? trw / trn : 0.5;
  const lower = wilsonLower(w, n);
  return {
    key: `${s.code} · ${family} · ${type} ${horizon}t`,
    symbol: s.code,
    symbolName: s.name,
    family,
    contractType: type,
    duration: horizon,
    durationUnit: 't',
    label: `${type === 'CALL' ? 'Rise' : 'Fall'} · ${horizon} ticks`,
    sample: n,
    p,
    lower,
    valP,
    testP,
    trainP,
    preScore: Math.min(valP, testP) + 0.35 * lower + 0.15 * trainP
  };
}

function rebuildModels() {
  S.models.clear();
  for (const s of S.focus) {
    const prices = S.buffers.get(s.code);
    if (!prices || prices.length < 800) continue;
    const family = familyOf(s);
    const current = eligibleDirectionAt(s, family, prices, prices.length - 1);
    if (!current) continue;
    for (const h of CFG.durations) {
      const m = evaluateModel(s, family, prices, current, h);
      if (m) S.models.set(m.key, m);
    }
  }
  render();
}

function proposalRequest(m) {
  return {
    proposal: 1,
    amount: CFG.stake,
    basis: 'stake',
    contract_type: m.contractType,
    currency: S.account?.currency || 'USD',
    underlying_symbol: m.symbol,
    duration: m.duration,
    duration_unit: m.durationUnit
  };
}

function proposalMetrics(m, p) {
  const ask = num(p?.ask_price), payout = num(p?.payout);
  if (!p?.id || ask === null || payout === null || payout <= 0) throw Error('Incomplete proposal');
  return {
    id: p.id,
    ask,
    payout,
    breakEven: ask / payout,
    rawExpected: m.p * payout - ask,
    confExpected: m.lower * payout - ask
  };
}

async function publicProposal(m) {
  const r = await publicRequest(proposalRequest(m), 9000);
  return proposalMetrics(m, r?.proposal);
}

async function tradeProposal(m) {
  const r = await tradeRequest(proposalRequest(m), 9000);
  return proposalMetrics(m, r?.proposal);
}

async function compareModels(gen) {
  if (Date.now() < S.proposalBlockedUntil) return [];
  status('COMPARING', 'Pricing only the top structured finalists.', 4);
  const finalists = [...S.models.values()]
    .filter(m => !stats(m.key).dropped)
    .sort((a, b) => b.preScore - a.preScore)
    .slice(0, CFG.proposalTop);
  const out = [];
  for (const m of finalists) {
    if (!S.running || gen !== S.generation) break;
    try {
      const q = await publicProposal(m);
      S.quoted++;
      out.push({ ...m, proposal: q });
      S.proposalBackoff = 30000;
    } catch (e) {
      if (/rate limit/i.test(e.message)) {
        S.proposalBlockedUntil = Date.now() + S.proposalBackoff;
        const seconds = Math.ceil(S.proposalBackoff / 1000);
        S.proposalBackoff = Math.min(S.proposalBackoff * 2, 180000);
        log(`PRICING COOLDOWN · ${seconds}s · ${e.message}`, 'warn');
        break;
      }
      log(`${m.key} pricing · ${e.message}`, 'warn');
    }
    await sleep(CFG.proposalGapMs);
  }
  render();
  return out.sort((a, b) => b.proposal.confExpected - a.proposal.confExpected || b.proposal.rawExpected - a.proposal.rawExpected);
}

function verifiedGate(c) {
  const q = c.proposal;
  return c.sample >= 60 &&
    c.trainP >= q.breakEven - 0.01 &&
    c.valP >= q.breakEven + 0.015 &&
    c.testP >= q.breakEven + 0.015 &&
    c.p >= q.breakEven + 0.02 &&
    c.lower >= q.breakEven + 0.003 &&
    q.confExpected > 0;
}

function discoveryGate(c) {
  const st = stats(c.key), q = c.proposal;
  if (st.discovery >= CFG.maxDiscoveryPerModel || st.dropped) return false;
  if (Date.now() - S.runStartedAt < CFG.discoveryAfterMs) return false;
  if (Date.now() - S.lastDiscoveryAt < CFG.discoveryGapMs) return false;
  return c.sample >= 40 &&
    c.trainP >= q.breakEven - 0.04 &&
    c.valP >= q.breakEven - 0.025 &&
    c.testP >= q.breakEven - 0.025 &&
    c.p >= q.breakEven + 0.012 &&
    q.rawExpected >= 0.008 &&
    q.confExpected >= -0.025;
}

function modeFor(c) {
  const st = stats(c.key);
  if (verifiedGate(c)) {
    const empirical = st.trades ? st.wins / st.trades : 0;
    if (st.verified >= 6 && st.pnl > 0 && empirical >= c.proposal.breakEven + 0.03) return 'HARVEST';
    return 'VERIFIED PROBE';
  }
  if (discoveryGate(c)) return 'DISCOVERY';
  return 'WAIT';
}

function shouldStop(best) {
  if (S.pnl <= CFG.sessionLossCap) return `Session drawdown reached ${money(CFG.sessionLossCap)}. Sani is protecting the Demo experiment.`;
  if (S.trades >= CFG.maxTrades) return `${CFG.maxTrades} Demo settlements are enough for this run.`;
  if (S.pnl >= CFG.strongBank) return `Sani is banking a strong Demo session at ${money(S.pnl)}.`;
  if (S.pnl >= 1 && (!best || modeFor(best) === 'WAIT')) return 'Sani is banking the positive session because no qualified edge remains.';
  return '';
}

function liveConditionValid(c) {
  const prices = S.buffers.get(c.symbol);
  const fresh = Date.now() - (S.tickAt.get(c.symbol) || 0) < 10000;
  const symbol = S.focus.find(s => s.code === c.symbol);
  if (!prices || !symbol || !fresh) return false;
  return eligibleDirectionAt(symbol, c.family, prices, prices.length - 1) === c.contractType;
}

async function cycle(gen) {
  if (!S.running || gen !== S.generation || S.active) return;
  if (Date.now() < S.buyBlockedUntil) {
    const wait = Math.ceil((S.buyBlockedUntil - Date.now()) / 1000);
    status('BUY WINDOW COOLING', `Deriv rate-limited Demo buying. Waiting ${wait}s.`, 6);
    decision('PAUSE', 'Execution is cooling down. Research continues after the timer.', 'rest');
    render();
    S.timer = setTimeout(() => cycle(gen), Math.max(1000, S.buyBlockedUntil - Date.now() + 300));
    return;
  }
  if (Date.now() < S.proposalBlockedUntil) {
    const wait = Math.ceil((S.proposalBlockedUntil - Date.now()) / 1000);
    status('PRICING COOLDOWN', `Deriv rate-limited pricing. Waiting ${wait}s.`, 4);
    decision('WATCH', 'No trade conclusion is being inferred from the API cooldown.', 'rest');
    render();
    S.timer = setTimeout(() => cycle(gen), Math.max(1000, S.proposalBlockedUntil - Date.now() + 300));
    return;
  }

  status('STATISTICAL TEST', 'Refreshing 5/10/20/30-tick structured-market models.', 3);
  rebuildModels();
  const compared = await compareModels(gen);
  if (!S.running || gen !== S.generation) return;
  if (Date.now() < S.proposalBlockedUntil) {
    S.timer = setTimeout(() => cycle(gen), Math.max(1000, S.proposalBlockedUntil - Date.now() + 300));
    return;
  }

  status('CONFIDENCE TEST', 'Separating Verified probes from Demo-only Discovery probes.', 5);
  const verified = compared.find(c => verifiedGate(c));
  const discovery = compared.find(c => discoveryGate(c));
  const best = verified || discovery || compared[0] || null;
  const stopReason = shouldStop(best);
  if (stopReason) {
    S.running = false;
    status('SANI SAYS STOP', stopReason, 7);
    decision('STOP', stopReason, 'rest');
    if (S.current) S.current.mode = 'STOP';
    if ($('start')) $('start').disabled = false;
    if ($('stop')) $('stop').disabled = true;
    render();
    return;
  }

  if (!best) {
    S.idleCycles++;
    S.current = null;
    decision('WATCH', 'No structured finalist is priceable right now. Sani stays awake.', 'rest');
    if ($('guide')) $('guide').innerHTML = '<strong>Watching.</strong> Zero entries do not stop the lab anymore.';
    render();
    S.timer = setTimeout(() => cycle(gen), CFG.cycleMs);
    return;
  }

  best.mode = modeFor(best);
  S.current = best;
  render();

  if (best.mode === 'WAIT') {
    S.idleCycles++;
    const untilDiscovery = Math.max(0, Math.ceil((CFG.discoveryAfterMs - (Date.now() - S.runStartedAt)) / 1000));
    decision('WATCH', `${best.label}: OOS ${pct(best.p)}, 99% floor ${pct(best.lower)}, break-even ${pct(best.proposal.breakEven)}. ${untilDiscovery ? `Discovery lane unlocks in about ${untilDiscovery}s.` : 'Still not close enough even for a Discovery probe.'}`, 'rest');
    if ($('guide')) $('guide').innerHTML = '<strong>No forced trade.</strong> Sani keeps watching instead of stopping.';
    S.timer = setTimeout(() => cycle(gen), CFG.cycleMs);
    return;
  }

  S.idleCycles = 0;
  if (best.mode === 'DISCOVERY') {
    decision('DISCOVERY', 'Demo-only exploratory entry. Raw expectancy is positive, but the confidence floor has not earned Verified status.', 'probe');
  } else if (best.mode === 'HARVEST') {
    decision('HARVEST', 'Historical gates and accumulated real Demo evidence agree.', 'harvest');
  } else {
    decision('VERIFIED PROBE', 'This candidate cleared the strict historical and live-price gates.', 'probe');
  }
  await enterTrade(best, gen);
}

async function buyProposal(c) {
  try {
    const r = await tradeRequest({ buy: c.proposal.id, price: c.proposal.ask }, 10000);
    const id = num(r?.buy?.contract_id);
    if (id === null) throw Error('Buy returned no contract ID');
    return { id, buyPrice: num(r?.buy?.buy_price) ?? c.proposal.ask, profit: 0 };
  } catch (e) {
    if (/rate limit/i.test(e.message)) e.rateLimit = true;
    throw e;
  }
}

async function enterTrade(c, gen) {
  if (!S.running || gen !== S.generation) return;
  status('LIVE CONTEXT CHECK', 'Confirming the structural condition still exists immediately before execution.', 5);
  if (!liveConditionValid(c)) {
    log(`${c.key} skipped · structural condition changed or live tick is stale.`, 'warn');
    S.timer = setTimeout(() => cycle(gen), 4000);
    return;
  }

  try { c.proposal = await tradeProposal(c); }
  catch (e) {
    log(`${c.key} authenticated re-price failed · ${e.message}`, 'warn');
    S.timer = setTimeout(() => cycle(gen), 5000);
    return;
  }

  c.mode = modeFor(c);
  S.current = c;
  render();
  if (c.mode === 'WAIT') {
    log(`${c.key} skipped · entry lane vanished on authenticated re-price.`, 'warn');
    S.timer = setTimeout(() => cycle(gen), 4000);
    return;
  }
  if ((c.mode === 'VERIFIED PROBE' || c.mode === 'HARVEST') && c.proposal.confExpected <= 0) {
    log(`${c.key} skipped · Verified lane cannot buy non-positive conservative EV.`, 'warn');
    S.timer = setTimeout(() => cycle(gen), 4000);
    return;
  }

  status(c.mode === 'DISCOVERY' ? 'DISCOVERY PROBE' : c.mode === 'HARVEST' ? 'HARVESTING' : 'VERIFIED PROBE', `${c.label} on ${c.symbolName}. Real Demo stake $${CFG.stake.toFixed(2)}.`, 6);
  let leg;
  try { leg = await buyProposal(c); }
  catch (e) {
    if (e.rateLimit) {
      S.buyBlockedUntil = Date.now() + S.buyBackoff;
      const seconds = Math.ceil(S.buyBackoff / 1000);
      S.buyBackoff = Math.min(S.buyBackoff * 2, 300000);
      status('BUY RATE LIMIT', `Deriv declined the Demo buy. Waiting ${seconds}s.`, 6);
      decision('PAUSE', 'The candidate still exists; execution is cooling down.', 'rest');
      log(`BUY COOLDOWN · ${seconds}s · ${c.key}`, 'warn');
      render();
      S.timer = setTimeout(() => cycle(gen), S.buyBlockedUntil - Date.now() + 300);
      return;
    }
    log(`${c.key} buy failed · ${e.message}`, 'warn');
    S.timer = setTimeout(() => cycle(gen), 5000);
    return;
  }

  if (c.mode === 'DISCOVERY') S.lastDiscoveryAt = Date.now();
  S.buyBackoff = 60000;
  S.buyBlockedUntil = Date.now() + 15000;
  S.active = { candidate: c, leg, entryMode: c.mode };
  S.trades++;
  tradeRequest({ proposal_open_contract: 1, contract_id: leg.id, subscribe: 1 }, 8000).catch(e => log(`Contract monitor · ${e.message}`, 'warn'));
  log(`${c.mode} OPEN · ${c.key} · OOS ${pct(c.p)} · floor ${pct(c.lower)} · BE ${pct(c.proposal.breakEven)} · raw ${money(c.proposal.rawExpected)} · conservative ${money(c.proposal.confExpected)}`, 'good');
  render();
}

function contractUpdate(msg) {
  if (!S.active) return;
  const c = msg?.proposal_open_contract;
  const id = num(c?.contract_id);
  if (id !== S.active.leg.id) return;
  S.active.leg.profit = num(c?.profit) ?? S.active.leg.profit;
  const done = !!c?.is_sold || ['won', 'lost', 'sold', 'expired'].includes(String(c?.status || '').toLowerCase());
  if (!done) return;

  const candidate = S.active.candidate;
  const entryMode = S.active.entryMode;
  const profit = S.active.leg.profit || 0;
  const st = stats(candidate.key);
  st.trades++;
  st.pnl += profit;
  if (entryMode === 'DISCOVERY') st.discovery++;
  else st.verified++;
  if (profit > 0) {
    st.wins++;
    st.lossStreak = 0;
    S.wins++;
  } else {
    st.losses++;
    st.lossStreak++;
    S.losses++;
  }
  if (st.lossStreak >= 2 || (st.trades >= 5 && st.pnl < 0)) {
    if (!st.dropped) {
      st.dropped = true;
      S.dropped++;
      log(`AUTO-DROP · ${candidate.key} · ${st.trades} real Demo trades · ${money(st.pnl)}`, 'bad');
    }
  }
  saveStats(candidate.key, st);
  S.pnl += profit;
  S.active = null;
  log(`SETTLED · ${candidate.key} · ${entryMode} · ${money(profit)} · accumulated ${money(st.pnl)}`, profit > 0 ? 'good' : 'bad');
  render();

  if (S.running) S.timer = setTimeout(() => cycle(S.generation), Math.max(CFG.cycleMs, S.buyBlockedUntil - Date.now() + 100));
  else {
    status('STOPPED', 'The open Demo contract settled. Sani is fully stopped.');
    decision('STOP', 'No open Demo contracts remain.', 'rest');
    if ($('start')) $('start').disabled = false;
    if ($('stop')) $('stop').disabled = true;
    render();
  }
}

async function start() {
  if (S.running || S.starting || S.active) return;
  S.starting = true;
  if ($('start')) $('start').disabled = true;
  if ($('stop')) $('stop').disabled = false;
  S.pnl = 0;
  S.trades = 0;
  S.wins = 0;
  S.losses = 0;
  S.idleCycles = 0;
  S.quoted = 0;
  S.dropped = 0;
  S.current = null;
  S.models.clear();
  S.buyBlockedUntil = 0;
  S.buyBackoff = 60000;
  S.proposalBlockedUntil = 0;
  S.proposalBackoff = 30000;
  S.runStartedAt = Date.now();
  S.lastDiscoveryAt = 0;
  S.generation++;
  const gen = S.generation;
  try {
    await loadSession();
    await Promise.all([connectPublic(), connectTrade()]);
    S.running = true;
    await mapUniverse();
    if (!S.focus.length) throw Error('No verified structured CALL/PUT markets are available right now.');
    status('STRUCTURAL TEST', 'Verified structured families only. Discovery probes are Demo-only and never count as Harvest evidence by themselves.', 2);
    await seedBuffers(gen);
    rebuildModels();
    render();
    await cycle(gen);
  } catch (e) {
    S.running = false;
    status('CANNOT START', e.message);
    decision('STOP', e.message, 'rest');
    if ($('start')) $('start').disabled = false;
    if ($('stop')) $('stop').disabled = true;
  } finally {
    S.starting = false;
  }
}

function stop() {
  S.running = false;
  S.generation++;
  clearTimeout(S.timer);
  if (S.active) {
    status('STOPPING', 'No new Demo entries. Waiting for the open Demo contract to settle.');
    decision('STOP AFTER SETTLEMENT', 'One Demo contract is still open.', 'rest');
    if ($('start')) $('start').disabled = true;
    if ($('stop')) $('stop').disabled = true;
  } else {
    status('STOPPED', 'You stopped Sani. No new Demo entries will be sent.');
    decision('STOP', 'Manual stop.', 'rest');
    if ($('start')) $('start').disabled = false;
    if ($('stop')) $('stop').disabled = true;
  }
  render();
}

loadEvidence();
if ($('start')) $('start').onclick = start;
if ($('stop')) $('stop').onclick = stop;
(async () => {
  try {
    await loadSession();
    status('READY', 'Start Sani. Verified trades stay strict; Demo-only Discovery probes prevent the lab from learning nothing.');
  } catch {
    status('LOGIN REQUIRED', 'Login with Deriv first. Demo only.');
  }
  decision('WATCH', 'Ready for a structured-market run.', 'rest');
  render();
})();