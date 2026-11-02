// Consolidacao horaria: recalcula o resumo da hora a partir das leituras brutas.
//
// Nao existe agendador — a Vercel nao mantem processo vivo —, entao o bucket da hora
// e recalculado a cada leitura recebida, logo apos ela ser gravada. O recalculo e
// idempotente e se corrige sozinho: leituras atrasadas entram no bucket da hora certa
// sem exigir soma incremental nem estado em memoria.
//
// A janela da hora e resolvida no proprio SQL, sobre o valor UTC ja gravado, para nao
// depender do fuso do processo Node.

const { execute } = require('../config/db');

async function consolidarHora(ambienteId, medidoEm) {
  await execute(
    `INSERT INTO leitura_hora
       (ambiente_id, hora_ref, qtd_leituras,
        temp_media, temp_min, temp_max,
        umid_media, umid_min, umid_max)
     SELECT lt.ambiente_id,
            DATE_FORMAT(lt.medido_em, '%Y-%m-%d %H:00:00'),
            COUNT(*),
            ROUND(AVG(lt.temperatura_c), 1),
            MIN(lt.temperatura_c),
            MAX(lt.temperatura_c),
            ROUND(AVG(lt.umidade_pct), 1),
            MIN(lt.umidade_pct),
            MAX(lt.umidade_pct)
       FROM leitura_telemetria lt
      WHERE lt.ambiente_id = ?
        AND lt.medido_em >= DATE_FORMAT(?, '%Y-%m-%d %H:00:00')
        AND lt.medido_em <  DATE_FORMAT(?, '%Y-%m-%d %H:00:00') + INTERVAL 1 HOUR
      GROUP BY lt.ambiente_id, DATE_FORMAT(lt.medido_em, '%Y-%m-%d %H:00:00')
     ON DUPLICATE KEY UPDATE
       qtd_leituras = VALUES(qtd_leituras),
       temp_media   = VALUES(temp_media),
       temp_min     = VALUES(temp_min),
       temp_max     = VALUES(temp_max),
       umid_media   = VALUES(umid_media),
       umid_min     = VALUES(umid_min),
       umid_max     = VALUES(umid_max)`,
    [ambienteId, medidoEm, medidoEm]
  );
}

module.exports = { consolidarHora };
