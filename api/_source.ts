import express from 'express';
import { createApiApp } from '../server-routes';
import { ensureSeedData } from '../server-import';
import { loadEnv } from '../server-env';

loadEnv();

const app = express();
app.disable('x-powered-by');
app.use(createApiApp());

ensureSeedData().catch((err) => {
  console.error('Error ensuring seed data on cold start:', err);
});

export default app;
