/**
 * Configuration, resolved once at startup.
 *
 * Every read-only tool works with no configuration at all. That is deliberate:
 * the party most in need of knowing what an agent is allowed to spend is rarely
 * the party holding the operator's credential, and a tool that demands a key
 * before it will tell you an agent's limit has made itself useless to exactly
 * the person who should be asking. `npx mandate-mcp` against the public
 * defaults can read the live policy, any agent's budget, and the whole decision
 * record.
 *
 * Only `mandate_spend` moves money, and the credential it needs lives on the
 * authority rather than here — this package never holds a key, which is the
 * same property that makes the authority binding in the first place.
 */

export type Config = {
  /** Where the authority is. Everything else is derived from it. */
  authorityUrl: string;
};

/** The live deployment, so the defaults point at something real. */
export const DEFAULT_AUTHORITY = "https://gateway-production-944e.up.railway.app";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    authorityUrl: env.MANDATE_AUTHORITY_URL ?? env.AUTHORITY_URL ?? DEFAULT_AUTHORITY,
  };
}
