import * as store from './store.js';
import { balances, settle } from './calc.js';

const CURRENCIES = [
  ['BRL', 'Real'], ['EUR', 'Euro'], ['USD', 'Dólar americano'], ['NOK', 'Coroa norueguesa'],
  ['GBP', 'Libra esterlina'], ['CHF', 'Franco suíço'], ['SEK', 'Coroa sueca'],
  ['DKK', 'Coroa dinamarquesa'], ['ISK', 'Coroa islandesa'], ['CZK', 'Coroa tcheca'],
  ['PLN', 'Zloty polonês'], ['HUF', 'Florim húngaro'], ['CAD', 'Dólar canadense'],
  ['MXN', 'Peso mexicano'], ['JPY', 'Iene'], ['AUD', 'Dólar australiano'], ['TRY', 'Lira turca'],
];
const CATEGORIES = {
  hospedagem: '🏨 Hospedagem', alimentacao: '🍽️ Alimentação',
  transporte: '🚆 Transporte', outros: '🧾 Outros',
};

// ---------- utilidades ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = c => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (v, cur) => v.toLocaleString('pt-BR', { style: 'currency', currency: cur });
const signed = c => (c > 0 ? '+' : c < 0 ? '−' : '') + brl(Math.abs(c));
const cls = c => (c > 0 ? 'pos' : c < 0 ? 'neg' : 'muted');
const today = () => new Date().toLocaleDateString('sv'); // AAAA-MM-DD local
const fmtDate = d => d.split('-').reverse().join('/');
const rid = (n = 10) => {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(n))].map(x => A[x % A.length]).join('');
};
const parseNum = s => {
  s = String(s).trim().replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : NaN;
};
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3000);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('Copiado!');
}
async function share(text) {
  if (navigator.share) {
    try { return await navigator.share({ text }); }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  copy(text);
}
const ls = {
  get: (k, d = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- cotações (Frankfurter / BCE) ----------
const rateCache = new Map();
async function fetchRate(cur, date) {
  const k = cur + date;
  if (rateCache.has(k)) return rateCache.get(k);
  const d = date >= today() ? 'latest' : date;
  for (const base of ['https://api.frankfurter.dev/v1/', 'https://api.frankfurter.app/']) {
    try {
      const r = await fetch(`${base}${d}?base=${cur}&symbols=BRL`);
      if (!r.ok) continue;
      const j = await r.json();
      const v = { rate: j.rates.BRL, date: j.date };
      rateCache.set(k, v);
      return v;
    } catch {}
  }
  throw new Error('sem cotação');
}

// ---------- estado ----------
const S = {
  id: null, trip: undefined, expenses: [], me: null, tab: 'saldos',
  fPerson: '', fCat: '', draft: [], draftName: '', unsub: null, token: 0,
};
const nameOf = id => S.trip.participants.find(p => p.id === id)?.name ?? '?';
const tripLink = () => location.origin + location.pathname + '#/v/' + S.id;
const sortedExpenses = () => [...S.expenses].sort((a, b) =>
  b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
const fail = e => { console.error(e); toast('Erro ao salvar. Verifique a conexão e a configuração do Firebase.'); };

async function route() {
  const id = location.hash.match(/^#\/v\/([a-z0-9]+)/i)?.[1] ?? null;
  S.unsub?.(); S.unsub = null;
  const token = ++S.token;
  Object.assign(S, { id, trip: id ? undefined : null, expenses: [], tab: 'saldos', fPerson: '', fCat: '' });
  S.me = id ? ls.get('dv:me:' + id) : null;
  render();
  if (!id) return;
  try {
    const unsub = await store.watch(id, {
      onTrip: t => {
        if (token !== S.token) return;
        S.trip = t;
        if (t) ls.set('dv:recent', [{ id, name: t.name }, ...ls.get('dv:recent', []).filter(r => r.id !== id)].slice(0, 5));
        render();
      },
      onExpenses: list => { if (token === S.token) { S.expenses = list; render(); } },
      onError: e => { console.error(e); toast('Sem acesso aos dados. Confira as regras do Firestore.'); },
    });
    if (token === S.token) S.unsub = unsub; else unsub();
  } catch (e) {
    console.error(e);
    $('#view').innerHTML = `<div class="card"><p>Não foi possível conectar ao banco de dados. Verifique a internet e recarregue a página.</p></div>`;
  }
}

// ---------- telas ----------
function render() {
  const v = $('#view');
  if (!S.id) v.innerHTML = homeHTML();
  else if (S.trip === undefined) v.innerHTML = '<p class="center muted">Carregando viagem…</p>';
  else if (S.trip === null) v.innerHTML = `<div class="card"><h1>Viagem não encontrada</h1>
    <p class="muted">Confira se o link está completo.</p><a class="btn" href="#">Voltar ao início</a></div>`;
  else if (!S.trip.participants.some(p => p.id === S.me)) v.innerHTML = pickHTML();
  else v.innerHTML = tripHTML();
}

const localBanner = () => store.isCloud ? '' :
  `<div class="banner"><strong>Modo local:</strong> o Firebase ainda não foi configurado, então os dados ficam só neste aparelho e o link não funciona para outras pessoas. Veja o README.</div>`;

function homeHTML() {
  const recent = ls.get('dv:recent', []);
  return `
    <header class="top"><div><h1>Divisão de Despesas</h1><p class="muted">Contas de viagem em família, sem complicação.</p></div></header>
    ${localBanner()}
    ${recent.length ? `<h2>Viagens recentes</h2><div class="card">${recent.map(r =>
      `<a class="row" href="#/v/${esc(r.id)}" style="text-decoration:none;color:inherit"><span class="title">${esc(r.name)}</span><span class="muted">abrir ›</span></a>`).join('')}</div>` : ''}
    <h2>Nova viagem</h2>
    <div class="card">
      <label for="tripName">Nome da viagem</label>
      <input id="tripName" placeholder="Ex.: Europa 2026" value="${esc(S.draftName)}" maxlength="60">
      <label for="pName">Participantes</label>
      <form class="inline" data-form="add-draft">
        <input id="pName" placeholder="Nome" maxlength="30" autocomplete="off">
        <button class="btn">Adicionar</button>
      </form>
      <div class="chips">${S.draft.map((n, i) =>
        `<span class="chip">${esc(n)}<button data-act="rm-draft" data-i="${i}" aria-label="Remover ${esc(n)}">×</button></span>`).join('')}</div>
      <button class="btn primary block" data-act="create-trip">Criar viagem</button>
    </div>
    <h2>Entrar em uma viagem</h2>
    <div class="card">
      <form class="inline" data-form="join">
        <input id="joinCode" placeholder="Cole o link ou o código" autocomplete="off">
        <button class="btn">Entrar</button>
      </form>
    </div>`;
}

function pickHTML() {
  return `
    <header class="top"><div><h1>${esc(S.trip.name)}</h1><p class="muted">Quem é você?</p></div></header>
    ${localBanner()}
    <div class="card">${S.trip.participants.map(p =>
      `<button class="row" data-act="pick" data-id="${esc(p.id)}"><span class="title">${esc(p.name)}</span><span class="muted">›</span></button>`).join('')}</div>
    <p class="small muted">Seu nome não está na lista? Entre com qualquer nome e adicione participantes na aba “Acerto”.</p>`;
}

function tripHTML() {
  const bal = balances(S.trip.participants, S.expenses);
  const transfers = settle(bal);
  const body = S.tab === 'saldos' ? saldosHTML(bal, transfers)
    : S.tab === 'despesas' ? despesasHTML() : acertoHTML(bal, transfers);
  const tab = (id, label) => `<button data-act="tab" data-tab="${id}" aria-current="${S.tab === id}">${label}</button>`;
  return `
    <header class="top">
      <div><h1>${esc(S.trip.name)}</h1>
        <span class="small muted">Você é ${esc(nameOf(S.me))} · </span><button class="btn link small" data-act="switch-me">trocar</button></div>
      <button class="btn" data-act="share-link">Convidar</button>
    </header>
    ${localBanner()}
    ${body}
    <button class="fab" data-act="new-exp">+ Despesa</button>
    <nav class="tabs">${tab('saldos', 'Saldos')}${tab('despesas', 'Despesas')}${tab('acerto', 'Acerto')}</nav>`;
}

const transfersHTML = transfers => transfers.length
  ? transfers.map(t => `<div class="row"><span class="grow">${esc(nameOf(t.from))} → ${esc(nameOf(t.to))}</span><span class="num">${brl(t.cents)}</span></div>`).join('')
  : '<p class="muted" style="margin:0">Tudo certo: ninguém deve nada.</p>';

function saldosHTML(bal, transfers) {
  const total = S.expenses.reduce((s, e) => s + e.brlCents, 0);
  const mine = bal[S.me];
  const lowest = S.trip.participants.reduce((a, p) => (bal[p.id] < bal[a.id] ? p : a));
  const paid = id => S.expenses.reduce((s, e) => s + (e.payer === id ? e.brlCents : 0), 0);
  return `
    <div class="hint">${mine > 0 ? `Você tem <strong>${brl(mine)}</strong> a receber.`
      : mine < 0 ? `Você deve <strong>${brl(-mine)}</strong>.` : 'Você está quite.'}
      ${bal[lowest.id] < 0 ? `<br>Para equilibrar, a próxima conta pode ficar com <strong>${esc(lowest.name)}</strong>.` : ''}</div>
    <h2>Saldos em R$</h2>
    <div class="card">${S.trip.participants.map(p => `
      <div class="row ${p.id === S.me ? 'me' : ''}">
        <div class="grow"><div class="title">${esc(p.name)}</div><div class="small muted">pagou ${brl(paid(p.id))}</div></div>
        <span class="num ${cls(bal[p.id])}">${signed(bal[p.id])}</span>
      </div>`).join('')}</div>
    <h2>Para zerar</h2>
    <div class="card">${transfersHTML(transfers)}</div>
    <p class="small muted center">Total gasto: ${brl(total)} em ${S.expenses.length} despesa(s)</p>`;
}

function despesasHTML() {
  const list = sortedExpenses().filter(e =>
    (!S.fPerson || e.payer === S.fPerson) && (!S.fCat || e.category === S.fCat));
  const sum = list.reduce((s, e) => s + e.brlCents, 0);
  return `
    <div class="grid2">
      <select data-filter="fPerson" aria-label="Filtrar por quem pagou">
        <option value="">Pago por: todos</option>
        ${S.trip.participants.map(p => `<option value="${esc(p.id)}" ${S.fPerson === p.id ? 'selected' : ''}>Pago por: ${esc(p.name)}</option>`).join('')}
      </select>
      <select data-filter="fCat" aria-label="Filtrar por categoria">
        <option value="">Categoria: todas</option>
        ${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}" ${S.fCat === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    <p class="small muted" style="margin:10px 0">${list.length} despesa(s) · ${brl(sum)}</p>
    <div class="card">${list.length ? list.map(e => `
      <button class="row" data-act="edit-exp" data-id="${esc(e.id)}">
        <div class="grow">
          <div class="title">${esc(e.desc || CATEGORIES[e.category].slice(3))}</div>
          <div class="small muted">${fmtDate(e.date)} · ${esc(nameOf(e.payer))} · ${CATEGORIES[e.category] ?? ''}${
            e.split.length < S.trip.participants.length ? ` · ${e.split.length} pessoa(s)` : ''}</div>
        </div>
        <div class="right num">
          <div>${money(e.amount, e.currency)}</div>
          ${e.currency !== 'BRL' ? `<div class="small muted">${brl(e.brlCents)}</div>` : ''}
        </div>
      </button>`).join('') : S.expenses.length
        ? `<p class="muted" style="margin:0 0 10px">Nenhuma das ${S.expenses.length} despesa(s) corresponde aos filtros acima.</p><button class="btn" data-act="clear-filters">Limpar filtros</button>`
        : '<p class="muted" style="margin:0">Nenhuma despesa ainda. Toque em “+ Despesa”.</p>'}</div>`;
}

function summaryText(bal, transfers) {
  const total = S.expenses.reduce((s, e) => s + e.brlCents, 0);
  return [
    `*${S.trip.name}* — resumo em ${fmtDate(today())}`,
    `Total gasto: ${brl(total)} (${S.expenses.length} despesas)`,
    '', 'Saldos:',
    ...S.trip.participants.map(p => `• ${p.name}: ${signed(bal[p.id])}`),
    '', 'Acerto:',
    ...(transfers.length ? transfers.map(t => `• ${nameOf(t.from)} paga ${brl(t.cents)} para ${nameOf(t.to)}`) : ['• Ninguém deve nada.']),
  ].join('\n');
}

function acertoHTML(bal, transfers) {
  return `
    <h2>Transferências para zerar</h2>
    <div class="card">${transfersHTML(transfers)}</div>
    <h2>Resumo para compartilhar</h2>
    <div class="card">
      <textarea id="summary" readonly>${esc(summaryText(bal, transfers))}</textarea>
      <div class="btns">
        <button class="btn primary" data-act="share-summary">Compartilhar</button>
        <button class="btn" data-act="whatsapp">WhatsApp</button>
        <button class="btn" data-act="email">E-mail</button>
        <button class="btn" data-act="copy-summary">Copiar</button>
      </div>
    </div>
    <h2>Participantes</h2>
    <div class="card">
      <div class="chips" style="margin:0 0 12px">${S.trip.participants.map(p => `<span class="chip">${esc(p.name)}</span>`).join('')}</div>
      <form class="inline" data-form="add-participant">
        <input id="newP" placeholder="Novo participante" maxlength="30" autocomplete="off">
        <button class="btn">Adicionar</button>
      </form>
    </div>
    <h2>Link da viagem</h2>
    <div class="card">
      <p class="small muted" style="word-break:break-all">${esc(tripLink())}</p>
      <div class="btns"><button class="btn" data-act="share-link">Compartilhar link</button><a class="btn" href="#">Sair da viagem</a></div>
    </div>`;
}

// ---------- formulário de despesa ----------
function openExpense(exp) {
  const dlg = $('#dlg');
  const P = S.trip.participants;
  const e = exp ?? { payer: S.me, amount: '', currency: ls.get('dv:cur', 'EUR'), rate: '', category: 'alimentacao', desc: '', date: today(), split: P.map(p => p.id) };
  const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;
  dlg.innerHTML = `
    <form id="expForm" novalidate>
      <h1>${exp ? 'Editar despesa' : 'Nova despesa'}</h1>
      <label for="fPayer">Quem pagou</label>
      <select id="fPayer">${P.map(p => opt(p.id, p.name, p.id === e.payer)).join('')}</select>
      <div class="grid2">
        <div><label for="fAmount">Valor</label>
          <input id="fAmount" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${exp ? String(e.amount).replace('.', ',') : ''}"></div>
        <div><label for="fCur">Moeda</label>
          <select id="fCur">${CURRENCIES.map(([c, n]) => opt(c, `${c} — ${n}`, c === e.currency)).join('')}</select></div>
      </div>
      <div id="rateBox">
        <label for="fRate">Cotação (R$ por 1 <span id="fCurLabel"></span>)</label>
        <input id="fRate" inputmode="decimal" autocomplete="off" value="${exp ? String(e.rate).replace('.', ',') : ''}">
        <div class="small muted" id="fRateInfo">${exp ? 'Cotação gravada no lançamento.' : ''}</div>
      </div>
      <p class="hint" id="fBrl" style="margin-top:12px"></p>
      <div class="grid2">
        <div><label for="fCat">Categoria</label>
          <select id="fCat">${Object.entries(CATEGORIES).map(([k, v]) => opt(k, v, k === e.category)).join('')}</select></div>
        <div><label for="fDate">Data</label><input id="fDate" type="date" value="${esc(e.date)}"></div>
      </div>
      <label for="fDesc">Descrição</label>
      <input id="fDesc" maxlength="80" placeholder="Ex.: Hotel Amsterdam — 2 noites" value="${esc(e.desc)}">
      <label>Dividir entre <button type="button" class="btn link small" id="fAll">marcar todos</button></label>
      <div class="checks">${P.map(p => `<label><input type="checkbox" name="split" value="${esc(p.id)}" ${e.split.includes(p.id) ? 'checked' : ''}>${esc(p.name)}</label>`).join('')}</div>
      <div class="btns actions">
        <button class="btn primary" style="flex:1">Salvar</button>
        <button type="button" class="btn" id="fCancel">Cancelar</button>
        ${exp ? '<button type="button" class="btn danger" id="fDelete">Excluir</button>' : ''}
      </div>
    </form>`;

  const f = id => dlg.querySelector('#' + id);
  let rateToken = 0;
  const preview = () => {
    const cur = f('fCur').value, a = parseNum(f('fAmount').value);
    const r = cur === 'BRL' ? 1 : parseNum(f('fRate').value);
    const n = dlg.querySelectorAll('[name=split]:checked').length;
    f('fBrl').textContent = a > 0 && r > 0
      ? `${money(a, cur)} = ${brl(Math.round(a * r * 100))}${n ? ` · ${brl(Math.round(a * r * 100 / n))} por pessoa (${n})` : ''}`
      : 'Informe o valor para ver a conversão em R$.';
  };
  const loadRate = async () => {
    const cur = f('fCur').value, date = f('fDate').value || today();
    f('rateBox').hidden = cur === 'BRL';
    f('fCurLabel').textContent = cur;
    if (cur === 'BRL') return preview();
    const t = ++rateToken;
    f('fRateInfo').textContent = 'Buscando cotação…';
    try {
      const r = await fetchRate(cur, date);
      if (t !== rateToken) return;
      f('fRate').value = r.rate.toFixed(4).replace('.', ',');
      f('fRateInfo').textContent = `Cotação do BCE de ${fmtDate(r.date)}. Pode ajustar se quiser.`;
    } catch {
      if (t !== rateToken) return;
      f('fRateInfo').textContent = 'Sem conexão com o serviço de cotações. Digite a cotação manualmente.';
    }
    preview();
  };

  f('fCur').onchange = loadRate;
  f('fDate').onchange = loadRate;
  f('fRate').oninput = () => { rateToken++; f('fRateInfo').textContent = 'Cotação informada manualmente.'; preview(); };
  f('fAmount').oninput = preview;
  dlg.querySelectorAll('[name=split]').forEach(c => (c.onchange = preview));
  f('fAll').onclick = () => { dlg.querySelectorAll('[name=split]').forEach(c => (c.checked = true)); preview(); };
  f('fCancel').onclick = () => dlg.close();
  if (exp) f('fDelete').onclick = () => {
    const b = f('fDelete');
    if (!b.dataset.armed) { // primeiro toque arma, segundo confirma
      b.dataset.armed = '1'; b.textContent = 'Confirmar exclusão';
      setTimeout(() => { delete b.dataset.armed; b.textContent = 'Excluir'; }, 4000);
      return;
    }
    store.deleteExpense(S.id, exp.id).catch(fail);
    dlg.close(); toast('Despesa excluída');
  };
  f('expForm').onsubmit = ev => {
    ev.preventDefault();
    const currency = f('fCur').value, amount = parseNum(f('fAmount').value);
    const rate = currency === 'BRL' ? 1 : parseNum(f('fRate').value);
    const split = [...dlg.querySelectorAll('[name=split]:checked')].map(c => c.value);
    if (!(amount > 0)) return toast('Informe um valor maior que zero.');
    if (!(rate > 0)) return toast('Informe a cotação.');
    if (!split.length) return toast('Marque pelo menos uma pessoa na divisão.');
    const data = {
      payer: f('fPayer').value, amount, currency, rate,
      brlCents: Math.round(amount * rate * 100),
      category: f('fCat').value, desc: f('fDesc').value.trim(),
      date: f('fDate').value || today(), split,
      createdAt: exp?.createdAt ?? Date.now(), updatedAt: Date.now(),
    };
    ls.set('dv:cur', currency);
    store.saveExpense(S.id, exp?.id ?? rid(16), data).catch(fail);
    dlg.close(); toast('Despesa salva');
  };

  if (exp) { f('rateBox').hidden = e.currency === 'BRL'; f('fCurLabel').textContent = e.currency; preview(); }
  else loadRate();
  dlg.showModal();
}

// ---------- eventos ----------
const addParticipantName = (list, raw) => {
  const name = raw.trim();
  if (!name) return false;
  if (list.some(n => n.toLowerCase() === name.toLowerCase())) { toast('Esse nome já está na lista.'); return false; }
  return name;
};

document.addEventListener('input', ev => { if (ev.target.id === 'tripName') S.draftName = ev.target.value; });
document.addEventListener('change', ev => {
  const k = ev.target.dataset?.filter;
  if (k) { S[k] = ev.target.value; render(); }
});
document.addEventListener('submit', ev => {
  const kind = ev.target.dataset?.form;
  if (!kind) return;
  ev.preventDefault();
  if (kind === 'add-draft') {
    const name = addParticipantName(S.draft, $('#pName').value);
    if (name) { S.draft.push(name); render(); $('#pName').focus(); }
  } else if (kind === 'join') {
    const code = $('#joinCode').value.trim().match(/([a-z0-9]{6,})\/?$/i)?.[1];
    if (code) location.hash = '#/v/' + code.toLowerCase(); else toast('Código inválido.');
  } else if (kind === 'add-participant') {
    const name = addParticipantName(S.trip.participants.map(p => p.name), $('#newP').value);
    if (!name) return;
    const trip = { ...S.trip, participants: [...S.trip.participants, { id: rid(6), name }] };
    store.saveTrip(S.id, trip).catch(fail);
    toast(`${name} entrou na viagem. Despesas já lançadas não mudam.`);
  }
});
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const bal = () => balances(S.trip.participants, S.expenses);
  const summary = () => { const b = bal(); return summaryText(b, settle(b)); };
  switch (el.dataset.act) {
    case 'rm-draft': S.draft.splice(+el.dataset.i, 1); render(); break;
    case 'create-trip': {
      const pending = addParticipantName(S.draft, $('#pName').value);
      if (pending) S.draft.push(pending);
      const name = S.draftName.trim();
      if (!name) return toast('Dê um nome à viagem.');
      if (S.draft.length < 2) return toast('Adicione pelo menos 2 participantes.');
      const id = rid(10);
      const trip = { name, participants: S.draft.map(n => ({ id: rid(6), name: n })), createdAt: Date.now() };
      store.saveTrip(id, trip).catch(fail);
      S.draft = []; S.draftName = '';
      location.hash = '#/v/' + id;
      break;
    }
    case 'pick': S.me = el.dataset.id; ls.set('dv:me:' + S.id, S.me); render(); break;
    case 'switch-me': S.me = null; render(); break;
    case 'tab': S.tab = el.dataset.tab; render(); scrollTo(0, 0); break;
    case 'clear-filters': S.fPerson = S.fCat = ''; render(); break;
    case 'new-exp': openExpense(null); break;
    case 'edit-exp': openExpense(S.expenses.find(e => e.id === el.dataset.id)); break;
    case 'share-link': share(`Despesas da viagem “${S.trip.name}”: ${tripLink()}`); break;
    case 'share-summary': share(summary()); break;
    case 'copy-summary': copy(summary()); break;
    case 'whatsapp': window.open('https://wa.me/?text=' + encodeURIComponent(summary()), '_blank', 'noopener'); break;
    case 'email': location.href = `mailto:?subject=${encodeURIComponent('Acerto — ' + S.trip.name)}&body=${encodeURIComponent(summary().replace(/\*/g, ''))}`; break;
  }
});

window.addEventListener('hashchange', route);
route();
