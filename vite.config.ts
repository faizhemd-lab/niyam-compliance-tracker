import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// On Vercel the app builds as a plain SPA in dist/ and the API is served by
// api/[...route].ts. The Cloudflare plugin (local dev + Sites) writes a Worker
// bundle instead, which Vercel cannot serve.
const onVercel = Boolean(process.env.VERCEL)

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(onVercel ? [] : [cloudflare()])],
  server: { port: 5305, strictPort: false },
})
