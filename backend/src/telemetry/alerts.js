// Alertas de conformidade: abre e encerra episodios em `alerta` a partir da faixa
// ideal do ambiente.
//
// O criterio repete exatamente o de `vw_ambiente_estado`, para que a view e a tabela
// nunca divirjam:
//  - fora da faixa ideal -> atencao;
//  - alem da tolerancia  -> critico (tolerancia NULL conta como 0);
//  - dentro da faixa     -> encerra o episodio aberto, se houver.
//
// Um episodio e identificado por (ambiente_id, tipo) com `encerrado_em IS NULL`.
// Enquanto a leitura continuar violando no mesmo sentido, o alerta e atualizado
// (pior valor e maior severidade); se o sentido inverter, o anterior e encerrado e
// um novo e aberto.

const { query, queryOne, execute } = require('../config/db');

const MEDIDAS = [
  {
    tipo: 'temperatura',
    min: 'temp_min_ideal',
    max: 'temp_max_ideal',
    tolerancia: 'temp_tolerancia'
  },
  {
    tipo: 'umidade',
    min: 'umid_min_ideal',
    max: 'umid_max_ideal',
    tolerancia: 'umid_tolerancia'
  }
];

function paraNumero(valor) {
  return valor === null || valor === undefined ? null : Number(valor);
}

// Mesma decisao da view. Devolve null quando a leitura esta conforme.
function avaliarViolacao(valor, min, max, tolerancia) {
  let sentido = null;
  let limite = null;

  if (max !== null && valor > max) {
    sentido = 'acima';
    limite = max;
  } else if (min !== null && valor < min) {
    sentido = 'abaixo';
    limite = min;
  }

  if (sentido === null) {
    return null;
  }

  const critico =
    sentido === 'acima' ? valor > max + tolerancia : valor < min - tolerancia;

  return {
    sentido,
    limite,
    severidade: critico ? 'critico' : 'atencao'
  };
}

function abrirAlerta({ ambienteId, dispositivoId, leituraId, tipo, violacao, valor, medidoEm }) {
  return execute(
    `INSERT INTO alerta
       (ambiente_id, dispositivo_id, leitura_id, tipo, sentido, severidade,
        valor, valor_extremo, limite_violado, ocorrido_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ambienteId,
      dispositivoId,
      leituraId,
      tipo,
      violacao.sentido,
      violacao.severidade,
      valor,
      valor,
      violacao.limite,
      medidoEm
    ]
  ).then((resultado) => resultado.insertId);
}

// GREATEST protege ck_alerta_periodo (encerrado_em >= ocorrido_em) contra leitura
// fora de ordem.
function encerrarAlerta(alertaId, instante) {
  return execute(
    `UPDATE alerta SET encerrado_em = GREATEST(?, ocorrido_em) WHERE id = ?`,
    [instante, alertaId]
  );
}

// Concilia os alertas do ambiente com a leitura recem-gravada.
// Retorna a lista de acoes, util para teste e diagnostico.
async function conciliarAlertas({
  ambienteId,
  dispositivoId,
  leituraId,
  temperatura,
  umidade,
  medidoEm
}) {
  const faixa = await queryOne(
    `SELECT temp_min_ideal, temp_max_ideal, umid_min_ideal, umid_max_ideal,
            temp_tolerancia, umid_tolerancia
       FROM ambiente
      WHERE id = ?`,
    [ambienteId]
  );

  if (!faixa) {
    return [];
  }

  const abertos = await query(
    `SELECT id, tipo, sentido, severidade, valor_extremo
       FROM alerta
      WHERE ambiente_id = ?
        AND encerrado_em IS NULL`,
    [ambienteId]
  );

  const acoes = [];
  const valores = { temperatura, umidade };

  for (const medida of MEDIDAS) {
    const valor = valores[medida.tipo];
    const min = paraNumero(faixa[medida.min]);
    const max = paraNumero(faixa[medida.max]);
    const tolerancia = paraNumero(faixa[medida.tolerancia]) ?? 0;

    const aberto = abertos.find((linha) => linha.tipo === medida.tipo) || null;
    const violacao = avaliarViolacao(valor, min, max, tolerancia);

    if (!violacao) {
      if (aberto) {
        await encerrarAlerta(aberto.id, medidoEm);
        acoes.push({ tipo: medida.tipo, acao: 'encerrado', alertaId: aberto.id });
      }
      continue;
    }

    if (aberto && aberto.sentido === violacao.sentido) {
      const extremo =
        violacao.sentido === 'acima'
          ? Math.max(paraNumero(aberto.valor_extremo), valor)
          : Math.min(paraNumero(aberto.valor_extremo), valor);
      const severidade = aberto.severidade === 'critico' ? 'critico' : violacao.severidade;

      await execute(`UPDATE alerta SET valor_extremo = ?, severidade = ? WHERE id = ?`, [
        extremo,
        severidade,
        aberto.id
      ]);
      acoes.push({ tipo: medida.tipo, acao: 'atualizado', alertaId: aberto.id, severidade });
      continue;
    }

    if (aberto) {
      await encerrarAlerta(aberto.id, medidoEm);
      acoes.push({ tipo: medida.tipo, acao: 'encerrado', alertaId: aberto.id });
    }

    const alertaId = await abrirAlerta({
      ambienteId,
      dispositivoId,
      leituraId,
      tipo: medida.tipo,
      violacao,
      valor,
      medidoEm
    });
    acoes.push({ tipo: medida.tipo, acao: 'aberto', alertaId, severidade: violacao.severidade });
  }

  return acoes;
}

module.exports = { conciliarAlertas, avaliarViolacao };
