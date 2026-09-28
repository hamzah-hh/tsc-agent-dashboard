import express from 'express';
import path from 'path';
import { loadEnv } from './server-env';
import { createApiApp } from './server-routes';
import { ensureSeedData } from './server-import';

loadEnv();

const app = express();
app.disable('x-powered-by');
const port = process.env.PORT || 3000;

// The whole /api/* interface lives in server-routes.ts (also used by the development server).
app.use(createApiApp());

// In production, serve Vite built static assets
const distPath = path.resolve(process.cwd(), 'dist');
app.use(express.static(distPath));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

// Initialize seed data on startup. A failure here is logged, not fatal: every request retries it,
// and /api/health shows the reason.
ensureSeedData()
  .then(() => {
    console.log('Seed data checked and ready.');
  })
  .catch((err) => {
    console.error('Error ensuring seed data:', err?.message || err);
  });

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
