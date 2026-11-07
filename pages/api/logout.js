const { clearSession } = require('../../lib/server/auth');
export default function handler(req, res) { clearSession(req, res); res.json({ ok: true }); }
