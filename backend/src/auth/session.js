const crypto = require('crypto');
const { queryOne } = require('../config/db');

const COOKIE_NAME = 'stma_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map();

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

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

function createSession(userId) {
  cleanupExpiredSessions();
  const token = crypto.randomUUID();
  sessions.set(token, {
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return token;
}

function destroySession(token) {
  if (!token) return;
  sessions.delete(token);
}

function getSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[COOKIE_NAME] || null;
}

function getSession(token) {
  cleanupExpiredSessions();
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
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
    sessions.delete(token);
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
