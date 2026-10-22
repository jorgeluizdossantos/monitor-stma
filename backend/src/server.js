require('dotenv').config();
const app = require('./app');
const { env } = require('./config/env');

app.listen(env.port, () => {
  console.log(`STMA backend disponível na porta ${env.port}`);
});
