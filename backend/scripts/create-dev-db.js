// Provisiona a base de DESENVOLVIMENTO (homologacao).
//
// Cria a base indicada por DB_NAME no arquivo de configuracao e replica a
// estrutura da base de origem (DB_NAME_ORIGEM, padrao stma_db).
// Com --com-dados, copia tambem o conteudo das tabelas.
// Em nenhum caso altera a base de origem.
//
// Uso:  npm run db:dev:setup         (somente estrutura)
//       npm run db:dev:replicate     (estrutura + dados)
//       STMA_ENV_FILE=<caminho> node backend/scripts/create-dev-db.js [--com-dados]

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const BACKEND = path.resolve(__dirname, '..');
const ROOT = path.resolve(BACKEND, '..');

const arquivoConfig =
  process.env.STMA_ENV_FILE || path.join(ROOT, 'config', '.env.development');

if (!fs.existsSync(arquivoConfig)) {
  console.error('Arquivo de configuracao nao encontrado: ' + arquivoConfig);
  process.exit(1);
}

require('dotenv').config({ path: arquivoConfig });

const ORIGEM = process.env.DB_NAME_ORIGEM || 'stma_db';
const DESTINO = process.env.DB_NAME;
const COM_DADOS = process.argv.includes('--com-dados');
const TAMANHO_LOTE = 500;

if (!DESTINO) {
  console.error('DB_NAME nao definido em ' + arquivoConfig);
  process.exit(1);
}

if (DESTINO === ORIGEM) {
  console.error('DB_NAME de destino e igual a origem (' + ORIGEM + '). Nada a fazer.');
  process.exit(1);
}

function buildSsl() {
  const usarSsl = String(process.env.DB_SSL || 'true').toLowerCase() === 'true';
  if (!usarSsl) return undefined;

  const ssl = {
    rejectUnauthorized:
      String(process.env.DB_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() === 'true'
  };

  const caPath = process.env.DB_SSL_CA_PATH
    ? path.resolve(BACKEND, process.env.DB_SSL_CA_PATH)
    : null;

  if (caPath && fs.existsSync(caPath)) {
    ssl.ca = fs.readFileSync(caPath, 'utf8');
  }

  return ssl;
}

const conexaoBase = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: buildSsl()
};

function qualificar(nome) {
  return '`' + String(nome).replace(/`/g, '') + '`';
}

// O mysql2 devolve colunas JSON como objeto. Na copia em lote e preciso
// devolve-las como texto, senao o MySQL recusa o INSERT.
function normalizarValor(valor) {
  if (valor === null || valor === undefined) return valor;
  if (Buffer.isBuffer(valor) || valor instanceof Date) return valor;
  if (typeof valor === 'object') return JSON.stringify(valor);
  return valor;
}

async function main() {
  console.log('Configuracao: ' + arquivoConfig);
  console.log('Origem:       ' + ORIGEM);
  console.log('Destino:      ' + DESTINO);
  console.log('');

  const semBase = await mysql.createConnection(conexaoBase);

  try {
    await semBase.query(
      'CREATE DATABASE IF NOT EXISTS ' +
        qualificar(DESTINO) +
        ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    console.log('[1/3] Base ' + DESTINO + ' pronta.');
  } finally {
    await semBase.end();
  }

  const origem = await mysql.createConnection({ ...conexaoBase, database: ORIGEM });
  let objetos;
  try {
    const [linhas] = await origem.query('SHOW FULL TABLES');
    objetos = linhas.map((linha) => {
      const valores = Object.values(linha);
      return { nome: valores[0], tipo: valores[1] };
    });
  } finally {
    await origem.end();
  }

  const tabelas = objetos.filter((item) => item.tipo === 'BASE TABLE');
  const views = objetos.filter((item) => item.tipo === 'VIEW');

  const destino = await mysql.createConnection({ ...conexaoBase, database: DESTINO });

  try {
    await destino.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const tabela of tabelas) {
      const origemLeitura = await mysql.createConnection({ ...conexaoBase, database: ORIGEM });
      try {
        const [linhas] = await origemLeitura.query('SHOW CREATE TABLE ' + qualificar(tabela.nome));
        const ddl = linhas[0]['Create Table'];
        await destino.query('DROP TABLE IF EXISTS ' + qualificar(tabela.nome));
        await destino.query(ddl);
        console.log('      tabela  ' + tabela.nome);
      } finally {
        await origemLeitura.end();
      }
    }

    for (const view of views) {
      const origemLeitura = await mysql.createConnection({ ...conexaoBase, database: ORIGEM });
      try {
        const [linhas] = await origemLeitura.query('SHOW CREATE VIEW ' + qualificar(view.nome));
        const ddl = linhas[0]['Create View'];
        await destino.query('DROP VIEW IF EXISTS ' + qualificar(view.nome));
        await destino.query(ddl);
        console.log('      view    ' + view.nome);
      } finally {
        await origemLeitura.end();
      }
    }

    if (COM_DADOS) {
      let totalLinhas = 0;

      for (const tabela of tabelas) {
        const origemLeitura = await mysql.createConnection({
          ...conexaoBase,
          database: ORIGEM,
          rowsAsArray: true
        });

        try {
          const [linhas] = await origemLeitura.query('SELECT * FROM ' + qualificar(tabela.nome));
          await destino.query('TRUNCATE TABLE ' + qualificar(tabela.nome));

          for (let inicio = 0; inicio < linhas.length; inicio += TAMANHO_LOTE) {
            const lote = linhas
              .slice(inicio, inicio + TAMANHO_LOTE)
              .map((linha) => linha.map(normalizarValor));
            await destino.query('INSERT INTO ' + qualificar(tabela.nome) + ' VALUES ?', [lote]);
          }

          totalLinhas += linhas.length;
          console.log('      dados   ' + tabela.nome + ' (' + linhas.length + ')');
        } finally {
          await origemLeitura.end();
        }
      }

      await destino.query('SET FOREIGN_KEY_CHECKS = 1');

      const [conferencia] = await destino.query('SHOW TABLES');
      console.log('');
      console.log('[2/3] Estrutura replicada: ' + tabelas.length + ' tabela(s), ' + views.length + ' view(s).');
      console.log('[3/3] Dados copiados: ' + totalLinhas + ' linha(s).');
      console.log('      Conferencia na base ' + DESTINO + ': ' + conferencia.length + ' tabela(s) encontrada(s).');
    } else {
      await destino.query('SET FOREIGN_KEY_CHECKS = 1');

      const [conferencia] = await destino.query('SHOW TABLES');
      console.log('');
      console.log('[2/3] Estrutura replicada: ' + tabelas.length + ' tabela(s), ' + views.length + ' view(s).');
      console.log('[3/3] Nenhum dado copiado (use npm run db:dev:replicate para copiar o conteudo).');
      console.log('      Conferencia na base ' + DESTINO + ': ' + conferencia.length + ' tabela(s) encontrada(s).');
    }

    console.log('');
    console.log('Pronto. Agora "npm run dev" ja conecta na base de homologacao.');
  } finally {
    await destino.end();
  }
}

main().catch((erro) => {
  console.error('');
  console.error('Falha ao provisionar a base de desenvolvimento.');
  console.error(erro.message);
  process.exit(1);
});
