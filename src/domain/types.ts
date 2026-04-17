// ============================================================
// Pure domain types — zero side effects
// ============================================================

export type TransactionSource = 'APP' | 'BANK' | 'UPI_SWITCH';
export type TransactionStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REVERSED';
export type MismatchType =
  | 'AMOUNT_MISMATCH'
  | 'STATUS_MISMATCH'
  | 'MISSING_IN_BANK'
  | 'MISSING_IN_UPI'
  | 'DUPLICATE_CHARGE';

export type ResolutionStatus =
  | 'PENDING'
  | 'AUTO_RESOLVED'
  | 'MANUALLY_RESOLVED'
  | 'UNRESOLVABLE';

export interface SourceTransaction {
  readonly id:               string;
  readonly transactionId:    string;
  readonly source:           TransactionSource;
  readonly amount:           number;
  readonly currency:         string;
  readonly status:           TransactionStatus;
  readonly referenceId?:     string;
  readonly metadata:         Record<string, unknown>;
  readonly sourceTimestamp:  Date;
  readonly ingestedAt:       Date;
}

export interface CanonicalTransaction {
  readonly id:            string;
  readonly transactionId: string;
  readonly appAmount?:    number;
  readonly appStatus?:    TransactionStatus;
  readonly bankAmount?:   number;
  readonly bankStatus?:   TransactionStatus;
  readonly upiAmount?:    number;
  readonly upiStatus?:    TransactionStatus;
  readonly isReconciled:  boolean;
  readonly lastReconciledAt?: Date;
  readonly createdAt:     Date;
  readonly updatedAt:     Date;
}

export interface Mismatch {
  readonly id:               string;
  readonly transactionId:    string;
  readonly mismatchType:     MismatchType;
  readonly sourceA?:         TransactionSource;
  readonly sourceB?:         TransactionSource;
  readonly valueA?:          string;
  readonly valueB?:          string;
  readonly resolutionStatus: ResolutionStatus;
  readonly detectedAt:       Date;
  readonly resolvedAt?:      Date;
  readonly runId?:           string;
}

export interface Resolution {
  readonly id:            string;
  readonly mismatchId:    string;
  readonly transactionId: string;
  readonly actionTaken:   string;
  readonly reason:        string;
  readonly resolvedBy:    string;
  readonly metadata:      Record<string, unknown>;
  readonly createdAt:     Date;
}

// Kafka-compatible event envelope
export interface TransactionEvent {
  readonly eventId:       string;
  readonly topic:         string;
  readonly source:        TransactionSource;
  readonly transactionId: string;
  readonly amount:        number;
  readonly currency:      string;
  readonly status:        TransactionStatus;
  readonly referenceId?:  string;
  readonly timestamp:     string;
  readonly metadata?:     Record<string, unknown>;
}
