const $ = id => document.getElementById(id);

const parseMoney = value => {
  const n = Number(String(value ?? '').replace(/[^0-9+-.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const money = value => `${value > 0 ? '+' : value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`;
const setText = (id, value) => { const el=$(id); if(el && el.textContent!==value) el.textContent=value; };
const setHTML = (el, value) => { if(el && el.innerHTML!==value) el.innerHTML=value; };

function updateSnapshot() {
  const pnl = parseMoney($('pnl')?.textContent);
  const left = Math.max(0, 5 - pnl);
  const room = Math.max(0, pnl + 2);
  setText('leftGoal', `$${left.toFixed(2)}`);
  setText('lossRoom', `$${room.toFixed(2)}`);

  let summary;
  if (pnl >= 5) summary = 'Goal reached. This session is complete. 🌿';
  else if (pnl <= -2) summary = 'Safety stop reached. No more entries this session.';
  else if (pnl < 0) summary = `${money(Math.abs(pnl))} down. $${room.toFixed(2)} remains before the safety stop.`;
  else summary = `Need $${left.toFixed(2)} more to finish this session grateful.`;
  setText('plainMath', summary);

  const pct = Math.max(0, Math.min(100, ((pnl + 2) / 7) * 100));
  const progress=$('harvestProgress'), marker=$('harvestMarker');
  if(progress && progress.style.width!==`${pct}%`) progress.style.width=`${pct}%`;
  if(marker && marker.style.left!==`${pct}%`) marker.style.left=`${pct}%`;

  const cooldown = $('cooldown')?.textContent || 'READY';
  const pill=$('topCooldownPill');
  setHTML(pill, cooldown === 'READY' ? 'Cooldown <strong>READY</strong>' : `Unlock in <strong>${cooldown}</strong>`);

  const status = ($('status')?.textContent || '').toUpperCase();
  let mood='READY 🌿', moodClass='moodGrowing', text='Ready when the rules allow it.';
  if (status.includes('COOLDOWN') || cooldown !== 'READY') { mood='RESTING 🍃'; moodClass='moodCaution'; text='Cooldown is active. The garden is resting.'; }
  if (status.includes('ALIGNED') || status.includes('RUNNING')) { mood=pnl>=0?'GROWING 🌱':'CAREFUL 🌾'; moodClass=pnl>=0?'moodGrowing':'moodCaution'; text=pnl>=0?'Aligned session is active.':'Session is active but below zero.'; }
  if (status.includes('LOSS') || status.includes('STOPPED') || status.includes('CANNOT')) { mood='STOPPED 🧺'; moodClass='moodBad'; text='Sani has stopped new entries.'; }
  if (status.includes('GOAL')) { mood='HARVESTED 🌿'; moodClass='moodGrowing'; text='Goal reached. Keep the basket closed.'; }
  const moodEl=$('sessionMood');
  if(moodEl){ if(moodEl.textContent!==mood)moodEl.textContent=mood; if(moodEl.className!==moodClass)moodEl.className=moodClass; }
  setText('moodText', text);
  setText('disciplineState', cooldown === 'READY' ? 'Pace controlled by Sani' : `Locked · ${cooldown}`);
}

function parseRows() {
  const body=$('board');
  if(!body) return [];
  return [...body.querySelectorAll('tr')].map(row=>{
    const cells=[...row.querySelectorAll('td')];
    if(cells.length<9 || cells[0]?.classList.contains('empty')) return null;
    return {row,cells,group:cells[1]?.textContent.trim()||'',market:cells[2]?.textContent.trim()||'',settled:Number(cells[3]?.textContent||0),wins:Number(cells[4]?.textContent||0),doubleLoss:Number(cells[5]?.textContent||0),fill:cells[6]?.textContent.trim()||'—',edge:parseMoney(cells[7]?.textContent),pnl:parseMoney(cells[8]?.textContent)};
  }).filter(Boolean);
}

function verdictFor(r){
  if(!r.settled) return ['SCAN','scan'];
  if(r.doubleLoss>0 || r.pnl<0) return ['DROP','drop'];
  if(r.settled>=20 && r.pnl>0) return ['KEEP','keep'];
  if(r.pnl>0) return ['WATCH','watch'];
  return ['SCAN','scan'];
}

function updateReview(){
  const rows=parseRows();
  if(!rows.length){ setText('reviewBest','Waiting for settlements'); setText('reviewWorst','None yet'); setText('winRate','—'); setText('bestMarket','Waiting for evidence'); setText('worstMarket','None yet'); return; }

  rows.forEach(r=>{
    const [label,cls]=verdictFor(r);
    let cell=r.cells[9];
    if(!cell){ cell=document.createElement('td'); r.row.appendChild(cell); }
    const html=`<span class="verdict ${cls}">${label}</span>`;
    if(cell.innerHTML!==html) cell.innerHTML=html;
  });

  const settledRows=rows.filter(r=>r.settled>0);
  if(!settledRows.length) return;
  const best=[...settledRows].sort((a,b)=>b.pnl-a.pnl)[0];
  const worst=[...settledRows].sort((a,b)=>a.pnl-b.pnl)[0];
  const totalSettled=settledRows.reduce((s,r)=>s+r.settled,0);
  const totalWins=settledRows.reduce((s,r)=>s+r.wins,0);
  const rate=totalSettled?(totalWins/totalSettled)*100:0;
  setText('reviewBest',`${best.market} · ${money(best.pnl)}`);
  setText('reviewWorst',worst.pnl<0?`${worst.market} · ${money(worst.pnl)}`:'No drainer yet');
  setText('winRate',`${rate.toFixed(0)}% · ${totalWins}/${totalSettled}`);
  setText('bestMarket',`${best.market} · ${money(best.pnl)}`);
  setText('worstMarket',worst.pnl<0?`${worst.market} · ${money(worst.pnl)}`:'None yet');
}

function improveLog(){
  const log=$('log');
  if(!log) return;
  [...log.children].forEach(item=>{
    if(item.dataset.harvestEnhanced) return;
    item.dataset.harvestEnhanced='1';
    const text=item.textContent;
    let label='UPDATE';
    if(text.includes('OPEN')) label='OPEN';
    else if(text.includes('SETTLED')) label=text.includes('-$')?'LOSS':'SETTLED';
    else if(text.includes('COOLDOWN')||text.includes('Cooldown')) label='REST';
    else if(text.includes('STOP')||text.includes('LOSS CAP')) label='STOP';
    else if(text.includes('WAVE')) label='WAVE';
    else if(text.includes('skip')) label='SKIP';
    else if(text.includes('Connected')) label='CONNECTED';
    item.innerHTML=`<div><span class="eventBadge">${label}</span>${text}</div>`;
  });
}

let refreshing=false;
function refresh(){
  if(refreshing) return;
  refreshing=true;
  try{ updateSnapshot(); updateReview(); improveLog(); }
  finally{ refreshing=false; }
}

// Deliberately no MutationObserver here. The engine updates the DOM frequently;
// observing and rewriting the same leaderboard created a self-triggering render loop.
setInterval(refresh, 750);
refresh();