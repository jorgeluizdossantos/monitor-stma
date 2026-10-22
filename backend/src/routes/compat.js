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

router.get('/empresas', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT id, nome FROM empresa WHERE ativo = 1 ORDER BY nome ASC'
    );

    return res.json(
      rows.map((row) => ({
        empresa_id: row.id,
        nome_empresa: row.nome,
        endereco_empresa: null
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

router.post('/usuarios', requireAuth, async (req, res, next) => {
  try {
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

router.post('/equipamentos', requireAuth, async (req, res, next) => {
  try {
    const { empresa_id, setor_id, equipamento_id, equioamento_name } = req.body || {};

    if (!empresa_id || !setor_id || !equioamento_name) {
      return res.status(400).json({
        ok: false,
        error: 'Informe empresa, setor e nome do equipamento.'
      });
    }

    const ambiente = await ensureAmbienteBase(empresa_id, setor_id);
    const dispositivo = await ensureDispositivoBase(empresa_id, ambiente.id, equipamento_id, equioamento_name);

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
