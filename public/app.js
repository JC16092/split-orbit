import { firebaseConfig } from "/firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  initializeAuth, browserLocalPersistence, indexedDBLocalPersistence, browserPopupRedirectResolver,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, onSnapshot, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/* ============ misconfig guard ============ */
if (firebaseConfig.apiKey === "REPLACE_ME" || !firebaseConfig.projectId || firebaseConfig.projectId === "REPLACE_ME") {
  document.getElementById("app").innerHTML =
    '<div class="signin"><div class="mark"><i></i></div><h2>Almost there</h2>' +
    '<p>Paste your Firebase web config into <b>public/firebase-config.js</b>, then deploy again.</p></div>';
  throw new Error("Firebase not configured");
}

/* ============ firebase ============ */
const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  popupRedirectResolver: browserPopupRedirectResolver
});
let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  db = initializeFirestore(app, {});
}

/* ============ constants ============ */
const OWNER_EMAIL = "owner@example.com";
const AUD = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const money = n => AUD.format(Math.round(n * 100) / 100);
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_IDX = [1, 2, 3, 4, 5, 6, 0];
const EPOCH_MON = mondayOf(new Date(2024, 0, 1)).getTime();
const CATS = {
  groceries: { label: "Groceries", emoji: "🛒", color: "#33E1D2" },
  rent:      { label: "Rent",      emoji: "🏠", color: "#8B7CFF" },
  utilities: { label: "Utilities", emoji: "⚡", color: "#FFB454" },
  eating:    { label: "Eating out", emoji: "🍜", color: "#FF6D8C" },
  transport: { label: "Transport", emoji: "🚗", color: "#5BE58B" },
  fun:       { label: "Fun",       emoji: "🎬", color: "#4FC3F7" },
  other:     { label: "Other",     emoji: "📦", color: "#8B97B8" }
};
const catOf = k => CATS[k] || CATS.other;

/* ============ helpers ============ */
function mondayOf(d) { const x = new Date(d); const k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); x.setHours(0, 0, 0, 0); return x; }
function weekIndexOf(d) { return Math.floor((mondayOf(d).getTime() - EPOCH_MON) / (7 * 864e5)); }
function dateKey(d) { const x = new Date(d); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); }
function ymOf(d) { const x = new Date(d); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0"); }
function other(p) { return p === "a" ? "b" : "a"; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function relTime(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 45) return "now";
  if (s < 3600) return Math.round(s / 60) + "m";
  if (s < 86400) return Math.round(s / 3600) + "h";
  if (s < 604800) return Math.round(s / 86400) + "d";
  return new Date(ts).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}
function turnFor(duty, date) {
  if (duty.rotation === "fixed") return duty.fixedTo || "a";
  const wi = weekIndexOf(date) - (duty.startWeek || 0);
  return (((wi % 2) + 2) % 2) === 0 ? (duty.first || "a") : other(duty.first || "a");
}
const norm = e => String(e || "").trim().toLowerCase();

let deviceId;
try {
  deviceId = localStorage.getItem("so.device");
  if (!deviceId) { deviceId = uid() + uid(); localStorage.setItem("so.device", deviceId); }
} catch (e) { deviceId = uid() + uid(); }

/* ============ state ============ */
const state = {
  user: null, config: null, me: null, gotConfig: false, accessError: false,
  expenses: [], duties: [], settlements: [], recurring: [],
  status: "sync", phase: "boot", signinErr: "", expensesLoaded: false,
  tab: (() => { try { return localStorage.getItem("so.tab") || "home"; } catch (e) { return "home"; } })(),
  month: ymOf(new Date()),
  filterCat: "all"
};
const appEl = document.getElementById("app");
let unsub = [];
let claimed = false;
let _prevTab = null, _gaugeDrawn = false, _balAnimated = false;
let _pendingGauge = null, _pendingBal = null;

/* ============ auth ============ */
const provider = new GoogleAuthProvider();

getRedirectResult(auth).catch(err => { state.signinErr = friendly(err); });

onAuthStateChanged(auth, user => {
  unsub.forEach(fn => { try { fn(); } catch (e) {} });
  unsub = [];
  claimed = false;
  Object.assign(state, {
    user: user || null, config: null, me: null, gotConfig: false, accessError: false, expensesLoaded: false,
    expenses: [], duties: [], settlements: [], recurring: []
  });
  if (!user) { state.phase = "signin"; render(); return; }
  state.phase = "app";
  startSubscriptions();
  render();
});

function doSignIn() {
  state.signinErr = "";
  signInWithPopup(auth, provider).catch(err => {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(err.code)) {
      signInWithRedirect(auth, provider).catch(e2 => { state.signinErr = friendly(e2); render(); });
    } else if (err.code !== "auth/popup-closed-by-user") {
      state.signinErr = friendly(err); render();
    }
  });
}
function friendly(err) {
  if (!err) return "";
  if (err.code === "auth/unauthorized-domain") return "This domain isn't authorised in Firebase Auth settings.";
  if (err.code === "auth/operation-not-allowed") return "Google sign-in isn't enabled in the Firebase console yet.";
  return err.message || "Sign-in failed. Try again.";
}

/* ============ firestore subscriptions ============ */
function startSubscriptions() {
  const mark = m => {
    if (m && m.fromCache && !m.hasPendingWrites) { if (state.status !== "live") state.status = "sync"; }
    else state.status = "live";
  };
  const onErr = () => { state.status = "offline"; render(); };
  const onConfigErr = err => {
    state.status = "offline";
    if (err && err.code === "permission-denied") state.accessError = true;
    render();
  };

  unsub.push(onSnapshot(doc(db, "config", "household"), snap => {
    state.gotConfig = true; state.accessError = false;
    state.config = snap.exists() ? snap.data() : null;
    mark(snap.metadata); resolveIdentity(); render();
  }, onConfigErr));

  unsub.push(onSnapshot(query(collection(db, "expenses"), orderBy("createdAt", "desc"), limit(400)), snap => {
    state.expenses = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    state.expensesLoaded = true;
    mark(snap.metadata);
    render();
  }, onErr));

  unsub.push(onSnapshot(query(collection(db, "settlements"), orderBy("createdAt", "desc"), limit(200)), snap => {
    state.settlements = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    mark(snap.metadata); render();
  }, onErr));

  unsub.push(onSnapshot(query(collection(db, "duties"), orderBy("createdAt", "asc"), limit(80)), snap => {
    state.duties = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    mark(snap.metadata);
    render();
  }, onErr));

  unsub.push(onSnapshot(collection(db, "recurring"), snap => {
    state.recurring = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    render(); maybeRunRecurring();
  }, () => {}));
}

function resolveIdentity() {
  const c = state.config, email = norm(state.user && state.user.email);
  if (!c) { state.me = null; return; }
  if (norm(c.a && c.a.email) === email) { state.me = "a"; }
  else if (norm(c.b && c.b.email) === email) { state.me = "b"; }
  else if (!claimed && norm(c.a && c.a.email) !== email && !norm(c.b && c.b.email)) {
    claimed = true;
    const preset = ((c.b && c.b.name) || "").trim();
    const name = (preset && preset !== "Crew B") ? preset : ((state.user.displayName || "").split(" ")[0] || "Crew B");
    setDoc(doc(db, "config", "household"), { b: { email, name } }, { merge: true }).catch(() => { claimed = false; });
    state.me = "b";
  } else {
    state.me = null;
  }
}

/* ============ store + undo/redo ============ */
const undoStack = [];
const redoStack = [];
function pushUndo(label, undo, redo) {
  undoStack.push({ label, undo, redo });
  if (undoStack.length > 25) undoStack.shift();
  redoStack.length = 0;
}
async function doUndo() {
  const a = undoStack.pop(); if (!a) return;
  try { await a.undo(); redoStack.push(a); toast("Undid: " + a.label); }
  catch (e) { toast("Couldn't undo"); undoStack.push(a); }
  render();
}
async function doRedo() {
  const a = redoStack.pop(); if (!a) return;
  try { await a.redo(); undoStack.push(a); toast("Redid: " + a.label); }
  catch (e) { toast("Couldn't redo"); redoStack.push(a); }
  render();
}

const S = {
  setConfig: c => setDoc(doc(db, "config", "household"), c, { merge: true }),

  async addExpense(x) {
    const { id, ...rest } = x;
    await setDoc(doc(db, "expenses", id), rest);
    pushUndo("add “" + (x.desc || "expense") + "”",
      () => deleteDoc(doc(db, "expenses", id)),
      () => setDoc(doc(db, "expenses", id), rest));
  },
  async editExpense(id, before, after) {
    await setDoc(doc(db, "expenses", id), after);
    pushUndo("edit “" + (after.desc || "expense") + "”",
      () => setDoc(doc(db, "expenses", id), before),
      () => setDoc(doc(db, "expenses", id), after));
  },
  async softDelete(id) {
    const e = state.expenses.find(x => x.id === id); if (!e) return;
    await updateDoc(doc(db, "expenses", id), { deleted: true, deletedAt: Date.now() });
    pushUndo("delete “" + (e.desc || "expense") + "”",
      () => updateDoc(doc(db, "expenses", id), { deleted: false, deletedAt: null }),
      () => updateDoc(doc(db, "expenses", id), { deleted: true, deletedAt: Date.now() }));
  },
  restore: id => updateDoc(doc(db, "expenses", id), { deleted: false, deletedAt: null }),
  hardDelete: id => deleteDoc(doc(db, "expenses", id)),

  async settleExpense(id) {
    const e = state.expenses.find(x => x.id === id); if (!e) return;
    const d = expenseDebt(e); if (!d.amount) return;
    const sid = "se_" + id;
    await setDoc(doc(db, "settlements", sid), { amount: d.amount, by: d.debtor, note: e.desc || "expense", expenseId: id, kind: "expense", createdAt: Date.now(), createdBy: state.me });
    await updateDoc(doc(db, "expenses", id), { settled: true, settledAt: Date.now(), settledBy: state.me });
    pushUndo("settle “" + (e.desc || "expense") + "”",
      async () => { await deleteDoc(doc(db, "settlements", sid)); await updateDoc(doc(db, "expenses", id), { settled: false, settledAt: null, settledBy: null }); },
      async () => { await setDoc(doc(db, "settlements", sid), { amount: d.amount, by: d.debtor, note: e.desc || "expense", expenseId: id, kind: "expense", createdAt: Date.now(), createdBy: state.me }); await updateDoc(doc(db, "expenses", id), { settled: true, settledAt: Date.now(), settledBy: state.me }); });
  },
  async unsettleExpense(id) {
    await deleteDoc(doc(db, "settlements", "se_" + id)).catch(() => {});
    await updateDoc(doc(db, "expenses", id), { settled: false, settledAt: null, settledBy: null });
  },

  async settleUp(amount, by, note) {
    const sid = uid();
    await setDoc(doc(db, "settlements", sid), { amount, by, note: note || "Settled up", kind: "manual", createdAt: Date.now(), createdBy: state.me });
    const outstanding = state.expenses.filter(e => !e.deleted && !e.settled && expenseDebt(e).amount);
    await Promise.all(outstanding.map(e => updateDoc(doc(db, "expenses", e.id), { settled: true, settledAt: Date.now(), settledBy: by, settledBulk: sid })));
    pushUndo("settle up " + money(amount),
      async () => { await deleteDoc(doc(db, "settlements", sid)); await Promise.all(outstanding.map(e => updateDoc(doc(db, "expenses", e.id), { settled: false, settledAt: null, settledBy: null, settledBulk: null }))); },
      async () => {});
  },

  async addDuty(x) { const { id, ...rest } = x; await setDoc(doc(db, "duties", id), rest); pushUndo("add “" + x.title + "”", () => deleteDoc(doc(db, "duties", id)), () => setDoc(doc(db, "duties", id), rest)); },
  async delDuty(id) { const d = state.duties.find(x => x.id === id); await deleteDoc(doc(db, "duties", id)); if (d) { const { id: _i, ...rest } = d; pushUndo("remove “" + d.title + "”", () => setDoc(doc(db, "duties", id), rest), () => deleteDoc(doc(db, "duties", id))); } },
  async toggleDuty(id, dk) {
    const d = state.duties.find(x => x.id === id); if (!d) return;
    const copy = JSON.parse(JSON.stringify(d)); copy.log = copy.log || {};
    const was = copy.log[dk];
    if (was) delete copy.log[dk]; else copy.log[dk] = state.me;
    const cut = dateKey(Date.now() - 28 * 864e5);
    Object.keys(copy.log).forEach(k => { if (k < cut) delete copy.log[k]; });
    const { id: _i, ...rest } = copy;
    await setDoc(doc(db, "duties", id), rest);
    pushUndo((was ? "uncheck" : "check") + " “" + d.title + "”",
      async () => { const c2 = JSON.parse(JSON.stringify(state.duties.find(x => x.id === id) || d)); c2.log = c2.log || {}; if (was) c2.log[dk] = was; else delete c2.log[dk]; const { id: _x, ...r2 } = c2; await setDoc(doc(db, "duties", id), r2); },
      () => S.toggleDuty(id, dk));
  },

  addRecurring: x => { const { id, ...rest } = x; return setDoc(doc(db, "recurring", id), rest); },
  updateRecurring: (id, patch) => updateDoc(doc(db, "recurring", id), patch),
  delRecurring: id => deleteDoc(doc(db, "recurring", id))
};

/* ============ money math ============ */
function names() {
  const c = state.config || {};
  return { a: (c.a && c.a.name && c.a.name.trim()) || "Crew A", b: (c.b && c.b.name && c.b.name.trim()) || "Crew B" };
}
function meName() { return state.me === "a" ? names().a : names().b; }
function otherName() { return state.me === "a" ? names().b : names().a; }

function expenseDelta(e) {
  const amt = +e.amount || 0;
  const respA = e.for === "both" ? amt / 2 : (e.for === "a" ? amt : 0);
  const paidA = e.paidBy === "a" ? amt : 0;
  return paidA - respA; // +ve => A is owed
}
function expenseDebt(e) {
  const d = expenseDelta(e);
  if (Math.abs(d) < 0.005) return { amount: 0, debtor: null, creditor: null };
  return d > 0 ? { amount: Math.round(d * 100) / 100, debtor: "b", creditor: "a" }
              : { amount: Math.round(-d * 100) / 100, debtor: "a", creditor: "b" };
}
function balance() {
  let net = 0, mSpentA = 0, mSpentB = 0;
  const monStart = new Date(); monStart.setDate(1); monStart.setHours(0, 0, 0, 0);
  state.expenses.forEach(e => {
    if (e.deleted) return;
    net += expenseDelta(e);
    if ((e.createdAt || 0) >= monStart.getTime()) { if (e.paidBy === "a") mSpentA += +e.amount || 0; else mSpentB += +e.amount || 0; }
  });
  state.settlements.forEach(s => { const amt = +s.amount || 0; net += (s.by === "b" ? -amt : amt); });
  return { net: Math.round(net * 100) / 100, mSpentA, mSpentB };
}
function monthCategoryTotals(ym) {
  const t = {};
  state.expenses.forEach(e => {
    if (e.deleted) return;
    if (ymOf(e.createdAt || Date.now()) !== ym) return;
    const k = CATS[e.category] ? e.category : "other";
    t[k] = (t[k] || 0) + (+e.amount || 0);
  });
  return t;
}
function choreStats() {
  const mon = mondayOf(new Date()), today = new Date();
  const stat = { a: { done: 0, due: 0 }, b: { done: 0, due: 0 } };
  state.duties.forEach(d => {
    if (d.deleted) return;
    const who = turnFor(d, today);
    for (let i = 0; i < 7; i++) {
      const day = new Date(mon); day.setDate(mon.getDate() + i);
      if (day > today) break;
      if (!(d.days || []).includes(day.getDay())) continue;
      stat[who].due++;
      if (d.log && d.log[dateKey(day)]) stat[who].done++;
    }
  });
  return stat;
}

/* ============ recurring ============ */
let recurringRan = false;
async function maybeRunRecurring() {
  if (recurringRan || state.me == null || !state.expensesLoaded) return;
  recurringRan = true;
  const now = new Date(), ym = ymOf(now);
  for (const r of state.recurring) {
    if (r.active === false || r.lastPosted === ym || now.getDate() < (r.dayOfMonth || 1)) continue;
    const exId = "rec_" + r.id + "_" + ym;
    try {
      await setDoc(doc(db, "expenses", exId), {
        desc: r.desc, amount: +r.amount || 0, category: r.category || "other",
        paidBy: r.paidBy || "a", for: r.for || "both",
        date: ym + "-" + String(r.dayOfMonth || 1).padStart(2, "0"),
        createdAt: Date.now(), createdBy: "system", auto: true, settled: false, deleted: false
      });
      await updateDoc(doc(db, "recurring", r.id), { lastPosted: ym });
    } catch (e) {}
  }
}

/* ============ csv ============ */
function exportCsv() {
  const n = names();
  const rows = [["Date", "Description", "Category", "Amount", "Paid by", "For", "Status"]];
  state.expenses.filter(e => !e.deleted).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).forEach(e => {
    rows.push([e.date || dateKey(e.createdAt || Date.now()), e.desc || "", catOf(e.category).label,
      (+e.amount || 0).toFixed(2), e.paidBy === "a" ? n.a : n.b,
      e.for === "both" ? "Both" : (e.for === "a" ? n.a : n.b), e.settled ? "Settled" : "Outstanding"]);
  });
  state.settlements.filter(s => s.kind === "manual").forEach(s => {
    rows.push([dateKey(s.createdAt || Date.now()), s.note || "Settled up", "Settlement", (+s.amount || 0).toFixed(2), s.by === "a" ? n.a : n.b, "—", "Paid"]);
  });
  const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "split-orbit-" + dateKey(Date.now()) + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ============ render ============ */
function render() {
  if (state.phase === "boot") return;
  if (state.phase === "signin" || !state.user) return renderSignIn();
  if (state.accessError) return renderStranger(true);
  if (!state.gotConfig) { appEl.innerHTML = '<div class="boot"><div class="spark"></div><p>Preparing your deck…</p></div>'; return; }
  if (state.config === null) return renderSetup();
  if (state.me === null) return renderStranger(false);
  renderApp();
}

function renderApp() {
  const n = names();
  const changed = _prevTab !== state.tab;
  _prevTab = state.tab;
  _pendingGauge = null; _pendingBal = null;
  let view = "";
  if (state.tab === "home") view = viewHome(n);
  else if (state.tab === "money") view = viewMoney(n);
  else if (state.tab === "chores") view = viewChores(n);
  else if (state.tab === "history") view = viewHistory(n);

  appEl.innerHTML = '<div class="deck' + (changed ? " swap" : "") + '">' + header(n) + view + '</div>' + tabbar();

  if (_pendingGauge) {
    const arcs = appEl.querySelectorAll(".gauge .arc");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      arcs.forEach(a => { a.setAttribute("stroke-dasharray", a.dataset.to); });
    }));
    _gaugeDrawn = true;
  }
  if (_pendingBal) {
    const el = appEl.querySelector(".gauge .v");
    if (el) countMoney(el, _pendingBal, 850);
    _balAnimated = true;
  }
}

function countMoney(el, to, dur) {
  const t0 = performance.now();
  (function step(now) {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = money(to * e);
    if (p < 1) requestAnimationFrame(step); else el.textContent = money(to);
  })(t0);
}

function header(n) {
  const st = state.status;
  const stTxt = st === "live" ? "Live sync" : st === "offline" ? "Offline" : "Syncing";
  const stCls = st === "live" ? "live" : st === "offline" ? "offline" : "sync";
  return '' +
    '<div class="topbar">' +
      '<div class="brand"><div class="mark"><i></i></div>' +
        '<div><h1>Split Orbit</h1><div class="sub">' + esc(state.config.deck || "Our place") + '</div></div></div>' +
      '<span class="sdot ' + stCls + '" title="' + stTxt + '"></span>' +
      '<button class="you-pill" data-act="settings" aria-label="You and settings">' +
        '<span class="dotk" style="background:var(--crew-' + state.me + ')"></span>' + esc(state.me === "a" ? n.a : n.b) +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" style="opacity:.5;margin-left:2px"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg></button>' +
    '</div>';
}

const ICON = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 4l9 6.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/></svg>',
  money: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.4"/></svg>',
  chores: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 2.6 2.6L16 9"/></svg>',
  history: '<svg viewBox="0 0 24 24"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M5 3v4h4"/><path d="M12 8v4.5l3 1.8"/></svg>'
};
function tabbar() {
  const t = state.tab;
  const item = (id, label) => '<button class="tab' + (t === id ? " on" : "") + '" data-tab="' + id + '">' + ICON[id] + label + '</button>';
  return '<nav class="tabbar">' +
    item("home", "Home") + item("money", "Money") + item("chores", "Chores") + item("history", "History") +
    '</nav>';
}

/* ---- HOME ---- */
function viewHome(n) {
  const bal = balance();
  const today = new Date();
  const meOwed = state.me === "a" ? bal.net : -bal.net;
  let coreK, coreV, zero = false, lineTxt;
  if (Math.abs(bal.net) < 0.005) { coreK = "Balance"; coreV = "Settled"; zero = true; lineTxt = "All square. Nothing owed either way."; }
  else if (meOwed > 0) { coreK = "You are owed"; coreV = money(meOwed); lineTxt = '<b>' + esc(otherName()) + '</b> owes you ' + esc(money(meOwed)); }
  else { coreK = "You owe"; coreV = money(-meOwed); lineTxt = 'You owe <b>' + esc(otherName()) + '</b> ' + esc(money(-meOwed)); }

  const R = 92, C = 2 * Math.PI * R, gap = 7;
  const tot = bal.mSpentA + bal.mSpentB;
  const fracA = tot > 0 ? bal.mSpentA / tot : 0.5;
  const aLen = Math.max(0, C * fracA - gap), bLen = Math.max(0, C * (1 - fracA) - gap);

  const mine = [], theirs = [];
  state.duties.forEach(d => { if (!d.deleted) (turnFor(d, today) === state.me ? mine : theirs).push(d); });
  const todayJobs = state.duties.filter(d => !d.deleted && (d.days || []).includes(today.getDay()) && turnFor(d, today) === state.me && !(d.log && d.log[dateKey(today)]));

  const drawArc = !_gaugeDrawn;
  if (drawArc && tot > 0) _pendingGauge = true;
  const daDim = (len) => drawArc ? "0 " + C : len + " " + (C - len);
  const aDA = daDim(aLen), bDA = daDim(bLen);
  const animBal = !_balAnimated && !zero;
  if (animBal) _pendingBal = meOwed > 0 ? meOwed : -meOwed;

  return '' +
    '<section class="core">' +
      '<div class="gauge"><svg viewBox="0 0 220 220" aria-hidden="true">' +
        '<circle class="track" cx="110" cy="110" r="' + R + '" fill="none" stroke-width="6"/>' +
        (tot > 0 ?
          '<circle class="arc" cx="110" cy="110" r="' + R + '" fill="none" stroke="var(--crew-a)" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + aDA + '" data-to="' + aLen + ' ' + (C - aLen) + '"/>' +
          '<circle class="arc" cx="110" cy="110" r="' + R + '" fill="none" stroke="var(--crew-b)" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + bDA + '" data-to="' + bLen + ' ' + (C - bLen) + '" stroke-dashoffset="' + (-(aLen + gap)) + '"/>' : '') +
        '</svg><div class="mid"><div class="k">' + esc(coreK) + '</div><div class="v' + (zero ? " zero" : "") + '">' + esc(animBal ? money(0) : coreV) + '</div>' +
        '<div class="nn">' + (tot > 0 ? esc(money(tot)) + " this mo" : "no spend yet") + '</div></div></div>' +
      '<div class="readout"><div class="line">' + lineTxt + '</div>' +
        '<div class="contrib">' +
          '<div><span class="dotk" style="background:var(--crew-a)"></span> ' + esc(n.a) + ' paid<b>' + esc(money(bal.mSpentA)) + '</b></div>' +
          '<div><span class="dotk" style="background:var(--crew-b)"></span> ' + esc(n.b) + ' paid<b>' + esc(money(bal.mSpentB)) + '</b></div></div>' +
        '<button class="settle" data-act="settle"' + (zero ? " disabled" : "") + '>◇ Settle up</button>' +
      '</div>' +
    '</section>' +

    categoryCard(n) +

    '<section class="panel">' +
      '<header><h2>Today · ' + esc(DOW[(today.getDay() + 6) % 7]) + '</h2><button class="addbtn" data-tab="chores">Roster ›</button></header>' +
      (todayJobs.length
        ? '<div class="list">' + todayJobs.map(d =>
            '<div class="row-x"><div class="av ' + state.me + '">✓</div>' +
            '<div class="desc"><div class="t">' + esc(d.title) + '</div><div class="m">your turn today</div>' +
            '<div class="rowactions"><button class="rowbtn pay" data-act="toggle-cell" data-id="' + esc(d.id) + '" data-dk="' + dateKey(today) + '">Mark done ✓</button></div></div>' +
            '<div class="amt"></div></div>').join("") + '</div>'
        : '<div class="mini-empty">Nothing of yours due today ' + (mine.length ? "· you’re on " + esc(mine.map(d => d.title).join(", ")) + " this week" : "") + '</div>') +
    '</section>' +

    activityCard(n);
}

function categoryCard(n) {
  const totals = monthCategoryTotals(state.month);
  const keys = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  const sum = keys.reduce((s, k) => s + totals[k], 0);
  const d = new Date(state.month + "-01");
  const label = d.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
  const canNext = state.month < ymOf(new Date());
  return '<section class="panel">' +
    '<header><h2>Spending</h2><div class="monthnav">' +
      '<button data-act="month-prev" aria-label="Previous month">‹</button><span>' + esc(label) + '</span>' +
      '<button data-act="month-next" ' + (canNext ? "" : "disabled") + ' aria-label="Next month">›</button></div></header>' +
    (sum > 0
      ? '<div class="catwrap"><div class="catbar">' +
          keys.map(k => '<span style="width:' + (totals[k] / sum * 100).toFixed(1) + '%;background:' + catOf(k).color + '" title="' + esc(catOf(k).label) + '"></span>').join("") +
        '</div><div class="catlist">' +
          keys.map(k => '<div><span class="cdot" style="background:' + catOf(k).color + '"></span>' + catOf(k).emoji + " " + esc(catOf(k).label) +
            '<b>' + esc(money(totals[k])) + '</b></div>').join("") +
        '<div class="ctotal">Total<b>' + esc(money(sum)) + '</b></div></div></div>'
      : '<div class="mini-empty">No spending logged for ' + esc(label) + '</div>') +
  '</section>';
}

function activityCard(n) {
  const acts = [];
  state.expenses.forEach(e => {
    if (e.deleted) return;
    acts.push({ ts: e.createdAt || 0, who: e.createdBy === "system" ? (e.paidBy) : e.createdBy, html: (e.auto ? "↻ " : "") + '<b>' + esc(e.createdBy === "system" ? "Auto" : (e.createdBy === "a" ? n.a : n.b)) + '</b> added ' + esc(e.desc) + ' · ' + esc(money(e.amount)) });
    if (e.settled && e.settledAt) acts.push({ ts: e.settledAt, who: e.settledBy, html: '<b>' + esc(e.settledBy === "a" ? n.a : n.b) + '</b> settled ' + esc(e.desc) });
  });
  state.settlements.filter(s => s.kind === "manual").forEach(s => acts.push({ ts: s.createdAt || 0, who: s.by, html: '<b>' + esc(s.by === "a" ? n.a : n.b) + '</b> settled up · ' + esc(money(s.amount)) }));
  Object.entries({}).forEach(() => {});
  state.duties.forEach(d => {
    if (!d.log) return;
    Object.entries(d.log).forEach(([dk, who]) => {
      const ts = new Date(dk + "T12:00").getTime();
      if (Date.now() - ts < 7 * 864e5) acts.push({ ts, who, html: '<b>' + esc(who === "a" ? n.a : n.b) + '</b> did ' + esc(d.title) + ' ✓' });
    });
  });
  acts.sort((a, b) => b.ts - a.ts);
  const top = acts.slice(0, 7);
  if (!top.length) return "";
  return '<section class="panel"><header><h2>Activity</h2></header><div class="feed">' +
    top.map(a => '<div class="fitem ' + (a.who || "a") + '"><span class="fi-dot"></span><span class="fi-t">' + a.html + '</span><span class="fi-time">' + esc(relTime(a.ts)) + '</span></div>').join("") +
    '</div></section>';
}

/* ---- MONEY ---- */
function viewMoney(n) {
  const outstanding = state.expenses.filter(e => !e.deleted && !e.settled)
    .filter(e => state.filterCat === "all" || e.category === state.filterCat);
  const chips = '<div class="filters"><button class="fchip' + (state.filterCat === "all" ? " on" : "") + '" data-cat="all">All</button>' +
    Object.keys(CATS).map(k => '<button class="fchip' + (state.filterCat === k ? " on" : "") + '" data-cat="' + k + '">' + catOf(k).emoji + '</button>').join("") + '</div>';

  const rows = outstanding.map(e => expenseRow(e, n)).join("");
  const body = outstanding.length ? '<div class="list">' + rows + '</div>'
    : '<div class="empty"><p>No outstanding expenses' + (state.filterCat !== "all" ? " in this category" : "") + '.</p>' +
      '<button class="addbtn" data-act="add-x"><span class="p">+</span> Add expense</button></div>';

  return '<section class="panel">' +
    '<header><h2>Outstanding<span class="count">' + outstanding.length + '</span></h2>' +
      '<div class="hbtns">' +
        (undoStack.length ? '<button class="iconbtn" data-act="undo" title="Undo ' + esc(undoStack[undoStack.length - 1].label) + '">↶</button>' : '') +
        (redoStack.length ? '<button class="iconbtn" data-act="redo" title="Redo">↷</button>' : '') +
        '<button class="addbtn" data-act="add-x"><span class="p">+</span> Expense</button>' +
      '</div></header>' +
    chips + body +
  '</section>';
}

function expenseRow(e, n) {
  const payer = e.paidBy === "a" ? n.a : n.b;
  const forTxt = e.for === "both" ? "split evenly" : "for " + esc(e.for === "a" ? n.a : n.b);
  const debt = expenseDebt(e);
  let action = "";
  if (debt.amount) {
    if (debt.debtor === state.me) action = '<button class="rowbtn pay" data-act="settle-x" data-id="' + esc(e.id) + '">I paid my ' + esc(money(debt.amount)) + '</button>';
    else action = '<button class="rowbtn got" data-act="settle-x" data-id="' + esc(e.id) + '">Mark ' + esc(money(debt.amount)) + ' received</button>';
  }
  return '<div class="row-x">' +
    '<div class="av ' + e.paidBy + '" title="' + esc(catOf(e.category).label) + '">' + catOf(e.category).emoji + '</div>' +
    '<div class="desc"><div class="t">' + esc(e.desc || "Expense") + '</div>' +
      '<div class="m">' + esc(payer) + ' paid · ' + forTxt + ' · ' + esc(new Date(e.createdAt || Date.now()).toLocaleDateString("en-AU", { day: "numeric", month: "short" })) + (e.auto ? " · auto" : "") + '</div>' +
      (action ? '<div class="rowactions">' + action + '</div>' : '') +
    '</div>' +
    '<div class="amt"><div class="nu">' + esc(money(+e.amount || 0)) + '</div>' +
      '<div class="mini"><button data-act="edit-x" data-id="' + esc(e.id) + '" title="Edit">✎</button>' +
      '<button data-act="del-x" data-id="' + esc(e.id) + '" title="Delete">✕</button></div></div>' +
  '</div>';
}

/* ---- CHORES ---- */
function viewChores(n) {
  const stat = choreStats();
  const streak = '<div class="streak">' +
    '<div class="' + (stat.a.done >= stat.a.due ? "ok" : "") + '"><span class="dotk" style="background:var(--crew-a)"></span>' + esc(n.a) + ' <b>' + stat.a.done + '/' + stat.a.due + '</b></div>' +
    '<div class="' + (stat.b.done >= stat.b.due ? "ok" : "") + '"><span class="dotk" style="background:var(--crew-b)"></span>' + esc(n.b) + ' <b>' + stat.b.done + '/' + stat.b.due + '</b></div>' +
    '<span class="sk-note">done / due this week</span></div>';

  const list = state.duties.filter(d => !d.deleted);
  if (!list.length) {
    return '<section class="panel"><header><h2>Roster</h2><button class="addbtn" data-act="add-d"><span class="p">+</span> Duty</button></header>' +
      '<div class="empty"><p>No house duties yet.</p><button class="addbtn" data-act="add-d"><span class="p">+</span> Add a duty</button></div></section>';
  }
  const today = new Date();
  return '<section class="panel">' +
    '<header><h2>This week<span class="count">wk ' + weekIndexOf(today) + '</span></h2>' +
      '<div class="hbtns">' + (undoStack.length ? '<button class="iconbtn" data-act="undo" title="Undo">↶</button>' : '') +
      '<button class="addbtn" data-act="add-d"><span class="p">+</span> Duty</button></div></header>' +
    streak +
    '<div class="list">' + list.map(d => dutyBlock(d, today, n)).join("") + '</div>' +
  '</section>';
}

function dutyBlock(d, today, n) {
  const assignee = turnFor(d, today);
  const mon = mondayOf(today);
  const cells = DAY_IDX.map((ji, col) => {
    const on = (d.days || []).includes(ji);
    if (!on) return '<span class="wk-cell"></span>';
    const cd = new Date(mon); cd.setDate(mon.getDate() + col);
    const dk = dateKey(cd);
    const done = d.log && d.log[dk];
    const isToday = ji === today.getDay();
    return '<button class="wk-cell on ' + assignee + (isToday ? " today" : "") + (done ? " done" : "") + '" data-act="toggle-cell" data-id="' + esc(d.id) + '" data-dk="' + dk + '" aria-label="' + DOW[col] + '">' + (done ? "✓" : DOW[col][0]) + '</button>';
  }).join("");
  const meta = d.rotation === "fixed" ? "always " + esc(assignee === "a" ? n.a : n.b) : "alternating · this week " + esc(assignee === "a" ? n.a : n.b);
  const dk = dateKey(today);
  const dueToday = (d.days || []).includes(today.getDay());
  let cta = "";
  if (dueToday) {
    const done = d.log && d.log[dk];
    if (done) cta = '<button class="rowbtn done" data-act="toggle-cell" data-id="' + esc(d.id) + '" data-dk="' + dk + '">Done ' + (done === state.me ? "by you" : "by " + esc(done === "a" ? n.a : n.b)) + ' · undo</button>';
    else if (assignee === state.me) cta = '<button class="rowbtn pay" data-act="toggle-cell" data-id="' + esc(d.id) + '" data-dk="' + dk + '">Mark done ✓</button>';
    else cta = '<button class="rowbtn got" data-act="toggle-cell" data-id="' + esc(d.id) + '" data-dk="' + dk + '">Mark ' + esc(assignee === "a" ? n.a : n.b) + ' did it</button>';
  }
  return '<div class="duty">' +
    '<div class="duty-head"><div><div class="t">' + esc(d.title) + '</div><div class="m">' + meta +
      ' · <button data-act="del-d" data-id="' + esc(d.id) + '" class="lnk">remove</button></div></div>' +
      '<span class="dotk big" style="background:var(--crew-' + assignee + ')"></span></div>' +
    '<div class="wk">' + cells + '</div>' +
    (cta ? '<div class="rowactions">' + cta + '</div>' : '') +
  '</div>';
}

/* ---- HISTORY ---- */
function viewHistory(n) {
  const paid = state.expenses.filter(e => !e.deleted && e.settled).slice().sort((a, b) => (b.settledAt || 0) - (a.settledAt || 0));
  const manual = state.settlements.filter(s => s.kind === "manual").slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const trash = state.expenses.filter(e => e.deleted).slice().sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));

  const paidRows = paid.map(e => {
    const debt = expenseDebt(e);
    return '<div class="row-x paid">' +
      '<div class="av ' + e.paidBy + '">' + catOf(e.category).emoji + '</div>' +
      '<div class="desc"><div class="t">' + esc(e.desc) + '</div><div class="m">' + esc(money(debt.amount || 0)) + ' · ' + esc((e.settledBy === "a" ? n.a : n.b)) + ' paid · ' + esc(relTime(e.settledAt || e.createdAt || Date.now())) + '</div></div>' +
      '<div class="amt"><button class="lnk" data-act="unsettle-x" data-id="' + esc(e.id) + '">undo</button></div></div>';
  }).join("");
  const manualRows = manual.map(s => '<div class="row-x paid">' +
    '<div class="av ' + s.by + '">↔</div><div class="desc"><div class="t">Settled up</div><div class="m">' + esc((s.by === "a" ? n.a : n.b)) + ' paid ' + esc(money(s.amount)) + ' · ' + esc(relTime(s.createdAt || Date.now())) + '</div></div></div>').join("");

  return '<section class="panel">' +
      '<header><h2>Paid</h2><button class="addbtn" data-act="export">⤓ CSV</button></header>' +
      ((paid.length || manual.length) ? '<div class="list">' + manualRows + paidRows + '</div>' : '<div class="mini-empty">Nothing settled yet</div>') +
    '</section>' +
    '<section class="panel">' +
      '<header><h2>Recurring bills<span class="count">' + state.recurring.length + '</span></h2><button class="addbtn" data-act="add-r"><span class="p">+</span> Bill</button></header>' +
      (state.recurring.length ? '<div class="list">' + state.recurring.map(r => recurRow(r, n)).join("") + '</div>' : '<div class="mini-empty">Auto-add rent, internet, subscriptions on a set day each month</div>') +
    '</section>' +
    (trash.length ? '<section class="panel"><header><h2>Recently deleted</h2></header><div class="list">' +
      trash.map(e => '<div class="row-x"><div class="av ' + e.paidBy + '">' + catOf(e.category).emoji + '</div><div class="desc"><div class="t">' + esc(e.desc) + '</div><div class="m">deleted ' + esc(relTime(e.deletedAt || Date.now())) + '</div></div>' +
        '<div class="amt"><button class="lnk" data-act="restore-x" data-id="' + esc(e.id) + '">restore</button> <button class="lnk danger" data-act="purge-x" data-id="' + esc(e.id) + '">delete</button></div></div>').join("") +
      '</div></section>' : "");
}
function recurRow(r, n) {
  return '<div class="row-x"><div class="av ' + (r.paidBy || "a") + '">' + catOf(r.category).emoji + '</div>' +
    '<div class="desc"><div class="t">' + esc(r.desc) + (r.active === false ? ' <span class="muted">(paused)</span>' : '') + '</div>' +
      '<div class="m">' + esc(money(r.amount)) + ' · day ' + (r.dayOfMonth || 1) + ' · ' + esc((r.paidBy === "a" ? n.a : n.b)) + ' pays · ' + (r.for === "both" ? "split" : "for " + esc(r.for === "a" ? n.a : n.b)) + '</div></div>' +
    '<div class="amt"><div class="mini"><button data-act="toggle-r" data-id="' + esc(r.id) + '" title="Pause/resume">' + (r.active === false ? "▶" : "⏸") + '</button>' +
      '<button data-act="del-r" data-id="' + esc(r.id) + '" title="Delete">✕</button></div></div></div>';
}

/* ---- sign-in / setup / stranger ---- */
function renderSignIn() {
  appEl.innerHTML = '<div class="signin"><div class="mark"><i></i></div><h2>Split Orbit</h2>' +
    '<p>A shared deck for two — expenses split evenly, house duties on rotation, in sync.<br>Sign in with the Google account you set up.</p>' +
    '<button class="gbtn" data-act="signin"><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.8 6.1C12.2 13.6 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7c4.3-4 6.9-9.9 6.9-17.4z"/><path fill="#FBBC05" d="M10.3 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.2.8-4.6l-7.8-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.4 0-11.8-4.1-13.7-9.8l-7.8 6.1C6.4 42.6 14.6 48 24 48z"/></svg>Continue with Google</button>' +
    '<div class="err">' + esc(state.signinErr) + '</div></div>';
}
function renderStranger(access) {
  const n = names();
  appEl.innerHTML = '<div class="signin"><div class="mark"><i></i></div><h2>' + (access ? "Access blocked" : "Not your deck") + '</h2>' +
    '<p>' + (access
      ? "You're signed in as <b>" + esc(state.user.email) + "</b>, but that address isn't allowed. Add it to <b>firestore.rules</b> and run <b>firebase deploy --only firestore:rules</b>."
      : "You're signed in as <b>" + esc(state.user.email) + "</b>, but this deck belongs to <b>" + esc(n.a) + "</b> and <b>" + esc(n.b) + "</b>.") + '</p>' +
    '<button class="gbtn" data-act="signout">Sign out</button></div>';
}
function renderSetup() {
  const c = state.config || {};
  const mine = state.user.email;
  const firstName = (state.user.displayName || "").split(" ")[0] || "";
  appEl.innerHTML = '<div class="setup"><div class="card">' +
    '<h2>' + (c.deck ? "Edit deck" : "Set up your deck") + '</h2>' +
    '<p class="lead">Signed in as <b>' + esc(mine) + '</b> — that’s you.</p>' +
    '<div class="fld"><label>Place name</label><input type="text" id="su-deck" placeholder="Flat 3B" value="' + esc(c.deck || "") + '"></div>' +
    '<div class="fld"><label>Your name</label><input type="text" id="su-a" placeholder="' + esc(firstName || "Alex") + '" value="' + esc((c.a && c.a.name) || firstName) + '"></div>' +
    '<div class="fld"><label>Partner’s name</label><input type="text" id="su-bn" placeholder="Sam" value="' + esc((c.b && c.b.name) || "") + '"></div>' +
    '<div class="fld"><label>Partner’s Google email <span class="opt">(optional)</span></label><input type="email" id="su-be" placeholder="sam@gmail.com" value="' + esc((c.b && c.b.email) || "") + '"></div>' +
    '<p class="hint">Both emails must also be in <b>firestore.rules</b>.</p>' +
    '<button class="go" id="su-go">' + (c.deck ? "Save" : "Launch deck") + '</button>' +
    '<div class="signed">Signed in as ' + esc(mine) + ' · <button data-act="signout">switch account</button></div>' +
  '</div></div>';
  document.getElementById("su-go").onclick = () => {
    const deck = fv("su-deck") || "Our place", an = fv("su-a") || firstName || "Alex", bn = fv("su-bn") || "Crew B", be = norm(fv("su-be"));
    if (be && be === norm(mine)) { toast("Partner email can't be your own"); return; }
    S.setConfig({ deck, a: { email: norm(mine), name: an }, b: { email: be, name: bn } }).then(() => toast("Saved")).catch(() => toast("Could not save"));
  };
}
function fv(id) { const e = document.getElementById(id); return e ? e.value.trim() : ""; }

/* ============ sheets / modals ============ */
function sheet(inner, cls) {
  const s = document.createElement("div");
  s.className = "scrim";
  s.innerHTML = '<div class="modal ' + (cls || "") + '">' + inner + '</div>';
  s.addEventListener("click", e => { if (e.target === s) close(); });
  function close() { s.remove(); document.removeEventListener("keydown", onKey); }
  function onKey(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);
  document.body.appendChild(s);
  s.querySelector("[data-x]").onclick = close;
  return { el: s, close };
}
function chipGroup(wrap, cb) {
  wrap.querySelectorAll("button").forEach(b => b.onclick = () => {
    wrap.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", "true"); cb(b.dataset.v);
  });
}
function catPicker(id, sel) {
  return '<div class="catpick" id="' + id + '">' + Object.keys(CATS).map(k =>
    '<button data-v="' + k + '" aria-pressed="' + (k === sel) + '">' + catOf(k).emoji + '<span>' + esc(catOf(k).label) + '</span></button>').join("") + '</div>';
}

function expenseModal(edit) {
  const n = names();
  const e = edit || {};
  const m = sheet(
    '<header><h3>' + (edit ? "Edit expense" : "New expense") + '</h3><button data-x aria-label="Close">✕</button></header>' +
    '<div class="body">' +
      '<div class="fld"><label>Description</label><input type="text" id="x-desc" placeholder="Groceries, rent, dinner…" value="' + esc(e.desc || "") + '"></div>' +
      '<div class="fld"><label>Amount (AUD)</label><input type="number" id="x-amt" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="' + (e.amount != null ? e.amount : "") + '"></div>' +
      '<div class="fld"><label>Category</label>' + catPicker("x-cat", e.category || "groceries") + '</div>' +
      '<div class="fld"><label>Paid by</label><div class="chips" id="x-paid">' +
        '<button class="chip" data-v="a" aria-pressed="' + ((e.paidBy || state.me) === "a") + '">' + esc(n.a) + '</button>' +
        '<button class="chip b" data-v="b" aria-pressed="' + ((e.paidBy || state.me) === "b") + '">' + esc(n.b) + '</button></div></div>' +
      '<div class="fld"><label>Who was it for?</label><div class="chips" id="x-for">' +
        '<button class="chip" data-v="both" aria-pressed="' + ((e.for || "both") === "both") + '">Both</button>' +
        '<button class="chip" data-v="a" aria-pressed="' + (e.for === "a") + '">' + esc(n.a) + '</button>' +
        '<button class="chip b" data-v="b" aria-pressed="' + (e.for === "b") + '">' + esc(n.b) + '</button></div></div>' +
      '<p class="hint" id="x-hint"></p>' +
      '<button class="go" id="x-go">' + (edit ? "Save" : "Add expense") + '</button>' +
    '</div>');
  let paid = e.paidBy || state.me, forv = e.for || "both", ccat = e.category || "groceries";
  chipGroup(m.el.querySelector("#x-paid"), v => { paid = v; hint(); });
  chipGroup(m.el.querySelector("#x-for"), v => { forv = v; hint(); });
  m.el.querySelectorAll("#x-cat button").forEach(b => b.onclick = () => {
    m.el.querySelectorAll("#x-cat button").forEach(x => x.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", "true"); ccat = b.dataset.v;
  });
  const amtEl = m.el.querySelector("#x-amt");
  amtEl.addEventListener("input", hint);
  function hint() {
    const amt = parseFloat(amtEl.value) || 0, h = m.el.querySelector("#x-hint");
    if (!amt) { h.textContent = ""; return; }
    const respA = forv === "both" ? amt / 2 : (forv === "a" ? amt : 0);
    const d = (paid === "a" ? amt : 0) - respA;
    if (Math.abs(d) < 0.005) h.textContent = "Even — nobody owes for this.";
    else if (d > 0) h.textContent = n.b + " will owe " + n.a + " " + money(d) + ".";
    else h.textContent = n.a + " will owe " + n.b + " " + money(-d) + ".";
  }
  if (!edit) m.el.querySelector("#x-desc").focus();
  m.el.querySelector("#x-go").onclick = async () => {
    const amt = parseFloat(amtEl.value);
    if (!amt || amt <= 0) { amtEl.focus(); return; }
    const rec = { desc: fv("x-desc") || "Expense", amount: Math.round(amt * 100) / 100, category: ccat, paidBy: paid, for: forv, date: dateKey(e.createdAt || Date.now()) };
    try {
      if (edit) {
        const before = { desc: e.desc, amount: e.amount, category: e.category, paidBy: e.paidBy, for: e.for, date: e.date, createdAt: e.createdAt, createdBy: e.createdBy, settled: e.settled || false, deleted: false };
        await S.editExpense(e.id, before, { ...before, ...rec });
        toast("Saved");
      } else {
        await S.addExpense({ id: uid(), ...rec, createdAt: Date.now(), createdBy: state.me, settled: false, deleted: false });
        toast("Expense added · undo in Money tab");
      }
      m.close();
    } catch (err) { toast("Could not save"); }
  };
}

function settleModal() {
  const n = names(), bal = balance();
  const debtor = bal.net > 0 ? "b" : "a", amt = Math.abs(bal.net);
  const m = sheet(
    '<header><h3>Settle up</h3><button data-x aria-label="Close">✕</button></header>' +
    '<div class="body">' +
      '<p class="hint">' + (amt < 0.005 ? "Already settled." : esc(debtor === "a" ? n.a : n.b) + " pays " + esc(debtor === "a" ? n.b : n.a) + " to clear everything.") + '</p>' +
      '<div class="fld"><label>Payer</label><div class="chips" id="s-by">' +
        '<button class="chip" data-v="a" aria-pressed="' + (debtor === "a") + '">' + esc(n.a) + '</button>' +
        '<button class="chip b" data-v="b" aria-pressed="' + (debtor === "b") + '">' + esc(n.b) + '</button></div></div>' +
      '<div class="fld"><label>Amount (AUD)</label><input type="number" id="s-amt" step="0.01" min="0" value="' + (Math.round(amt * 100) / 100) + '"></div>' +
      '<div class="fld"><label>Note</label><input type="text" id="s-note" placeholder="bank transfer"></div>' +
      '<button class="go" id="s-go">Record payment</button>' +
    '</div>');
  let by = debtor;
  chipGroup(m.el.querySelector("#s-by"), v => by = v);
  m.el.querySelector("#s-go").onclick = async () => {
    const a = parseFloat(m.el.querySelector("#s-amt").value);
    if (!a || a <= 0) return;
    try { await S.settleUp(Math.round(a * 100) / 100, by, fv("s-note")); m.close(); toast("Settled up"); }
    catch (e) { toast("Could not save"); }
  };
}

function dutyModal() {
  const n = names();
  const m = sheet(
    '<header><h3>New duty</h3><button data-x aria-label="Close">✕</button></header>' +
    '<div class="body">' +
      '<div class="fld"><label>What needs doing</label><input type="text" id="d-title" placeholder="Dishes, bins, bathroom…"></div>' +
      '<div class="fld"><label>Which days</label><div class="days" id="d-days">' + DOW.map((d, i) => '<button data-i="' + DAY_IDX[i] + '" aria-pressed="true">' + d + '</button>').join("") + '</div></div>' +
      '<div class="fld"><label>Who does it</label><div class="chips" id="d-rot">' +
        '<button class="chip" data-v="alt" aria-pressed="true">Alternate weekly</button>' +
        '<button class="chip" data-v="fa" aria-pressed="false">Always ' + esc(n.a) + '</button>' +
        '<button class="chip b" data-v="fb" aria-pressed="false">Always ' + esc(n.b) + '</button></div></div>' +
      '<div class="fld" id="d-first-wrap"><label>Starts with</label><div class="chips" id="d-first">' +
        '<button class="chip" data-v="a" aria-pressed="true">' + esc(n.a) + '</button>' +
        '<button class="chip b" data-v="b" aria-pressed="false">' + esc(n.b) + '</button></div></div>' +
      '<button class="go" id="d-go">Add duty</button>' +
    '</div>');
  const days = {}; DAY_IDX.forEach(i => days[i] = true);
  m.el.querySelectorAll("#d-days button").forEach(b => b.onclick = () => { const i = +b.dataset.i; days[i] = !days[i]; b.setAttribute("aria-pressed", String(days[i])); });
  let rot = "alt", first = "a";
  chipGroup(m.el.querySelector("#d-rot"), v => { rot = v; m.el.querySelector("#d-first-wrap").style.display = v === "alt" ? "" : "none"; });
  chipGroup(m.el.querySelector("#d-first"), v => first = v);
  m.el.querySelector("#d-title").focus();
  m.el.querySelector("#d-go").onclick = async () => {
    const title = fv("d-title"); if (!title) { m.el.querySelector("#d-title").focus(); return; }
    let dl = DAY_IDX.filter(i => days[i]); if (!dl.length) dl = DAY_IDX.slice();
    const d = { id: uid(), title, days: dl, log: {}, createdAt: Date.now() };
    if (rot === "fa") { d.rotation = "fixed"; d.fixedTo = "a"; }
    else if (rot === "fb") { d.rotation = "fixed"; d.fixedTo = "b"; }
    else { d.rotation = "alt"; d.first = first; d.startWeek = weekIndexOf(new Date()); }
    try { await S.addDuty(d); m.close(); toast("Duty added"); } catch (e) { toast("Could not save"); }
  };
}

function recurringModal() {
  const n = names();
  const m = sheet(
    '<header><h3>Recurring bill</h3><button data-x aria-label="Close">✕</button></header>' +
    '<div class="body">' +
      '<div class="fld"><label>Name</label><input type="text" id="r-desc" placeholder="Rent, Internet, Netflix…"></div>' +
      '<div class="fld"><label>Amount (AUD)</label><input type="number" id="r-amt" step="0.01" min="0" placeholder="0.00"></div>' +
      '<div class="fld"><label>Category</label>' + catPicker("r-cat", "utilities") + '</div>' +
      '<div class="fld"><label>Day of month</label><input type="number" id="r-day" min="1" max="28" value="1"></div>' +
      '<div class="fld"><label>Paid by</label><div class="chips" id="r-paid">' +
        '<button class="chip" data-v="a" aria-pressed="' + (state.me === "a") + '">' + esc(n.a) + '</button>' +
        '<button class="chip b" data-v="b" aria-pressed="' + (state.me === "b") + '">' + esc(n.b) + '</button></div></div>' +
      '<div class="fld"><label>Split</label><div class="chips" id="r-for">' +
        '<button class="chip" data-v="both" aria-pressed="true">Both</button>' +
        '<button class="chip" data-v="a" aria-pressed="false">' + esc(n.a) + '</button>' +
        '<button class="chip b" data-v="b" aria-pressed="false">' + esc(n.b) + '</button></div></div>' +
      '<p class="hint">Auto-added on that day each month, next time either of you opens the app.</p>' +
      '<button class="go" id="r-go">Add bill</button>' +
    '</div>');
  let paid = state.me, forv = "both", ccat = "utilities";
  chipGroup(m.el.querySelector("#r-paid"), v => paid = v);
  chipGroup(m.el.querySelector("#r-for"), v => forv = v);
  m.el.querySelectorAll("#r-cat button").forEach(b => b.onclick = () => { m.el.querySelectorAll("#r-cat button").forEach(x => x.setAttribute("aria-pressed", "false")); b.setAttribute("aria-pressed", "true"); ccat = b.dataset.v; });
  m.el.querySelector("#r-desc").focus();
  m.el.querySelector("#r-go").onclick = async () => {
    const amt = parseFloat(m.el.querySelector("#r-amt").value);
    const desc = fv("r-desc");
    if (!desc || !amt || amt <= 0) { toast("Name and amount needed"); return; }
    let day = parseInt(m.el.querySelector("#r-day").value, 10) || 1; day = Math.max(1, Math.min(28, day));
    try {
      await S.addRecurring({ id: uid(), desc, amount: Math.round(amt * 100) / 100, category: ccat, dayOfMonth: day, paidBy: paid, for: forv, active: true, lastPosted: "", createdAt: Date.now() });
      m.close(); toast("Recurring bill added");
    } catch (e) { toast("Could not save"); }
  };
}

function settingsSheet() {
  const n = names();
  sheet(
    '<header><h3>Settings</h3><button data-x aria-label="Close">✕</button></header>' +
    '<div class="body">' +
      '<div class="setrow"><div><b>Deck &amp; names</b><span>' + esc(state.config.deck || "") + ' · ' + esc(n.a) + ' &amp; ' + esc(n.b) + '</span></div>' +
        '<button class="bbtn" data-act="edit-deck">Edit</button></div>' +
      '<div class="setrow"><div><b>Export data</b><span>Download all expenses as CSV</span></div><button class="bbtn" data-act="export">CSV</button></div>' +
      '<div class="setrow"><div><b>Signed in</b><span>' + esc(state.user.email) + ' · you are ' + esc(meName()) + '</span></div>' +
        '<button class="bbtn" data-act="signout">Sign out</button></div>' +
      '<p class="hint">Split Orbit · data lives in your private Firebase. Open the same link on any device — changes sync live while the app is open.</p>' +
    '</div>', "sheet");
}

/* ============ events ============ */
document.addEventListener("click", async e => {
  const tabEl = e.target.closest("[data-tab]");
  if (tabEl) { state.tab = tabEl.dataset.tab; try { localStorage.setItem("so.tab", state.tab); } catch (x) {} render(); return; }
  const catEl = e.target.closest("[data-cat]");
  if (catEl) { state.filterCat = catEl.dataset.cat; render(); return; }
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const a = t.dataset.act, id = t.dataset.id;
  if (a === "signin") doSignIn();
  else if (a === "signout") signOut(auth);
  else if (a === "settings") settingsSheet();
  else if (a === "add-x") expenseModal();
  else if (a === "edit-x") { const ex = state.expenses.find(x => x.id === id); if (ex) expenseModal(ex); }
  else if (a === "del-x") S.softDelete(id).then(() => toast("Deleted · undo in Money"));
  else if (a === "restore-x") S.restore(id).then(() => toast("Restored"));
  else if (a === "purge-x") { if (!window.confirm || confirm("Delete permanently?")) S.hardDelete(id); }
  else if (a === "settle-x") S.settleExpense(id);
  else if (a === "unsettle-x") S.unsettleExpense(id).then(() => toast("Moved back to outstanding"));
  else if (a === "settle") settleModal();
  else if (a === "add-d") dutyModal();
  else if (a === "del-d") { if (!window.confirm || confirm("Remove this duty?")) S.delDuty(id); }
  else if (a === "toggle-cell") S.toggleDuty(id, t.dataset.dk);
  else if (a === "add-r") recurringModal();
  else if (a === "toggle-r") { const r = state.recurring.find(x => x.id === id); if (r) S.updateRecurring(id, { active: r.active === false }); }
  else if (a === "del-r") { if (!window.confirm || confirm("Delete this recurring bill?")) S.delRecurring(id); }
  else if (a === "undo") doUndo();
  else if (a === "redo") doRedo();
  else if (a === "export") exportCsv();
  else if (a === "edit-deck") { document.querySelectorAll(".scrim").forEach(s => s.remove()); renderSetup(); }
  else if (a === "month-prev") { const d = new Date(state.month + "-01"); d.setMonth(d.getMonth() - 1); state.month = ymOf(d); render(); }
  else if (a === "month-next") { const d = new Date(state.month + "-01"); d.setMonth(d.getMonth() + 1); if (ymOf(d) <= ymOf(new Date())) state.month = ymOf(d); render(); }
});
document.addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("wk-cell") && e.target.dataset.act === "toggle-cell") {
    e.preventDefault(); S.toggleDuty(e.target.dataset.id, e.target.dataset.dk);
  }
});

let toastT;
function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2600);
}

/* ============ aurora background ============ */
(function aurora() {
  const cv = document.getElementById("aurora"); if (!cv) return;
  const cx = cv.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
  const DPR = Math.min(devicePixelRatio || 1, 2);
  const darkMq = matchMedia("(prefers-color-scheme: dark)");
  let W, H, blobs, raf, t = 0;

  function palette() {
    const s = getComputedStyle(document.documentElement);
    return ["--aurora-1", "--aurora-2", "--aurora-3", "--aurora-4"].map(k => s.getPropertyValue(k).trim() || "180,180,220");
  }
  function build() {
    W = cv.width = Math.ceil(innerWidth * DPR);
    H = cv.height = Math.ceil(innerHeight * DPR);
    const cols = palette(), m = Math.max(W, H);
    // one hue anchored near each corner-ish region so all four always show
    const anchors = [[0.18, 0.12], [0.86, 0.30], [0.14, 0.78], [0.82, 0.92]];
    blobs = cols.map((c, i) => ({
      c, x: anchors[i][0] * W, y: anchors[i][1] * H,
      r: m * (0.62 + Math.random() * 0.22),
      ax: (26 + Math.random() * 30) * DPR, ay: (22 + Math.random() * 26) * DPR,
      sx: 0.00018 + Math.random() * 0.00012, sy: 0.00015 + Math.random() * 0.0001,
      ph: Math.random() * 6.283, drift: (Math.random() - .5) * 0.016 * DPR
    }));
  }
  function frame() {
    t += 1;
    const dark = darkMq.matches;
    const s = getComputedStyle(document.documentElement);
    cx.globalCompositeOperation = "source-over";
    cx.fillStyle = s.getPropertyValue("--bg").trim() || (dark ? "#0B0C16" : "#EDEFF7");
    cx.fillRect(0, 0, W, H);
    cx.globalCompositeOperation = dark ? "lighter" : "source-over";
    const alpha = dark ? 0.32 : 0.72;
    for (const b of blobs) {
      const x = b.x + Math.sin(t * b.sx + b.ph) * b.ax + (reduce ? 0 : t * b.drift);
      const y = b.y + Math.cos(t * b.sy + b.ph) * b.ay;
      const g = cx.createRadialGradient(x, y, 0, x, y, b.r);
      g.addColorStop(0, "rgba(" + b.c + "," + alpha + ")");
      g.addColorStop(1, "rgba(" + b.c + ",0)");
      cx.fillStyle = g;
      cx.fillRect(0, 0, W, H);
    }
    cx.globalCompositeOperation = "source-over";
    if (!reduce) raf = requestAnimationFrame(frame);
  }
  build(); frame();
  addEventListener("resize", () => { cancelAnimationFrame(raf); build(); frame(); });
  const onScheme = () => { cancelAnimationFrame(raf); build(); frame(); };
  if (darkMq.addEventListener) darkMq.addEventListener("change", onScheme);
  else if (darkMq.addListener) darkMq.addListener(onScheme);
})();

/* ============ service worker ============ */
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
