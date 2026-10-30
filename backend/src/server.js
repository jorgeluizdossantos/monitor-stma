// Carrega o arquivo de configuracao indicado pelos scripts da raiz
// (npm run dev / npm run prod). Sem STMA_ENV_FILE, le backend/.env como antes.
require('dotenv').config(
  process.env.STMA_ENV_FILE ? { path: process.env.STMA_ENV_FILE } : undefined
);
const app = require('./app');
const { env } = require('./config/env');

app.listen(env.port, () => {
  console.log(`STMA backend disponível na porta ${env.port}`);
});
