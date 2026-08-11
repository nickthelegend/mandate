/**
 * What to say when the authority cannot be reached.
 *
 * `TypeError: Failed to fetch` is what the browser says, and it is not an error
 * message — it names the API that threw, not what went wrong or what it means
 * for the person reading. Every page here surfaced it verbatim, so a gateway
 * that was merely asleep looked, to a visitor, like a broken product.
 *
 * The distinction between "you are offline" and "the authority is not
 * answering" is worth drawing: one of them is the reader's network and one is
 * ours, and telling them the wrong one wastes their time. Anything that is
 * neither is passed through with its own text rather than flattened into a
 * generic apology — an unexpected message is information, and hiding it would
 * be the same mistake in the other direction.
 */
export function unreachable(e: unknown, opts: { stale?: boolean } = {}): string {
  const caveat = opts.stale ? " The figures shown are from the last time it answered." : "";
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return `This browser is offline — nothing below could be refreshed.${caveat}`;
  }
  const detail = e instanceof Error ? e.message : String(e);
  if (/Failed to fetch|NetworkError|Load failed|ERR_/i.test(detail)) {
    return `The authority is not answering. It sleeps when idle, so the first request after a quiet spell can take a moment — try again.${caveat}`;
  }
  /*
   * A JSON parse failure means the host answered instead of the authority.
   *
   * Railway serves its own plain-text page while a container is starting or
   * restarting, so `r.json()` throws `Unexpected token 'u', "upstream error"`
   * — and quoting a parser at a reader tells them nothing about what happened.
   * Seen for real: a suite run caught it mid-restart, which is exactly when a
   * judge would hit it too.
   */
  if (/JSON|Unexpected token|Unexpected end of/i.test(detail)) {
    return `The authority is restarting — its host answered instead of it. Give it a few seconds and try again.${caveat}`;
  }
  return `The authority answered with something unexpected: ${detail}`;
}
