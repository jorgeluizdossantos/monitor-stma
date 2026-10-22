const { Router } = require('express');
const { queryOne, execute } = require('../config/db');
const {
  createSession,
  destroySession,
  getAuthenticatedUser,
  getSessionToken,
  setSessionCookie,
  clearSessionCookie
} = require('../auth/session');
const {
  verifyPassword,
  needsRehash,
  hashPassword
} = require('../security/password');

const router = Router();

function buildUserPayload(user) {
  const isAdmin = ['superadmin', 'administrador'].includes(user.perfil);
  return {
    id: user.id,
    nome: user.nome,
    user_nome: user.nome,
    email: user.email,
    user_email: user.email,
    perfil: user.perfil,
    empresaId: user.empresaId,
    empresa_id: user.empresaId,
    empresaNome: user.empresaNome || null,
    isAdmin
  };
}

async function findUserInNewModel(email) {
  try {
    return await queryOne(`
      SELECT
        u.id,
        u.nome,
        u.email,
        u.senha_hash AS senhaHash,
        u.perfil,
        u.ativo AS ativo,
        u.empresa_id AS empresaId,
        e.nome AS empresaNome
      FROM usuario u
      LEFT JOIN empresa e ON e.id = u.empresa_id
      WHERE u.email = ?
      LIMIT 1
    `, [email]);
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR') {
      return null;
    }
    throw error;
  }
}

async function findUserInLegacyModel(email) {
  try {
    return await queryOne(`
      SELECT
        u.user_id AS id,
        u.user_nome AS nome,
        u.user_email AS email,
        u.user_senha AS senha,
        CASE WHEN COALESCE(u.isAdmin, 0) = 1 THEN 'administrador' ELSE 'operador' END AS perfil,
        u.empresa_id AS empresaId,
        e.nome_empresa AS empresaNome
      FROM usuarios u
      LEFT JOIN empresa e ON e.empresa_id = u.empresa_id
      WHERE u.user_email = ?
      LIMIT 1
    `, [email]);
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR') {
      return null;
    }
    throw error;
  }
}

async function authenticate(email, senha) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  const newUser = await findUserInNewModel(normalizedEmail);
  if (newUser && Number(newUser.ativo) === 1) {
    const isValid = await verifyPassword(senha, newUser.senhaHash);
    if (isValid) {
      if (needsRehash(newUser.senhaHash)) {
        const nextHash = await hashPassword(senha);
        await execute('UPDATE usuario SET senha_hash = ? WHERE id = ?', [nextHash, newUser.id]);
      }

      return {
        id: newUser.id,
        nome: newUser.nome,
        email: newUser.email,
        perfil: newUser.perfil,
        empresaId: newUser.empresaId,
        empresaNome: newUser.empresaNome || null
      };
    }
  }

  const legacyUser = await findUserInLegacyModel(normalizedEmail);
  if (legacyUser && String(legacyUser.senha) === String(senha)) {
    return {
      id: legacyUser.id,
      nome: legacyUser.nome,
      email: legacyUser.email,
      perfil: legacyUser.perfil,
      empresaId: legacyUser.empresaId,
      empresaNome: legacyUser.empresaNome || null
    };
  }

  return null;
}

async function handleLogin(req, res, next) {
  try {
    const { email, senha } = req.body || {};

    if (!email || !senha) {
      return res.status(400).json({
        ok: false,
        error: 'Informe o e-mail e a senha.'
      });
    }

    const user = await authenticate(email, senha);

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: 'E-mail ou senha incorretos.'
      });
    }

    const token = createSession(user.id);
    setSessionCookie(res, token);

    return res.json({
      ok: true,
      message: 'Login realizado com sucesso!',
      authenticated: true,
      data: {
        usuario: buildUserPayload(user)
      },
      usuario: buildUserPayload(user)
    });
  } catch (error) {
    return next(error);
  }
}

async function handleMe(req, res, next) {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        ok: false,
        authenticated: false,
        error: 'Sessão não encontrada ou expirada.'
      });
    }

    return res.json({
      ok: true,
      authenticated: true,
      data: {
        usuario: buildUserPayload(user)
      },
      usuario: buildUserPayload(user)
    });
  } catch (error) {
    return next(error);
  }
}

function handleLogout(req, res) {
  const token = getSessionToken(req);
  destroySession(token);
  clearSessionCookie(res);
  return res.json({
    ok: true,
    message: 'Sessão encerrada com sucesso.'
  });
}

router.post('/login', handleLogin);
router.post('/auth/login', handleLogin);
router.get('/me', handleMe);
router.get('/auth/me', handleMe);
router.post('/logout', handleLogout);
router.post('/auth/logout', handleLogout);

module.exports = router;
