// The values the part's demo fills the steps with (store.ts DemoState). A simulation: nothing is signed or sent and
// the wallet is never opened. Hashes and blocks shown are only those recorded on Arc testnet (src/demo/replay.json,
// and the publish and bond transactions already cited by demo-strings.ts DEMO_STEPS), always labelled as recorded;
// everything else (the answer text, the pairing, the manifest address) is labelled as simulated.
import { useEffect, useState } from 'react'
import R from '../../demo/replay.json'
import { ENCLAVE, abs } from '../../data/endpoints'
import { useDemo } from './store'
import type { St } from './kit'

export const REC = {
  enclaveUrl: () => abs(ENCLAVE.x402), // the enclave known to serve product 3 (use.ts KNOWN_ENCLAVE)
  pid: String(R.payProduct.id), price: String(R.payProduct.price), // product 3, 0.01 USDC per call
  bps: [R.payProduct.bpsOperator, R.payProduct.bpsAuthor, R.payProduct.bpsNetwork] as const,
  minBond: String(Number(R.payProduct.minBond) / 1e6),
  manifestHash: R.payProduct.manifestHash, imageId: R.registration.allowedId,
  signer: R.enclave.signer, enclavePid: String(R.enclave.productId),
  payTx: R.payment?.tx ?? '', payBlock: R.payment?.block ?? 0, payAmount: String(R.payment?.args.amount ?? R.payProduct.price),
  regTx: R.registration.tx, regBlock: R.registration.block, regGas: R.registration.costUsdc.toFixed(4),
  quoteBytes: R.registration.quoteBytes, events: R.registration.events.length,
  // cited with their transaction in demo-strings.ts (DEMO_STEPS: bond, propose(3), activate(3))
  bond: '8', bondTx: '0x4cc68bc8690b3b36f1338f90ceb066a54e7e6cf9e1f6a9c07e43d9c499274c3c',
  proposeTx: '0xc7bb4c75225388bc52644a760ce5336976377fbf50365cef0aa949073d3dd350',
  activateTx: '0x6f875e3da3dcc54783d81f0bb6563d1ae7374f7a224994a83402b6374e2109d4',
  pairCode: 'HIVE-7K2P-QX9M', // the field's own placeholder: a sample code
  manifestUri: 'https://example.com/manifest.json', // a sample address
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** The demo of this part, if it is playing or over: the stage, and the state of page step i. */
export function useShow(part: 'use' | 'rent' | 'publish') {
  const d = useDemo()
  const D = d && d.part === part ? d : null
  const st = (i: number): St => (!D ? 'todo' : i === 0 || D.end || i < D.k ? 'done' : i === D.k ? 'doing' : 'todo')
  const at = (i: number) => !!D && !D.end && D.k === i // step i is the one playing
  const past = (i: number) => !!D && (D.end || D.k > i)
  return { on: !!D, D, st, at, past }
}

/** Text typed in while its step plays (all at once with reduced motion), whole once the step is over. */
export function useTyped(text: string, on: boolean, done: boolean, ms = 1300) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!on) { setN(0); return }
    if (reduced()) { setN(text.length); return }
    let r = 0; const t0 = performance.now()
    const f = () => { const u = Math.min(1, (performance.now() - t0) / ms); setN(Math.round(u * text.length)); if (u < 1) r = requestAnimationFrame(f) }
    r = requestAnimationFrame(f)
    return () => cancelAnimationFrame(r)
  }, [on, text, ms])
  return done ? text : on ? text.slice(0, n) : ''
}
