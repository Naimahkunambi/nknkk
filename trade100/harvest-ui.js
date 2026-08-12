const $ = id => document.getElementById(id);

const parseMoney = value => {
  const n = Number(String(value ?? '').replace(/[^0-9+-.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const money = value => `${value > 0 ? '+' : value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`;

function updateSnapshot() {
  const pnl = parseMoney($('pnl')?.textContent);
  const left = Math.max(0, 5 - pnl);
  const room = Math.max(0, pnl + 2);

  if ($('leftGoal')) $('leftGoal').textContent = `$${left.toFixed(2)}`;
  if ($('lossRoom')) $('lossRoom').textContent = `$${room.toFixed(2)}`;

  if ($('plainMath')) {
    if (pnl >= 5) $('plainMath').textContent = 'Goal reached. This session is complete. 🌿';
    else if (pnl <= -2) $('plainMath').textContent = 'Safety stop reached. No more entries this session.';
    else if (pnl < 0) $('plainMath').textContent = `${money(Math.abs(pnl))} down. $${room.toFixed(2)} remains before the safety stop.`;
    else $('plainMath').textContent = `Need $${left.toFixed(2)} more to finish this session grateful.`;
  }

  const pct = Math.max(0, Math.min(100, ((pnl + 2) / 7) * 100));
  if ($('harvestProgress')) $('harvestProgress').style.width = `${pct}%`;
  if ($('harvestMarker')) $('harvestMarker').style.left = `${pct}%`;

  const cooldown = $('cooldown')?.textContent || 'READY';
  if ($('topCooldownPill')) {
    $('topCooldownPill').innerHTML = cooldown === 'READY'
      ? 'Cooldown <strong>READY</strong>'
      : `Unlock in <strong>${cooldown}</strong>`;
  }

  const status = ($('status')?.textContent || '').toUpperCase();
  let mood = 'READY 🌿', moodClass = 'moodGrowing', text = 'Ready when the rules allow it.';
  if (status.includes('COOLDOWN') || cooldown !== 'READY') { mood = 'RESTING 🍃'; moodClass = 'moodCaution'; text = 'Cooldown is active. The garden is resting.'; }
  if (status.includes('ALIGNED') || status.includes('RUNNING')) { mood = pnl >= 0 ? 'GROWING 🌱' : 'CAREFUL 🌾'; moodClass = pnl >= 0 ? 'moodGrowing' : 'moodCaution'; text = pnl >= 0 ? 'Aligned session is active.' : 'Session is active but below zero.'; }
  if (status.includes('LOSS') || status.includes('STOPPED')) { mood = 'STOPPED 🧺'; moodClass = 'moodBad'; text = 'Sani has stopped new entries.'; }
  if (status.includes('GOAL')) { mood = 'HARVESTED 🌿'; moodClass = 'moodGrowing'; text = 'Goal reached. Keep the basket closed.'; }

  if ($('sessionMood')) { $('sessionMood').textContent = mood; $('sessionMood').className = moodClass; }
  if ($('moodText')) $('moodText').textContent = text;
  if ($('disciplineState')) $('disciplineState').textContent = cooldown === 'READY' ? 'Pace controlled by Sani' : `Locked · ${cooldown}`;
}

function parseRows() {
  const body = $('board');
  if (!body) return [];
  return [...body.querySelectorAll('tr')].map(row => {
    const cells = [...row.querySelectorAll('td')];
    if (cells.length < 9 || cells[0]?.classList.contains('empty')) return null;
    return {
      row,
      cells,
      group: cells[1]?.textContent.trim() || '',
      market: cells[2]?.textContent.trim() || '',
      settled: Number(cells[3]?.textContent || 0),
      wins: Number(cells[4]?.textContent || 0),
      doubleLoss: Number(cells[5]?.textContent || 0),
      fill: cells[6]?.textContent.trim() || '—',
      edge: parseMoney(cells[7]?.textContent),
      pnl: parseMoney(cells[8]?.textContent),
    };
  }).filter(Boolean);
}

function verdictFor(r) {
  if (!r.settled) return ['SCAN', 'scan'];
  if (r.doubleLoss > 0 || r.pnl < 0) return ['DROP', 'drop'];
  if (r.settled >= 20 && r.pnl > 0) return ['KEEP', 'keep'];
  if (r.pnl > 0) return ['WATCH', 'watch'];
  return ['SCAN', 'scan'];
}

function updateReview() {
  const rows = parseRows();
  if (!rows.length) {
    if ($('reviewBest')) $('reviewBest').textContent = 'Waiting for settlements';
    if ($('reviewWorst')) $('reviewWorst').textContent = 'None yet';
    if ($('winRate')) $('winRate').textContent = '—';
    if ($('bestMarket')) $('bestMarket').textContent = 'Waiting for evidence';
    if ($('worstMarket')) $('worstMarket').textContent = 'None yet';
    return;
  }

  rows.forEach(r => {
    const [label, cls] = verdictFor(r);
    let verdictCell = r.cells[9];
    if (!verdictCell) {
      verdictCell = document.createElement('td');
      r.row.appendChild(verdictCell);
    }
    verdictCell.innerHTML = `<span class="verdict ${cls}">${label}</span>`;
  });

  const settledRows = rows.filter(r => r.settled > 0);
  if (!settledRows.length) return;

  const best = [...settledRows].sort((a,b) => b.pnl - a.pnl)[0];
  const worst = [...settledRows].sort((a,b) => a.pnl - b.pnl)[0];
  const totalSettled = settledRows.reduce((s,r) => s + r.settled, 0);
  const totalWins = settledRows.reduce((s,r) => s + r.wins, 0);
  const rate = totalSettled ? (totalWins / totalSettled) * 100 : 0;

  if ($('reviewBest')) $('reviewBest').textContent = `${best.market} · ${money(best.pnl)}`;
  if ($('reviewWorst')) $('reviewWorst').textContent = worst.pnl < 0 ? `${worst.market} · ${money(worst.pnl)}` : 'No drainer yet';
  if ($('winRate')) $('winRate').textContent = `${rate.toFixed(0)}% · ${totalWins}/${totalSettled}`;
  if ($('bestMarket')) $('bestMarket').textContent = `${best.market} · ${money(best.pnl)}`;
  if ($('worstMarket')) $('worstMarket').textContent = worst.pnl < 0 ? `${worst.market} · ${money(worst.pnl)}` : 'None yet';
}

function improveLog() {
  const log = $('log');
  if (!log) return;
  [...log.children].forEach(item => {
    if (item.dataset.harvestEnhanced) return;
    item.dataset.harvestEnhanced = '1';
    const text = item.textContent;
    let label = 'UPDATE';
    if (text.includes('OPEN')) label = 'OPEN';
    else if (text.includes('SETTLED')) label = text.includes('-$') ? 'LOSS' : 'SETTLED';
    else if (text.includes('COOLDOWN') || text.includes('Cooldown')) label = 'REST';
    else if (text.includes('STOP') || text.includes('LOSS CAP')) label = 'STOP';
    else if (text.includes('WAVE')) label = 'WAVE';
    else if (text.includes('skip')) label = 'SKIP';
    else if (text.includes('Connected')) label = 'CONNECTED';
    item.innerHTML = `<div><span class="eventBadge">${label}</span>${text}</div>`;
  });
}

function refresh() {
  updateSnapshot();
  updateReview();
  improveLog();
}

const observer = new MutationObserver(() => refresh());
['pnl','cooldown','status','board','log','entries','settled','active','sessionsToday'].forEach(id => {
  const el = $(id);
  if (el) observer.observe(el, { childList: true, subtree: true, characterData: true });
});

setInterval(refresh, 1000);
refresh();