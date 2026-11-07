// Login de Salomão e Elizandra. As senhas ficam SOMENTE em variáveis de
// ambiente do servidor (Coolify): SENHA_APP vale para os dois; SENHA_SALOMAO /
// SENHA_ELIZANDRA, se definidas, têm prioridade. Sessão = cookie assinado HMAC.

const crypto = require('crypto');

const USERS = {
  salomao: { id: 'salomao', name: 'Salomão', env: 'SENHA_SALOMAO' },
  elizandra: { id: 'elizandra', name: 'Elizandra', env: 'SENHA_ELIZANDRA' },
};
const COOKIE = 'fin_sessao';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

function passwordFor(userId) {
  const u = USERS[userId];
  if (!u) return null;
  return process.env[u.env] || process.env.SENHA_APP || null;
}

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const base = Object.keys(USERS).map(passwordFor).join('|');
  return crypto.createHash('sha256').update(`fin-familia|${base}`).digest('hex');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function normalizeUser(login) {
  const n = String(login || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().split(/[\s@.]/)[0];
  return USERS[n] ? n : null;
}

function checkPassword(login, password) {
  const id = normalizeUser(login);
  const expected = id && passwordFor(id);
  if (!id || !expected) return null;
  return safeEqual(password, expected) ? USERS[id] : null;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (!safeEqual(mac, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.u || !USERS[p.u] || p.exp < Date.now()) return null;
    return USERS[p.u];
  } catch { return null; }
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function currentUser(req) { return verify(parseCookies(req)[COOKIE]); }

function isSecure(req) {
  return req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1';
}

function setSession(req, res, user) {
  const token = sign({ u: user.id, exp: Date.now() + MAX_AGE * 1000 });
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${isSecure(req) ? '; Secure' : ''}`);
}

function clearSession(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure(req) ? '; Secure' : ''}`);
}

// Limite simples de tentativas por IP (10 erros / 15 min).
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const a = (attempts.get(ip) || []).filter(t => now - t < 15 * 60 * 1000);
  attempts.set(ip, a);
  return a.length >= 10;
}
function registerFailure(ip) { attempts.set(ip, [...(attempts.get(ip) || []), Date.now()]); }

function requireUser(handler) {
  return async (req, res) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: 'Faça login novamente.' });
    req.user = user;
    try { return await handler(req, res); }
    catch (e) { console.error(e); return res.status(500).json({ error: e.message || 'Erro interno' }); }
  };
}

function passwordsConfigured() { return Object.keys(USERS).every(passwordFor); }

module.exports = { USERS, checkPassword, currentUser, setSession, clearSession, requireUser, tooManyAttempts, registerFailure, passwordsConfigured };
