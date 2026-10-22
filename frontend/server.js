const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 5500);
const root = __dirname;
const API_TARGET_HOST = '127.0.0.1';
const API_TARGET_PORT = 3001;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon'
};

const ROUTE_MAP = new Map([
  ['/', 'login.html'],
  ['/login.html', 'login.html'],
  ['/dashboard.html', 'dashboard.html'],
  ['/equipamentos.html', 'equipamentos.html'],
  ['/monitor_engeasier-limite.html', 'monitor_engeasier-limite.html'],
  ['/js/stma-api.js', path.join('js', 'stma-api.js')]
]);

function setNoCacheHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Connection', 'close');
}

function sendFileBuffer(res, relativePath) {
  const absolutePath = path.join(root, relativePath);

  if (!absolutePath.startsWith(root)) {
    res.status(403).type('text/plain; charset=utf-8').send('Acesso negado.');
    return;
  }

  fs.readFile(absolutePath, (error, buffer) => {
    if (error) {
      const status = error.code === 'ENOENT' ? 404 : 500;
      res.status(status);
      setNoCacheHeaders(res);
      res.type('text/plain; charset=utf-8');
      const message = status === 404 ? 'Arquivo não encontrado.' : 'Erro ao carregar arquivo.';
      res.setHeader('Content-Length', Buffer.byteLength(message, 'utf8'));
      res.end(message);
      return;
    }

    const ext = path.extname(absolutePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.status(200);
    setNoCacheHeaders(res);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  });
}

app.disable('etag');

app.use('/api', (req, res) => {
  const targetPath = req.originalUrl;
  const proxy = http.request({
    host: API_TARGET_HOST,
    port: API_TARGET_PORT,
    path: targetPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: `${API_TARGET_HOST}:${API_TARGET_PORT}`
    }
  }, (proxyRes) => {
    res.status(proxyRes.statusCode || 502);

    Object.entries(proxyRes.headers).forEach(([key, value]) => {
      if (value !== undefined) {
        res.setHeader(key, value);
      }
    });

    proxyRes.pipe(res);
  });

  proxy.on('error', () => {
    const message = 'Não foi possível encaminhar a requisição para o backend.';
    res.status(502);
    setNoCacheHeaders(res);
    res.type('text/plain; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(message, 'utf8'));
    res.end(message);
  });

  req.pipe(proxy);
});

app.use((req, res) => {
  const pathname = req.path || '/';
  const mapped = ROUTE_MAP.get(pathname);

  if (!mapped) {
    res.status(404);
    setNoCacheHeaders(res);
    res.type('text/plain; charset=utf-8');
    const message = 'Rota não encontrada.';
    res.setHeader('Content-Length', Buffer.byteLength(message, 'utf8'));
    res.end(message);
    return;
  }

  sendFileBuffer(res, mapped);
});

app.listen(PORT, () => {
  console.log(`Frontend STMA disponível em http://127.0.0.1:${PORT}`);
});
