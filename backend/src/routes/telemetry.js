// Rotas de leitura do dashboard (bloco B5).
//
// Somente leitura: nada aqui altera telemetria ou estado de dispositivo. A escrita
// continua em `POST /api/medicoes` (B1) e `POST /api/porta` (B4).
//
// Duas decisoes que valem para todas as rotas:
//
//  - Toda data sai formatada pelo proprio SQL, com sufixo `_utc`. O driver `mysql2`
//    converte `DATETIME` para o fuso do processo Node (UTC-3 nesta maquina) ao ler a
//    coluna; formatar no SQL e o unico jeito de devolver o instante realmente gravado,
//    que e UTC.
//  - A regra de conformidade nao e reescrita aqui: vem de `vw_ambiente_estado`, a mesma
//    fonte que o bloco B2 reproduz em `alerts.js`.

const { Router } = require('express');
const { query, queryOne, execute } = require('../config/db');
const { requireAuth } = require('../auth/session');

const router = Router();

const ISO_UTC = '%Y-%m-%dT%H:%i:%sZ';
const UM_DIA_MS = 24 * 60 * 60 * 1000;

function paraUtcSql(data) {
  return data.toISOString().slice(0, 23).replace('T', ' ');
}

function paraIsoUtc(valorSql) {
  return valorSql.replace(' ', 'T') + 'Z';
}

// Instante para o SQL, sempre em UTC. Sem o parametro, usa `agora + ausenteMs`
// (negativo para "ha N ms"); com valor invalido devolve null e a rota responde 400.
function interpretarData(valor, ausenteMs = 0) {
  if (valor === undefined || valor === null || valor === '') {
    return paraUtcSql(new Date(Date.now() + ausenteMs));
  }

  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : paraUtcSql(data);
}

function inteiroPositivo(valor) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function limitar(valor, padrao, maximo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) return padrao;
  return Math.min(numero, maximo);
}

function ehVerdadeiro(valor) {
  return ['1', 'true', 'sim'].includes(String(valor || '').trim().toLowerCase());
}

function paraBooleano(valor) {
  return valor === null || valor === undefined ? null : Boolean(Number(valor));
}

// Reconhecer alerta e acao de operacao: o perfil `leitor` apenas consulta.
function podeReconhecer(user) {
  return ['superadmin', 'administrador', 'operador'].includes(
    String(user?.perfil || '').toLowerCase()
  );
}

const CAMPOS_STATUS = `
  v.ambiente_id,
  v.ambiente,
  v.empresa_id,
  v.setor_id,
  v.dispositivo_id,
  v.device_id,
  v.status_conexao,
  v.em_manutencao,
  d.nome AS dispositivo,
  d.intervalo_leitura_seg,
  d.offline_apos_seg,
  DATE_FORMAT(v.ultima_leitura_em, ?) AS ultima_leitura_utc,
  TIMESTAMPDIFF(SECOND, v.ultima_leitura_em, UTC_TIMESTAMP()) AS idade_leitura_seg,
  v.temperatura_c,
  v.umidade_pct,
  v.estado,
  CASE
    WHEN v.ultima_leitura_em IS NULL THEN 0
    WHEN v.ultima_leitura_em >= TIMESTAMPADD(SECOND, -COALESCE(d.offline_apos_seg, 120), UTC_TIMESTAMP()) THEN 1
    ELSE 0
  END AS online
`;

function linhaStatus(row) {
  return {
    ambiente_id: row.ambiente_id,
    ambiente: row.ambiente,
    empresa_id: row.empresa_id,
    setor_id: row.setor_id,
    dispositivo_id: row.dispositivo_id,
    dispositivo: row.dispositivo,
    device_id: row.device_id,
    status_conexao: row.status_conexao,
    online: Boolean(row.online),
    em_manutencao: paraBooleano(row.em_manutencao) || false,
    intervalo_leitura_seg: row.intervalo_leitura_seg,
    offline_apos_seg: row.offline_apos_seg,
    ultima_leitura_utc: row.ultima_leitura_utc,
    idade_leitura_seg: row.idade_leitura_seg === null ? null : Number(row.idade_leitura_seg),
    temperatura_c: row.temperatura_c,
    umidade_pct: row.umidade_pct,
    estado: row.estado
  };
}

// P1 — saude do dado: um registro por ambiente, com ou sem dispositivo ativo.
router.get('/dispositivos/status', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT ${CAMPOS_STATUS}
         FROM vw_ambiente_estado v
         LEFT JOIN dispositivo d ON d.id = v.dispositivo_id
        ORDER BY v.empresa_id, v.setor_id, v.ambiente`,
      [ISO_UTC]
    );

    return res.json({ ok: true, data: rows.map(linhaStatus) });
  } catch (error) {
    return next(error);
  }
});

// P1 + P2 — estado atual de um ambiente: leitura em cache, faixa ideal, conformidade
// e atraso de ingestao da ultima leitura gravada.
router.get('/telemetria/atual', requireAuth, async (req, res, next) => {
  try {
    const ambienteId = inteiroPositivo(req.query.ambiente_id);
    if (!ambienteId) {
      return res.status(400).json({ ok: false, error: 'Informe o ambiente_id.' });
    }

    const linha = await queryOne(
      `SELECT ${CAMPOS_STATUS},
              a.nome AS ambiente_nome,
              a.temp_min_ideal,
              a.temp_max_ideal,
              a.umid_min_ideal,
              a.umid_max_ideal,
              a.temp_tolerancia,
              a.umid_tolerancia
         FROM vw_ambiente_estado v
         JOIN ambiente a ON a.id = v.ambiente_id
         LEFT JOIN dispositivo d ON d.id = v.dispositivo_id
        WHERE v.ambiente_id = ?
        LIMIT 1`,
      [ISO_UTC, ambienteId]
    );

    if (!linha) {
      return res.status(404).json({ ok: false, error: 'Ambiente não encontrado.' });
    }

    const ultima = await queryOne(
      `SELECT DATE_FORMAT(medido_em, ?) AS medido_utc,
              DATE_FORMAT(recebido_em, ?) AS recebido_utc,
              TIMESTAMPDIFF(SECOND, medido_em, recebido_em) AS atraso_seg
         FROM leitura_telemetria
        WHERE ambiente_id = ?
        ORDER BY medido_em DESC, id DESC
        LIMIT 1`,
      [ISO_UTC, ISO_UTC, ambienteId]
    );

    return res.json({
      ok: true,
      data: {
        ...linhaStatus(linha),
        temp_min_ideal: linha.temp_min_ideal,
        temp_max_ideal: linha.temp_max_ideal,
        umid_min_ideal: linha.umid_min_ideal,
        umid_max_ideal: linha.umid_max_ideal,
        temp_tolerancia: linha.temp_tolerancia,
        umid_tolerancia: linha.umid_tolerancia,
        medicao: ultima
          ? {
            medido_utc: ultima.medido_utc,
            recebido_utc: ultima.recebido_utc,
            atraso_seg: Number(ultima.atraso_seg)
          }
          : null
      }
    });
  } catch (error) {
    return next(error);
  }
});

// P2 — episodios de alerta com duracao e magnitude do desvio.
router.get('/alertas', requireAuth, async (req, res, next) => {
  try {
    const somenteAbertos = ehVerdadeiro(req.query.abertos);
    const de = interpretarData(req.query.de, -7 * UM_DIA_MS);
    const ate = interpretarData(req.query.ate, 0);
    if (de === null || ate === null) {
      return res.status(400).json({ ok: false, error: 'Período inválido.' });
    }

    // Um alerta aberto ha mais tempo que o recorte sumiria da tela, que e justamente o
    // caso mais grave. Por isso o periodo so entra quando pedido explicitamente ou
    // quando a consulta nao esta restrita aos abertos.
    const recortarPeriodo = !somenteAbertos || req.query.de !== undefined || req.query.ate !== undefined;

    const condicoes = [];
    const valores = [ISO_UTC, ISO_UTC];

    if (somenteAbertos) {
      condicoes.push('al.encerrado_em IS NULL');
    }

    const severidade = String(req.query.severidade || '').toLowerCase();
    if (severidade === 'atencao' || severidade === 'critico') {
      condicoes.push('al.severidade = ?');
      valores.push(severidade);
    }

    const tipo = String(req.query.tipo || '').toLowerCase();
    if (tipo === 'temperatura' || tipo === 'umidade') {
      condicoes.push('al.tipo = ?');
      valores.push(tipo);
    }

    const ambienteId = inteiroPositivo(req.query.ambiente_id);
    if (ambienteId) {
      condicoes.push('al.ambiente_id = ?');
      valores.push(ambienteId);
    }

    if (recortarPeriodo) {
      condicoes.push('al.ocorrido_em >= ?', 'al.ocorrido_em < ?');
      valores.push(de, ate);
    }

    const limite = limitar(req.query.limite, 100, 500);
    valores.push(limite);

    const rows = await query(
      `SELECT
         al.id,
         al.ambiente_id,
         a.nome AS ambiente,
         al.dispositivo_id,
         al.leitura_id,
         al.tipo,
         al.sentido,
         al.severidade,
         al.valor,
         al.valor_extremo,
         al.limite_violado,
         DATE_FORMAT(al.ocorrido_em, ?) AS ocorrido_utc,
         DATE_FORMAT(al.encerrado_em, ?) AS encerrado_utc,
         TIMESTAMPDIFF(SECOND, al.ocorrido_em, COALESCE(al.encerrado_em, UTC_TIMESTAMP())) AS duracao_seg,
         (al.encerrado_em IS NULL) AS aberto,
         al.reconhecido_por,
         DATE_FORMAT(al.reconhecido_em, ?) AS reconhecido_utc
       FROM alerta al
       JOIN ambiente a ON a.id = al.ambiente_id
       ${condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''}
       ORDER BY al.ocorrido_em DESC, al.id DESC
       LIMIT ?`,
      // O terceiro formato e do reconhecido_em, que vem depois das condicoes no SELECT.
      [valores[0], valores[1], ISO_UTC, ...valores.slice(2)]
    );

    return res.json({
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        ambiente_id: row.ambiente_id,
        ambiente: row.ambiente,
        dispositivo_id: row.dispositivo_id,
        leitura_id: row.leitura_id,
        tipo: row.tipo,
        sentido: row.sentido,
        severidade: row.severidade,
        valor: row.valor,
        valor_extremo: row.valor_extremo,
        limite_violado: row.limite_violado,
        ocorrido_utc: row.ocorrido_utc,
        encerrado_utc: row.encerrado_utc,
        duracao_seg: Number(row.duracao_seg),
        aberto: Boolean(row.aberto),
        reconhecido_por: row.reconhecido_por,
        reconhecido_utc: row.reconhecido_utc
      }))
    });
  } catch (error) {
    return next(error);
  }
});

// P2 — panorama do periodo: alertas por severidade e tipo, mais a taxa de conformidade
// das leituras gravadas.
router.get('/alertas/resumo', requireAuth, async (req, res, next) => {
  try {
    const de = interpretarData(req.query.de, -UM_DIA_MS);
    const ate = interpretarData(req.query.ate, 0);
    if (de === null || ate === null) {
      return res.status(400).json({ ok: false, error: 'Período inválido.' });
    }

    const ambienteId = inteiroPositivo(req.query.ambiente_id);
    const filtroAlerta = ambienteId ? ' AND ambiente_id = ?' : '';
    const filtroLeitura = ambienteId ? ' AND lt.ambiente_id = ?' : '';
    const valoresAmbiente = ambienteId ? [ambienteId] : [];

    const grupos = await query(
      `SELECT severidade, tipo, COUNT(*) AS total, SUM(encerrado_em IS NULL) AS abertos
         FROM alerta
        WHERE ocorrido_em >= ? AND ocorrido_em < ?${filtroAlerta}
        GROUP BY severidade, tipo`,
      [de, ate, ...valoresAmbiente]
    );

    const porSeveridade = new Map();
    const porTipo = new Map();
    let totalAlertas = 0;
    let totalAbertos = 0;

    for (const grupo of grupos) {
      const total = Number(grupo.total);
      const abertos = Number(grupo.abertos || 0);
      totalAlertas += total;
      totalAbertos += abertos;

      const naSeveridade = porSeveridade.get(grupo.severidade) || { severidade: grupo.severidade, total: 0, abertos: 0 };
      naSeveridade.total += total;
      naSeveridade.abertos += abertos;
      porSeveridade.set(grupo.severidade, naSeveridade);

      const noTipo = porTipo.get(grupo.tipo) || { tipo: grupo.tipo, total: 0, abertos: 0 };
      noTipo.total += total;
      noTipo.abertos += abertos;
      porTipo.set(grupo.tipo, noTipo);
    }

    // Conformidade pelo numero de leituras dentro da faixa ideal. Faixa nula em qualquer
    // limite deixa a leitura como conforme, o mesmo resultado da view.
    const conformidade = await queryOne(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN lt.temperatura_c > a.temp_max_ideal
                         OR lt.temperatura_c < a.temp_min_ideal
                         OR lt.umidade_pct   > a.umid_max_ideal
                         OR lt.umidade_pct   < a.umid_min_ideal
                       THEN 1 ELSE 0 END) AS fora
         FROM leitura_telemetria lt
         JOIN ambiente a ON a.id = lt.ambiente_id
        WHERE lt.medido_em >= ? AND lt.medido_em < ?${filtroLeitura}`,
      [de, ate, ...valoresAmbiente]
    );

    const totalLeituras = Number(conformidade?.total || 0);
    const leiturasFora = Number(conformidade?.fora || 0);

    return res.json({
      ok: true,
      data: {
        de: paraIsoUtc(de),
        ate: paraIsoUtc(ate),
        ambiente_id: ambienteId,
        alertas: {
          total: totalAlertas,
          abertos: totalAbertos,
          por_severidade: [...porSeveridade.values()],
          por_tipo: [...porTipo.values()]
        },
        leituras: {
          total: totalLeituras,
          fora_faixa: leiturasFora,
          conformidade_pct: totalLeituras === 0
            ? null
            : Number((((totalLeituras - leiturasFora) / totalLeituras) * 100).toFixed(1))
        }
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/alertas/:id/reconhecer', requireAuth, async (req, res, next) => {
  try {
    if (!podeReconhecer(req.auth?.user)) {
      return res.status(403).json({
        ok: false,
        error: 'O perfil leitor não pode reconhecer alertas.'
      });
    }

    const alertaId = inteiroPositivo(req.params.id);
    if (!alertaId) {
      return res.status(400).json({ ok: false, error: 'Identificador de alerta inválido.' });
    }

    const agora = paraUtcSql(new Date());
    const resultado = await execute(
      'UPDATE alerta SET reconhecido_por = ?, reconhecido_em = ? WHERE id = ?',
      [req.auth.user.id, agora, alertaId]
    );

    // O pool conecta com CLIENT_FOUND_ROWS: `affectedRows` conta as linhas encontradas,
    // entao reconhecer duas vezes o mesmo alerta continua devolvendo 1.
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: 'Alerta não encontrado.' });
    }

    return res.json({
      ok: true,
      alerta_id: alertaId,
      reconhecido_por: req.auth.user.id,
      reconhecido_utc: paraIsoUtc(agora)
    });
  } catch (error) {
    return next(error);
  }
});

// P3 — serie temporal. `bucket=hora` usa o resumo consolidado (B3); `bucket=leitura`
// devolve a telemetria bruta paginada, para o detalhe do periodo.
router.get('/telemetria/historico', requireAuth, async (req, res, next) => {
  try {
    const ambienteId = inteiroPositivo(req.query.ambiente_id);
    if (!ambienteId) {
      return res.status(400).json({ ok: false, error: 'Informe o ambiente_id.' });
    }

    const bucket = String(req.query.bucket || 'hora').toLowerCase();
    if (bucket !== 'hora' && bucket !== 'leitura') {
      return res.status(400).json({ ok: false, error: 'bucket deve ser hora ou leitura.' });
    }

    const de = interpretarData(req.query.de, -UM_DIA_MS);
    const ate = interpretarData(req.query.ate, 0);
    if (de === null || ate === null) {
      return res.status(400).json({ ok: false, error: 'Período inválido.' });
    }

    if (bucket === 'leitura') {
      const limite = limitar(req.query.limite, 500, 2000);
      const linhas = await query(
        `SELECT id,
                DATE_FORMAT(medido_em, ?) AS medido_utc,
                DATE_FORMAT(recebido_em, ?) AS recebido_utc,
                temperatura_c,
                umidade_pct,
                TIMESTAMPDIFF(SECOND, medido_em, recebido_em) AS atraso_seg
           FROM leitura_telemetria
          WHERE ambiente_id = ?
            AND medido_em >= ?
            AND medido_em < ?
          ORDER BY medido_em DESC, id DESC
          LIMIT ?`,
        [ISO_UTC, ISO_UTC, ambienteId, de, ate, limite]
      );

      return res.json({
        ok: true,
        bucket,
        de: paraIsoUtc(de),
        ate: paraIsoUtc(ate),
        data: linhas.map((row) => ({
          id: Number(row.id),
          medido_utc: row.medido_utc,
          recebido_utc: row.recebido_utc,
          temperatura_c: row.temperatura_c,
          umidade_pct: row.umidade_pct,
          atraso_seg: Number(row.atraso_seg)
        }))
      });
    }

    const linhas = await query(
      `SELECT DATE_FORMAT(hora_ref, ?) AS hora_utc,
              qtd_leituras,
              temp_media,
              temp_min,
              temp_max,
              umid_media,
              umid_min,
              umid_max
         FROM leitura_hora
        WHERE ambiente_id = ?
          AND hora_ref >= ?
          AND hora_ref < ?
        ORDER BY hora_ref`,
      [ISO_UTC, ambienteId, de, ate]
    );

    return res.json({
      ok: true,
      bucket,
      de: paraIsoUtc(de),
      ate: paraIsoUtc(ate),
      data: linhas.map((row) => ({
        hora_utc: row.hora_utc,
        qtd_leituras: Number(row.qtd_leituras),
        temp_media: row.temp_media,
        temp_min: row.temp_min,
        temp_max: row.temp_max,
        umid_media: row.umid_media,
        umid_min: row.umid_min,
        umid_max: row.umid_max
      }))
    });
  } catch (error) {
    return next(error);
  }
});

// P4 — aberturas de porta: quantas no periodo, quanto tempo duraram e se ha alguma
// em aberto agora.
//
// O B4 grava so na mudanca de estado, entao cada linha com `aberta = 1` abre um
// episodio que termina na proxima linha do mesmo dispositivo (`LEAD`). Episodio sem
// linha seguinte esta aberto agora; a duracao dele conta ate `UTC_TIMESTAMP()`, o
// mesmo criterio de `/alertas`.
function cteAberturas(filtroAmbiente) {
  return `
    WITH marcacoes AS (
      SELECT ep.dispositivo_id,
             ep.aberta,
             ep.ocorrido_em,
             LEAD(ep.aberta) OVER w AS proxima_aberta,
             LEAD(ep.ocorrido_em) OVER w AS proxima_em
        FROM evento_porta ep
       ${filtroAmbiente}
      WINDOW w AS (PARTITION BY ep.dispositivo_id ORDER BY ep.ocorrido_em, ep.id)
    ),
    aberturas AS (
      SELECT ocorrido_em AS aberta_em,
             CASE WHEN proxima_aberta = 0 THEN proxima_em END AS fechada_em
        FROM marcacoes
       WHERE aberta = 1
    )
  `;
}

// A janela do `LEAD` nao pode ser recortada pelo periodo: o fechamento de uma abertura
// feita dentro do periodo pode estar depois de `ate`, e sem ele o episodio apareceria
// como eternamente aberto. Por isso o periodo entra so na consulta de fora.
const DURACAO_ABERTURA = 'TIMESTAMPDIFF(SECOND, aberta_em, COALESCE(fechada_em, UTC_TIMESTAMP()))';

router.get('/porta/resumo', requireAuth, async (req, res, next) => {
  try {
    const ambienteId = inteiroPositivo(req.query.ambiente_id);
    const de = interpretarData(req.query.de, -7 * UM_DIA_MS);
    const ate = interpretarData(req.query.ate, 0);
    if (de === null || ate === null) {
      return res.status(400).json({ ok: false, error: 'Período inválido.' });
    }

    const filtroAmbiente = ambienteId ? 'WHERE ep.ambiente_id = ?' : '';
    const cte = cteAberturas(filtroAmbiente);
    const valoresAmbiente = ambienteId ? [ambienteId] : [];

    const totais = await queryOne(
      `${cte}
       SELECT COUNT(*) AS total,
              SUM(fechada_em IS NULL) AS em_aberto,
              SUM(${DURACAO_ABERTURA}) AS duracao_total_seg,
              AVG(${DURACAO_ABERTURA}) AS duracao_media_seg,
              MAX(${DURACAO_ABERTURA}) AS duracao_maxima_seg
         FROM aberturas
        WHERE aberta_em >= ? AND aberta_em < ?`,
      [...valoresAmbiente, de, ate]
    );

    const eventos = await query(
      `${cte}
       SELECT DATE_FORMAT(aberta_em, ?) AS aberta_utc,
              DATE_FORMAT(fechada_em, ?) AS fechada_utc,
              ${DURACAO_ABERTURA} AS duracao_seg,
              (fechada_em IS NULL) AS em_aberto
         FROM aberturas
        WHERE aberta_em >= ? AND aberta_em < ?
        ORDER BY aberta_em DESC
        LIMIT ?`,
      [...valoresAmbiente, ISO_UTC, ISO_UTC, de, ate, limitar(req.query.limite, 200, 500)]
    );

    // Estado atual: ultimo evento gravado no escopo. Como o B4 so grava na mudanca,
    // ele e o estado vigente da porta.
    const ultimo = await queryOne(
      `SELECT DATE_FORMAT(ocorrido_em, ?) AS ocorrido_utc, aberta
         FROM evento_porta
        ${ambienteId ? 'WHERE ambiente_id = ?' : ''}
        ORDER BY ocorrido_em DESC, id DESC
        LIMIT 1`,
      ambienteId ? [ISO_UTC, ambienteId] : [ISO_UTC]
    );

    const total = Number(totais?.total || 0);

    return res.json({
      ok: true,
      data: {
        de: paraIsoUtc(de),
        ate: paraIsoUtc(ate),
        ambiente_id: ambienteId,
        porta_aberta: ultimo ? Boolean(ultimo.aberta) : null,
        aberta_desde_utc: ultimo && ultimo.aberta ? ultimo.ocorrido_utc : null,
        total_aberturas: total,
        aberturas_em_aberto: Number(totais?.em_aberto || 0),
        duracao_total_seg: Number(totais?.duracao_total_seg || 0),
        duracao_media_seg: total === 0 ? null : Number(totais.duracao_media_seg),
        duracao_maxima_seg: total === 0 ? null : Number(totais.duracao_maxima_seg),
        eventos: eventos.map((row) => ({
          aberta_utc: row.aberta_utc,
          fechada_utc: row.fechada_utc,
          duracao_seg: Number(row.duracao_seg),
          em_aberto: Boolean(row.em_aberto)
        }))
      }
    });
  } catch (error) {
    return next(error);
  }
});

// P5 — placas publicando que ainda nao tem cadastro (RF007). O B1 grava uma linha por
// device_id desconhecido e incrementa `qtd_mensagens`; a adocao e feita no cadastro.
router.get('/dispositivos/pendentes', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT device_id,
              DATE_FORMAT(primeiro_contato_em, ?) AS primeiro_contato_utc,
              DATE_FORMAT(ultimo_contato_em, ?) AS ultimo_contato_utc,
              qtd_mensagens,
              ultimo_payload
         FROM dispositivo_pendente
        WHERE situacao = 'pendente'
        ORDER BY ultimo_contato_em DESC
        LIMIT ?`,
      [ISO_UTC, ISO_UTC, limitar(req.query.limite, 100, 500)]
    );

    return res.json({
      ok: true,
      data: rows.map((row) => ({
        device_id: row.device_id,
        primeiro_contato_utc: row.primeiro_contato_utc,
        ultimo_contato_utc: row.ultimo_contato_utc,
        qtd_mensagens: Number(row.qtd_mensagens),
        ultimo_payload: row.ultimo_payload
      }))
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
