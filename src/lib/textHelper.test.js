import { describe, it, expect } from 'vitest';
import {
  segmentSentences,
  cosineSimilarity,
  scoreToRisk,
  computeHallucinationScore,
  classifyOverallRisk,
  scoreSentences,
} from './textHelper.js';
import { analyzeTexts } from './analyze.js';

describe('segmentSentences', () => {
  it('returns an empty array for empty or whitespace input', () => {
    expect(segmentSentences('')).toEqual([]);
    expect(segmentSentences('   ')).toEqual([]);
    expect(segmentSentences(undefined)).toEqual([]);
  });

  it('splits text into sentences and trims them', () => {
    const out = segmentSentences('The tower is in Paris. It was built in 1889.  It is tall.');
    expect(out).toEqual(['The tower is in Paris.', 'It was built in 1889.', 'It is tall.']);
  });

  it('drops fragments of 10 characters or fewer', () => {
    expect(segmentSentences('Yes. The tower is located in Paris.')).toEqual(['The tower is located in Paris.']);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors and 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('clamps negative similarity to 0', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(0);
  });

  it('returns 0 for mismatched lengths, missing input or zero vectors', () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
    expect(cosineSimilarity(null, [1])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('risk labels', () => {
  it('maps support scores to the documented thresholds', () => {
    expect(scoreToRisk(0.55).label).toBe('Low Risk');
    expect(scoreToRisk(0.54).label).toBe('Medium Risk');
    expect(scoreToRisk(0.38).label).toBe('Medium Risk');
    expect(scoreToRisk(0.37).label).toBe('High Risk');
  });

  it('turns average support into a hallucination percentage', () => {
    expect(computeHallucinationScore([])).toBe(0);
    expect(computeHallucinationScore([0.7, 0.7])).toBe(30);
    expect(computeHallucinationScore([0.3])).toBe(70);
  });

  it('classifies the overall percentage', () => {
    expect(classifyOverallRisk(34).label).toBe('Low Hallucination');
    expect(classifyOverallRisk(35).label).toBe('Medium Hallucination');
    expect(classifyOverallRisk(60).label).toBe('High Hallucination');
  });
});

// Deterministic fake "model": maps a text to a vector from its characters.
const fakeEmbed = (text) => {
  const v = new Array(8).fill(0);
  for (let i = 0; i < text.length; i++) v[i % 8] += text.charCodeAt(i) % 17;
  return v;
};

// The original (pre-refactor) algorithm: re-embeds every other sentence for every sentence.
async function referenceAnalysis(embed, sentences, fullText) {
  const round2 = (x) => Math.round(x * 100) / 100;
  const ctx = await embed(fullText);
  const results = [];
  for (let i = 0; i < sentences.length; i++) {
    const s = await embed(sentences[i]);
    const support = cosineSimilarity(ctx, s);
    let sum = 0;
    let count = 0;
    for (let j = 0; j < sentences.length; j++) {
      if (i !== j) {
        sum += cosineSimilarity(s, await embed(sentences[j]));
        count++;
      }
    }
    const cross = count > 0 ? sum / count : support;
    results.push({
      text: sentences[i],
      supportScore: round2(support * 0.6 + cross * 0.4),
      contextScore: round2(support),
      crossScore: round2(cross),
    });
  }
  const avg = results.reduce((a, r) => a + r.supportScore, 0) / results.length;
  return { sentences: results, hallucinationScore: Math.round(Math.max(0, Math.min(100, (1 - avg) * 100))) };
}

const sentences = [
  'The tower is located in Paris, France.',
  'It was completed in 1889 for the World Fair.',
  'It currently serves as an underwater observation deck.',
  'Millions of tourists visit it every year.',
];
const fullText = sentences.join(' ');

describe('analyzeTexts', () => {
  it('gives the same scores as the original algorithm', async () => {
    const expected = await referenceAnalysis(async (t) => fakeEmbed(t), sentences, fullText);
    const actual = await analyzeTexts(async (t) => fakeEmbed(t), { sentences, fullText });
    expect(actual).toEqual(expected);
  });

  it('calls the model once for the full text and once per sentence', async () => {
    let calls = 0;
    await analyzeTexts(async (t) => { calls++; return fakeEmbed(t); }, { sentences, fullText });
    expect(calls).toBe(sentences.length + 1);
  });

  it('the original algorithm needed n*n + 1 calls for the same input', async () => {
    let calls = 0;
    await referenceAnalysis(async (t) => { calls++; return fakeEmbed(t); }, sentences, fullText);
    expect(calls).toBe(sentences.length * sentences.length + 1);
  });

  it('reports progress for the full text and each sentence', async () => {
    const messages = [];
    await analyzeTexts(async (t) => fakeEmbed(t), { sentences, fullText }, (m) => messages.push(m));
    expect(messages).toHaveLength(sentences.length + 1);
    expect(messages[0]).toMatch(/full context/);
  });

  it('handles a single sentence by falling back to the context score', () => {
    const [r] = scoreSentences(fakeEmbed('a b c d e f g'), [fakeEmbed('a b c d e f g')], ['a b c d e f g']);
    expect(r.crossScore).toBe(r.contextScore);
  });
});
