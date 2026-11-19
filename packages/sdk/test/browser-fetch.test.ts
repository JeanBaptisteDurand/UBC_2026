/** Régression du 9/11 : dans un navigateur, fetch appelé comme MÉTHODE d'un objet (this.f(...)) lève « Illegal
 *  invocation ». Node l'accepte, d'où ce faux fetch qui reproduit la règle des navigateurs. */
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { InferenceClient } from "../src/inference";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function browserLikeFetch(): typeof fetch {
  return function (this: unknown, _input: RequestInfo | URL) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    return Promise.resolve(new Response(JSON.stringify({ data: [{ id: "m" }] }), { headers: { "content-type": "application/json" } }));
  } as typeof fetch;
}

describe("default fetch of the SDK clients (browser rule)", () => {
  it("InferenceClient calls fetch without binding it to itself", async () => {
    globalThis.fetch = browserLikeFetch();
    const c = new InferenceClient({ enclaveUrl: "https://enclave.example", sessionKey: { privateKey: generatePrivateKey() } } as any);
    await expect(c.models.list()).resolves.toEqual({ data: [{ id: "m" }] });
  });

  it("no client keeps globalThis.fetch as is to call it as a method", () => {
    const dir = new URL("../src/", import.meta.url);
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const src = readFileSync(new URL(f, dir), "utf8");
      expect(/this\.\w+\s*=\s*[^;\n]*\?\?\s*globalThis\.fetch\s*;/.test(src), f).toBe(false);
    }
  });
});
