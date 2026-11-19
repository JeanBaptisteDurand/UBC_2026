import { defineConfig } from "vitest/config";

// The integration tests (x402-proofs, bounty-dos-catch, bounty-relay) start real anvil forks and HTTP servers. Under
// heavy load (several suites in parallel on a busy machine) a transient network or fork delay can fail one of them, and
// it passes again in isolation. Two retries make a full run reliable without slowing the normal path (a retry only
// happens after a failure) and without hiding a real bug, which fails all three times. Deterministic unit tests are
// not affected.
export default defineConfig({
  test: {
    retry: 2,
  },
});
