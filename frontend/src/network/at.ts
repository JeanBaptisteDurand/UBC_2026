// Key times of the overview thread (seconds), shared by the scene loop (loop.ts) and the panel texts (data.ts). Kept
// apart from loop.ts so that the page itself (NetworkPage.tsx, data.ts) can read the panel texts without loading three.js.
export const AT = { manifest: 0.2, publish: 5.0, arrive: 5.2, quote: 14.4, compare: 15.0, seal: 18.0, carry: 20.4, insert: 24.4, key: 31.0, request: 34.4, answer: 38.4, pay: 45.3, end: 49.5 }
