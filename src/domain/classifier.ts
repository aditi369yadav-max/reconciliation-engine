// ============================================================
// Mismatch Classifier — PURE FUNCTIONS ONLY
//
// This is the TypeScript implementation that mirrors the
// Haskell module in /haskell/Classifier.hs
//
// Every function:
//   1. Takes inputs
//   2. Returns outputs
//   3. Has ZERO side effects
//   4. Is referentially transparent
// ============================================================

import {
  CanonicalTransaction,
  Mismatch,
  MismatchType,
  TransactionSource,
} from './types';

// Result type — Either pattern from Haskell
export type ClassifierResult =
  | { readonly kind: 'mismatch'; readonly mismatch: Omit<Mismatch, 'id' | 'detectedAt' | 'runId'> }
  | { readonly kind: 'clean' };

const mismatch = (
  transactionId: string,
  mismatchType: MismatchType,
  sourceA?: TransactionSource,
  sourceB?: TransactionSource,
  valueA?: string,
  valueB?: string
): ClassifierResult => ({
  kind: 'mismatch',
  mismatch: {
    transactionId,
    mismatchType,
    sourceA,
    sourceB,
    valueA,
    valueB,
    resolutionStatus: 'PENDING',
    resolvedAt: undefined,
  },
});

const clean = (): ClassifierResult => ({ kind: 'clean' });

// ============================================================
// Pure: classify amount mismatch between two sources
// ============================================================
export const classifyAmountMismatch = (
  txn: CanonicalTransaction,
  sourceA: TransactionSource,
  amountA: number,
  sourceB: TransactionSource,
  amountB: number
): ClassifierResult => {
  const tolerance = 0.01; // 1 paisa tolerance for float precision
  if (Math.abs(amountA - amountB) > tolerance) {
    return mismatch(
      txn.transactionId,
      'AMOUNT_MISMATCH',
      sourceA, sourceB,
      String(amountA), String(amountB)
    );
  }
  return clean();
};

// ============================================================
// Pure: classify status mismatch between two sources
// ============================================================
export const classifyStatusMismatch = (
  txn: CanonicalTransaction,
  sourceA: TransactionSource,
  statusA: string,
  sourceB: TransactionSource,
  statusB: string
): ClassifierResult => {
  if (statusA !== statusB) {
    return mismatch(
      txn.transactionId,
      'STATUS_MISMATCH',
      sourceA, sourceB,
      statusA, statusB
    );
  }
  return clean();
};

// ============================================================
// Pure: classify missing transaction in bank
// ============================================================
export const classifyMissingInBank = (
  txn: CanonicalTransaction
): ClassifierResult => {
  if (txn.appStatus && !txn.bankStatus) {
    return mismatch(
      txn.transactionId,
      'MISSING_IN_BANK',
      'APP', 'BANK',
      txn.appStatus, 'NOT_FOUND'
    );
  }
  return clean();
};

// ============================================================
// Pure: classify missing transaction in UPI
// ============================================================
export const classifyMissingInUPI = (
  txn: CanonicalTransaction
): ClassifierResult => {
  if (txn.appStatus && !txn.upiStatus) {
    return mismatch(
      txn.transactionId,
      'MISSING_IN_UPI',
      'APP', 'UPI_SWITCH',
      txn.appStatus, 'NOT_FOUND'
    );
  }
  return clean();
};

// ============================================================
// Pure: run all classifiers against a canonical transaction
// Returns array of all detected mismatches
// ============================================================
export const classifyTransaction = (
  txn: CanonicalTransaction
): ClassifierResult[] => {
  const results: ClassifierResult[] = [];

  // Amount checks
  if (txn.appAmount && txn.bankAmount) {
    results.push(classifyAmountMismatch(txn, 'APP', txn.appAmount, 'BANK', txn.bankAmount));
  }
  if (txn.appAmount && txn.upiAmount) {
    results.push(classifyAmountMismatch(txn, 'APP', txn.appAmount, 'UPI_SWITCH', txn.upiAmount));
  }

  // Status checks
  if (txn.appStatus && txn.bankStatus) {
    results.push(classifyStatusMismatch(txn, 'APP', txn.appStatus, 'BANK', txn.bankStatus));
  }
  if (txn.appStatus && txn.upiStatus) {
    results.push(classifyStatusMismatch(txn, 'APP', txn.appStatus, 'UPI_SWITCH', txn.upiStatus));
  }

  // Missing checks
  results.push(classifyMissingInBank(txn));
  results.push(classifyMissingInUPI(txn));

  // Return only actual mismatches
  return results.filter(r => r.kind === 'mismatch');
};

// ============================================================
// Pure: determine auto-resolution action for a mismatch
// ============================================================
export type ResolutionAction =
  | { readonly action: 'CALL_BANK_API';    readonly reason: string }
  | { readonly action: 'MARK_RECONCILED';  readonly reason: string }
  | { readonly action: 'FLAG_FOR_MANUAL';  readonly reason: string }
  | { readonly action: 'REVERSE_CHARGE';   readonly reason: string };

export const determineResolutionAction = (
  mismatchType: MismatchType,
  appStatus?: string,
  bankStatus?: string,
  ageMinutes?: number
): ResolutionAction => {
  switch (mismatchType) {
    case 'STATUS_MISMATCH':
      if (appStatus === 'SUCCESS' && bankStatus === 'PENDING') {
        if ((ageMinutes ?? 0) > 10) {
          return { action: 'CALL_BANK_API', reason: 'App shows SUCCESS but bank PENDING for >10 min' };
        }
        return { action: 'FLAG_FOR_MANUAL', reason: 'App SUCCESS, bank PENDING — waiting for bank confirmation' };
      }
      if (appStatus === 'SUCCESS' && bankStatus === 'FAILED') {
        return { action: 'REVERSE_CHARGE', reason: 'App shows SUCCESS but bank FAILED — potential double charge' };
      }
      return { action: 'FLAG_FOR_MANUAL', reason: `Unhandled status mismatch: ${appStatus} vs ${bankStatus}` };

    case 'AMOUNT_MISMATCH':
      return { action: 'FLAG_FOR_MANUAL', reason: 'Amount mismatch requires human verification' };

    case 'MISSING_IN_BANK':
      if ((ageMinutes ?? 0) > 30) {
        return { action: 'CALL_BANK_API', reason: 'Transaction missing in bank for >30 min' };
      }
      return { action: 'FLAG_FOR_MANUAL', reason: 'Transaction not yet reflected in bank' };

    case 'MISSING_IN_UPI':
      return { action: 'CALL_BANK_API', reason: 'Transaction missing in UPI switch — verify with NPCI' };

    case 'DUPLICATE_CHARGE':
      return { action: 'REVERSE_CHARGE', reason: 'Duplicate charge detected — initiating reversal' };

    default:
      return { action: 'FLAG_FOR_MANUAL', reason: 'Unknown mismatch type' };
  }
};

// ============================================================
// Pure: compute mismatch statistics from array
// ============================================================
export interface MismatchStats {
  readonly total:           number;
  readonly byType:          Record<MismatchType, number>;
  readonly autoResolved:    number;
  readonly manualPending:   number;
  readonly unresolvable:    number;
  readonly resolutionRate:  number;
}

export const computeMismatchStats = (mismatches: Mismatch[]): MismatchStats => {
  const byType = mismatches.reduce((acc, m) => {
    acc[m.mismatchType] = (acc[m.mismatchType] ?? 0) + 1;
    return acc;
  }, {} as Record<MismatchType, number>);

  const autoResolved  = mismatches.filter(m => m.resolutionStatus === 'AUTO_RESOLVED').length;
  const manualPending = mismatches.filter(m => m.resolutionStatus === 'PENDING').length;
  const unresolvable  = mismatches.filter(m => m.resolutionStatus === 'UNRESOLVABLE').length;
  const total         = mismatches.length;

  return {
    total,
    byType,
    autoResolved,
    manualPending,
    unresolvable,
    resolutionRate: total > 0 ? (autoResolved / total) * 100 : 100,
  };
};
