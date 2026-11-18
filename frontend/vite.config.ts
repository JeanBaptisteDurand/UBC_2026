import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'

// Same-origin proxy in dev and preview (ArcHive API, Arc RPC); a static build calls the public URLs directly.
const PROXY = {
  '/jb-api': { target: 'https://archive.62-171-153-35.sslip.io', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/jb-api/, '/api') },
  // Enclaves, behind the API's nginx, on the same origin in dev
  '/jb-enclave': { target: 'https://archive.62-171-153-35.sslip.io', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/jb-enclave/, '/enclave') },
  '/arc-rpc': { target: 'https://rpc.testnet.arc.io', changeOrigin: true, rewrite: () => '/' },
}
const PORT = Number(process.env.PORT ?? 5261)
const PAGES = ['index', 'service', 'use', 'demo', 'rent', 'publish', 'network', 'bounty', 'sessions', 'operator', 'doc'] as const

/** Public files referenced by an absolute path in the code ("/models/…", "/net/…") get the build base; HTML and CSS
 *  are already rebased by Vite. No file is modified: the rewrite happens at compile time. */
function rebase(base: string): Plugin {
  const re = /(['"`])\/(models|tex|net|manifests|fonts|og|arc-logo|favicon)([/.\-])/g
  return {
    name: 'archive-rebase', enforce: 'pre',
    transform(code, id) {
      if (base === '/' || !/\/src\/.*\.(t|j)sx?$/.test(id) || !re.test(code)) return null
      re.lastIndex = 0
      return { code: code.replace(re, (_m, q, d, c) => `${q}${base}${d}${c}`), map: null }
    },
  }
}

/** Video landing: the film manifests are inlined into the page (no request before the first draw); the Retina set
 *  reuses the desktop positions (ysFrom) */
function filmManifests(): Plugin {
  return {
    name: 'film-manifestes',
    transformIndexHtml(html) {
      if (!html.includes('/*FILM_MAN*/')) return html
      const out: Record<string, unknown> = {}
      for (const set of ['desktop', 'retina', 'phone']) {
        const f = resolve(__dirname, 'public/film', set, 'manifest.json')
        if (!existsSync(f)) continue
        const m = JSON.parse(readFileSync(f, 'utf8'))
        if (m.ysFrom) delete m.ys
        out[set] = m
      }
      return html.replace('/*FILM_MAN*/null', JSON.stringify(out))
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  const profile = env.VITE_PROFILE === 'jb' || env.VITE_PROFILE === 'ext' ? env.VITE_PROFILE : 'relay'
  // Root, unless VITE_BASE is set
  const base = (env.VITE_BASE ?? '/').replace(/\/?$/, '/')
  return {
  base,
  plugins: [react(), rebase(base), filmManifests()],
  server: { port: PORT, strictPort: true, host: true, proxy: PROXY },
  preview: { port: PORT, strictPort: true, proxy: PROXY },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      input: Object.fromEntries(PAGES.map((p) => [p === 'index' ? 'main' : p, resolve(__dirname, `${p}.html`)])),
      output: {
        manualChunks: (id) => {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
          if (id.includes('node_modules/three')) return 'three'
          // No forced viem chunk: Rollup splits it, so the landing only loads what gate.ts imports
        },
      },
    },
  },
}
})
