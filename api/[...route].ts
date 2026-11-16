import app from '../src/worker/index'

/**
 * Vercel entry point. The Hono app in src/worker is written against the Web
 * Request/Response API, so it runs unchanged on Vercel's Edge runtime; only the
 * static-asset fallback is Cloudflare-specific and is guarded in the app.
 */
export const config = { runtime: 'edge' }

export default function handler(request: Request): Response | Promise<Response> {
  return app.fetch(request, {
    MODEL_BASE_URL: process.env.MODEL_BASE_URL,
    MODEL_NAME: process.env.MODEL_NAME,
    MODEL_API_KEY: process.env.MODEL_API_KEY,
  })
}
