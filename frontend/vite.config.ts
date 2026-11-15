import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Same-origin proxy in dev and preview (ArcHive API, Arc RPC); a static build calls the public URLs directly.
const PROXY = {
  '/jb-api': { target: 'https://archive.62-171-153-35.sslip.io', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/jb-api/, '/api') },
  '/arc-rpc': { target: 'https://rpc.testnet.arc.io', changeOrigin: true, rewrite: () => '/' },
}
const PORT = Number(process.env.PORT ?? 5261)

export default defineConfig({
  plugins: [react()],
  server: { port: PORT, strictPort: true, host: true, proxy: PROXY },
  preview: { port: PORT, strictPort: true, proxy: PROXY },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html') },
      output: {
        manualChunks: (id) => {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/viem') || id.includes('@noble')) return 'viem'
        },
      },
    },
  },
})
