import { ocr, inferLayout, sortBlocksByReadingOrder } from 'macos-vision';
import { ping, generate, OllamaUnavailableError } from './ollama.js';
import { groupByParagraph, buildPrompt } from './prompt.js';

export { OllamaUnavailableError } from './ollama.js';
export type { ParagraphGroup } from './prompt.js';

export interface VisionScribeOptions {
  /**
   * Ollama model name.
   * @default 'mistral-nemo'
   */
  model?: string;
  /**
   * Base URL of the Ollama server.
   * @default 'http://localhost:11434'
   */
  ollamaUrl?: string;
}

/**
 * Converts an image to structured Markdown using a two-stage pipeline:
 *
 * 1. **Apple Vision OCR** — extracts raw text blocks with bounding-box coordinates.
 * 2. **Layout inference** — groups blocks by `paragraphId` using spatial heuristics.
 * 3. **Local LLM (Ollama/Mistral)** — formats the pre-extracted paragraphs into
 *    clean Markdown without hallucinating new content.
 *
 * @example
 * ```ts
 * const scribe = new VisionScribe({ model: 'mistral-nemo' });
 * const markdown = await scribe.toMarkdown('invoice.png');
 * ```
 */
export class VisionScribe {
  private readonly model: string;
  private readonly ollamaUrl: string;

  constructor(options: VisionScribeOptions = {}) {
    this.model = options.model ?? 'mistral-nemo';
    this.ollamaUrl = options.ollamaUrl ?? 'http://localhost:11434';
  }

  /**
   * Convert an image file to Markdown.
   *
   * @param imagePath Absolute or relative path to the image (PNG, JPEG, HEIC, …).
   * @returns Markdown string.
   * @throws {OllamaUnavailableError} If the Ollama server cannot be reached.
   */
  async toMarkdown(imagePath: string): Promise<string> {
    // 1. Ensure Ollama is reachable before doing expensive OCR work.
    await ping(this.ollamaUrl);

    // 2. Extract raw OCR blocks via Apple Vision.
    const rawBlocks = await ocr(imagePath, { format: 'blocks' });

    // 3. Infer layout (assigns lineId + paragraphId to each block).
    const layoutBlocks = inferLayout({ textBlocks: rawBlocks });

    // 4. Sort into reading order: top-to-bottom, then left-to-right.
    const sorted = sortBlocksByReadingOrder(layoutBlocks);

    // 5. Group text blocks by paragraphId to preserve semantic coherence.
    const paragraphs = groupByParagraph(sorted);

    if (paragraphs.length === 0) {
      return '';
    }

    // 6. Build the grounded prompt and send to the local LLM.
    const prompt = buildPrompt(paragraphs);
    const markdown = await generate(
      { baseUrl: this.ollamaUrl, model: this.model },
      prompt,
    );

    return markdown;
  }
}
