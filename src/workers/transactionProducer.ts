import { v4 as uuid } from 'uuid';
import { config } from '../config';
import { logger } from '../utils/logger';
import { publishEvent, TOPICS } from '../infrastructure/queue/queues';
import { TransactionEvent, TransactionStatus } from '../domain/types';

// ============================================================
// Transaction Producer
// Simulates 3 independent payment systems publishing events
// ============================================================

const randomStatus = (): TransactionStatus => {
  const r = Math.random();
  if (r < 0.7)  return 'SUCCESS';
  if (r < 0.85) return 'PENDING';
  if (r < 0.95) return 'FAILED';
  return 'REVERSED';
};

const injectMismatch = (
  status: TransactionStatus,
  amount: number,
  mismatchRate: number
): { status: TransactionStatus; amount: number } => {
  if (Math.random() > mismatchRate) return { status, amount };

  const r = Math.random();
  if (r < 0.3) {
    // Status mismatch
    const statuses: TransactionStatus[] = ['PENDING', 'SUCCESS', 'FAILED'];
    const different = statuses.filter(s => s !== status);
    return { status: different[Math.floor(Math.random() * different.length)], amount };
  }
  if (r < 0.6) {
    // Amount mismatch — slightly different amount
    return { status, amount: parseFloat((amount + (Math.random() * 10 - 5)).toFixed(2)) };
  }
  // Missing (return null-like — don't publish)
  return { status: 'PENDING', amount: 0 };
};

export const produceTransaction = async (): Promise<string> => {
  const transactionId = `TXN_${Date.now()}_${uuid().slice(0, 8).toUpperCase()}`;
  const amount        = parseFloat((Math.random() * 9900 + 100).toFixed(2));
  const currency      = 'INR';
  const appStatus     = randomStatus();

  // APP always publishes
  const appEvent: TransactionEvent = {
    eventId:       uuid(),
    topic:         TOPICS.APP_TRANSACTIONS,
    source:        'APP',
    transactionId,
    amount,
    currency,
    status:        appStatus,
    referenceId:   `APP_REF_${Date.now()}`,
    timestamp:     new Date().toISOString(),
  };
  await publishEvent('APP_TRANSACTIONS', appEvent);

  // BANK publishes with possible mismatch
  const bankMismatch = injectMismatch(appStatus, amount, config.sim.bankMismatchRate);
  if (bankMismatch.amount > 0) {
    const bankEvent: TransactionEvent = {
      eventId:       uuid(),
      topic:         TOPICS.BANK_TRANSACTIONS,
      source:        'BANK',
      transactionId,
      amount:        bankMismatch.amount,
      currency,
      status:        bankMismatch.status,
      referenceId:   `BANK_REF_${Date.now()}`,
      timestamp:     new Date().toISOString(),
    };
    await publishEvent('BANK_TRANSACTIONS', bankEvent);
  }

  // UPI publishes with possible mismatch
  const upiMismatch = injectMismatch(appStatus, amount, config.sim.upiMismatchRate);
  if (upiMismatch.amount > 0) {
    const upiEvent: TransactionEvent = {
      eventId:       uuid(),
      topic:         TOPICS.UPI_TRANSACTIONS,
      source:        'UPI_SWITCH',
      transactionId,
      amount:        upiMismatch.amount,
      currency,
      status:        upiMismatch.status,
      referenceId:   `UPI_REF_${Date.now()}`,
      timestamp:     new Date().toISOString(),
    };
    await publishEvent('UPI_TRANSACTIONS', upiEvent);
  }

  logger.info('Transaction produced', { transactionId, amount, appStatus });
  return transactionId;
};

// Run as standalone producer
const runProducer = async (): Promise<void> => {
  logger.info('Transaction producer started', {
    interval: config.sim.producerIntervalMs,
    bankMismatchRate: config.sim.bankMismatchRate,
    upiMismatchRate: config.sim.upiMismatchRate,
  });

  // Produce initial batch
  for (let i = 0; i < 10; i++) {
    await produceTransaction();
    await new Promise(r => setTimeout(r, 200));
  }

  // Continue producing at interval
  setInterval(async () => {
    try {
      await produceTransaction();
    } catch (e: any) {
      logger.error('Producer error', { error: e.message });
    }
  }, config.sim.producerIntervalMs);
};

if (require.main === module) {
  runProducer().catch(console.error);
}

export { runProducer };
