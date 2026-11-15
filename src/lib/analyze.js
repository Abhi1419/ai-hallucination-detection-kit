/**
 * analyze.js
 * Model-independent analysis pipeline. The embedding function is passed in, so the same code
 * runs in the Web Worker (real MiniLM model) and in unit tests (fake embeddings).
 */
import { scoreSentences, computeHallucinationScore } from './textHelper.js';

/**
 * Embeds the full text once and every sentence once, then scores each sentence.
 * Model calls: 1 + number of sentences (previously 1 + n + n*(n-1)).
 *
 * @param {(text: string) => Promise<number[]>} embed - Returns an embedding vector for a text
 * @param {{ sentences: string[], fullText: string }} input
 * @param {(message: string) => void} [onStatus] - Optional progress callback
 * @returns {Promise<{ sentences: object[], hallucinationScore: number }>}
 */
export async function analyzeTexts(embed, { sentences, fullText }, onStatus = () => {}) {
  onStatus('Embedding full context...');
  const contextEmbedding = await embed(fullText);

  const sentenceEmbeddings = [];
  for (let i = 0; i < sentences.length; i++) {
    onStatus(`Analyzing sentence ${i + 1} of ${sentences.length}...`);
    sentenceEmbeddings.push(await embed(sentences[i]));
  }

  const results = scoreSentences(contextEmbedding, sentenceEmbeddings, sentences);
  const hallucinationScore = computeHallucinationScore(results.map((r) => r.supportScore));
  return { sentences: results, hallucinationScore };
}
