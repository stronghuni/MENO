import type { ModelSpec } from './types'

/**
 * Model download specs. Kept in `shared/` with zero Electron imports so
 * tooling (CI integration tests, scripts) can import the URLs without
 * booting Electron — importing them through a main-process module would
 * transitively pull in `electron`, which isn't available outside the
 * Electron runtime.
 */
export const MODEL_SPECS: ModelSpec[] = [
  {
    key: 'whisper',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
    filename: 'ggml-large-v3-turbo.bin',
    approxBytes: 1_624_555_275
  },
  {
    key: 'llm',
    // Qwen's own repo split the 7B Q4_K_M into two shards (00001-of-00002).
    // bartowski's community single-file quant is identical content, easier
    // to load via node-llama-cpp without merging shards.
    url: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    filename: 'qwen2.5-7b-instruct-q4_k_m.gguf',
    approxBytes: 4_683_074_240
  }
]
