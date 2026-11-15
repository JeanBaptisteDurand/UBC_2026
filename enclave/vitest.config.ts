import { defineConfig } from "vitest/config";

// 11/11 : les tests d'INTÉGRATION (x402-proofs, bounty-dos-catch, bounty-relay) lancent de vrais forks arc-anvil et des
// serveurs HTTP. Sous forte charge (plusieurs suites en parallèle, ou plusieurs agents sur la machine) ils peuvent
// échouer sur un délai réseau/fork passager, et repassent au vert en isolation. 2 reprises rendent un run COMPLET fiable
// sans ralentir le chemin normal (la reprise ne se déclenche qu'en cas d'échec) et sans masquer un vrai bug (qui, lui,
// échoue les 3 fois). Les tests unitaires déterministes ne sont pas affectés.
export default defineConfig({
  test: {
    retry: 2,
  },
});
