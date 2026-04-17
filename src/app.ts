import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env') });

import express from 'express';
import cors from 'cors';
import { config } from './config';
import { logger } from './utils/logger';
import { apiRoutes } from './api/routes/api.routes';
import { webhookRoutes } from './api/routes/webhook.routes';
import { getPool } from './infrastructure/db/postgres';
import { startWorkers } from './workers/reconciliationWorker';
import { runProducer } from './workers/transactionProducer';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    name:    'Distributed Transaction Reconciliation Engine',
    version: '1.0.0',
    status:  'running',
    endpoints: {
      health:       'GET  /health',
      transactions: 'GET  /api/transactions',
      mismatches:   'GET  /api/mismatches',
      analytics:    'GET  /api/analytics',
      runs:         'GET  /api/runs',
      reconcile:    'POST /api/reconcile',
      simulate:     'POST /api/simulate',
      webhooks: {
        bank:  'POST /webhooks/bank',
        upi:   'POST /webhooks/upi',
        app:   'POST /webhooks/app',
        test:  'GET  /webhooks/test',
      },
    },
  });
});

app.get('/health', async (_req, res) => {
  try {
    await getPool().query('SELECT 1');
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (e: any) {
    res.status(503).json({ status: 'unhealthy', error: e.message });
  }
});

app.use('/api', apiRoutes);
app.use('/webhooks', webhookRoutes);

app.use((err: any, _req: any, res: any, _next: any) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

const start = async () => {
  try {
    await getPool().query('SELECT NOW()');
    logger.info('PostgreSQL connected');

    startWorkers();
    logger.info('Workers started');

    if (config.app.env === 'development') {
      runProducer().catch(e => logger.error('Producer error', { error: e.message }));
    }

    app.listen(config.app.port, () => {
      logger.info(`Reconciliation Engine running on port ${config.app.port}`);
    });
  } catch (e: any) {
    logger.error('Startup failed', { error: e.message });
    process.exit(1);
  }
};

start();
export { app };