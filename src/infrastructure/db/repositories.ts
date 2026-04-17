import { v4 as uuid } from 'uuid';
import { SourceTransaction, CanonicalTransaction, TransactionEvent } from '../../domain/types';
import { query, queryOne, withTransaction, getPool } from './postgres';
import { PoolClient } from 'pg';

const mapSource = (r: any): SourceTransaction => ({
  id: r.id, transactionId: r.transaction_id, source: r.source,
  amount: parseFloat(r.amount), currency: r.currency, status: r.status,
  referenceId: r.reference_id, metadata: r.metadata ?? {},
  sourceTimestamp: r.source_timestamp, ingestedAt: r.ingested_at,
});

const mapCanonical = (r: any): CanonicalTransaction => ({
  id: r.id, transactionId: r.transaction_id,
  appAmount:  r.app_amount  ? parseFloat(r.app_amount)  : undefined,
  appStatus:  r.app_status  ?? undefined,
  bankAmount: r.bank_amount ? parseFloat(r.bank_amount) : undefined,
  bankStatus: r.bank_status ?? undefined,
  upiAmount:  r.upi_amount  ? parseFloat(r.upi_amount)  : undefined,
  upiStatus:  r.upi_status  ?? undefined,
  isReconciled: r.is_reconciled,
  lastReconciledAt: r.last_reconciled_at,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export const SourceTransactionRepo = {
  async upsert(event: TransactionEvent): Promise<SourceTransaction> {
    const row = await queryOne<any>(`
      INSERT INTO source_transactions
        (id, transaction_id, source, amount, currency, status, reference_id, metadata, source_timestamp)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (transaction_id, source) DO UPDATE SET
        amount = EXCLUDED.amount, status = EXCLUDED.status,
        reference_id = EXCLUDED.reference_id, metadata = EXCLUDED.metadata
      RETURNING *`,
      [uuid(), event.transactionId, event.source, event.amount, event.currency,
       event.status, event.referenceId ?? null, JSON.stringify(event.metadata ?? {}),
       event.timestamp]
    );
    return mapSource(row);
  },

  async findByTransactionId(txnId: string): Promise<SourceTransaction[]> {
    const rows = await query<any>(
      'SELECT * FROM source_transactions WHERE transaction_id = $1', [txnId]
    );
    return rows.map(mapSource);
  },

  async findUnreconciled(): Promise<string[]> {
    const rows = await query<any>(`
      SELECT DISTINCT transaction_id FROM source_transactions
      WHERE transaction_id NOT IN (
        SELECT transaction_id FROM canonical_transactions WHERE is_reconciled = TRUE
      )
      LIMIT 100
    `);
    return rows.map(r => r.transaction_id);
  },
};

export const CanonicalRepo = {
  async upsert(txnId: string, sources: SourceTransaction[]): Promise<CanonicalTransaction> {
    const app  = sources.find(s => s.source === 'APP');
    const bank = sources.find(s => s.source === 'BANK');
    const upi  = sources.find(s => s.source === 'UPI_SWITCH');

    const row = await queryOne<any>(`
      INSERT INTO canonical_transactions
        (id, transaction_id, app_amount, app_status, bank_amount, bank_status, upi_amount, upi_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (transaction_id) DO UPDATE SET
        app_amount  = COALESCE(EXCLUDED.app_amount,  canonical_transactions.app_amount),
        app_status  = COALESCE(EXCLUDED.app_status,  canonical_transactions.app_status),
        bank_amount = COALESCE(EXCLUDED.bank_amount, canonical_transactions.bank_amount),
        bank_status = COALESCE(EXCLUDED.bank_status, canonical_transactions.bank_status),
        upi_amount  = COALESCE(EXCLUDED.upi_amount,  canonical_transactions.upi_amount),
        upi_status  = COALESCE(EXCLUDED.upi_status,  canonical_transactions.upi_status),
        updated_at  = NOW()
      RETURNING *`,
      [uuid(), txnId,
       app?.amount ?? null,  app?.status ?? null,
       bank?.amount ?? null, bank?.status ?? null,
       upi?.amount ?? null,  upi?.status ?? null]
    );
    return mapCanonical(row);
  },

  async markReconciled(txnId: string): Promise<void> {
    await getPool().query(
      'UPDATE canonical_transactions SET is_reconciled=TRUE, last_reconciled_at=NOW() WHERE transaction_id=$1',
      [txnId]
    );
  },

  async findAll(limit = 50, offset = 0): Promise<CanonicalTransaction[]> {
    const rows = await query<any>(
      'SELECT * FROM canonical_transactions ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return rows.map(mapCanonical);
  },

  async findByTransactionId(txnId: string): Promise<CanonicalTransaction | null> {
    const row = await queryOne<any>(
      'SELECT * FROM canonical_transactions WHERE transaction_id=$1', [txnId]
    );
    return row ? mapCanonical(row) : null;
  },
};

export const MismatchRepo = {
  async create(m: any, runId: string): Promise<any> {
    return queryOne(`
      INSERT INTO mismatches
        (id, transaction_id, mismatch_type, source_a, source_b, value_a, value_b, run_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT DO NOTHING
      RETURNING *`,
      [uuid(), m.transactionId, m.mismatchType, m.sourceA ?? null,
       m.sourceB ?? null, m.valueA ?? null, m.valueB ?? null, runId]
    );
  },

  async resolve(id: string, status: string): Promise<void> {
    await getPool().query(
      'UPDATE mismatches SET resolution_status=$1, resolved_at=NOW() WHERE id=$2',
      [status, id]
    );
  },

  async findPending(): Promise<any[]> {
    return query(`
      SELECT m.*, EXTRACT(EPOCH FROM (NOW()-m.detected_at))/60 AS age_minutes
      FROM mismatches m
      WHERE m.resolution_status = 'PENDING'
      ORDER BY m.detected_at ASC
      LIMIT 50
    `);
  },

  async findAll(limit = 50, offset = 0): Promise<any[]> {
    return query(
      'SELECT * FROM mismatches ORDER BY detected_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
  },

  async getStats(): Promise<any> {
    const rows = await query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE resolution_status='AUTO_RESOLVED') as auto_resolved,
        COUNT(*) FILTER (WHERE resolution_status='PENDING') as pending,
        COUNT(*) FILTER (WHERE resolution_status='MANUALLY_RESOLVED') as manual_resolved,
        mismatch_type,
        DATE_TRUNC('hour', detected_at) as hour
      FROM mismatches
      WHERE detected_at > NOW() - INTERVAL '24 hours'
      GROUP BY mismatch_type, hour
      ORDER BY hour DESC
    `);
    return rows;
  },
};

export const ResolutionRepo = {
  async create(data: any): Promise<void> {
    await getPool().query(
      `INSERT INTO resolutions (id, mismatch_id, transaction_id, action_taken, reason, resolved_by, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uuid(), data.mismatchId, data.transactionId, data.actionTaken,
       data.reason, data.resolvedBy ?? 'system', JSON.stringify(data.metadata ?? {})]
    );
  },
};

export const AuditRepo = {
  async log(eventType: string, transactionId: string | null, payload: unknown): Promise<void> {
    await getPool().query(
      'INSERT INTO audit_log (id, event_type, transaction_id, payload) VALUES ($1,$2,$3,$4)',
      [uuid(), eventType, transactionId, JSON.stringify(payload)]
    );
  },

  async findByTransaction(txnId: string): Promise<any[]> {
    return query(
      'SELECT * FROM audit_log WHERE transaction_id=$1 ORDER BY created_at ASC',
      [txnId]
    );
  },
};

export const RunRepo = {
  async create(): Promise<string> {
    const row = await queryOne<any>(
      'INSERT INTO reconciliation_runs (id) VALUES ($1) RETURNING id', [uuid()]
    );
    return row.id;
  },

  async complete(id: string, stats: any): Promise<void> {
    await getPool().query(
      `UPDATE reconciliation_runs SET
         completed_at=NOW(), status='COMPLETED',
         transactions_processed=$1, mismatches_found=$2, auto_resolved=$3
       WHERE id=$4`,
      [stats.processed, stats.mismatches, stats.autoResolved, id]
    );
  },

  async findRecent(limit = 10): Promise<any[]> {
    return query(
      'SELECT * FROM reconciliation_runs ORDER BY started_at DESC LIMIT $1', [limit]
    );
  },
};
