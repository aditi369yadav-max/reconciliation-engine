import { Queue, Worker, Job } from 'bullmq';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { TransactionEvent } from '../../domain/types';

const connection = { host: config.redis.host, port: config.redis.port };

// ============================================================
// Kafka-compatible Queue Interface
//
// These queues mirror Kafka topics:
//   app-transactions    → topic: app.transactions
//   bank-transactions   → topic: bank.transactions
//   upi-transactions    → topic: upi.transactions
//   reconciliation-jobs → topic: reconciliation.jobs
//
// Swapping to real Kafka = replace Queue/Worker with
// KafkaProducer/KafkaConsumer. Business logic unchanged.
// ============================================================

export const TOPICS = {
  APP_TRANSACTIONS:   'app-transactions',
  BANK_TRANSACTIONS:  'bank-transactions',
  UPI_TRANSACTIONS:   'upi-transactions',
  RECON_JOBS:         'reconciliation-jobs',
} as const;

// Producers (Kafka: producer.send)
export const appQueue  = new Queue(TOPICS.APP_TRANSACTIONS,  { connection });
export const bankQueue = new Queue(TOPICS.BANK_TRANSACTIONS, { connection });
export const upiQueue  = new Queue(TOPICS.UPI_TRANSACTIONS,  { connection });
export const reconQueue = new Queue(TOPICS.RECON_JOBS,       { connection });

export const publishEvent = async (
  topic: keyof typeof TOPICS,
  event: TransactionEvent
): Promise<void> => {
  const queues = {
    APP_TRANSACTIONS:  appQueue,
    BANK_TRANSACTIONS: bankQueue,
    UPI_TRANSACTIONS:  upiQueue,
    RECON_JOBS:        reconQueue,
  };
  await queues[topic].add(event.transactionId, event, {
    removeOnComplete: 1000,
    removeOnFail:     500,
  });
  logger.debug(`Published to ${topic}`, { transactionId: event.transactionId });
};

// Consumer factory (Kafka: consumer.subscribe + consumer.run)
export const createConsumer = (
  topic: string,
  handler: (event: TransactionEvent) => Promise<void>,
  concurrency = 5
): Worker => {
  const worker = new Worker(
    topic,
    async (job: Job) => {
      await handler(job.data as TransactionEvent);
    },
    { connection, concurrency }
  );

  worker.on('completed', (job) =>
    logger.debug(`Job completed: ${topic}`, { jobId: job.id })
  );
  worker.on('failed', (job, err) =>
    logger.error(`Job failed: ${topic}`, { jobId: job?.id, error: err.message })
  );

  logger.info(`Consumer started for topic: ${topic}`);
  return worker;
};
