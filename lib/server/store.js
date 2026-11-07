// Banco de dados em arquivo JSON dentro de DATA_DIR (volume persistente no
// Coolify). Escritas são atômicas (arquivo temporário + rename) e serializadas
// numa fila para que Salomão e Elizandra possam usar ao mesmo tempo.

const fs = require('fs');
const path = require('path');
const { classifyImportedTransaction, CATEGORY_GROUPS } = require('../finance-categories');
const { extractCounterparty, accountLabel } = require('../importers');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'financeiro.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const SEED_DIR = path.join(process.cwd(), 'seed');

let cache = null;
let queue = Promise.resolve();
let initPromise = null;

function emptyDb() {
  return { version: 2, transactions: [], accounts: {}, plan: null, learned: {}, imports: [], updatedAt: new Date().toISOString() };
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeAtomic(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db.updatedAt = new Date().toISOString();
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

function dailyBackup(db) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const f = path.join(BACKUP_DIR, `financeiro-${new Date().toISOString().slice(0, 10)}.json`);
    if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(db));
    const files = fs.readdirSync(BACKUP_DIR).filter(n => n.endsWith('.json')).sort();
    files.slice(0, Math.max(0, files.length - 30)).forEach(n => fs.unlinkSync(path.join(BACKUP_DIR, n)));
  } catch (e) { console.error('backup falhou', e.message); }
}

// Conta de cada lançamento já existente (extratos importados antes da migração).
function legacyAccount(t) {
  const titular = t.titular || 'salomao';
  if (t.account) return t.account;
  if (t.source === 'nubank') {
    const conta = /^(transfer[eê]ncia|compra no d[eé]bito|pagamento de (boleto|conta)|resgate|aplica[cç][aã]o|dep[oó]sito|pix)/i.test(t.description || '');
    return conta ? `nubank-checking-${titular}` : `nubank-card-${titular}`;
  }
  if (t.source === 'checking') return `conta-corrente-${titular}`;
  return `manual-${titular}`;
}

function defaultAccounts() {
  return {
    'nubank-checking-elizandra': { id: 'nubank-checking-elizandra', label: accountLabel('Nubank', 'checking', 'elizandra'), bank: 'Nubank', kind: 'checking', titular: 'elizandra' },
    'nubank-card-elizandra': { id: 'nubank-card-elizandra', label: accountLabel('Nubank', 'card', 'elizandra'), bank: 'Nubank', kind: 'card', titular: 'elizandra' },
    'conta-corrente-salomao': { id: 'conta-corrente-salomao', label: 'Conta corrente (Salomão)', bank: 'Banco do Brasil', kind: 'checking', titular: 'salomao' },
    'manual-salomao': { id: 'manual-salomao', label: 'Lançamentos manuais (Salomão)', bank: 'Manual', kind: 'manual', titular: 'salomao' },
    'manual-elizandra': { id: 'manual-elizandra', label: 'Lançamentos manuais (Elizandra)', bank: 'Manual', kind: 'manual', titular: 'elizandra' },
  };
}

function normalizeTxn(t) {
  const out = { ...t };
  out.amount = Math.abs(Math.round(Number(out.amount) || 0));
  if (out.date && (!out.month || !out.year)) { const [y, m] = out.date.split('-').map(Number); out.month = m; out.year = y; }
  out.titular = out.titular || 'salomao';
  out.account = legacyAccount(out);
  if (out.counterparty === undefined) out.counterparty = extractCounterparty(out.description);
  if (out.group === 'outros') out.group = CATEGORY_GROUPS[out.category] || 'a_classificar';
  return out;
}

async function fetchLegacySupabase() {
  const url = process.env.SUPABASE_ANTIGO_URL;
  const key = process.env.SUPABASE_ANTIGO_KEY;
  if (!url || !key) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/transactions?select=*&limit=20000`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    return rows.map(r => ({
      id: r.id, type: r.type, description: r.description, amount: r.amount, category: r.category_override || r.category,
      categoryOverride: r.category_override || null, group: r.group_name, subcategory: r.subcategory, status: r.status,
      paymentMethod: r.payment_method, date: r.date, month: r.month, year: r.year, installments: r.installments || 1,
      installmentMonth: r.installment_month || null, titular: r.titular || 'salomao', importRecordId: r.import_record_id || null,
    }));
  } catch (e) {
    console.warn('[migracao] Supabase antigo indisponível:', e.message);
    return null;
  }
}

async function buildInitialDb() {
  const { mergeImportedTransactions } = require('../finance-persistence');
  const db = emptyDb();
  const imported = readJSON(path.join(SEED_DIR, 'extratos.json'), []).map(classifyImportedTransaction);
  const remote = await fetchLegacySupabase();
  const base = remote && remote.length ? remote : readJSON(path.join(SEED_DIR, 'manuais.json'), []);
  const merged = mergeImportedTransactions(base, imported, CATEGORY_GROUPS);
  db.transactions = merged.map(normalizeTxn);
  db.accounts = defaultAccounts();
  db.imports.push({ at: new Date().toISOString(), by: 'sistema', file: remote ? 'migração Supabase + extratos' : 'carga inicial (extratos + manuais)', count: db.transactions.length });
  db.migratedFromSupabase = !!(remote && remote.length);
  console.log(`[migracao] banco criado com ${db.transactions.length} lançamentos (supabase: ${db.migratedFromSupabase})`);
  return db;
}

async function init() {
  if (cache) return cache;
  if (!initPromise) initPromise = (async () => {
    const existing = readJSON(DB_FILE, null);
    if (existing) cache = existing;
    else { cache = await buildInitialDb(); writeAtomic(cache); }
    return cache;
  })();
  return initPromise;
}

async function read() { return init(); }

function mutate(fn) {
  const run = queue.then(async () => {
    const db = await init();
    const result = await fn(db);
    dailyBackup(db);
    writeAtomic(db);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

module.exports = { read, mutate, normalizeTxn, DATA_DIR, DB_FILE };
