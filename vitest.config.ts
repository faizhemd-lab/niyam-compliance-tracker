import { defineConfig } from 'vitest/config'

// Kept apart from vite.config.ts so the Cloudflare and React plugins do not load
// for tests: everything under test is plain TypeScript.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
