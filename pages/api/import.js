// POST {filename, content, titular, kind?, bank?, accountId?, accountLabel?, invertSign?}
//   -> prévia (nada é gravado)
// POST {..., commit:true, include:[ids], overrides:{id:{category,titular}}}
//   -> grava os lançamentos escolhidos
const { requireUser } = require('../../lib/server/auth');
const store = require('../../lib/server/store');
const { buildImport } = require('../../lib/importers');
const { CATEGORY_GROUPS } = require('../../lib/finance-categories');

export const config = { api: { bodyParser: { sizeLimit: '15mb' } } };

export default requireUser(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const b = req.body || {};
  if (!b.content) return res.status(400).json({ error: 'Arquivo vazio.' });
  const db = await store.read();
  const opts = {
    filename: b.filename || '', titular: b.titular || req.user.id, kind: b.kind || undefined, bank: b.bank || undefined,
    accountId: b.accountId || undefined, accountLabel: b.accountLabel || undefined,
    invertSign: b.invertSign === undefined || b.invertSign === null ? undefined : !!b.invertSign,
    existing: db.transactions, learned: db.learned,
  };
  const known = opts.accountId && db.accounts[opts.accountId];
  if (known) { opts.bank = opts.bank || known.bank; opts.kind = opts.kind || known.kind; opts.accountLabel = opts.accountLabel || known.label; }
  const result = buildImport(b.content, opts);
  if (!result.items.length) return res.status(422).json({ error: 'Não encontrei lançamentos neste arquivo. Envie o extrato em CSV ou OFX exportado pelo banco.' });

  if (!b.commit) return res.json(result);

  const include = new Set(b.include || result.items.filter(i => i.include).map(i => i.txn.id));
  const overrides = b.overrides || {};
  const out = await store.mutate(dbw => {
    const ids = new Set(dbw.transactions.map(t => t.id));
    let added = 0;
    result.items.forEach(({ txn }) => {
      if (!include.has(txn.id) || ids.has(txn.id)) return;
      const o = overrides[txn.id] || {};
      const t = { ...txn, createdBy: req.user.id, importedAt: new Date().toISOString() };
      if (o.category && o.category !== t.category) {
        t.category = o.category; t.categoryOverride = o.category;
        t.group = t.type === 'expense' ? (CATEGORY_GROUPS[o.category] || 'a_classificar') : null;
        if (t.counterparty) dbw.learned[require('../../lib/finance-categories').normalize(t.counterparty)] = o.category;
      }
      if (o.titular) t.titular = o.titular;
      dbw.transactions.push(store.normalizeTxn(t));
      ids.add(t.id); added++;
    });
    const acc = result.account;
    dbw.accounts[acc.id] = { ...(dbw.accounts[acc.id] || {}), ...acc, label: (dbw.accounts[acc.id] && dbw.accounts[acc.id].label) || acc.label };
    dbw.imports.push({ at: new Date().toISOString(), by: req.user.id, file: b.filename || 'arquivo', account: acc.id, count: added,
      periodo: Object.keys(result.months).sort().join(', ') });
    return added;
  });
  return res.json({ ok: true, added: out, account: result.account });
});
