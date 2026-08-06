/**
 * @polarispay/keeperhub
 *
 * The execution layer for PolarisPay credit. Everything that has to touch a
 * chain -- collecting an installment, liquidating a defaulted loan, paying a
 * merchant -- goes through KeeperHub so that it simulates first, never
 * double-charges, always reconciles to a terminal status, and leaves a receipt.
 */

export { chargeKey, encodeArgs, KeeperHubClient } from "./client.ts";
export type { KeeperHubClientOptions, KeeperHubEvent } from "./client.ts";

export {
  classifyFailure,
  errorFromResponse,
  isIndefinite,
  isKeeperHubError,
  KeeperHubError,
} from "./errors.ts";
export type { KeeperHubErrorKind } from "./errors.ts";

export {
  DEFAULT_DUNNING_LADDER,
  dunningMessage,
  nextDunningStep,
  partialCollection,
  selfCure,
export type {
  DunningDecision,
  DunningInput,
  DunningStage,
  PartialDecision,

export {
  LOAN_ENGINE_ABI,
  MERCHANT_ESCROW_ABI,
  PolarisKeeper,
export type {
  CollectInstallmentParams,
  LiquidateParams,
  PolarisDeployment,
  SettleMerchantParams,

export {
  formatReceipt,
  InMemoryReceiptStore,
  receiptFromStatus,
} from "./receipts.ts";
export type { Receipt, ReceiptKind, ReceiptOutcome, ReceiptStore } from "./receipts.ts";

export {
  CHAIN,
  isTerminal,
  SPONSORSHIP_ELIGIBLE_CHAINS,
  TERMINAL_STATUSES,
} from "./types.ts";
export type {
  ChainId,
  CheckAndExecuteInput,
  ComparisonOperator,
  ConditionNotMet,
  ContractCallInput,
  ExecuteAccepted,
  ExecuteErrorBody,
  ExecutionStatus,
  ExecutionStatusResponse,
  SimulationResult,
  TransferInput,
} from "./types.ts";
