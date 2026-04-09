# macos-vision-md

Convert images and PDFs to structured Markdown using **Apple Vision OCR** + a **local Ollama model** — fully offline, no cloud APIs, no subscriptions.

```bash
npm install macos-vision-md
```

## Zero runtime dependencies

`macos-vision-md` has no npm runtime dependencies. It uses:
- [`macos-vision`](https://github.com/woladi/macos-vision) (peer dependency — Apple Vision OCR)
- Node.js built-in `fetch` for Ollama communication (Node 18+)

Nothing is downloaded at runtime. Nothing leaves your machine except the local Ollama request.

---

## How it works

Most image-to-Markdown tools rely on a cloud vision API to do everything in one shot. This package takes a different approach — a multi-stage pipeline that keeps OCR deterministic and local while using the LLM only for formatting:

```
Image / PDF
  │
  ▼
Apple Vision OCR          ← macOS native, deterministic, zero hallucination
  │  VisionBlock[] per page
  ▼
Per-page Layout Inference ← each page processed independently (coordinates are page-local)
  │  paragraphId, lineId, y-coordinates
  ▼
Chunker                   ← splits paragraphs into batches that fit the LLM output window
  │  ParagraphGroup[][]
  ▼
Ollama /api/chat          ← system prompt as role:"system", OCR text as role:"user"
  │  temperature=0, top_p=1, num_predict=-1
  ▼
Markdown string           ← chunk results joined with blank lines
```

### Why this prevents hallucinations

The LLM never sees the raw image — it only receives text that Apple Vision has already extracted. The system prompt instructs the model to act as a high-fidelity document parser and explicitly forbids summarising, paraphrasing, or adding content. OCR text is wrapped in `<ocr_source>` tags so the model cannot mistake it for a user asking a question.

Per-page processing ensures paragraph coordinates from different pages are never mixed, which would cause layout inference to produce incorrect groupings on multi-page PDFs.

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

## Programmatic API

```ts
import { VisionScribe } from 'macos-vision-md';

const scribe = new VisionScribe();
const markdown = await scribe.toMarkdown('receipt.png');
console.log(markdown);
```

Custom options:

```ts
const scribe = new VisionScribe({
  model: 'mistral-nemo',
  ollamaUrl: 'http://localhost:11434',
});
```

Batch processing (ping Ollama once, skip per-call health checks):

```ts
const scribe = new VisionScribe({ skipPing: true });

// Verify Ollama once upfront
import { ping } from 'macos-vision-md/ollama';
await ping('http://localhost:11434');

for (const file of files) {
  const md = await scribe.toMarkdown(file);
}
```

### `new VisionScribe(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `string` | `'mistral-nemo'` | Ollama model name |
| `ollamaUrl` | `string` | `'http://localhost:11434'` | Base URL of the Ollama server |
| `skipPing` | `boolean` | `false` | Skip per-call Ollama health check (useful in batch loops) |
| `chunkSizeTokens` | `number` | `1800` | Max estimated output tokens per LLM chunk. Lower = more chunks (safer for small models); higher = fewer calls but risks hitting model output limits |

### `scribe.toMarkdown(imagePath)`

Converts the image or PDF at `imagePath` to a Markdown string.

- Accepts PNG, JPEG, HEIC, HEIF, TIFF, GIF, BMP, WebP and **PDF**
- Returns an empty string `''` if no text is detected
- Throws `OllamaUnavailableError` if the Ollama server is not reachable (unless `skipPing: true`)

### `OllamaUnavailableError`

Extends `Error`. Thrown when the Ollama server cannot be reached. Check `error.message` for the URL and troubleshooting instructions.

---

## How the prompt is structured

Each chunk is sent as a two-message chat request:

**System message** (`role: "system"`) — hard constraints sent once per chunk:
```
ACT AS A HIGH-FIDELITY DOCUMENT PARSER. Your only goal is to reconstruct
the provided OCR data into a structured Markdown document. NEVER skip text.
NEVER summarize. Content must be 100% identical to the source.

DO NOT SUMMARIZE.
Transcribe every single word from the provided OCR data.
Maintain 1:1 content fidelity. If the source has 5 paragraphs, the output
must have 5 paragraphs.
…
```

**User message** (`role: "user"`) — OCR content wrapped in source tags:
```
Convert the OCR source below into Markdown.
Reproduce EVERY word EXACTLY. Do not respond, explain, or ask questions.

<ocr_source>

[Page 1]

[Paragraph 0, y≈0.04]
Quarterly Report Q3 2024

[Paragraph 1, y≈0.12]
Revenue increased by 12% compared to the previous quarter.
All product lines contributed to growth.

[Page 2]

[Paragraph 5, y≈0.08]
Key Metrics
…
</ocr_source>
```

The `y≈` value is the normalised vertical position (0 = top of page, 1 = bottom). It helps the model distinguish titles (short text near the top) from body paragraphs. `[Page N]` separators appear only for multi-page documents.

The Ollama request uses `temperature: 0` and `top_p: 1` to make token selection deterministic, and `num_predict: -1` to disable output truncation.

---

## Known limitations

- **Local model fidelity**: Small local models (mistral-nemo, gemma) may occasionally summarise or paraphrase content on long or information-dense documents instead of transcribing word-for-word. The pipeline uses `temperature: 0` and explicit fidelity instructions to minimise this, but it is an inherent limitation of small LLMs. Larger models (e.g. `llama3.1:70b`, `qwen2.5:32b`) produce significantly better fidelity.

- **Tables**: Multi-column table layouts are partially supported. OCR reads cells in reading order but the LLM may not always reconstruct correct Markdown table syntax.

- **Images / charts**: Non-textual content (photos, diagrams, charts) is ignored — only text blocks extracted by Apple Vision are processed.

---

## License

MIT © Adrian Wolczuk
