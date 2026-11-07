const { requireUser } = require('../../lib/server/auth');
const store = require('../../lib/server/store');

export default requireUser(async (req, res) => {
  if (req.method !== 'PUT') return res.status(405).end();
  const { id, label, bank, titular } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Conta inválida' });
  const acc = await store.mutate(db => {
    db.accounts[id] = { ...(db.accounts[id] || { id, kind: 'checking' }), ...(label ? { label } : {}), ...(bank ? { bank } : {}), ...(titular ? { titular } : {}) };
    return db.accounts[id];
  });
  res.json({ ok: true, account: acc });
});
