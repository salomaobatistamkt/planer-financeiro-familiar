// Carrega tudo de uma vez (lançamentos, contas, planejamento). ?since=ISO
// devolve 304-like {unchanged:true} quando nada mudou — usado no polling.
const { requireUser } = require('../../lib/server/auth');
const store = require('../../lib/server/store');

export default requireUser(async (req, res) => {
  const db = await store.read();
  if (req.query.since && req.query.since === db.updatedAt) return res.json({ unchanged: true, updatedAt: db.updatedAt });
  res.json({
    user: { id: req.user.id, name: req.user.name },
    updatedAt: db.updatedAt,
    transactions: db.transactions,
    accounts: db.accounts,
    plan: db.plan,
    imports: db.imports.slice(-30).reverse(),
    migratedFromSupabase: !!db.migratedFromSupabase,
  });
});
