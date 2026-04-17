-- ============================================================
-- Reconciliation Engine — Haskell Mismatch Classifier
--
-- Pure functional implementation of the mismatch detection
-- logic. This is the reference implementation — the TypeScript
-- classifier in src/domain/classifier.ts mirrors this exactly.
--
-- Compile: ghc -o classifier Classifier.hs
-- Run:     ./classifier
-- ============================================================

module Classifier where

import Data.List (intercalate)
import Data.Maybe (mapMaybe)

-- ============================================================
-- Domain Types — ADTs
-- ============================================================

data TransactionSource = APP | BANK | UPI_SWITCH
  deriving (Show, Eq)

data TransactionStatus = PENDING | SUCCESS | FAILED | REVERSED
  deriving (Show, Eq)

data MismatchType
  = AMOUNT_MISMATCH
  | STATUS_MISMATCH
  | MISSING_IN_BANK
  | MISSING_IN_UPI
  | DUPLICATE_CHARGE
  deriving (Show, Eq)

data ResolutionAction
  = CallBankAPI    String
  | MarkReconciled String
  | FlagForManual  String
  | ReverseCharge  String
  deriving (Show)

-- Canonical view of a transaction across all sources
data CanonicalTransaction = CanonicalTransaction
  { transactionId :: String
  , appAmount     :: Maybe Double
  , appStatus     :: Maybe TransactionStatus
  , bankAmount    :: Maybe Double
  , bankStatus    :: Maybe TransactionStatus
  , upiAmount     :: Maybe Double
  , upiStatus     :: Maybe TransactionStatus
  } deriving (Show)

data Mismatch = Mismatch
  { mismatchTxnId :: String
  , mismatchType  :: MismatchType
  , sourceA       :: Maybe TransactionSource
  , sourceB       :: Maybe TransactionSource
  , valueA        :: Maybe String
  , valueB        :: Maybe String
  } deriving (Show)

-- ============================================================
-- Pure: classify amount mismatch
-- ============================================================

classifyAmountMismatch
  :: CanonicalTransaction
  -> TransactionSource -> Double
  -> TransactionSource -> Double
  -> Maybe Mismatch
classifyAmountMismatch txn sA amtA sB amtB
  | abs (amtA - amtB) > 0.01 = Just Mismatch
      { mismatchTxnId = transactionId txn
      , mismatchType  = AMOUNT_MISMATCH
      , sourceA       = Just sA
      , sourceB       = Just sB
      , valueA        = Just (show amtA)
      , valueB        = Just (show amtB)
      }
  | otherwise = Nothing

-- ============================================================
-- Pure: classify status mismatch
-- ============================================================

classifyStatusMismatch
  :: CanonicalTransaction
  -> TransactionSource -> TransactionStatus
  -> TransactionSource -> TransactionStatus
  -> Maybe Mismatch
classifyStatusMismatch txn sA stA sB stB
  | stA /= stB = Just Mismatch
      { mismatchTxnId = transactionId txn
      , mismatchType  = STATUS_MISMATCH
      , sourceA       = Just sA
      , sourceB       = Just sB
      , valueA        = Just (show stA)
      , valueB        = Just (show stB)
      }
  | otherwise = Nothing

-- ============================================================
-- Pure: classify missing in bank
-- ============================================================

classifyMissingInBank :: CanonicalTransaction -> Maybe Mismatch
classifyMissingInBank txn = case (appStatus txn, bankStatus txn) of
  (Just st, Nothing) -> Just Mismatch
    { mismatchTxnId = transactionId txn
    , mismatchType  = MISSING_IN_BANK
    , sourceA       = Just APP
    , sourceB       = Just BANK
    , valueA        = Just (show st)
    , valueB        = Just "NOT_FOUND"
    }
  _ -> Nothing

-- ============================================================
-- Pure: classify missing in UPI
-- ============================================================

classifyMissingInUPI :: CanonicalTransaction -> Maybe Mismatch
classifyMissingInUPI txn = case (appStatus txn, upiStatus txn) of
  (Just st, Nothing) -> Just Mismatch
    { mismatchTxnId = transactionId txn
    , mismatchType  = MISSING_IN_UPI
    , sourceA       = Just APP
    , sourceB       = Just UPI_SWITCH
    , valueA        = Just (show st)
    , valueB        = Just "NOT_FOUND"
    }
  _ -> Nothing

-- ============================================================
-- Pure: run all classifiers — main entry point
-- ============================================================

classifyTransaction :: CanonicalTransaction -> [Mismatch]
classifyTransaction txn = mapMaybe id
  [ amountCheck APP BANK   (appAmount txn) (bankAmount txn)
  , amountCheck APP UPI_SWITCH (appAmount txn) (upiAmount txn)
  , statusCheck APP BANK   (appStatus txn) (bankStatus txn)
  , statusCheck APP UPI_SWITCH (appStatus txn) (upiStatus txn)
  , classifyMissingInBank txn
  , classifyMissingInUPI txn
  ]
  where
    amountCheck sA sB (Just a) (Just b) = classifyAmountMismatch txn sA a sB b
    amountCheck _  _  _        _        = Nothing
    statusCheck sA sB (Just a) (Just b) = classifyStatusMismatch txn sA a sB b
    statusCheck _  _  _        _        = Nothing

-- ============================================================
-- Pure: determine resolution action
-- ============================================================

determineResolution :: MismatchType -> Maybe TransactionStatus -> Maybe TransactionStatus -> Double -> ResolutionAction
determineResolution STATUS_MISMATCH (Just SUCCESS) (Just PENDING) age
  | age > 10  = CallBankAPI "App SUCCESS, bank PENDING >10 min — verify with bank"
  | otherwise = FlagForManual "App SUCCESS, bank PENDING — waiting"
determineResolution STATUS_MISMATCH (Just SUCCESS) (Just FAILED) _ =
  ReverseCharge "App SUCCESS but bank FAILED — potential duplicate"
determineResolution AMOUNT_MISMATCH _ _ _ =
  FlagForManual "Amount mismatch — needs human verification"
determineResolution MISSING_IN_BANK _ _ age
  | age > 30  = CallBankAPI "Missing in bank >30 min"
  | otherwise = FlagForManual "Not yet in bank"
determineResolution MISSING_IN_UPI _ _ _ =
  CallBankAPI "Missing in UPI switch — verify with NPCI"
determineResolution DUPLICATE_CHARGE _ _ _ =
  ReverseCharge "Duplicate charge detected"
determineResolution _ _ _ _ =
  FlagForManual "Unknown mismatch — manual review required"

-- ============================================================
-- Demo
-- ============================================================

main :: IO ()
main = do
  putStrLn "\n=== Reconciliation Engine — Haskell Classifier Demo ===\n"

  let clean = CanonicalTransaction
        { transactionId = "TXN_001"
        , appAmount = Just 500.0, appStatus = Just SUCCESS
        , bankAmount = Just 500.0, bankStatus = Just SUCCESS
        , upiAmount = Just 500.0, upiStatus = Just SUCCESS
        }

  let statusMismatch = CanonicalTransaction
        { transactionId = "TXN_002"
        , appAmount = Just 1000.0, appStatus = Just SUCCESS
        , bankAmount = Just 1000.0, bankStatus = Just PENDING
        , upiAmount = Just 1000.0, upiStatus = Just SUCCESS
        }

  let amountMismatch = CanonicalTransaction
        { transactionId = "TXN_003"
        , appAmount = Just 500.0, appStatus = Just SUCCESS
        , bankAmount = Just 495.0, bankStatus = Just SUCCESS
        , upiAmount = Nothing, upiStatus = Nothing
        }

  let missingInBank = CanonicalTransaction
        { transactionId = "TXN_004"
        , appAmount = Just 200.0, appStatus = Just SUCCESS
        , bankAmount = Nothing, bankStatus = Nothing
        , upiAmount = Just 200.0, upiStatus = Just SUCCESS
        }

  let testCases = [("Clean transaction", clean),
                   ("Status mismatch", statusMismatch),
                   ("Amount mismatch", amountMismatch),
                   ("Missing in bank", missingInBank)]

  mapM_ (\(name, txn) -> do
    putStrLn $ "[ " ++ name ++ " — " ++ transactionId txn ++ " ]"
    let mismatches = classifyTransaction txn
    if null mismatches
      then putStrLn "  ✓ No mismatches — clean"
      else mapM_ (\m -> do
        putStrLn $ "  ✗ " ++ show (mismatchType m)
        let resolution = determineResolution (mismatchType m)
              (appStatus txn) (bankStatus txn) 15.0
        putStrLn $ "  → Resolution: " ++ show resolution
        ) mismatches
    putStrLn ""
    ) testCases

  putStrLn "=== Demo Complete ===\n"
