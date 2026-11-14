// Cálculo de saldos e de transferências mínimas. Tudo em centavos de real (inteiros).

// participants: [{id,name}]  expenses: [{payer, brlCents, split:[ids]}]
// Retorna {id: centavos}; positivo = tem a receber, negativo = deve.
export function balances(participants, expenses) {
  const b = Object.fromEntries(participants.map(p => [p.id, 0]));
  for (const e of expenses) {
    const ids = (e.split || []).filter(id => id in b);
    if (!ids.length || !(e.payer in b)) continue;
    const total = e.brlCents;
    const share = Math.floor(total / ids.length);
    let rem = total - share * ids.length; // centavos que sobram da divisão
    b[e.payer] += total;
    for (const id of ids) {
      b[id] -= share + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
    }
  }
  return b;
}

// Acerta um grupo cuja soma é zero com (n-1) transferências no máximo.
function settleGroup(items) {
  const deb = items.filter(x => x.v < 0).map(x => ({ id: x.id, v: -x.v })).sort((a, b) => b.v - a.v);
  const cre = items.filter(x => x.v > 0).map(x => ({ ...x })).sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0, j = 0;
  while (i < deb.length && j < cre.length) {
    const pay = Math.min(deb[i].v, cre[j].v);
    out.push({ from: deb[i].id, to: cre[j].id, cents: pay });
    deb[i].v -= pay; cre[j].v -= pay;
    if (!deb[i].v) i++;
    if (!cre[j].v) j++;
  }
  return out;
}

// Menor número de transferências que zera todos os saldos.
// Divide as pessoas no maior número possível de subgrupos de soma zero
// (cada subgrupo de k pessoas se acerta com k-1 transferências).
export function settle(bal) {
  const items = Object.entries(bal).filter(([, v]) => v !== 0).map(([id, v]) => ({ id, v }));
  const n = items.length;
  if (n === 0) return [];
  if (n > 14) return settleGroup(items); // grupo muito grande: aproximação gulosa

  const size = 1 << n;
  const sum = new Int32Array(size);
  const dp = new Int8Array(size);
  for (let m = 1; m < size; m++) {
    const low = m & -m;
    sum[m] = sum[m ^ low] + items[31 - Math.clz32(low)].v;
    let best = 0;
    for (let i = 0; i < n; i++) if (m & (1 << i)) best = Math.max(best, dp[m ^ (1 << i)]);
    dp[m] = best + (sum[m] === 0 ? 1 : 0);
  }
  // Reconstrói a ordem de inclusão; cada vez que a soma parcial zera, fecha um subgrupo.
  const order = [];
  let m = size - 1;
  while (m) {
    const target = dp[m] - (sum[m] === 0 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      if ((m & (1 << i)) && dp[m ^ (1 << i)] === target) { order.push(i); m ^= 1 << i; break; }
    }
  }
  order.reverse();
  const out = [];
  let group = [], acc = 0;
  for (const i of order) {
    group.push(items[i]); acc += items[i].v;
    if (acc === 0) { out.push(...settleGroup(group)); group = []; }
  }
  return out;
}
