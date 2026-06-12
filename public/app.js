'use strict';

const TOKEN_KEY = 'tdin_dash_token';
let token = localStorage.getItem(TOKEN_KEY) || '';
let latest = null;

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['x-access-token'] = token;
  return h;
}

async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    const t = prompt('Dashboard access token:');
    if (t) { token = t; localStorage.setItem(TOKEN_KEY, t); return api(path, method, body); }
    throw new Error('Unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

const $ = (id) => document.getElementById(id);
const short = (s) => (s ? s.slice(0, 4) + '…' + s.slice(-4) : '');

function setText(id, v) { const el = $(id); if (el) el.textContent = v; }

function renderStatusStrip(s) {
  const dry = s.config.dryRun;
  const mode = $('mode-pill');
  mode.textContent = dry ? 'DRY RUN' : 'LIVE';
  mode.className = 'pill ' + (dry ? 'pill-dry' : 'pill-live');

  const rpc = $('rpc-pill');
  rpc.textContent = s.rpcConfigured ? 'RPC ok' : 'RPC missing';
  rpc.className = 'pill ' + (s.rpcConfigured ? 'pill-on' : 'pill-live');

  setText('spend-pill', `spend ${s.spend.spentSol.toFixed(3)}/${s.spend.maxSpendSol} SOL`);
}

function renderWallets(s) {
  setText('wallet-count', `(${s.wallets.length})`);
  const box = $('wallet-list');
  box.innerHTML = '';
  if (!s.wallets.length) {
    box.innerHTML = '<p class="muted">No wallets yet. Add one below.</p>';
    return;
  }
  for (const w of s.wallets) {
    const row = document.createElement('div');
    row.className = 'wallet' + (w.active ? ' active' : '');
    const bal = w.balanceSol == null ? '—' : w.balanceSol.toFixed(4) + ' SOL';
    row.innerHTML = `
      <div class="meta">
        <div class="addr">${w.label ? `<b>${w.label}</b> · ` : ''}${short(w.pubkey)}</div>
        <div class="bal">${bal}${w.active ? ' · active' : ''}</div>
      </div>
      <div class="acts">
        ${w.active ? '' : `<button class="mini" data-act="activate" data-pk="${w.pubkey}">use</button>`}
        <button class="mini danger" data-act="remove" data-pk="${w.pubkey}">×</button>
      </div>`;
    box.appendChild(row);
  }
  box.querySelectorAll('button[data-act]').forEach((b) => {
    b.addEventListener('click', () => walletAction(b.dataset.act, b.dataset.pk));
  });
}

async function walletAction(act, pk) {
  try {
    if (act === 'activate') await api('/config', 'POST', { activeWallet: pk });
    if (act === 'remove' && confirm('Remove this wallet from the bot?')) {
      await api('/wallets/' + pk, 'DELETE');
    }
    await refresh();
  } catch (e) { alert(e.message); }
}

function fillSettings(c) {
  $('cfg-amount').value = c.amountSol;
  $('cfg-delay').value = c.delayBetweenBuysSec;
  $('cfg-slippage').value = (c.slippageBps / 100);
  $('cfg-maxspend').value = c.maxSpendSol;
  $('cfg-feemode').value = c.priorityFeeMode;
  $('cfg-fee').value = c.priorityFeeMicroLamports;
  $('cfg-dryrun').checked = c.dryRun;
  $('cfg-snipemax').value = c.snipeMaxBuys;
  $('cfg-snipepoll').value = c.snipePollSec;
}

function renderSniper(s) {
  const pill = $('sniper-pill');
  pill.textContent = s.sniper.running ? 'ON' : 'OFF';
  pill.className = 'pill ' + (s.sniper.running ? 'pill-on' : 'pill-off');
  const parts = [`buys this run: ${s.sniper.buysThisRun}`, `seen: ${s.sniper.seenCount}`];
  if (s.sniper.lastError) parts.push('· ' + s.sniper.lastError);
  setText('sniper-status', parts.join(' '));

  const q = $('queue-list');
  q.innerHTML = s.queue.length
    ? s.queue.map((m) => `<span class="chip">${short(m)}</span>`).join('')
    : '<span class="muted">queue empty</span>';
}

function renderHistory(s) {
  const body = $('history-body');
  if (!s.history.length) { body.innerHTML = '<tr><td colspan="6" class="muted">no buys yet</td></tr>'; return; }
  body.innerHTML = s.history.map((r) => {
    const t = new Date(r.ts).toLocaleTimeString();
    const tx = r.signature
      ? `<a href="https://solscan.io/tx/${r.signature}" target="_blank" rel="noopener">${short(r.signature)}</a>`
      : (r.error ? `<span class="muted" title="${r.error.replace(/"/g, '')}">${r.error.slice(0, 28)}</span>` : '—');
    return `<tr>
      <td>${t}</td><td>${r.source}</td>
      <td><a href="https://solscan.io/token/${r.mint}" target="_blank" rel="noopener">${short(r.mint)}</a></td>
      <td>${r.amountSol}</td>
      <td><span class="tag ${r.status}">${r.status}</span></td>
      <td>${tx}</td>
    </tr>`;
  }).join('');
}

function render(s) {
  latest = s;
  renderStatusStrip(s);
  renderWallets(s);
  renderSniper(s);
  renderHistory(s);
}

async function refresh() {
  try {
    const s = await api('/state');
    render(s);
    if (document.activeElement === document.body) fillSettings(s.config);
  } catch (e) { console.warn(e.message); }
}

// ---- actions ----
$('add-wallet-btn').addEventListener('click', async () => {
  const secret = $('wallet-secret').value.trim();
  if (!secret) return alert('Paste a private key');
  try {
    await api('/wallets', 'POST', { label: $('wallet-label').value.trim(), secret });
    $('wallet-secret').value = ''; $('wallet-label').value = '';
    await refresh();
  } catch (e) { alert(e.message); }
});

$('save-cfg-btn').addEventListener('click', async () => {
  try {
    await api('/config', 'POST', {
      amountSol: Number($('cfg-amount').value),
      delayBetweenBuysSec: Number($('cfg-delay').value),
      slippageBps: Math.round(Number($('cfg-slippage').value) * 100),
      maxSpendSol: Number($('cfg-maxspend').value),
      priorityFeeMode: $('cfg-feemode').value,
      priorityFeeMicroLamports: Number($('cfg-fee').value),
      dryRun: $('cfg-dryrun').checked,
      snipeMaxBuys: Number($('cfg-snipemax').value),
      snipePollSec: Number($('cfg-snipepoll').value),
    });
    flash('save-cfg-btn', 'Saved ✓');
    await refresh();
  } catch (e) { alert(e.message); }
});

$('reset-spend-btn').addEventListener('click', async () => {
  await api('/spend/reset', 'POST'); await refresh();
});

$('buy-btn').addEventListener('click', async () => {
  const mint = $('buy-mint').value.trim();
  if (!mint) return alert('Enter a mint address');
  const amount = $('buy-amount').value ? Number($('buy-amount').value) : undefined;
  const out = $('buy-result');
  out.className = 'result'; out.textContent = 'Submitting…';
  try {
    const r = await api('/buy', 'POST', { mint, amountSol: amount });
    if (r.status === 'success') { out.className = 'result ok'; out.textContent = `✅ Bought · tx ${short(r.signature)}`; }
    else if (r.status === 'dry-run') { out.className = 'result dry'; out.textContent = `🧪 Dry run ok · would receive ~${r.outAmount} base units`; }
    else { out.className = 'result err'; out.textContent = '❌ ' + (r.error || 'failed'); }
    await refresh();
  } catch (e) { out.className = 'result err'; out.textContent = '❌ ' + e.message; }
});

$('sniper-start-btn').addEventListener('click', async () => { await api('/sniper/start', 'POST'); await refresh(); });
$('sniper-stop-btn').addEventListener('click', async () => { await api('/sniper/stop', 'POST'); await refresh(); });
$('queue-add-btn').addEventListener('click', async () => {
  const m = $('queue-mint').value.trim();
  if (!m) return;
  await api('/sniper/queue', 'POST', { mint: m }); $('queue-mint').value = ''; await refresh();
});

function flash(id, msg) {
  const el = $(id); const old = el.textContent;
  el.textContent = msg; setTimeout(() => { el.textContent = old; }, 1200);
}

// boot
refresh().then(() => { if (latest) fillSettings(latest.config); });
setInterval(refresh, 6000);
