import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Only run pure-JS modules. Anything that imports Electron's `app`,
    // better-sqlite3, smart-whisper, keytar, or node-llama-cpp is excluded
    // because those native addons are pinned to the Electron Node ABI.
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'out', 'dist'],
    environment: 'node'
  }
})
