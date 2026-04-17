import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { SourceTransactionRepo } from '../../infrastructure/db/repositories';
import { ReconciliationService } from '../../services/ReconciliationService';
import { TransactionEvent } from '../../domain/types';
import { logger } from '../../utils/logger';

const router = Router();

const BANK_WEBHOOK_SECRET = process.env.BANK_WEBHOOK_SECRET || 'bank-secret-dev';
const UPI_WEBHOOK_SECRET  = process.env.UPI_WEBHOOK_SECRET  || 'upi-secret-dev';

const verifySignature = (payload: string, signature: string, secret: string): boolean => {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch { return false; }
};

router.post('/bank', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const signature = req.headers['x-bank-signature'] as string;
    if (signature && !verifySignature(JSON.stringify(req.body), signature, BANK_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'Invalid signature', code: 'INVALID_SIGNATURE' });
    }
    const { transactionId, amount, status, referenceId, currency, metadata } = req.body;
    if (!transactionId || !amount || !status) {
      return res.status(400).json({ error: 'Missing required fields', code: 'VALIDATION_ERROR' });
    }
    logger.info('Bank webhook received', { transactionId, amount, status });
    await SourceTransactionRepo.upsert({
      eventId: uuid(), topic: 'bank-transactions', source: 'BANK',
      transactionId, amount: parseFloat(amount), currency: currency || 'INR',
      status, referenceId: referenceId || `BANK_WEBHOOK_${Date.now()}`,
      timestamp: new Date().toISOString(), metadata: metadata || {},
    });
    ReconciliationService.reconcileTransaction(transactionId, uuid())
      .then(r => logger.info('Bank webhook reconciled', { transactionId, ...r }))
      .catch(e => logger.error('Bank webhook recon failed', { error: e.message }));
    res.status(200).json({ received: true, transactionId, message: 'Bank webhook received' });
  } catch (e) { next(e); }
});

router.post('/upi', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const signature = req.headers['x-upi-signature'] as string;
    if (signature && !verifySignature(JSON.stringify(req.body), signature, UPI_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'Invalid signature', code: 'INVALID_SIGNATURE' });
    }
    const { transactionId, amount, status, upiReferenceId, currency, metadata } = req.body;
    if (!transactionId || !amount || !status) {
      return res.status(400).json({ error: 'Missing required fields', code: 'VALIDATION_ERROR' });
    }
    logger.info('UPI webhook received', { transactionId, amount, status });
    await SourceTransactionRepo.upsert({
      eventId: uuid(), topic: 'upi-transactions', source: 'UPI_SWITCH',
      transactionId, amount: parseFloat(amount), currency: currency || 'INR',
      status, referenceId: upiReferenceId || `UPI_WEBHOOK_${Date.now()}`,
      timestamp: new Date().toISOString(), metadata: metadata || {},
    });
    ReconciliationService.reconcileTransaction(transactionId, uuid())
      .then(r => logger.info('UPI webhook reconciled', { transactionId, ...r }))
      .catch(e => logger.error('UPI webhook recon failed', { error: e.message }));
    res.status(200).json({ received: true, transactionId, message: 'UPI webhook received' });
  } catch (e) { next(e); }
});

router.post('/app', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transactionId, amount, status, referenceId, currency, metadata } = req.body;
    if (!transactionId || !amount || !status) {
      return res.status(400).json({ error: 'Missing required fields', code: 'VALIDATION_ERROR' });
    }
    logger.info('App webhook received', { transactionId, amount, status });
    await SourceTransactionRepo.upsert({
      eventId: uuid(), topic: 'app-transactions', source: 'APP',
      transactionId, amount: parseFloat(amount), currency: currency || 'INR',
      status, referenceId: referenceId || `APP_WEBHOOK_${Date.now()}`,
      timestamp: new Date().toISOString(), metadata: metadata || {},
    });
    ReconciliationService.reconcileTransaction(transactionId, uuid())
      .then(r => logger.info('App webhook reconciled', { transactionId, ...r }))
      .catch(e => logger.error('App webhook recon failed', { error: e.message }));
    res.status(200).json({ received: true, transactionId });
  } catch (e) { next(e); }
});

router.get('/test', (_req: Request, res: Response) => {
  res.json({
    description: 'Webhook endpoints for bank and UPI callbacks',
    endpoints: {
      bank: { method: 'POST', url: '/webhooks/bank', body: { transactionId: 'TXN_YOUR_ID', amount: 500, status: 'SUCCESS' } },
      upi:  { method: 'POST', url: '/webhooks/upi',  body: { transactionId: 'TXN_YOUR_ID', amount: 500, status: 'PENDING' } },
      app:  { method: 'POST', url: '/webhooks/app',  body: { transactionId: 'TXN_YOUR_ID', amount: 500, status: 'SUCCESS' } },
    },
    mismatchScenarios: {
      statusMismatch: 'Send app=SUCCESS, then bank=PENDING for same transactionId',
      amountMismatch: 'Send app=500, then bank=495 for same transactionId',
      missingInBank:  'Only POST to /webhooks/app, skip /webhooks/bank',
    },
  });
});

export { router as webhookRoutes };