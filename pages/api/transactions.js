const { requireUser } = require('../../lib/server/auth');
const store = require('../../lib/server/store');
const { normalize } = require('../../lib/finance-categories');

const FIELDS = ['id', 'type', 'description', 'amount', 'category', 'categoryOverride', 'group', 'subcategory', 'status', 'paymentMethod',
  'date', 'month', 'year', 'installments', 'installmentMonth', 'titular', 'account', 'counterparty', 'source', 'importRecordId', 'notes'];

function clean(t) {
  const o = {};
  FIELDS.forEach(k => { if (t[k] !== undefined) o[k] = t[k]; });
  if (!o.id || !['income', 'expense'].includes(o.type) || !/^\d{4}-\d{2}-\d{2}$/.test(o.date || '')) throw new Error('Lançamento inválido');
  return store.normalizeTxn(o);
}

export default requireUser(async (req, res) => {
  if (req.method === 'POST' || req.method === 'PUT') {
    const list = Array.isArray(req.body) ? req.body : [req.body];
    const saved = await store.mutate(db => {
      const out = [];
      list.forEach(raw => {
        const t = clean(raw);
        const i = db.transactions.findIndex(x => x.id === t.id);
        const prev = i >= 0 ? db.transactions[i] : null;
        t.updatedBy = req.user.id; t.updatedAt = new Date().toISOString();
        if (prev && prev.category !== t.category) {
          t.categoryOverride = t.category;
          if (t.counterparty) db.learned[normalize(t.counterparty)] = t.category; // aprende para próximas importações
        }
        if (i >= 0) db.transactions[i] = { ...prev, ...t }; else db.transactions.push({ ...t, createdBy: req.user.id });
        out.push(t);
      });
      return out;
    });
    return res.json({ ok: true, transactions: saved });
  }
  if (req.method === 'DELETE') {
    const ids = [].concat(req.query.id || (req.body && req.body.ids) || []);
    const removed = await store.mutate(db => {
      const before = db.transactions.length;
      db.transactions = db.transactions.filter(t => !ids.includes(t.id));
      return before - db.transactions.length;
    });
    return res.json({ ok: true, removed });
  }
  res.status(405).end();
});
