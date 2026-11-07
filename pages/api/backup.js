const { requireUser } = require('../../lib/server/auth');
const store = require('../../lib/server/store');

export default requireUser(async (req, res) => {
  const db = await store.read();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="financeiro-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(db, null, 2));
});
