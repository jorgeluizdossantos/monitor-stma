const fs = require('fs');
const mysql = require('mysql2/promise');
const { env } = require('./env');

function buildSslConfig() {
  if (!env.db.ssl) {
    return undefined;
  }

  const sslConfig = {
    rejectUnauthorized: env.db.sslRejectUnauthorized
  };

  if (env.db.sslCaPath && fs.existsSync(env.db.sslCaPath)) {
    sslConfig.ca = fs.readFileSync(env.db.sslCaPath, 'utf8');
  }

  return sslConfig;
}

const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.name,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: buildSslConfig()
});

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function execute(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

async function pingDatabase() {
  const connection = await pool.getConnection();

  try {
    await connection.ping();
    return {
      ok: true,
      database: env.db.name,
      host: env.db.host
    };
  } finally {
    connection.release();
  }
}

module.exports = {
  pool,
  query,
  queryOne,
  execute,
  pingDatabase
};
