import { logger } from '../utils/logger';
import { classifyTransaction, determineResolutionAction } from '../domain/classifier';
import {
  SourceTransactionRepo, CanonicalRepo,
  MismatchRepo, ResolutionRepo, AuditRepo, RunRepo,
} from '../infrastructure/db/repositories';
import { config } from '../config';

// ============================================================
// ReconciliationService — orchestrates the full recon cycle
// ============================================================

export const ReconciliationService = {

  // ============================================================
  // Run a full reconciliation cycle
  // ============================================================
  async runCycle(): Promise<{ processed: number; mismatches: number; autoResolved: number }> {
    const runId = await RunRepo.create();
    logger.info('Reconciliation cycle started', { runId });

    let processed = 0, mismatches = 0, autoResolved = 0;

    try {
      const unreconciledIds = await SourceTransactionRepo.findUnreconciled();
      logger.info(`Found ${unreconciledIds.length} transactions to reconcile`);

      for (const txnId of unreconciledIds) {
        try {
          const result = await this.reconcileTransaction(txnId, runId);
          processed++;
          mismatches   += result.mismatches;
          autoResolved += result.autoResolved;
        } catch (e: any) {
          logger.error('Failed to reconcile transaction', { txnId, error: e.message });
        }
      }

      await RunRepo.complete(runId, { processed, mismatches, autoResolved });
      logger.info('Reconciliation cycle complete', { runId, processed, mismatches, autoResolved });
    } catch (e: any) {
      logger.error('Reconciliation cycle failed', { runId, error: e.message });
    }

    return { processed, mismatches, autoResolved };
  },

  // ============================================================
  // Reconcile a single transaction
  // ============================================================
  async reconcileTransaction(
    txnId: string,
    runId: string
  ): Promise<{ mismatches: number; autoResolved: number }> {

    // 1. Get all source records
    const sources = await SourceTransactionRepo.findByTransactionId(txnId);
    if (sources.length === 0) return { mismatches: 0, autoResolved: 0 };

    // 2. Build canonical view
    const canonical = await CanonicalRepo.upsert(txnId, sources);

    // 3. Classify mismatches using pure functions
    const classifierResults = classifyTransaction(canonical);
    const detectedMismatches = classifierResults.filter(r => r.kind === 'mismatch');

    await AuditRepo.log('RECONCILIATION_RUN', txnId, {
      runId, sourcesFound: sources.length, mismatchesFound: detectedMismatches.length,
    });

    if (detectedMismatches.length === 0) {
      await CanonicalRepo.markReconciled(txnId);
      await AuditRepo.log('TRANSACTION_RECONCILED', txnId, { runId, clean: true });
      return { mismatches: 0, autoResolved: 0 };
    }

    // 4. Store mismatches and attempt auto-resolution
    let autoResolved = 0;

    for (const result of detectedMismatches) {
      if (result.kind !== 'mismatch') continue;
      const m = result.mismatch;

      const saved = await MismatchRepo.create(m, runId);
      if (!saved) continue;

      await AuditRepo.log('MISMATCH_DETECTED', txnId, {
        mismatchId: saved.id, type: m.mismatchType,
        sourceA: m.sourceA, sourceB: m.sourceB,
        valueA: m.valueA, valueB: m.valueB,
      });

      // 5. Attempt auto-resolution using pure function
      const ageMinutes = sources[0]
        ? (Date.now() - new Date(sources[0].sourceTimestamp).getTime()) / 60000
        : 0;

      const resolution = determineResolutionAction(
        m.mismatchType,
        canonical.appStatus,
        canonical.bankStatus,
        ageMinutes
      );

      if (resolution.action !== 'FLAG_FOR_MANUAL') {
        await this.executeResolution(saved.id, txnId, resolution, canonical);
        autoResolved++;
      } else {
        await AuditRepo.log('MISMATCH_FLAGGED_MANUAL', txnId, {
          mismatchId: saved.id, reason: resolution.reason,
        });
      }
    }

    return { mismatches: detectedMismatches.length, autoResolved };
  },

  // ============================================================
  // Execute a resolution action
  // ============================================================
  async executeResolution(
    mismatchId: string,
    txnId: string,
    resolution: { action: string; reason: string },
    canonical: any
  ): Promise<void> {
    logger.info('Executing auto-resolution', { txnId, action: resolution.action, reason: resolution.reason });

    switch (resolution.action) {
      case 'CALL_BANK_API':
        // Simulate bank API call
        await new Promise(r => setTimeout(r, 100));
        await MismatchRepo.resolve(mismatchId, 'AUTO_RESOLVED');
        break;

      case 'MARK_RECONCILED':
        await MismatchRepo.resolve(mismatchId, 'AUTO_RESOLVED');
        await CanonicalRepo.markReconciled(txnId);
        break;

      case 'REVERSE_CHARGE':
        await MismatchRepo.resolve(mismatchId, 'AUTO_RESOLVED');
        break;

      default:
        await MismatchRepo.resolve(mismatchId, 'UNRESOLVABLE');
    }

    await ResolutionRepo.create({
      mismatchId, transactionId: txnId,
      actionTaken: resolution.action,
      reason: resolution.reason,
      resolvedBy: 'system',
      metadata: { canonical },
    });

    await AuditRepo.log('MISMATCH_RESOLVED', txnId, {
      mismatchId, action: resolution.action, reason: resolution.reason,
    });
  },

  // ============================================================
  // Process pending mismatches for auto-resolution
  // ============================================================
  async processPendingMismatches(): Promise<number> {
    const pending = await MismatchRepo.findPending();
    let resolved = 0;

    for (const m of pending) {
      const resolution = determineResolutionAction(
        m.mismatch_type, m.app_status, m.bank_status, m.age_minutes
      );

      if (resolution.action !== 'FLAG_FOR_MANUAL') {
        await this.executeResolution(m.id, m.transaction_id, resolution, {});
        resolved++;
      }
    }

    return resolved;
  },
};
