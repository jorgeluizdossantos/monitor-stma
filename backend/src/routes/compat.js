const { Router } = require('express');
const { query, queryOne, execute } = require('../config/db');
const { requireAuth } = require('../auth/session');
const { hashPassword } = require('../security/password');

const router = Router();

async function ensureEmpresaBase(empresaId) {
  if (empresaId) {
    const empresa = await queryOne(
      'SELECT id, nome FROM empresa WHERE id = ? LIMIT 1',
      [empresaId]
    );
    if (empresa) {
      return empresa;
    }
  }

  const empresa = await queryOne(
    'SELECT id, nome FROM empresa WHERE ativo = 1 ORDER BY id ASC LIMIT 1'
  );

  if (empresa) {
    return empresa;
  }

  const result = await execute(
    'INSERT INTO empresa (nome, eh_demo, ativo) VALUES (?, ?, ?)',
    ['Empresa Padrão STMA', 0, 1]
  );

  return {
    id: result.insertId,
    nome: 'Empresa Padrão STMA'
  };
}

async function ensureUnidadeBase(empresaId, endereco = null) {
  const unidade = await queryOne(
    'SELECT id, nome, endereco FROM unidade WHERE empresa_id = ? AND ativo = 1 ORDER BY id ASC LIMIT 1',
    [empresaId]
  );

  if (unidade) {
    return unidade;
  }

  const result = await execute(
    'INSERT INTO unidade (empresa_id, nome, endereco, fuso_horario, ativo) VALUES (?, ?, ?, ?, ?)',
    [empresaId, 'Unidade Principal', endereco, 'America/Sao_Paulo', 1]
  );

  return {
    id: result.insertId,
    nome: 'Unidade Principal',
    endereco
  };
}

async function ensureAmbienteBase(empresaId, setorId) {
  const ambiente = await queryOne(
    'SELECT id, nome FROM ambiente WHERE empresa_id = ? AND setor_id = ? AND ativo = 1 ORDER BY id ASC LIMIT 1',
    [empresaId, setorId]
  );

  if (ambiente) {
    return ambiente;
  }

  const result = await execute(
    `INSERT INTO ambiente (
      empresa_id,
      setor_id,
      nome,
      descricao,
      temp_min_ideal,
      temp_max_ideal,
      umid_min_ideal,
      umid_max_ideal,
      temp_tolerancia,
      umid_tolerancia,
      ativo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [empresaId, setorId, 'Ambiente Principal', 'Criado automaticamente para compatibilidade', null, null, null, null, null, null, 1]
  );

  return {
    id: result.insertId,
    nome: 'Ambiente Principal'
  };
}

async function ensureDispositivoBase(empresaId, ambienteId, equipamentoId = null, nome = null) {
  if (equipamentoId) {
    const byName = await queryOne(
      'SELECT id, device_id, nome FROM dispositivo WHERE empresa_id = ? AND device_id = ? LIMIT 1',
      [empresaId, `equip-${equipamentoId}`]
    );
    if (byName) {
      return byName;
    }
  }

  const existente = await queryOne(
    'SELECT id, device_id, nome FROM dispositivo WHERE empresa_id = ? AND ambiente_id = ? AND ativo = 1 ORDER BY id ASC LIMIT 1',
    [empresaId, ambienteId]
  );

  if (existente) {
    return existente;
  }

  const deviceId = equipamentoId ? `equip-${equipamentoId}` : `esp32-auto-${empresaId}-${ambienteId}`;
  const result = await execute(
    `INSERT INTO dispositivo (
      empresa_id,
      ambiente_id,
      device_id,
      nome,
      modelo_placa,
      sensor,
      intervalo_leitura_seg,
      offline_apos_seg,
      status_conexao,
      em_manutencao,
      ativo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [empresaId, ambienteId, deviceId, nome || 'Dispositivo Compatível', 'ESP32', 'OUTRO', 30, 120, 'desconhecido', 0, 1]
  );

  return {
    id: result.insertId,
    device_id: deviceId,
    nome: nome || 'Dispositivo Compatível'
  };
}

function isAdminUser(user) {
  return ['administrador', 'superadmin'].includes(String(user?.perfil || '').toLowerCase());
}

function ensureAdmin(req, res) {
  if (!isAdminUser(req.auth?.user)) {
    res.status(403).json({
      ok: false,
      error: 'Apenas administradores podem gerir utilizadores.'
    });
    return false;
  }

  return true;
}

function toTinyInt(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  if (value === true || value === 1 || value === '1' || value === 'true') {
    return 1;
  }

  return 0;
}

router.get('/empresas', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT
        e.id,
        e.nome,
        u.endereco
      FROM empresa e
      LEFT JOIN unidade u
        ON u.id = (
          SELECT u2.id
          FROM unidade u2
          WHERE u2.empresa_id = e.id
            AND COALESCE(u2.ativo, 1) = 1
          ORDER BY u2.id ASC
          LIMIT 1
        )
      WHERE COALESCE(e.ativo, 1) = 1
      ORDER BY e.nome ASC, e.id ASC
    `);

    return res.json(
      rows.map((row) => ({
        empresa_id: row.id,
        nome_empresa: row.nome,
        endereco_empresa: row.endereco || ''
      }))
    );
  } catch (error) {
    return next(error);
  }
});

router.post('/empresas', requireAuth, async (req, res, next) => {
  try {
    const { empresa_id, nome_empresa, endereco_empresa } = req.body || {};

    if (!nome_empresa) {
      return res.status(400).json({
        ok: false,
        error: 'Informe o nome da empresa.'
      });
    }

    let result;
    if (empresa_id) {
      result = await execute(
        'INSERT INTO empresa (id, nome, eh_demo, ativo) VALUES (?, ?, ?, ?)',
        [empresa_id, nome_empresa, 0, 1]
      );
    } else {
      result = await execute(
        'INSERT INTO empresa (nome, eh_demo, ativo) VALUES (?, ?, ?)',
        [nome_empresa, 0, 1]
      );
    }

    const empresaId = empresa_id || result.insertId;
    await ensureUnidadeBase(empresaId, endereco_empresa || null);

    return res.status(201).json({
      ok: true,
      message: 'Empresa cadastrada com sucesso!',
      empresa_id: empresaId
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/usuarios', requireAuth, async (req, res, next) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const rows = await query(`
      SELECT
        u.id,
        u.nome,
        u.email,
        u.perfil,
        u.empresa_id AS empresa_id,
        e.nome AS nome_empresa
      FROM usuario u
      LEFT JOIN empresa e ON e.id = u.empresa_id
      WHERE COALESCE(u.ativo, 1) = 1
      ORDER BY u.nome ASC, u.id ASC
    `);

    return res.json({
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        user_nome: row.nome,
        user_email: row.email,
        empresa_id: row.empresa_id,
        nome_empresa: row.nome_empresa || 'Sem empresa',
        perfil: row.perfil,
        isAdmin: isAdminUser({ perfil: row.perfil })
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/equipamentos', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT
        d.id,
        d.empresa_id,
        a.setor_id,
        d.device_id,
        d.nome,
        e.nome AS nome_empresa,
        s.nome AS nome_setor
      FROM dispositivo d
      INNER JOIN ambiente a ON a.id = d.ambiente_id
      LEFT JOIN empresa e ON e.id = d.empresa_id
      LEFT JOIN setor s ON s.id = a.setor_id
      WHERE COALESCE(d.ativo, 1) = 1
        AND d.device_id LIKE 'equip-%'
      ORDER BY e.nome ASC, s.nome ASC, d.nome ASC, d.id ASC
    `);

    return res.json({
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        empresa_id: row.empresa_id,
        setor_id: row.setor_id,
        equipamento_id: Number(String(row.device_id || '').replace(/^equip-/, '')) || row.id,
        equioamento_name: row.nome,
        nome_empresa: row.nome_empresa || 'Sem empresa',
        nome_setor: row.nome_setor || 'Sem setor'
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.put('/equipamentos/:id', requireAuth, async (req, res, next) => {
  try {
    const dispositivoId = Number(req.params.id);
    const {
      empresa_id,
      setor_id,
      equipamento_id,
      equioamento_name,
      equipamento_name
    } = req.body || {};
    const nomeEquipamento = equioamento_name || equipamento_name;

    if (!dispositivoId || !empresa_id || !setor_id || !equipamento_id || !nomeEquipamento) {
      return res.status(400).json({
        ok: false,
        error: 'Informe o identificador, empresa, setor, código e nome do equipamento.'
      });
    }

    const dispositivo = await queryOne(
      'SELECT id FROM dispositivo WHERE id = ? AND COALESCE(ativo, 1) = 1 LIMIT 1',
      [dispositivoId]
    );

    if (!dispositivo) {
      return res.status(404).json({
        ok: false,
        error: 'Equipamento não encontrado.'
      });
    }

    const ambiente = await ensureAmbienteBase(empresa_id, setor_id);
    await execute(
      `UPDATE dispositivo
       SET empresa_id = ?, ambiente_id = ?, device_id = ?, nome = ?
       WHERE id = ?`,
      [empresa_id, ambiente.id, `equip-${equipamento_id}`, nomeEquipamento, dispositivoId]
    );

    return res.json({
      ok: true,
      message: 'Equipamento atualizado com sucesso!'
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/equipamentos/:id', requireAuth, async (req, res, next) => {
  try {
    const dispositivoId = Number(req.params.id);

    if (!dispositivoId) {
      return res.status(400).json({
        ok: false,
        error: 'Informe o identificador do equipamento.'
      });
    }

    const result = await execute(
      'UPDATE dispositivo SET ativo = 0 WHERE id = ? AND COALESCE(ativo, 1) = 1',
      [dispositivoId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        ok: false,
        error: 'Equipamento não encontrado.'
      });
    }

    return res.json({
      ok: true,
      message: 'Equipamento excluído com sucesso!'
    });
  } catch (error) {
    return next(error);
  }
});

router.put('/empresas/:id', requireAuth, async (req, res, next) => {
  try {
    const empresaId = Number(req.params.id);
    const { nome_empresa, endereco_empresa } = req.body || {};

    if (!empresaId || !nome_empresa) {
      return res.status(400).json({
        ok: false,
        error: 'Informe o identificador e o nome da empresa.'
      });
    }

    const empresa = await queryOne(
      'SELECT id FROM empresa WHERE id = ? AND COALESCE(ativo, 1) = 1 LIMIT 1',
      [empresaId]
    );

    if (!empresa) {
      return res.status(404).json({
        ok: false,
        error: 'Empresa não encontrada.'
      });
    }

    await execute(
      'UPDATE empresa SET nome = ? WHERE id = ?',
      [nome_empresa, empresaId]
    );

    const unidade = await ensureUnidadeBase(empresaId, endereco_empresa || null);
    await execute(
      'UPDATE unidade SET endereco = ? WHERE id = ?',
      [endereco_empresa || null, unidade.id]
    );

    return res.json({
      ok: true,
      message: 'Empresa atualizada com sucesso!'
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/empresas/:id', requireAuth, async (req, res, next) => {
  try {
    const empresaId = Number(req.params.id);

    if (!empresaId) {
      return res.status(400).json({
        ok: false,
        error: 'Informe o identificador da empresa.'
      });
    }

    const result = await execute(
      'UPDATE empresa SET ativo = 0 WHERE id = ? AND COALESCE(ativo, 1) = 1',
      [empresaId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        ok: false,
        error: 'Empresa não encontrada.'
      });
    }

    await execute('UPDATE unidade SET ativo = 0 WHERE empresa_id = ?', [empresaId]);
    await execute('UPDATE setor SET ativo = 0 WHERE empresa_id = ?', [empresaId]);
    await execute('UPDATE ambiente SET ativo = 0 WHERE empresa_id = ?', [empresaId]);
    await execute('UPDATE dispositivo SET ativo = 0 WHERE empresa_id = ?', [empresaId]);

    return res.json({
      ok: true,
      message: 'Empresa excluída com sucesso!'
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/usuarios', requireAuth, async (req, res, next) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const { user_nome, user_email, user_senha, empresa_id, isAdmin } = req.body || {};

    if (!user_nome || !user_email || !user_senha) {
      return res.status(400).json({
        ok: false,
        error: 'Informe nome, e-mail e senha.'
      });
    }

    const senhaHash = await hashPassword(user_senha);
    const perfil = isAdmin ? 'administrador' : 'operador';

    const result = await execute(
      'INSERT INTO usuario (empresa_id, nome, email, senha_hash, perfil, ativo) VALUES (?, ?, ?, ?, ?, ?)',
      [empresa_id || null, user_nome, String(user_email).trim().toLowerCase(), senhaHash, perfil, 1]
    );

    return res.status(201).json({
      ok: true,
      message: 'Utilizador cadastrado com sucesso!',
      id: result.insertId
    });
  } catch (error) {
    return next(error);
  }
});

router.put('/usuarios/:id', requireAuth, async (req, res, next) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const userId = Number(req.params.id);
    const { user_nome, user_email, user_senha, empresa_id, isAdmin } = req.body || {};

    if (!userId || !user_nome || !user_email) {
      return res.status(400).json({
        ok: false,
        error: 'Informe o identificador, nome e e-mail do utilizador.'
      });
    }

    const existente = await queryOne(
      'SELECT id FROM usuario WHERE id = ? AND COALESCE(ativo, 1) = 1 LIMIT 1',
      [userId]
    );

    if (!existente) {
      return res.status(404).json({
        ok: false,
        error: 'Utilizador não encontrado.'
      });
    }

    const perfil = isAdmin ? 'administrador' : 'operador';
    const senhaNormalizada = String(user_senha || '').trim();

    if (senhaNormalizada) {
      const senhaHash = await hashPassword(senhaNormalizada);
      await execute(
        `UPDATE usuario
         SET empresa_id = ?, nome = ?, email = ?, senha_hash = ?, perfil = ?
         WHERE id = ?`,
        [empresa_id || null, user_nome, String(user_email).trim().toLowerCase(), senhaHash, perfil, userId]
      );
    } else {
      await execute(
        `UPDATE usuario
         SET empresa_id = ?, nome = ?, email = ?, perfil = ?
         WHERE id = ?`,
        [empresa_id || null, user_nome, String(user_email).trim().toLowerCase(), perfil, userId]
      );
    }

    return res.json({
      ok: true,
      message: 'Utilizador atualizado com sucesso!'
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/usuarios/:id', requireAuth, async (req, res, next) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const userId = Number(req.params.id);

    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: 'Informe o identificador do utilizador.'
      });
    }

    if (Number(req.auth?.user?.id) === userId) {
      return res.status(400).json({
        ok: false,
        error: 'Não é permitido excluir o próprio utilizador autenticado.'
      });
    }

    const result = await execute(
      'UPDATE usuario SET ativo = 0 WHERE id = ? AND COALESCE(ativo, 1) = 1',
      [userId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        ok: false,
        error: 'Utilizador não encontrado.'
      });
    }

    return res.json({
      ok: true,
      message: 'Utilizador excluído com sucesso!'
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/setores', requireAuth, async (req, res, next) => {
  try {
    const { empresa_id, setor_id, setor_name } = req.body || {};

    if (!empresa_id || !setor_name) {
      return res.status(400).json({
        ok: false,
        error: 'Informe a empresa e o nome do setor.'
      });
    }

    const empresa = await ensureEmpresaBase(empresa_id);
    const unidade = await ensureUnidadeBase(empresa.id);

    let result;
    if (setor_id) {
      result = await execute(
        'INSERT INTO setor (id, empresa_id, unidade_id, nome, descricao, ativo) VALUES (?, ?, ?, ?, ?, ?)',
        [setor_id, empresa.id, unidade.id, setor_name, null, 1]
      );
    } else {
      result = await execute(
        'INSERT INTO setor (empresa_id, unidade_id, nome, descricao, ativo) VALUES (?, ?, ?, ?, ?)',
        [empresa.id, unidade.id, setor_name, null, 1]
      );
    }

    return res.status(201).json({
      ok: true,
      message: 'Setor cadastrado com sucesso!',
      setor_id: setor_id || result.insertId
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/setores', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT
        s.id,
        s.empresa_id,
        s.nome,
        e.nome AS nome_empresa
      FROM setor s
      LEFT JOIN empresa e ON e.id = s.empresa_id
      WHERE COALESCE(s.ativo, 1) = 1
      ORDER BY e.nome ASC, s.nome ASC, s.id ASC
    `);

    return res.json({
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        setor_id: row.id,
        empresa_id: row.empresa_id,
        nome_empresa: row.nome_empresa || 'Sem empresa',
        setor_name: row.nome
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.put('/setores/:id', requireAuth, async (req, res, next) => {
  try {
    const setorId = Number(req.params.id);
    const { empresa_id, setor_name } = req.body || {};

    if (!setorId || !empresa_id || !setor_name) {
      return res.status(400).json({
        ok: false,
        error: 'Informe o identificador, a empresa e o nome do setor.'
      });
    }

    const setor = await queryOne(
      'SELECT id FROM setor WHERE id = ? AND COALESCE(ativo, 1) = 1 LIMIT 1',
      [setorId]
    );

    if (!setor) {
      return res.status(404).json({
        ok: false,
        error: 'Setor não encontrado.'
      });
    }

    const empresa = await ensureEmpresaBase(empresa_id);
    const unidade = await ensureUnidadeBase(empresa.id);

    await execute(
      'UPDATE setor SET empresa_id = ?, unidade_id = ?, nome = ? WHERE id = ?',
      [empresa.id, unidade.id, setor_name, setorId]
    );

    await execute(
      'UPDATE ambiente SET empresa_id = ? WHERE setor_id = ?',
      [empresa.id, setorId]
    );

    await execute(
      `UPDATE dispositivo
       SET empresa_id = ?
       WHERE ambiente_id IN (
         SELECT id
         FROM ambiente
         WHERE setor_id = ?
       )`,
      [empresa.id, setorId]
    );

    return res.json({
      ok: true,
      message: 'Setor atualizado com sucesso!'
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/setores/:id', requireAuth, async (req, res, next) => {
  try {
    const setorId = Number(req.params.id);

    if (!setorId) {
      return res.status(400).json({
        ok: false,
        error: 'Informe o identificador do setor.'
      });
    }

    const result = await execute(
      'UPDATE setor SET ativo = 0 WHERE id = ? AND COALESCE(ativo, 1) = 1',
      [setorId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        ok: false,
        error: 'Setor não encontrado.'
      });
    }

    await execute('UPDATE ambiente SET ativo = 0 WHERE setor_id = ?', [setorId]);
    await execute(
      `UPDATE dispositivo
       SET ativo = 0
       WHERE ambiente_id IN (
         SELECT id
         FROM ambiente
         WHERE setor_id = ?
       )`,
      [setorId]
    );

    return res.json({
      ok: true,
      message: 'Setor excluído com sucesso!'
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/ambientes', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT
        a.id,
        a.empresa_id,
        a.setor_id,
        a.nome,
        a.descricao,
        a.temp_min_ideal,
        a.temp_max_ideal,
        a.umid_min_ideal,
        a.umid_max_ideal,
        a.temp_tolerancia,
        a.umid_tolerancia,
        e.nome AS nome_empresa,
        s.nome AS nome_setor
      FROM ambiente a
      LEFT JOIN empresa e ON e.id = a.empresa_id
      LEFT JOIN setor s ON s.id = a.setor_id AND s.empresa_id = a.empresa_id
      WHERE COALESCE(a.ativo, 1) = 1
      ORDER BY e.nome ASC, s.nome ASC, a.nome ASC, a.id ASC
    `);

    return res.json({
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        empresa_id: row.empresa_id,
        setor_id: row.setor_id,
        nome: row.nome,
        descricao: row.descricao || '',
        temp_min_ideal: row.temp_min_ideal,
        temp_max_ideal: row.temp_max_ideal,
        umid_min_ideal: row.umid_min_ideal,
        umid_max_ideal: row.umid_max_ideal,
        temp_tolerancia: row.temp_tolerancia,
        umid_tolerancia: row.umid_tolerancia,
        nome_empresa: row.nome_empresa || 'Sem empresa',
        nome_setor: row.nome_setor || 'Sem setor'
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/ambientes', requireAuth, async (req, res, next) => {
  try {
    const {
      empresa_id,
      setor_id,
      nome,
      descricao,
      temp_min_ideal,
      temp_max_ideal,
      umid_min_ideal,
      umid_max_ideal,
      temp_tolerancia,
      umid_tolerancia
    } = req.body || {};

    if (!empresa_id || !setor_id || !nome) {
      return res.status(400).json({
        ok: false,
        error: 'Informe empresa, setor e nome do ambiente.'
      });
    }

    const result = await execute(
      `INSERT INTO ambiente (
        empresa_id,
        setor_id,
        nome,
        descricao,
        temp_min_ideal,
        temp_max_ideal,
        umid_min_ideal,
        umid_max_ideal,
        temp_tolerancia,
        umid_tolerancia,
        ativo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresa_id,
        setor_id,
        nome,
        descricao || null,
        temp_min_ideal ?? null,
        temp_max_ideal ?? null,
        umid_min_ideal ?? null,
        umid_max_ideal ?? null,
        temp_tolerancia ?? null,
        umid_tolerancia ?? null,
        1
      ]
    );

    return res.status(201).json({
      ok: true,
      message: 'Ambiente cadastrado com sucesso!',
      id: result.insertId
    });
  } catch (error) {
    return next(error);
  }
});

router.put('/ambientes/:id', requireAuth, async (req, res, next) => {
  try {
    const ambienteId = Number(req.params.id);
    const {
      empresa_id,
      setor_id,
      nome,
      descricao,
      temp_min_ideal,
      temp_max_ideal,
      umid_min_ideal,
      umid_max_ideal,
      temp_tolerancia,
      umid_tolerancia
    } = req.body || {};

    if (!ambienteId || !empresa_id || !setor_id || !nome) {
      return res.status(400).json({
        ok: false,
        error: 'Informe o identificador, empresa, setor e nome do ambiente.'
      });
    }

    const ambiente = await queryOne(
      'SELECT id FROM ambiente WHERE id = ? AND COALESCE(ativo, 1) = 1 LIMIT 1',
      [ambienteId]
    );

    if (!ambiente) {
      return res.status(404).json({
        ok: false,
        error: 'Ambiente não encontrado.'
      });
    }

    await execute(
      `UPDATE ambiente
       SET
         empresa_id = ?,
         setor_id = ?,
         nome = ?,
         descricao = ?,
         temp_min_ideal = ?,
         temp_max_ideal = ?,
         umid_min_ideal = ?,
         umid_max_ideal = ?,
         temp_tolerancia = ?,
         umid_tolerancia = ?
       WHERE id = ?`,
      [
        empresa_id,
        setor_id,
        nome,
        descricao || null,
        temp_min_ideal ?? null,
        temp_max_ideal ?? null,
        umid_min_ideal ?? null,
        umid_max_ideal ?? null,
        temp_tolerancia ?? null,
        umid_tolerancia ?? null,
        ambienteId
      ]
    );

    await execute(
      'UPDATE dispositivo SET empresa_id = ?, ambiente_id = ? WHERE ambiente_id = ?',
      [empresa_id, ambienteId, ambienteId]
    );

    return res.json({
      ok: true,
      message: 'Ambiente atualizado com sucesso!'
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/ambientes/:id', requireAuth, async (req, res, next) => {
  try {
    const ambienteId = Number(req.params.id);

    if (!ambienteId) {
      return res.status(400).json({
        ok: false,
        error: 'Informe o identificador do ambiente.'
      });
    }

    const result = await execute(
      'UPDATE ambiente SET ativo = 0 WHERE id = ? AND COALESCE(ativo, 1) = 1',
      [ambienteId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        ok: false,
        error: 'Ambiente não encontrado.'
      });
    }

    await execute('UPDATE dispositivo SET ativo = 0 WHERE ambiente_id = ?', [ambienteId]);

    return res.json({
      ok: true,
      message: 'Ambiente excluído com sucesso!'
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/dispositivos', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT
        d.id,
        d.empresa_id,
        d.ambiente_id,
        d.device_id,
        d.nome,
        d.modelo_placa,
        d.sensor,
        d.intervalo_leitura_seg,
        d.offline_apos_seg,
        d.status_conexao,
        d.ultimo_contato_em,
        d.ultima_leitura_em,
        d.ultima_temperatura_c,
        d.ultima_umidade_pct,
        d.em_manutencao,
        d.led_aceso,
        d.limite_led,
        d.controle_recebido_em,
        d.controle_comando_id,
        e.nome AS nome_empresa,
        a.nome AS nome_ambiente,
        a.setor_id,
        s.nome AS nome_setor
      FROM dispositivo d
      LEFT JOIN empresa e ON e.id = d.empresa_id
      LEFT JOIN ambiente a ON a.id = d.ambiente_id AND a.empresa_id = d.empresa_id
      LEFT JOIN setor s ON s.id = a.setor_id AND s.empresa_id = d.empresa_id
      WHERE COALESCE(d.ativo, 1) = 1
      ORDER BY e.nome ASC, s.nome ASC, a.nome ASC, d.device_id ASC
    `);

    return res.json({
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        empresa_id: row.empresa_id,
        ambiente_id: row.ambiente_id,
        setor_id: row.setor_id,
        device_id: row.device_id,
        nome: row.nome || '',
        modelo_placa: row.modelo_placa,
        sensor: row.sensor,
        intervalo_leitura_seg: row.intervalo_leitura_seg,
        offline_apos_seg: row.offline_apos_seg,
        status_conexao: row.status_conexao,
        ultimo_contato_em: row.ultimo_contato_em,
        ultima_leitura_em: row.ultima_leitura_em,
        ultima_temperatura_c: row.ultima_temperatura_c,
        ultima_umidade_pct: row.ultima_umidade_pct,
        em_manutencao: Boolean(row.em_manutencao),
        led_aceso: row.led_aceso,
        limite_led: row.limite_led,
        controle_recebido_em: row.controle_recebido_em,
        controle_comando_id: row.controle_comando_id,
        nome_empresa: row.nome_empresa || 'Sem empresa',
        nome_setor: row.nome_setor || 'Sem setor',
        nome_ambiente: row.nome_ambiente || 'Sem ambiente'
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/dispositivos', requireAuth, async (req, res, next) => {
  try {
    const {
      empresa_id,
      ambiente_id,
      device_id,
      nome,
      modelo_placa,
      sensor,
      intervalo_leitura_seg,
      offline_apos_seg,
      em_manutencao,
      limite_led
    } = req.body || {};

    if (!empresa_id || !ambiente_id || !device_id || !sensor) {
      return res.status(400).json({
        ok: false,
        error: 'Informe empresa, ambiente, device ID e sensor.'
      });
    }

    const result = await execute(
      `INSERT INTO dispositivo (
        empresa_id,
        ambiente_id,
        device_id,
        nome,
        modelo_placa,
        sensor,
        intervalo_leitura_seg,
        offline_apos_seg,
        status_conexao,
        em_manutencao,
        ativo,
        limite_led
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresa_id,
        ambiente_id,
        String(device_id).trim(),
        nome || null,
        modelo_placa || 'ESP32',
        sensor,
        intervalo_leitura_seg || 30,
        offline_apos_seg || 120,
        'desconhecido',
        toTinyInt(em_manutencao),
        1,
        limite_led ?? null
      ]
    );

    return res.status(201).json({
      ok: true,
      message: 'Dispositivo cadastrado com sucesso!',
      id: result.insertId
    });
  } catch (error) {
    return next(error);
  }
});

router.put('/dispositivos/:id', requireAuth, async (req, res, next) => {
  try {
    const dispositivoId = Number(req.params.id);
    const {
      empresa_id,
      ambiente_id,
      device_id,
      nome,
      modelo_placa,
      sensor,
      intervalo_leitura_seg,
      offline_apos_seg,
      em_manutencao,
      limite_led
    } = req.body || {};

    if (!dispositivoId || !empresa_id || !ambiente_id || !device_id || !sensor) {
      return res.status(400).json({
        ok: false,
        error: 'Informe o identificador, empresa, ambiente, device ID e sensor.'
      });
    }

    const dispositivo = await queryOne(
      'SELECT id FROM dispositivo WHERE id = ? AND COALESCE(ativo, 1) = 1 LIMIT 1',
      [dispositivoId]
    );

    if (!dispositivo) {
      return res.status(404).json({
        ok: false,
        error: 'Dispositivo não encontrado.'
      });
    }

    await execute(
      `UPDATE dispositivo
       SET
         empresa_id = ?,
         ambiente_id = ?,
         device_id = ?,
         nome = ?,
         modelo_placa = ?,
         sensor = ?,
         intervalo_leitura_seg = ?,
         offline_apos_seg = ?,
         em_manutencao = ?,
         limite_led = ?
       WHERE id = ?`,
      [
        empresa_id,
        ambiente_id,
        String(device_id).trim(),
        nome || null,
        modelo_placa || 'ESP32',
        sensor,
        intervalo_leitura_seg || 30,
        offline_apos_seg || 120,
        toTinyInt(em_manutencao),
        limite_led ?? null,
        dispositivoId
      ]
    );

    return res.json({
      ok: true,
      message: 'Dispositivo atualizado com sucesso!'
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/dispositivos/:id', requireAuth, async (req, res, next) => {
  try {
    const dispositivoId = Number(req.params.id);

    if (!dispositivoId) {
      return res.status(400).json({
        ok: false,
        error: 'Informe o identificador do dispositivo.'
      });
    }

    const result = await execute(
      'UPDATE dispositivo SET ativo = 0 WHERE id = ? AND COALESCE(ativo, 1) = 1',
      [dispositivoId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        ok: false,
        error: 'Dispositivo não encontrado.'
      });
    }

    return res.json({
      ok: true,
      message: 'Dispositivo excluído com sucesso!'
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/equipamentos', requireAuth, async (req, res, next) => {
  try {
    const {
      empresa_id,
      setor_id,
      equipamento_id,
      equioamento_name,
      equipamento_name
    } = req.body || {};
    const nomeEquipamento = equioamento_name || equipamento_name;

    if (!empresa_id || !setor_id || !nomeEquipamento) {
      return res.status(400).json({
        ok: false,
        error: 'Informe empresa, setor e nome do equipamento.'
      });
    }

    const ambiente = await ensureAmbienteBase(empresa_id, setor_id);
    const dispositivo = await ensureDispositivoBase(empresa_id, ambiente.id, equipamento_id, nomeEquipamento);

    return res.status(201).json({
      ok: true,
      message: 'Equipamento cadastrado com sucesso!',
      equipamento_id: equipamento_id || dispositivo.id,
      device_id: dispositivo.device_id
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/medicoes', requireAuth, async (req, res, next) => {
  try {
    const { temp_vlr, umidade_vlr } = req.body || {};

    const empresa = await ensureEmpresaBase(req.auth?.user?.empresaId || null);
    const unidade = await ensureUnidadeBase(empresa.id);
    let setor = await queryOne(
      'SELECT id, nome FROM setor WHERE empresa_id = ? AND unidade_id = ? AND ativo = 1 ORDER BY id ASC LIMIT 1',
      [empresa.id, unidade.id]
    );

    if (!setor) {
      const setorInsert = await execute(
        'INSERT INTO setor (empresa_id, unidade_id, nome, descricao, ativo) VALUES (?, ?, ?, ?, ?)',
        [empresa.id, unidade.id, 'Setor Principal', 'Criado automaticamente para telemetria', 1]
      );
      setor = { id: setorInsert.insertId, nome: 'Setor Principal' };
    }

    const ambiente = await ensureAmbienteBase(empresa.id, setor.id);
    const dispositivo = await ensureDispositivoBase(empresa.id, ambiente.id, null, 'ESP32 Compatível');

    await execute(
      `UPDATE dispositivo
       SET
         status_conexao = 'online',
         ultimo_contato_em = CURRENT_TIMESTAMP(3),
         ultima_leitura_em = CURRENT_TIMESTAMP(3),
         ultima_temperatura_c = ?,
         ultima_umidade_pct = ?
       WHERE id = ?`,
      [temp_vlr ?? null, umidade_vlr ?? null, dispositivo.id]
    );

    return res.status(201).json({
      ok: true,
      message: 'Medição gravada com sucesso!',
      dispositivo_id: dispositivo.id
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
