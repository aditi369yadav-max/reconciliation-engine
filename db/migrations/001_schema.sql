-- ============================================================
-- Reconciliation Engine — Complete Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Source systems
CREATE TYPE transaction_source AS ENUM ('APP', 'BANK', 'UPI_SWITCH');
CREATE TYPE transaction_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REVERSED');
CREATE TYPE mismatch_type     AS ENUM ('AMOUNT_MISMATCH', 'STATUS_MISMATCH', 'MISSING_IN_BANK', 'MISSING_IN_UPI', 'DUPLICATE_CHARGE');
CREATE TYPE resolution_status AS ENUM ('PENDING', 'AUTO_RESOLVED', 'MANUALLY_RESOLVED', 'UNRESOLVABLE');

-- ============================================================
-- Raw transactions from each source
-- ============================================================
CREATE TABLE IF NOT EXISTS source_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  VARCHAR(255) NOT NULL,
  source          transaction_source NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  currency        VARCHAR(3) NOT NULL DEFAULT 'INR',
  status          transaction_status NOT NULL,
  reference_id    VARCHAR(255),
  metadata        JSONB DEFAULT '{}',
  source_timestamp TIMESTAMPTZ NOT NULL,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(transaction_id, source)
);

CREATE INDEX idx_src_txn_id     ON source_transactions(transaction_id);
CREATE INDEX idx_src_source     ON source_transactions(source);
CREATE INDEX idx_src_ingested   ON source_transactions(ingested_at DESC);

-- ============================================================
-- Canonical transaction — our source of truth
-- ============================================================
CREATE TABLE IF NOT EXISTS canonical_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  VARCHAR(255) UNIQUE NOT NULL,
  app_amount      NUMERIC(12,2),
  app_status      transaction_status,
  bank_amount     NUMERIC(12,2),
  bank_status     transaction_status,
  upi_amount      NUMERIC(12,2),
  upi_status      transaction_status,
  is_reconciled   BOOLEAN NOT NULL DEFAULT FALSE,
  last_reconciled_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_canonical_txn_id    ON canonical_transactions(transaction_id);
CREATE INDEX idx_canonical_reconciled ON canonical_transactions(is_reconciled);

-- ============================================================
-- Reconciliation runs
-- ============================================================
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  transactions_processed INTEGER NOT NULL DEFAULT 0,
  mismatches_found       INTEGER NOT NULL DEFAULT 0,
  auto_resolved          INTEGER NOT NULL DEFAULT 0,
  status          VARCHAR(50) NOT NULL DEFAULT 'RUNNING',
  error           TEXT
);

-- ============================================================
-- Detected mismatches
-- ============================================================
CREATE TABLE IF NOT EXISTS mismatches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  VARCHAR(255) NOT NULL,
  mismatch_type   mismatch_type NOT NULL,
  source_a        transaction_source,
  source_b        transaction_source,
  value_a         TEXT,
  value_b         TEXT,
  resolution_status resolution_status NOT NULL DEFAULT 'PENDING',
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  run_id          UUID REFERENCES reconciliation_runs(id)
);

CREATE INDEX idx_mismatches_txn_id   ON mismatches(transaction_id);
CREATE INDEX idx_mismatches_type     ON mismatches(mismatch_type);
CREATE INDEX idx_mismatches_status   ON mismatches(resolution_status);
CREATE INDEX idx_mismatches_detected ON mismatches(detected_at DESC);

-- ============================================================
-- Resolution log
-- ============================================================
CREATE TABLE IF NOT EXISTS resolutions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mismatch_id     UUID NOT NULL REFERENCES mismatches(id),
  transaction_id  VARCHAR(255) NOT NULL,
  action_taken    TEXT NOT NULL,
  reason          TEXT NOT NULL,
  resolved_by     VARCHAR(100) NOT NULL DEFAULT 'system',
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resolutions_mismatch ON resolutions(mismatch_id);
CREATE INDEX idx_resolutions_txn      ON resolutions(transaction_id);

-- ============================================================
-- Immutable audit log
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      VARCHAR(100) NOT NULL,
  transaction_id  VARCHAR(255),
  actor           VARCHAR(100) NOT NULL DEFAULT 'system',
  payload         JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_txn_id    ON audit_log(transaction_id);
CREATE INDEX idx_audit_event     ON audit_log(event_type);
CREATE INDEX idx_audit_created   ON audit_log(created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER canonical_updated_at
  BEFORE UPDATE ON canonical_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
