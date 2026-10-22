const path = require('path');

function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return ['true', '1', 'yes', 'sim'].includes(String(value).toLowerCase());
}

function resolveFromBackend(relativePath) {
  return path.resolve(__dirname, '..', '..', relativePath);
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3001),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  db: {
    host: process.env.DB_HOST || '',
    port: Number(process.env.DB_PORT || 3306),
    name: process.env.DB_NAME || '',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    ssl: toBoolean(process.env.DB_SSL, true),
    sslRejectUnauthorized: toBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED, true),
    sslCaPath: process.env.DB_SSL_CA_PATH
      ? resolveFromBackend(process.env.DB_SSL_CA_PATH)
      : null
  }
};

module.exports = { env, toBoolean };
