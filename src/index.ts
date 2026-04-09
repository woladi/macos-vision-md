import { ocr, inferLayout, sortBlocksByReadingOrder } from 'macos-vision';
import type { VisionBlock } from 'macos-vision';
import { ping, generate, OllamaUnavailableError } from './ollama.js';
import { groupByParagraph, buildPrompt } from './prompt.js';
import type { ParagraphGroup } from './prompt.js';

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
  /**
   * Skip the Ollama reachability check before each call.
   * Useful in batch/eval contexts where you ping once upfront.
   * @default false
   */
  skipPing?: boolean;
}

/**
 * Group raw OCR blocks by their page index.
 * macos-vision attaches a `page` field (0-based) to blocks from PDFs.
 * Single-image blocks have no `page` field and land in page 0.
 *
 * Coordinates in VisionBlock are always page-local (0–1), so blocks from
 * different pages must NOT be passed together to inferLayout().
 */
function groupBlocksByPage(blocks: VisionBlock[]): Map<number, VisionBlock[]> {
  const pages = new Map<number, VisionBlock[]>();
  for (const block of blocks) {
    const page = (block as VisionBlock & { page?: number }).page ?? 0;
    const existing = pages.get(page) ?? [];
    existing.push(block);
    pages.set(page, existing);
  }
  return pages;
}

/**
 * Converts an image or PDF to structured Markdown using a two-stage pipeline:
 *
 * 1. **Apple Vision OCR** — extracts raw text blocks with bounding-box coordinates.
 *    PDFs are automatically rasterized page-by-page via `sips`.
 * 2. **Layout inference** — groups blocks by `paragraphId` per page using spatial
 *    heuristics (each page processed independently to avoid coordinate mixing).
 * 3. **Local LLM (Ollama/Mistral)** — formats the pre-extracted paragraphs into
 *    clean Markdown without hallucinating new content.
 *
 * @example
 * ```ts
 * const scribe = new VisionScribe({ model: 'mistral-nemo' });
 * const markdown = await scribe.toMarkdown('invoice.png');
 * const mdFromPdf = await scribe.toMarkdown('report.pdf');
 * ```
 */
export class VisionScribe {
  private readonly model: string;
  private readonly ollamaUrl: string;
  private readonly skipPing: boolean;

  constructor(options: VisionScribeOptions = {}) {
    this.model = options.model ?? 'mistral-nemo';
    this.ollamaUrl = options.ollamaUrl ?? 'http://localhost:11434';
    this.skipPing = options.skipPing ?? false;
  }

  /**
   * Convert an image or PDF file to Markdown.
   *
   * @param imagePath Absolute or relative path to the image or PDF.
   * @returns Markdown string. Empty string if no text was detected.
   * @throws {OllamaUnavailableError} If the Ollama server cannot be reached.
   */
  async toMarkdown(imagePath: string): Promise<string> {
    // 1. Ensure Ollama is reachable before doing expensive OCR work.
    if (!this.skipPing) await ping(this.ollamaUrl);

    // 2. Extract raw OCR blocks via Apple Vision.
    //    For PDFs, macos-vision rasterizes each page and adds a `page` field.
    const rawBlocks = await ocr(imagePath, { format: 'blocks' });

    // 3. Split blocks by page — inferLayout() requires page-local coordinates.
    const pageMap = groupBlocksByPage(rawBlocks);

    // 4. Per page: infer layout → sort → group into paragraphs.
    const allParagraphs: ParagraphGroup[] = [];
    for (const [pageIndex, pageBlocks] of [...pageMap.entries()].sort(([a], [b]) => a - b)) {
      const layoutBlocks = inferLayout({ textBlocks: pageBlocks });
      const sorted = sortBlocksByReadingOrder(layoutBlocks);
      const paragraphs = groupByParagraph(sorted, pageIndex);
      allParagraphs.push(...paragraphs);
    }

    if (allParagraphs.length === 0) {
      return '';
    }

    // 5. Build the grounded prompt and send to the local LLM.
    const prompt = buildPrompt(allParagraphs);
    const markdown = await generate(
      { baseUrl: this.ollamaUrl, model: this.model },
      prompt,
    );

    return markdown;
  }
}
