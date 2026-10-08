import type { Plugin } from 'vite';
import { createApiApp } from './server-routes';
import { ensureSeedData } from './server-import';

/**
 * Development server: serves the same /api/* interface as the published server (server-routes.ts).
 * Only /api requests are handed to it; everything else stays with Vite.
 */
export function apiServerPlugin(): Plugin {
  return {
    name: 'api-server-plugin',
    configureServer(server) {
      // Initialize seed data on dev server start
      ensureSeedData().catch((err) => {
        console.error('Failed to initialize seed data in dev plugin:', err?.message || err);
      });

      const api = createApiApp();
      server.middlewares.use((req, res, next) => {
        if (!req.url || req.url === '/' || req.url.startsWith('/index.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
        if (req.url && req.url.startsWith('/api/')) {
          return api(req as any, res as any, next);
        }
        next();
      });
    },
  };
}
