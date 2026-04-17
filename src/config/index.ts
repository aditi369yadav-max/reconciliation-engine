import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env') });

const opt = (key: string, fallback: string) => process.env[key] ?? fallback;

export const config = {
  app:   { port: parseInt(opt('PORT', '4000')), env: opt('NODE_ENV', 'development') },
  db:    {
    host: opt('DB_HOST', 'localhost'), port: parseInt(opt('DB_PORT', '5432')),
    database: opt('DB_NAME', 'reconciliation_engine'),
    user: opt('DB_USER', 'postgres'), password: opt('DB_PASSWORD', 'postgres'),
    ssl: opt('NODE_ENV', 'development') === 'production',
  },
  redis: { host: opt('REDIS_HOST', 'localhost'), port: parseInt(opt('REDIS_PORT', '6379')) },
  recon: {
    intervalMs:          parseInt(opt('RECONCILIATION_INTERVAL_MS', '60000')),
    autoResolveMinutes:  parseInt(opt('MISMATCH_AUTO_RESOLVE_MINUTES', '10')),
    maxRetryAttempts:    parseInt(opt('MAX_RETRY_ATTEMPTS', '3')),
    retryBaseDelayMs:    parseInt(opt('RETRY_BASE_DELAY_MS', '1000')),
  },
  sim: {
    bankMismatchRate:    parseFloat(opt('BANK_MISMATCH_RATE', '0.2')),
    upiMismatchRate:     parseFloat(opt('UPI_MISMATCH_RATE', '0.15')),
    producerIntervalMs:  parseInt(opt('PRODUCER_INTERVAL_MS', '5000')),
  },
} as const;
