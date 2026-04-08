# macos-vision-md

Convert images to structured Markdown using **Apple Vision OCR** + a **local Ollama/Mistral model** — fully offline, no cloud APIs, no subscriptions.

```bash
npm install macos-vision-md
```

---

## How it works

Most image-to-Markdown tools rely on a cloud vision API to do everything in one shot. This package takes a different approach — a two-stage hybrid pipeline that keeps OCR deterministic and local while using the LLM only for formatting:

```
Image
  │
  ▼
Apple Vision OCR          ← macOS native, always accurate, zero hallucination
  │  VisionBlock[]
  │  (text + bounding boxes)
  ▼
Layout Inference          ← spatial grouping into lines + paragraphs
  │  paragraphId, lineId, y-coordinates
  ▼
Prompt Builder            ← structured, grounded prompt (no invention possible)
  │  "[Paragraph 0, y≈0.05]\nInvoice\n\n[Paragraph 1, y≈0.12]\n..."
  ▼
Ollama / Mistral          ← formats pre-extracted text into clean Markdown
  │
  ▼
Markdown string
```

### Why this prevents hallucinations

The LLM never sees the raw image — it only receives text that Apple Vision has already extracted. The prompt explicitly forbids the model from adding or paraphrasing content. It can only decide _how to format_ the words already on the page (headings, bullets, paragraphs).

The `paragraphId` grouping (computed via spatial gap heuristics in `macos-vision`) ensures the model understands which OCR fragments belong together, so it never accidentally merges or splits paragraphs.

---

## Prerequisites

1. **macOS** — Apple Vision only runs on macOS (the underlying Swift binary requires it).
2. **[Ollama](https://ollama.com)** running locally:
   ```bash
   brew install ollama
   ollama serve          # keep this running in a terminal
   ollama pull mistral-nemo
   ```
3. **Node.js ≥ 18**

---

## Quick start

```ts
import { VisionScribe } from 'macos-vision-md';

const scribe = new VisionScribe();
const markdown = await scribe.toMarkdown('receipt.png');
console.log(markdown);
```

Custom model or Ollama URL:

```ts
const scribe = new VisionScribe({
  model: 'mistral-nemo',
  ollamaUrl: 'http://localhost:11434',
});
```

---

## API

### `new VisionScribe(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `string` | `'mistral-nemo'` | Ollama model name |
| `ollamaUrl` | `string` | `'http://localhost:11434'` | Base URL of the Ollama server |

### `scribe.toMarkdown(imagePath)`

Converts the image at `imagePath` to a Markdown string.

- Accepts any image format supported by Apple Vision: PNG, JPEG, HEIC, PDF page, etc.
- Returns an empty string `''` if no text is detected in the image.
- Throws `OllamaUnavailableError` if the Ollama server is not reachable before OCR is even attempted (fail-fast).

### `OllamaUnavailableError`

Extends `Error`. Thrown when the Ollama server cannot be reached. Check `error.message` for the URL and instructions.

---

## How the prompt is structured

Each call to `toMarkdown` builds a prompt that looks like this:

```
You are a precise Markdown formatter. The text below was extracted from
an image using Apple Vision OCR and is already grouped into paragraphs
in reading order.

RULES:
1. Do NOT add, invent, or paraphrase any words. Use only the text provided.
2. Use # / ## / ### only for paragraphs that look like titles or headings …
…

---

[Paragraph 0, y≈0.04]
Quarterly Report Q3 2024

[Paragraph 1, y≈0.12]
Revenue increased by 12% compared to the previous quarter.
All product lines contributed to growth.

[Paragraph 2, y≈0.25]
Key Metrics
…
```

The `y≈` value is the normalised vertical position (0 = top of image, 1 = bottom). The model uses it as a spatial cue — a short, isolated paragraph near the top is likely a title.

---

## Supported image formats

Anything Apple Vision can read: JPEG, PNG, HEIC, HEIF, TIFF, GIF, BMP, WebP.

---

## Evaluation & Quality Assurance

The repository ships a full evaluation suite that measures conversion quality against
the [opendataloader-bench](https://github.com/opendataloader-project/opendataloader-bench)
dataset using two complementary metrics:

| Metric | Description |
|---|---|
| **CER** (Character Error Rate) | Levenshtein distance / ground-truth length — measures raw text accuracy |
| **LLM-as-a-judge** | An LLM scores 1–10 on text accuracy, structure (headings/tables/lists), and completeness |

A file **passes** when its LLM score is ≥ 8.

### Setup

```bash
# 1. Clone the benchmark dataset (one-time)
npm run eval:setup

# 2. Run the evaluation (Ollama must be running)
npm run eval

# 3. Print a formatted report of the latest run
npm run eval:report
```

### Feedback loop — improve the prompt

When files fail (score < 8), the `optimize-prompts` command analyses the failures
and asks Claude to suggest concrete improvements to the system prompt in `src/prompt.ts`:

```bash
ANTHROPIC_API_KEY=sk-... npm run optimize-prompts
```

It outputs a diagnosis and a revised instruction string ready to drop into `buildPrompt()`.
Apply the suggestions, then re-run `npm run eval` to verify the improvement.

### Eval pipeline internals

```
eval/bench/pdfs/*.pdf
  │
  ▼  VisionScribe.toMarkdown()
eval/predictions/{name}.md
  │
  ├─ computeCER(prediction, groundTruth)       → cer  (0–1)
  └─ llmJudge(prediction, groundTruth)         → score (1–10)
  │
  ▼
eval/reports/report-{timestamp}.json
```

The judge auto-selects its backend: **Claude** when `ANTHROPIC_API_KEY` is set,
otherwise **Ollama/Mistral** for a fully local run.

---

## License

MIT © Adrian Wolczuk
