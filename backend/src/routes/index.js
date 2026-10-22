const { Router } = require('express');
const { pingDatabase } = require('../config/db');
const authRouter = require('./auth');
const compatRouter = require('./compat');

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'stma-backend',
    timestamp: new Date().toISOString()
  });
});

router.get('/health/db', async (req, res) => {
  try {
    const status = await pingDatabase();

    res.json({
      ok: true,
      database: status
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'Falha ao conectar ao banco de dados.',
      details: error.message
    });
  }
});

router.use(authRouter);
router.use(compatRouter);

module.exports = router;
