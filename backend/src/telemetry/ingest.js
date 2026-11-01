// Ingestao de telemetria: converte uma mensagem do dispositivo em leitura persistida.
//
// Responsabilidades:
//  - validar a faixa das medidas (o firmware ja valida, mas o backend nao confia no cliente);
//  - resolver o `device_id` real no cadastro de `dispositivo`;
//  - registrar em `dispositivo_pendente` quando o dispositivo nao esta cadastrado,
//    sem criar leitura;
//  - inserir em `leitura_telemetria` de forma idempotente (uq_leitura_disp_tempo);
//  - atualizar o cache da ultima leitura do dispositivo.

const { queryOne, execute } = require('../config/db');

const LIMITES = {
  temperatura: { min: 0, max: 50 },
  umidade: { min: 0, max: 100 }
};

function converterMedida(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function foraDaFaixa(valor, limite) {
  return valor < limite.min || valor > limite.max;
}

// Grava como texto UTC literal ("YYYY-MM-DD HH:MM:SS.mmm"): a sessao MySQL roda em
// UTC e assim nao dependemos do fuso horario do processo Node nem do driver.
function paraUtcSql(data) {
  return data.toISOString().slice(0, 23).replace('T', ' ');
}

function normalizarMedidoEm(medidoEm) {
  if (medidoEm === null || medidoEm === undefined || medidoEm === '') {
    return paraUtcSql(new Date());
  }

  const data = new Date(medidoEm);
  return Number.isNaN(data.getTime()) ? null : paraUtcSql(data);
}

async function registrarPendente(deviceId, agora, payload) {
  await execute(
    `INSERT INTO dispositivo_pendente
       (device_id, primeiro_contato_em, ultimo_contato_em, qtd_mensagens, ultimo_payload)
     VALUES (?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       ultimo_contato_em = VALUES(ultimo_contato_em),
       qtd_mensagens = qtd_mensagens + 1,
       ultimo_payload = VALUES(ultimo_payload)`,
    [deviceId, agora, agora, payload]
  );
}

// Retorna { resultado: 'gravada' | 'duplicada' | 'pendente' | 'invalido', ... }
async function registrarLeitura({ deviceId, temperatura, umidade, medidoEm }) {
  const id = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!id) {
    return { resultado: 'invalido', motivo: 'Informe o device_id do dispositivo.' };
  }

  const temp = converterMedida(temperatura);
  const umid = converterMedida(umidade);
  if (temp === null || umid === null) {
    return { resultado: 'invalido', motivo: 'Temperatura e umidade devem ser numéricas.' };
  }
  if (foraDaFaixa(temp, LIMITES.temperatura) || foraDaFaixa(umid, LIMITES.umidade)) {
    return { resultado: 'invalido', motivo: 'Medida fora da faixa válida (0-50 °C / 0-100 %).' };
  }

  const medido = normalizarMedidoEm(medidoEm);
  if (!medido) {
    return { resultado: 'invalido', motivo: 'medido_em inválido.' };
  }

  const agora = paraUtcSql(new Date());

  const dispositivo = await queryOne(
    `SELECT id, ambiente_id
       FROM dispositivo
      WHERE device_id = ?
        AND COALESCE(ativo, 1) = 1
      ORDER BY id ASC
      LIMIT 1`,
    [id]
  );

  if (!dispositivo) {
    await registrarPendente(
      id,
      agora,
      JSON.stringify({ id, temperatura: temp, umidade: umid, timestamp: medidoEm ?? null })
    );
    return { resultado: 'pendente', deviceId: id };
  }

  let gravada = true;
  try {
    await execute(
      `INSERT INTO leitura_telemetria
         (dispositivo_id, ambiente_id, temperatura_c, umidade_pct, medido_em)
       VALUES (?, ?, ?, ?, ?)`,
      [dispositivo.id, dispositivo.ambiente_id, temp, umid, medido]
    );
  } catch (erro) {
    // uq_leitura_disp_tempo: a mesma leitura (dispositivo + instante) nao duplica.
    if (erro.code !== 'ER_DUP_ENTRY') throw erro;
    gravada = false;
  }

  await execute(
    `UPDATE dispositivo
        SET status_conexao = 'online',
            ultimo_contato_em = ?,
            ultima_leitura_em = ?,
            ultima_temperatura_c = ?,
            ultima_umidade_pct = ?
      WHERE id = ?`,
    [agora, medido, temp, umid, dispositivo.id]
  );

  return {
    resultado: gravada ? 'gravada' : 'duplicada',
    deviceId: id,
    dispositivoId: dispositivo.id,
    ambienteId: dispositivo.ambiente_id
  };
}

module.exports = { registrarLeitura };
