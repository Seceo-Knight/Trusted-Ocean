'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const config = require('./config');
const db = require('./db');
const { startScheduler } = require('./collectors');
const routes = require('./routes');
const trustRoutes = require('./routes-trust');
const { loadSigningKey } = require('./trust/pqc');

const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"], // Material UI injects component styles
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'", 'data:'],
      'worker-src': ["'self'", 'blob:'], // the map renders in a web worker
      'child-src': ['blob:'],
      'connect-src': ["'self'"],
      // plain HTTP for now (dev and LAN); re-enable when HTTPS is set up in deployment
      'upgrade-insecure-requests': null,
    },
  },
}));
app.use(compression());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '100kb' }));

app.use('/api/v1/trust', trustRoutes);
app.use('/api/v1', routes);

// Production: serve the built dashboard (frontend/dist) from the same server.
const dist = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist, { index: 'index.html', maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  console.log(`[web] serving dashboard from ${dist}`);
}

app.use((req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

async function main() {
  console.log(`[db] connecting to ${config.db.host}:${config.db.port}/${config.db.name}`);
  await db.waitForDb();
  await db.migrate();
  console.log('[db] ready');
  const key = await loadSigningKey();
  console.log(`[trust] signing with ${key.alg} key ${key.keyId}`);
  app.listen(config.port, config.host, () => {
    console.log(`Trusted Ocean API on http://${config.host}:${config.port}`);
    startScheduler();
  });
}

main().catch((err) => {
  console.error(`[startup] ${err.message}`);
  process.exit(1);
});
