// Armazenamento: Firestore (tempo real, compartilhado) ou localStorage (modo local).
import { firebaseConfig } from './firebase-config.js';

export const isCloud = !!firebaseConfig.apiKey && !/^COLE/.test(firebaseConfig.apiKey);

const FB_VERSION = '10.12.2';
let fbPromise;
function fb() {
  return fbPromise ??= (async () => {
    const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
    const [{ initializeApp }, fs] = await Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-firestore.js'),
    ]);
    const app = initializeApp(firebaseConfig);
    let db;
    try { // cache local: lançamentos feitos sem sinal são enviados quando a conexão volta
      db = fs.initializeFirestore(app, {
        localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
      });
    } catch { db = fs.getFirestore(app); }
    return { db, fs };
  })();
}

// ---------- modo local ----------
const key = id => 'dv:trip:' + id;
const listeners = new Map(); // id -> Set(fn)
const loadLocal = id => JSON.parse(localStorage.getItem(key(id)) || 'null');
function saveLocal(id, data) {
  localStorage.setItem(key(id), JSON.stringify(data));
  listeners.get(id)?.forEach(fn => fn());
}
window.addEventListener('storage', e => {
  if (e.key?.startsWith('dv:trip:')) listeners.get(e.key.slice(8))?.forEach(fn => fn());
});

// ---------- API ----------
// Observa a viagem e suas despesas. onTrip(null) = viagem não existe.
export async function watch(id, { onTrip, onExpenses, onError }) {
  if (!isCloud) {
    const emit = () => {
      const d = loadLocal(id);
      onTrip(d ? d.trip : null);
      onExpenses(d ? Object.entries(d.expenses).map(([eid, e]) => ({ id: eid, ...e })) : []);
    };
    if (!listeners.has(id)) listeners.set(id, new Set());
    listeners.get(id).add(emit);
    emit();
    return () => listeners.get(id).delete(emit);
  }
  const { db, fs } = await fb();
  const ref = fs.doc(db, 'viagens', id);
  const u1 = fs.onSnapshot(ref, { includeMetadataChanges: true }, snap => {
    if (snap.exists()) onTrip(snap.data());
    else if (!snap.metadata.fromCache) onTrip(null);
  }, onError);
  const u2 = fs.onSnapshot(fs.collection(ref, 'despesas'), snap => {
    onExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, onError);
  return () => { u1(); u2(); };
}

export async function saveTrip(id, trip) {
  if (!isCloud) {
    const d = loadLocal(id) || { expenses: {} };
    d.trip = trip;
    return saveLocal(id, d);
  }
  const { db, fs } = await fb();
  return fs.setDoc(fs.doc(db, 'viagens', id), trip);
}

export async function saveExpense(tripId, expId, data) {
  if (!isCloud) {
    const d = loadLocal(tripId);
    d.expenses[expId] = data;
    return saveLocal(tripId, d);
  }
  const { db, fs } = await fb();
  return fs.setDoc(fs.doc(db, 'viagens', tripId, 'despesas', expId), data);
}

export async function deleteExpense(tripId, expId) {
  if (!isCloud) {
    const d = loadLocal(tripId);
    delete d.expenses[expId];
    return saveLocal(tripId, d);
  }
  const { db, fs } = await fb();
  return fs.deleteDoc(fs.doc(db, 'viagens', tripId, 'despesas', expId));
}
