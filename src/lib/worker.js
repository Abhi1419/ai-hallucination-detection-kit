/**
 * worker.js
 * Web Worker that runs @xenova/transformers ML inference off the main thread.
 * This prevents the popup UI from freezing during embedding computation.
 */

import { pipeline, env } from '@xenova/transformers';
import { analyzeTexts } from './analyze.js';

// Configure transformers.js to use remote model fetching
// (models are cached in browser storage after first load)
env.allowLocalModels = false;
env.useBrowserCache = true;

let embedder = null;
let isLoading = false;

/**
 * Lazily initializes the embedding pipeline.
 * Model: Xenova/all-MiniLM-L6-v2 (~22MB, very fast)
 */
async function getEmbedder() {
  if (embedder) return embedder;
  if (isLoading) {
    // Wait until loading completes
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (!isLoading) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
    return embedder;
  }

  isLoading = true;
  self.postMessage({ type: 'status', message: 'Loading AI model (first time only)...' });

  try {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      progress_callback: (progress) => {
        if (progress.status === 'downloading') {
          self.postMessage({
            type: 'progress',
            file: progress.file,
            loaded: progress.loaded,
            total: progress.total,
          });
        }
      },
    });
    isLoading = false;
    return embedder;
  } catch (error) {
    isLoading = false;
    throw error;
  }
}

/**
 * Generates a normalized mean-pooled embedding for a piece of text.
 * @param {object} pipe - The transformers pipeline
 * @param {string} text - Text to embed
 * @returns {number[]} Embedding vector
 */
async function embed(pipe, text) {
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * Runs the shared analysis pipeline with the real embedding model.
 */
async function analyze({ sentences, fullText }) {
  const pipe = await getEmbedder();
  const { sentences: results, hallucinationScore } = await analyzeTexts(
    (text) => embed(pipe, text),
    { sentences, fullText },
    (message) => self.postMessage({ type: 'status', message })
  );

  self.postMessage({
    type: 'result',
    sentences: results,
    hallucinationScore,
  });
}

// Message handler
self.onmessage = async (event) => {
  const { type, sentences, fullText } = event.data;

  if (type === 'analyze') {
    try {
      await analyze({ sentences, fullText });
    } catch (error) {
      self.postMessage({ type: 'error', message: error.message || 'Analysis failed' });
    }
  } else if (type === 'warmup') {
    try {
      await getEmbedder();
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({ type: 'error', message: error.message });
    }
  }
};
