const $ = id => document.getElementById(id);

const PUBLIC_WS = 'wss://api.derivws.com/trading/v1/options/ws/public';
const DERIV_CLIENT_ID = '345Q6O96H6J8ANmWhmGkX';
const REDIRECT_URI = 'https://sani-arb.vercel.app/callback';

const state = {
  ws: null,
  mode: 'idle',
  authenticated: false,
  demoAccount: null,
  connectedDemo: false,
  scanning: false,
  autoExecute: false,
  executing: false,
  killed: false,
  touch: null,
  noTouch: null,
  stableCount: 0,
  lastQualifiedSignature: '',
  reqSeq: 1000,
  pending: new Map(),
  currentPair: null,
};

function now() { return new Date().toLocaleTimeString(); }
function log(message, level = '') {
  const line = document.createElement('div');
  if (level) line.className = level;
  line.textContent = `[${now()}] ${message}`;
  $('log').prepend(line);
}
function money(v) { return Number.isFinite(v) ? `$${v.toFixed(4)}` : '—'; }
function setStatus(title, detail, tone = 'neutral') {
  $('statusText').textContent = title;
  $('statusDetail').textContent = detail;
  $('modePill').className = `pill ${tone}`;
  $('modePill').textContent = state.connectedDemo ? 'DERIV DEMO' : (state.scanning ? 'PUBLIC SCANNER' : 'IDLE');
}
function settings() {
  return {
    symbol: $('symbol').value,
    barrier: $('barrier').value.trim(),
    duration: Number($('duration').value),
    durationUnit: $('durationUnit').value,
    targetPayout: Number($('targetPayout').value),
    minEdge: Number($('minEdge').value),
    stableChecks: Number($('stableChecks').value),
  };
}
function validateSettings() {
  const s = settings();
  if (!s.symbol || !s.barrier || !Number.isFinite(s.duration) || s.duration <= 0) throw new Error('Check symbol, barrier and duration.');
  if (!Number.isFinite(s.targetPayout) || s.targetPayout <= 0) throw new Error('Target payout must be above zero.');
  if (!Number.isFinite(s.minEdge) || s.minEdge < 0) throw new Error('Minimum edge cannot be negative.');
  return s;
}
function proposalRequest(contractType, reqId) {
  const s = validateSettings();
  return {
    proposal: 1,
    amount: s.targetPayout,
    basis: 'payout',
    contract_type: contractType,
    currency: 'USD',
    duration: s.duration,
    duration_unit: s.durationUnit,
    barrier: s.barrier,
    underlying_symbol: s.symbol,
    subscribe: 1,
    req_id: reqId,
  };
}
function send(obj) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not connected.');
  state.ws.send(JSON.stringify(obj));
}
function request(obj, timeoutMs = 8000) {
  const reqId = ++state.reqSeq;
  obj.req_id = reqId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { state.pending.delete(reqId); reject(new Error('Request timed out.')); }, timeoutMs);
    state.pending.set(reqId, { resolve, reject, timer });
    try { send(obj); } catch (err) { clearTimeout(timer); state.pending.delete(reqId); reject(err); }
  });
}
function parseProposal(msg) {
  if (!msg?.proposal) return null;
  const ask = Number(msg.proposal.ask_price);
  const payout = Number(msg.proposal.payout);
  if (!msg.proposal.id || !Number.isFinite(ask) || !Number.isFinite(payout)) return null;
  return { id: msg.proposal.id, ask, payout, receivedAt: Date.now() };
}
function updateUI() {
  $('touchAsk').textContent = money(state.touch?.ask);
  $('touchPayout').textContent = money(state.touch?.payout);
  $('noTouchAsk').textContent = money(state.noTouch?.ask);
  $('noTouchPayout').textContent = money(state.noTouch?.payout);
  if (!state.touch || !state.noTouch) {
    $('combinedCost').textContent = '—'; $('lockedEdge').textContent = '—'; $('stabilityScore').textContent = String(state.stableCount); return;
  }
  const combined = state.touch.ask + state.noTouch.ask;
  const payoutFloor = Math.min(state.touch.payout, state.noTouch.payout);
  const edge = payoutFloor - combined;
  $('combinedCost').textContent = money(combined);
  $('lockedEdge').textContent = `${edge >= 0 ? '+' : ''}${money(edge)}`;
  $('stabilityScore').textContent = String(state.stableCount);
}
function evaluatePair() {
  updateUI();
  if (!state.touch || !state.noTouch || state.killed || !state.scanning) return;
  const s = settings();
  const age = Math.max(Date.now() - state.touch.receivedAt, Date.now() - state.noTouch.receivedAt);
  const combined = state.touch.ask + state.noTouch.ask;
  const payoutFloor = Math.min(state.touch.payout, state.noTouch.payout);
  const edge = payoutFloor - combined;
  const fresh = age <= 2500;
  const qualified = fresh && edge >= s.minEdge;
  const signature = qualified ? `${state.touch.id}|${state.noTouch.id}|${edge.toFixed(6)}` : '';
  if (qualified) {
    if (signature !== state.lastQualifiedSignature) { state.stableCount += 1; state.lastQualifiedSignature = signature; }
  } else { state.stableCount = 0; state.lastQualifiedSignature = ''; }
  $('stabilityScore').textContent = String(state.stableCount);
  if (!fresh) return setStatus('Waiting for fresh quotes', 'Both legs must be fresh before the engine can arm.', 'neutral');
  if (!qualified) return setStatus('No arbitrage', `Current pair edge ${edge.toFixed(4)} USD is below your ${s.minEdge.toFixed(4)} USD minimum.`, 'neutral');
  if (state.stableCount < s.stableChecks) return setStatus('Candidate detected', `Positive edge ${edge.toFixed(4)} USD. Confirming stability ${state.stableCount}/${s.stableChecks}.`, 'armed');
  setStatus('Arbitrage armed', `Quoted floor edge ${edge.toFixed(4)} USD after ${state.stableCount} stable checks.`, 'armed');
  if (state.connectedDemo && $('autoExecute').checked && !state.executing) {
    executePair().catch(err => { log(`Execution error: ${err.message}`, 'bad'); emergencyStop(`Execution error: ${err.message}`); });
  }
}
function handleMessage(event) {
  let msg; try { msg = JSON.parse(event.data); } catch { return; }
  if (msg.error) {
    const pending = state.pending.get(msg.req_id);
    if (pending) { clearTimeout(pending.timer); state.pending.delete(msg.req_id); pending.reject(new Error(msg.error.message || msg.error.code || 'Deriv API error')); }
    else log(`Deriv error: ${msg.error.message || msg.error.code}`, 'bad');
    return;
  }
  const pending = state.pending.get(msg.req_id);
  if (pending) { clearTimeout(pending.timer); state.pending.delete(msg.req_id); pending.resolve(msg); }
  if (msg.msg_type === 'proposal') {
    const p = parseProposal(msg); if (!p) return;
    if (msg.req_id === 101) state.touch = p;
    if (msg.req_id === 102) state.noTouch = p;
    evaluatePair();
  }
}
async function openSocket(url, mode) {
  closeSocket();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('WebSocket connection timed out.')); }, 10000);
    ws.onopen = () => {
      clearTimeout(timer); state.ws = ws; state.mode = mode; ws.onmessage = handleMessage;
      ws.onclose = () => {
        if (state.ws === ws) {
          state.ws = null; state.scanning = false; state.connectedDemo = false;
          $('autoExecute').checked = false; $('autoExecute').disabled = true; $('connectDemoBtn').disabled = !state.authenticated;
          setStatus('Disconnected', 'Connection closed.', 'neutral');
        }
      };
      ws.onerror = () => log('WebSocket network error.', 'bad'); resolve(ws);
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('Could not open WebSocket.')); };
  });
}
function closeSocket() {
  if (state.ws) { try { state.ws.close(); } catch {} }
  state.ws = null;
  state.pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error('Connection closed.')); });
  state.pending.clear();
}
function resetQuotes() { state.touch = null; state.noTouch = null; state.stableCount = 0; state.lastQualifiedSignature = ''; updateUI(); }
function subscribePair() {
  resetQuotes(); send(proposalRequest('ONETOUCH', 101)); send(proposalRequest('NOTOUCH', 102)); state.scanning = true;
  $('startScannerBtn').disabled = true; $('stopScannerBtn').disabled = false;
  setStatus('Scanning live proposals', 'Waiting for Touch and No Touch quotes.', state.connectedDemo ? 'live' : 'neutral');
  log(`Scanning ${settings().symbol}: ONETOUCH + NOTOUCH, barrier ${settings().barrier}, ${settings().duration}${settings().durationUnit}.`);
}
async function startPublicScanner() {
  state.killed = false; state.connectedDemo = false; $('autoExecute').checked = false; $('autoExecute').disabled = true;
  await openSocket(PUBLIC_WS, 'public'); subscribePair();
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function startOAuthLogin() {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(64));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const verifier = Array.from(verifierBytes, b => alphabet[b % alphabet.length]).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64Url(new Uint8Array(digest));
  const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem('sani_pkce_verifier', verifier);
  sessionStorage.setItem('sani_oauth_state', oauthState);
  const params = new URLSearchParams({
    response_type: 'code', client_id: DERIV_CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'trade',
    state: oauthState, code_challenge: challenge, code_challenge_method: 'S256'
  });
  location.assign(`https://auth.deriv.com/oauth2/auth?${params.toString()}`);
}
async function handleOAuthCallback() {
  if (location.pathname !== '/callback') return;
  const params = new URLSearchParams(location.search);
  const error = params.get('error');
  if (error) throw new Error(params.get('error_description') || error);
  const code = params.get('code');
  const returnedState = params.get('state');
  const expectedState = sessionStorage.getItem('sani_oauth_state');
  const verifier = sessionStorage.getItem('sani_pkce_verifier');
  if (!code || !returnedState || !expectedState || returnedState !== expectedState || !verifier) throw new Error('OAuth validation failed. Please login again.');
  const response = await fetch('/api/oauth-exchange', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
    body: JSON.stringify({ code, codeVerifier: verifier, redirectUri: REDIRECT_URI })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'OAuth token exchange failed.');
  sessionStorage.removeItem('sani_oauth_state'); sessionStorage.removeItem('sani_pkce_verifier');
  history.replaceState({}, '', '/');
  log('Deriv OAuth login completed.', 'good');
}
function renderLogin() {
  if (state.authenticated && state.demoAccount) {
    $('loginTitle').textContent = 'Logged in · Demo ready';
    $('loginDetail').textContent = `${state.demoAccount.account_id} · ${state.demoAccount.currency || 'USD'} · balance ${state.demoAccount.balance ?? '—'}`;
    $('loginDerivBtn').hidden = true; $('logoutDerivBtn').hidden = false; $('connectDemoBtn').disabled = state.connectedDemo;
  } else {
    $('loginTitle').textContent = 'Not logged in';
    $('loginDetail').textContent = 'Sign in with Deriv. Sani Arb will automatically select your demo Options account.';
    $('loginDerivBtn').hidden = false; $('logoutDerivBtn').hidden = true; $('connectDemoBtn').disabled = true;
  }
}
async function refreshSession() {
  const response = await fetch('/api/session', { credentials: 'same-origin' });
  const body = await response.json();
  state.authenticated = Boolean(response.ok && body.authenticated && body.demoAccount);
  state.demoAccount = state.authenticated ? body.demoAccount : null;
  renderLogin();
}
async function getDemoSocketUrl() {
  if (!state.authenticated || !state.demoAccount) throw new Error('Login with Deriv first.');
  const response = await fetch('/api/demo-otp', { method: 'POST', credentials: 'same-origin' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `OTP request failed (${response.status}).`);
  if (!body.url || !body.url.includes('/ws/demo')) throw new Error('Safety lock: only a Deriv DEMO WebSocket URL is accepted.');
  return body.url;
}
async function connectDemo() {
  state.killed = false; setStatus('Connecting demo', 'Requesting a one-time authenticated demo WebSocket URL.', 'neutral');
  const url = await getDemoSocketUrl(); await openSocket(url, 'demo'); state.connectedDemo = true;
  $('connectDemoBtn').disabled = true; $('autoExecute').disabled = false; $('emergencyBtn').disabled = false;
  subscribePair(); setStatus('Demo connected', 'Authenticated demo proposals are live. Auto-execution remains off until you enable it.', 'live');
  log(`Connected to Deriv DEMO ${state.demoAccount.account_id}. Real-money WebSocket URLs are blocked.`, 'good');
}
async function logoutDeriv() {
  emergencyStop('Deriv session logged out.'); closeSocket();
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  state.authenticated = false; state.demoAccount = null; state.connectedDemo = false; resetQuotes(); renderLogin();
}
function extractContractId(msg) { const id = Number(msg?.buy?.contract_id); return Number.isFinite(id) ? id : null; }
async function buyProposal(proposal, label) {
  const msg = await request({ buy: proposal.id, price: proposal.ask }, 10000);
  const contractId = extractContractId(msg); if (!contractId) throw new Error(`${label} buy response did not contain a contract ID.`);
  log(`${label} filled. Contract ${contractId}, buy price ${money(Number(msg.buy?.buy_price))}.`, 'good'); return { label, contractId, buy: msg.buy };
}
async function sellAtMarket(contractId, label) {
  try { const msg = await request({ sell: contractId, price: 0 }, 7000); log(`Emergency sell sent for ${label} contract ${contractId}.`, 'warn'); return msg; }
  catch (err) { log(`Emergency sell FAILED for ${label} contract ${contractId}: ${err.message}`, 'bad'); throw err; }
}
async function monitorContract(contractId, label) {
  try { send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1, req_id: ++state.reqSeq, passthrough: { label } }); }
  catch (err) { log(`Could not start monitor for ${label}: ${err.message}`, 'warn'); }
}
async function executePair() {
  if (!state.connectedDemo) throw new Error('Demo is not connected.');
  if (state.killed) throw new Error('Emergency stop is active.');
  if (state.executing) return;
  const s = settings(); const touch = state.touch && { ...state.touch }; const noTouch = state.noTouch && { ...state.noTouch };
  if (!touch || !noTouch) throw new Error('Both proposals are required.');
  const combined = touch.ask + noTouch.ask; const payoutFloor = Math.min(touch.payout, noTouch.payout); const edge = payoutFloor - combined;
  const fresh = Date.now() - Math.max(touch.receivedAt, noTouch.receivedAt) < 3000;
  if (!fresh || edge < s.minEdge || state.stableCount < s.stableChecks) throw new Error('Arbitrage gate is no longer satisfied.');
  state.executing = true; $('autoExecute').disabled = true;
  setStatus('Submitting both legs', `Quoted floor edge ${edge.toFixed(4)} USD. Waiting for two fills.`, 'armed');
  log(`EXECUTE: combined ask ${combined.toFixed(4)}, payout floor ${payoutFloor.toFixed(4)}, quoted edge ${edge.toFixed(4)}.`, 'warn');
  const results = await Promise.allSettled([buyProposal(touch, 'TOUCH'), buyProposal(noTouch, 'NO TOUCH')]);
  const fulfilled = results.filter(r => r.status === 'fulfilled').map(r => r.value); const failed = results.filter(r => r.status === 'rejected');
  if (fulfilled.length === 2) {
    state.currentPair = fulfilled; fulfilled.forEach(x => monitorContract(x.contractId, x.label));
    log('PAIR CONFIRMED: both legs filled. Hedge is established for this pair.', 'good');
    setStatus('Pair confirmed', 'Both contracts filled. Monitoring settlement.', 'live');
    state.stableCount = 0; state.lastQualifiedSignature = ''; state.executing = false; $('autoExecute').disabled = false; return;
  }
  state.killed = true; $('autoExecute').checked = false; $('autoExecute').disabled = true;
  setStatus('UNHEDGED · ENGINE STOPPED', 'One or both legs failed. No further trades will be sent.', 'risk');
  if (fulfilled.length === 1) { const lone = fulfilled[0]; log(`CRITICAL: only ${lone.label} filled. Attempting emergency sell.`, 'bad'); try { await sellAtMarket(lone.contractId, lone.label); } catch {} }
  else log('Both buy requests failed. No confirmed open pair.', 'bad');
  failed.forEach(r => log(`Failed leg: ${r.reason?.message || r.reason}`, 'bad')); state.executing = false;
}
function emergencyStop(reason = 'Emergency stop pressed by user.') {
  state.killed = true; state.scanning = false; $('autoExecute').checked = false; $('autoExecute').disabled = true;
  $('startScannerBtn').disabled = false; $('stopScannerBtn').disabled = true; setStatus('ENGINE STOPPED', reason, 'risk'); log(reason, 'bad');
}
function stopScanner() { state.scanning = false; state.stableCount = 0; $('startScannerBtn').disabled = false; $('stopScannerBtn').disabled = true; setStatus('Scanner stopped', 'No execution will occur while scanner is stopped.', 'neutral'); log('Scanner stopped.'); }

$('startScannerBtn').addEventListener('click', async () => { try { await startPublicScanner(); } catch (err) { log(err.message, 'bad'); setStatus('Scanner error', err.message, 'risk'); } });
$('stopScannerBtn').addEventListener('click', stopScanner);
$('loginDerivBtn').addEventListener('click', () => startOAuthLogin().catch(err => log(err.message, 'bad')));
$('connectDemoBtn').addEventListener('click', async () => { try { await connectDemo(); } catch (err) { log(`Demo connection failed: ${err.message}`, 'bad'); setStatus('Demo connection failed', err.message, 'risk'); } });
$('logoutDerivBtn').addEventListener('click', () => logoutDeriv().catch(err => log(err.message, 'bad')));
$('emergencyBtn').addEventListener('click', () => emergencyStop());
$('autoExecute').addEventListener('change', e => { state.autoExecute = e.target.checked; log(`Auto-execution ${e.target.checked ? 'ENABLED' : 'disabled'} for DEMO.`, e.target.checked ? 'warn' : ''); evaluatePair(); });
$('clearLogBtn').addEventListener('click', () => $('log').replaceChildren());
['symbol','barrier','duration','durationUnit','targetPayout','minEdge','stableChecks'].forEach(id => $(id).addEventListener('change', () => { if (state.scanning) { log('Settings changed. Restart scanner to apply new proposal subscriptions.', 'warn'); stopScanner(); } }));

(async function boot() {
  try { await handleOAuthCallback(); } catch (err) { history.replaceState({}, '', '/'); log(`Login failed: ${err.message}`, 'bad'); setStatus('Login failed', err.message, 'risk'); }
  try { await refreshSession(); } catch (err) { log(`Session check failed: ${err.message}`, 'bad'); renderLogin(); }
  setStatus('Idle', 'Start the public scanner to read live proposals.', 'neutral');
  log('Sani Arb loaded. Public scanning requires no login. Demo execution requires Deriv OAuth.');
})();
