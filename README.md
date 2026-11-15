# AI Hallucination Detector

[![CI](https://github.com/Abhi1419/ai-hallucination-detection-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Abhi1419/ai-hallucination-detection-kit/actions/workflows/ci.yml)

A Chrome extension that scores each sentence of AI-generated text for **semantic consistency** with the rest of the text and labels it Low, Medium or High risk. The model runs entirely in the browser: no backend, no API keys, no permissions, and your text never leaves your machine.

> Built with a collaborator as part of a college society project, then cleaned up and extended (shared scoring module, embedding cache, unit tests, CI).

## What it does (and does not do)

Paste a block of text, click **Analyze**, and the extension returns:

- a **risk label per sentence** (Low, Medium or High) with its score,
- an **overall percentage** and risk label for the whole text.

It flags sentences that drift away from the rest of the text, which is often a sign that a passage deserves a second look.

**It does not check facts.** The score measures consistency, not truth: a confident, internally consistent but false statement can still score as low risk. Treat the output as a hint about what to double-check, not as proof of a hallucination. Fact-checking against an external source is listed under [future work](#future-work).

## How it works

1. **Segment** the input into sentences with `Intl.Segmenter` (regex fallback), dropping fragments of 10 characters or fewer.
2. **Embed** the full text and each sentence with `Xenova/all-MiniLM-L6-v2` (about 22 MB, run in WebAssembly through Transformers.js inside a Web Worker so the popup stays responsive).
3. **Score** each sentence as a blend of two cosine similarities:
   - **60%** similarity to the full text (does it fit the overall topic?),
   - **40%** mean similarity to the other sentences (is it consistent with its neighbours?).
4. **Label** each sentence by its blended support score, and the whole text by the average.

| Support score | Sentence label |
| --- | --- |
| 0.55 or higher | Low risk |
| 0.38 to 0.54 | Medium risk |
| below 0.38 | High risk |

The overall percentage is `(1 − average support) × 100`, labelled Low (under 35%), Medium (35% to 59%) or High (60% or more). The thresholds were tuned by hand for MiniLM and have not been validated on a labelled dataset.

### Design notes

- **Client-side only.** The manifest declares no permissions and no host permissions, and the model is downloaded once from Hugging Face and then cached by the browser.
- **Web Worker.** Inference runs off the main thread, so the popup does not freeze during analysis.
- **Model-independent pipeline.** `analyze.js` takes the embedding function as an argument, so the same code runs in the worker with the real model and in unit tests with a fake one.

### Performance

The first version re-embedded every other sentence for each sentence, so a text with *n* sentences needed *n² + 1* model calls. Each sentence is now embedded once, so it needs *n + 1*.

| Sentences | Model calls before | Model calls now |
| --- | --- | --- |
| 4 | 17 | 5 |
| 9 | 82 | 10 |
| 20 | 401 | 21 |

The scores are identical, and a unit test checks this against the original algorithm.

## Getting started

Requirements: Node.js 18 or newer and npm 9 or newer.

```bash
git clone https://github.com/Abhi1419/ai-hallucination-detection-kit.git
cd ai-hallucination-detection-kit
npm install
npm run build
```

Then load it in Chrome:

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Click **Load unpacked** and select the `dist/` folder.
3. Click the extension icon in the toolbar to open the popup.

The first analysis downloads the model (about 22 MB), so it takes a little longer. After that it is cached.

## Tests

```bash
npm test
```

Vitest covers sentence segmentation, cosine similarity, risk thresholds, the percentage calculation and the analysis pipeline, including a check that the optimised pipeline matches the original algorithm and that it calls the model `n + 1` times. GitHub Actions runs the tests and the production build on every push.

## Sample inputs

Three inputs to try. Scores depend on the model and the wording, so treat the intended labels as a guide.

**Mostly false claims (intended to score as high risk)**
```
The Eiffel Tower was built in 1989 by Leonardo da Vinci as a lighthouse for the Mediterranean Sea. It is located in Berlin, Germany and stands 5,000 meters tall. The structure is made entirely of gold and was sold to the United States in 1945. It currently serves as the world's tallest underwater observation deck.
```

**Mixed true and false claims (intended to score as medium risk)**
```
The Great Wall of China was constructed over many centuries, beginning around the 7th century BC. It stretches approximately 13,000 miles and was primarily used as a barrier against invasions. The wall is made of stone, brick, tamped earth, and even pizza, according to recent historians. Many sections of the Great Wall are well-preserved today and attract millions of tourists annually.
```

**Accurate claims (intended to score as low risk)**
```
The Eiffel Tower was built between 1887 and 1889 by Gustave Eiffel's company as the entrance arch to the 1889 World's Fair. It stands 330 meters tall and is located in Paris, France on the Champ de Mars. The tower was initially criticized by some French artists but has since become one of the most recognizable structures in the world. It attracts approximately seven million visitors per year.
```

## Project structure

```
├── .github/workflows/ci.yml   # Runs tests and build on every push
├── public/
│   ├── manifest.json          # Chrome Manifest V3 (no permissions)
│   └── icons/
├── src/
│   ├── components/            # Popup UI (header, input, loading, results, sentence cards)
│   ├── lib/
│   │   ├── worker.js          # Web Worker: loads the model and runs the pipeline
│   │   ├── analyze.js         # Model-independent pipeline (embeds each sentence once)
│   │   ├── textHelper.js      # Segmentation, cosine similarity, scoring, risk labels
│   │   └── textHelper.test.js # Unit tests
│   ├── App.jsx                # Popup state machine
│   └── main.jsx
├── index.html
├── vite.config.js
└── package.json
```

## Known limitations

- Scores consistency, not factual accuracy (see above).
- Thresholds are hand-tuned and not validated on labelled data.
- Works on pasted text only; it does not read the page you are viewing.
- Very short sentences are skipped, and the model is English-focused.

## Future work

- Validate the thresholds on a labelled set of true and false statements and report accuracy.
- Cross-check named entities against an external source such as Wikipedia.
- Compare AI output against a user-supplied source document.
- Download progress indicator, analysis history and report export.
- Sidebar mode to analyse text directly on a web page.
