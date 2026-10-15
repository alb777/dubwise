// @ts-check
/**
 * The WebLLM build, pinned, in a module of its own that imports nothing. The model's worker loads it, and a worker
 * whose imports take time to load, like the word lists that decode with a top-level await, would still be loading
 * when the page sends its first message, and lose it: the model would never load. sw.js caches this same URL for
 * offline use; a test keeps the two in step.
 */
export const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm";
