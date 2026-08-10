/**
 * @untch/canon — the deterministic hashing surface shared by server, middleware, and
 * contracts tests (PRD §9). Two surfaces:
 *   A. Canonical JSON  — `canonicalize` / `hashCanonicalJson` + the §9 domain normalizers.
 *   B. SpendIntent hash — `hashSpendIntent` (§8.1), differential-tested against Solidity.
 */
export { canonicalize, hashCanonicalJson } from "./canonicalize.ts";
export {
  canonAddress,
  canonUint256,
  moneyToBaseUnits,
  canonTimestamp,
  canonUrl,
} from "./domain.ts";
export {
  hashSpendIntent,
  SPEND_INTENT_ABI_PARAMS,
  type SpendIntent,
} from "./spendIntent.ts";
