// Eventos de porta: grava em `evento_porta` apenas quando o estado muda.
//
// O firmware republica "Porta Aberta"/"Porta Fechada" a cada amostra de proposito —
// assim o painel se recupera sozinho depois de uma queda do backend. Gravar cada
// publicacao encheria a tabela com milhares de linhas identicas e destruiria o
// indicador de duracao da abertura, que e justamente o que interessa (P4).
//
// Como o backend nao guarda estado em memoria (Vercel serverless), a comparacao e
// feita contra a ultima linha gravada do dispositivo. O primeiro evento de um
// dispositivo sempre grava: e ele que estabelece o estado inicial.

const { queryOne, execute } = require('../config/db');

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

// Aceita o booleano do painel e as formas textuais que o firmware publica.
function interpretarAberta(valor) {
  if (typeof valor === 'boolean') return valor;
  if (valor === 1 || valor === 0) return valor === 1;

  if (typeof valor === 'string') {
    const texto = valor.trim().toLowerCase();
    if (['1', 'true', 'aberta', 'aberto'].includes(texto)) return true;
    if (['0', 'false', 'fechada', 'fechado'].includes(texto)) return false;
  }

  return null;
}

// Retorna { resultado: 'gravado' | 'inalterado' | 'pendente' | 'invalido', ... }
async function registrarPorta({ deviceId, aberta, medidoEm }) {
  const id = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!id) {
    return { resultado: 'invalido', motivo: 'Informe o device_id do dispositivo.' };
  }

  const estado = interpretarAberta(aberta);
  if (estado === null) {
    return { resultado: 'invalido', motivo: 'Estado da porta deve ser aberta ou fechada.' };
  }

  const ocorrido = normalizarMedidoEm(medidoEm);
  if (!ocorrido) {
    return { resultado: 'invalido', motivo: 'medido_em inválido.' };
  }

  const dispositivo = await queryOne(
    `SELECT id, ambiente_id
       FROM dispositivo
      WHERE device_id = ?
        AND COALESCE(ativo, 1) = 1
      ORDER BY id ASC
      LIMIT 1`,
    [id]
  );

  // Dispositivo desconhecido nao gera evento: sem cadastro nao ha ambiente ao qual
  // associar a abertura, e `evento_porta.ambiente_id` e NOT NULL com FK.
  if (!dispositivo) {
    return { resultado: 'pendente', deviceId: id };
  }

  const ultimo = await queryOne(
    `SELECT aberta
       FROM evento_porta
      WHERE dispositivo_id = ?
      ORDER BY ocorrido_em DESC, id DESC
      LIMIT 1`,
    [dispositivo.id]
  );

  if (ultimo && Boolean(ultimo.aberta) === estado) {
    return { resultado: 'inalterado', dispositivoId: dispositivo.id, aberta: estado };
  }

  await execute(
    `INSERT INTO evento_porta
       (dispositivo_id, ambiente_id, aberta, ocorrido_em, recebido_em)
     VALUES (?, ?, ?, ?, ?)`,
    [dispositivo.id, dispositivo.ambiente_id, estado ? 1 : 0, ocorrido, paraUtcSql(new Date())]
  );

  return {
    resultado: 'gravado',
    dispositivoId: dispositivo.id,
    ambienteId: dispositivo.ambiente_id,
    aberta: estado
  };
}

module.exports = { registrarPorta };
