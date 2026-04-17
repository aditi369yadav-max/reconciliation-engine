import { Router, Request, Response, NextFunction } from 'express';
import { CanonicalRepo, MismatchRepo, RunRepo, AuditRepo } from '../../infrastructure/db/repositories';
import { ReconciliationService } from '../../services/ReconciliationService';
import { computeMismatchStats } from '../../domain/classifier';
import { produceTransaction } from '../../workers/transactionProducer';

const router = Router();

// GET /api/transactions
router.get('/transactions', async (req, res, next) => {
  try {
    const limit  = parseInt(req.query.limit as string ?? '20');
    const offset = parseInt(req.query.offset as string ?? '0');
    const data   = await CanonicalRepo.findAll(limit, offset);
    res.json({ success: true, data, count: data.length });
  } catch (e) { next(e); }
});

// GET /api/transactions/:id
router.get('/transactions/:id', async (req, res, next) => {
  try {
    const txn = await CanonicalRepo.findByTransactionId(req.params.id);
    if (!txn) return res.status(404).json({ error: 'Not found' });
    const audit = await AuditRepo.findByTransaction(req.params.id);
    res.json({ success: true, data: txn, auditLog: audit });
  } catch (e) { next(e); }
});

// GET /api/mismatches
router.get('/mismatches', async (req, res, next) => {
  try {
    const limit  = parseInt(req.query.limit as string ?? '20');
    const offset = parseInt(req.query.offset as string ?? '0');
    const data   = await MismatchRepo.findAll(limit, offset);
    res.json({ success: true, data, count: data.length });
  } catch (e) { next(e); }
});

// GET /api/analytics
router.get('/analytics', async (req, res, next) => {
  try {
    const stats = await MismatchRepo.getStats();
    res.json({ success: true, data: stats });
  } catch (e) { next(e); }
});

// GET /api/runs
router.get('/runs', async (req, res, next) => {
  try {
    const runs = await RunRepo.findRecent(10);
    res.json({ success: true, data: runs });
  } catch (e) { next(e); }
});

// POST /api/reconcile — trigger manually
router.post('/reconcile', async (req, res, next) => {
  try {
    const result = await ReconciliationService.runCycle();
    res.json({ success: true, result });
  } catch (e) { next(e); }
});

// POST /api/simulate — produce test transactions
router.post('/simulate', async (req, res, next) => {
  try {
    const count = parseInt(req.body.count ?? '5');
    const ids: string[] = [];
    for (let i = 0; i < Math.min(count, 20); i++) {
      const id = await produceTransaction();
      ids.push(id);
      await new Promise(r => setTimeout(r, 100));
    }
    res.json({
      success: true,
      message: `Produced ${ids.length} transactions. Run POST /api/reconcile to reconcile.`,
      transactionIds: ids,
    });
  } catch (e) { next(e); }
});

export { router as apiRoutes };
