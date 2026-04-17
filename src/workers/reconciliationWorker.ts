import { createConsumer, TOPICS } from '../infrastructure/queue/queues';
import { SourceTransactionRepo } from '../infrastructure/db/repositories';
import { ReconciliationService } from '../services/ReconciliationService';
import { TransactionEvent } from '../domain/types';
import { logger } from '../utils/logger';
import { config } from '../config';

// ============================================================
// Reconciliation Worker
// Consumes events from all 3 source queues
// ============================================================

const handleTransactionEvent = async (event: TransactionEvent): Promise<void> => {
  logger.debug('Processing transaction event', {
    source: event.source, transactionId: event.transactionId,
  });

  await SourceTransactionRepo.upsert(event);

  // Queue a reconciliation job for this transaction
  logger.debug('Transaction ingested', { transactionId: event.transactionId, source: event.source });
};

export const startWorkers = (): void => {
  // Consume from all 3 source topics (mirrors Kafka consumer group)
  createConsumer(TOPICS.APP_TRANSACTIONS,  handleTransactionEvent);
  createConsumer(TOPICS.BANK_TRANSACTIONS, handleTransactionEvent);
  createConsumer(TOPICS.UPI_TRANSACTIONS,  handleTransactionEvent);

  logger.info('All queue consumers started');

  // Run reconciliation on schedule
  setInterval(async () => {
    try {
      logger.info('Starting scheduled reconciliation cycle');
      const result = await ReconciliationService.runCycle();
      logger.info('Reconciliation cycle complete', result);
    } catch (e: any) {
      logger.error('Scheduled reconciliation failed', { error: e.message });
    }
  }, config.recon.intervalMs);

  // Process pending mismatches every 2 minutes
  setInterval(async () => {
    try {
      const resolved = await ReconciliationService.processPendingMismatches();
      if (resolved > 0) logger.info(`Auto-resolved ${resolved} pending mismatches`);
    } catch (e: any) {
      logger.error('Pending mismatch processor failed', { error: e.message });
    }
  }, 120_000);

  logger.info('Reconciliation worker started', {
    reconInterval: config.recon.intervalMs,
  });
};
