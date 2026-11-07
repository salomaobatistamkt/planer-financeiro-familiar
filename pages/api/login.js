const { checkPassword, setSession, tooManyAttempts, registerFailure, passwordsConfigured } = require('../../lib/server/auth');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!passwordsConfigured()) return res.status(503).json({ error: 'Senha ainda não configurada no servidor (variável SENHA_APP).' });
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (tooManyAttempts(ip)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
  const { usuario, senha } = req.body || {};
  const user = checkPassword(usuario, senha || '');
  if (!user) { registerFailure(ip); return res.status(401).json({ error: 'Usuário ou senha incorretos.' }); }
  setSession(req, res, user);
  return res.json({ ok: true, user: { id: user.id, name: user.name } });
}
