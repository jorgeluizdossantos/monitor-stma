const express = require('express');
const cors = require('cors');
const { env } = require('./config/env');
const routes = require('./routes');

const app = express();

if (env.corsOrigin === '*') {
  app.use(cors());
} else {
  const allowedOrigins = env.corsOrigin
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  app.use(cors({
    origin: allowedOrigins,
    credentials: true
  }));
}

app.use(express.json());
app.use('/api', routes);

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: 'Rota não encontrada.'
  });
});

module.exports = app;
