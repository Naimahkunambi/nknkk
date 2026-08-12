const enableBtn = document.getElementById('enableTournamentBtn');
const tournament = document.getElementById('tournamentEnabled');
const connectBtn = document.getElementById('connectDemoBtn');
const loginBtn = document.getElementById('loginDerivBtn');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sessionState() {
  try {
    const r = await fetch('/api/session', { credentials: 'same-origin' });
    const b = await r.json();
    return { ok: r.ok && b.authenticated && b.demoAccount, body: b };
  } catch {
    return { ok: false, body: null };
  }
}

async function waitUntilTournamentReady(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (tournament && !tournament.disabled) return true;
    await sleep(250);
  }
  return false;
}

async function enableTournament() {
  if (!enableBtn || !tournament) return;
  enableBtn.disabled = true;
  const original = enableBtn.textContent;
  try {
    const session = await sessionState();
    if (!session.ok) {
      enableBtn.textContent = 'Opening Deriv login…';
      if (loginBtn) loginBtn.click();
      return;
    }

    if (tournament.disabled) {
      enableBtn.textContent = 'Connecting Demo…';
      if (!connectBtn || connectBtn.disabled) {
        const ready = await waitUntilTournamentReady(2500);
        if (!ready && tournament.disabled) throw new Error('Demo connection is not ready yet. Refresh once and try again.');
      } else {
        connectBtn.click();
      }
      const ready = await waitUntilTournamentReady();
      if (!ready) throw new Error('Demo connection did not finish in time.');
    }

    tournament.checked = true;
    tournament.dispatchEvent(new Event('change', { bubbles: true }));
    enableBtn.textContent = 'Demo Tournament Enabled';
  } catch (err) {
    enableBtn.textContent = 'Try Demo Tournament Again';
    console.error(err);
  } finally {
    if (!tournament.checked) {
      enableBtn.disabled = false;
      if (enableBtn.textContent === original) enableBtn.textContent = 'Enable Demo Tournament';
    }
  }
}

if (enableBtn) enableBtn.addEventListener('click', enableTournament);

(async () => {
  const s = await sessionState();
  if (s.ok && enableBtn) {
    enableBtn.disabled = false;
    enableBtn.textContent = 'Enable Demo Tournament';
  }
})();