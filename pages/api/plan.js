// Planejamento (dívidas, metas, aportes, desejos, anotações) — agora salvo no
// servidor e compartilhado entre os dois logins.
const { requireUser } = require('../../lib/server/auth');
const store = require('../../lib/server/store');

export const config = { api: { bodyParser: { sizeLimit: '5mb' } } };

export default requireUser(async (req, res) => {
  if (req.method !== 'PUT') return res.status(405).end();
  const plan = req.body && req.body.plan;
  if (!plan || typeof plan !== 'object') return res.status(400).json({ error: 'Plano inválido' });
  await store.mutate(db => { db.plan = plan; });
  res.json({ ok: true });
});
