const crypto = require('crypto');
const { queryOne } = require('../config/db');
const { env } = require('../config/env');

const COOKIE_NAME = 'stma_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function parseCookies(rawCookie = '') {
  return rawCookie
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((acc, item) => {
      const index = item.indexOf('=');
      if (index === -1) return acc;
      const key = item.slice(0, index).trim();
      const value = decodeURIComponent(item.slice(index + 1).trim());
      acc[key] = value;
      return acc;
    }, {});
}

function signPayload(encodedPayload) {
  return crypto
    .createHmac('sha256', env.sessionSecret)
    .update(encodedPayload)
    .digest('base64url');
}

function createSession(userId) {
  const payload = Buffer.from(
    JSON.stringify({ userId, exp: Date.now() + SESSION_TTL_MS }),
    'utf8'
  ).toString('base64url');

  return `${payload}.${signPayload(payload)}`;
}

function destroySession() {
  // Token assinado é stateless: não há o que apagar no servidor.
  // O logout apenas remove o cookie no navegador.
}

function getSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[COOKIE_NAME] || null;
}

function getSession(token) {
  if (!token || !token.includes('.')) return null;

  const [payload, signature] = token.split('.');
  const expected = signPayload(payload);

  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (error) {
    return null;
  }

  if (!data || !data.userId || !data.exp || data.exp <= Date.now()) {
    return null;
  }

  return { userId: data.userId };
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/; HttpOnly; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
}

function normalizeNewUser(row) {
  return {
    id: row.id,
    nome: row.nome,
    email: row.email,
    perfil: row.perfil,
    empresaId: row.empresaId,
    empresaNome: row.empresaNome
  };
}

async function getUserFromNewModel(userId) {
  try {
    const row = await queryOne(`
      SELECT
        u.id,
        u.nome,
        u.email,
        u.perfil,
        u.ativo AS ativo,
        u.empresa_id AS empresaId,
        e.nome AS empresaNome
      FROM usuario u
      LEFT JOIN empresa e ON e.id = u.empresa_id
      WHERE u.id = ?
      LIMIT 1
    `, [userId]);

    if (!row || Number(row.ativo) !== 1) {
      return null;
    }

    return normalizeNewUser(row);
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR') {
      return null;
    }
    throw error;
  }
}

async function getUserFromLegacyModel(userId) {
  try {
    const row = await queryOne(`
      SELECT
        u.user_id AS id,
        u.user_nome AS nome,
        u.user_email AS email,
        CASE WHEN COALESCE(u.isAdmin, 0) = 1 THEN 'administrador' ELSE 'operador' END AS perfil,
        u.empresa_id AS empresaId,
        e.nome_empresa AS empresaNome
      FROM usuarios u
      LEFT JOIN empresa e ON e.empresa_id = u.empresa_id
      WHERE u.user_id = ?
      LIMIT 1
    `, [userId]);

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      nome: row.nome,
      email: row.email,
      perfil: row.perfil,
      empresaId: row.empresaId,
      empresaNome: row.empresaNome || null
    };
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR') {
      return null;
    }
    throw error;
  }
}

async function getAuthenticatedUser(req) {
  const token = getSessionToken(req);
  if (!token) return null;

  const session = getSession(token);
  if (!session) return null;

  const user = await getUserFromNewModel(session.userId) || await getUserFromLegacyModel(session.userId);

  if (!user) {
    return null;
  }

  req.auth = {
    token,
    user
  };

  return user;
}

async function requireAuth(req, res, next) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({
        ok: false,
        error: 'Sessão não encontrada ou expirada.'
      });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  COOKIE_NAME,
  createSession,
  destroySession,
  getSessionToken,
  getAuthenticatedUser,
  requireAuth,
  setSessionCookie,
  clearSessionCookie
};
