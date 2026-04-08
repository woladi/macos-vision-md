import type { LayoutBlock } from 'macos-vision';

/**
 * A single paragraph: all TextBlocks sharing the same paragraphId,
 * in reading order (top-to-bottom, left-to-right within each line).
 */
export interface ParagraphGroup {
  paragraphId: number;
  /** Average y-coordinate of the first line — used as a spatial hint. */
  y: number;
  lines: string[];
}

/**
 * Group sorted layout blocks by paragraphId into ParagraphGroup objects.
 * Non-text blocks (faces, barcodes, etc.) are ignored.
 */
export function groupByParagraph(blocks: LayoutBlock[]): ParagraphGroup[] {
  const map = new Map<number, { y: number; lines: Map<number, string[]> }>();

  for (const block of blocks) {
    if (block.kind !== 'text') continue;

    if (!map.has(block.paragraphId)) {
      map.set(block.paragraphId, { y: block.y, lines: new Map() });
    }
    const para = map.get(block.paragraphId)!;

    const existing = para.lines.get(block.lineId) ?? [];
    existing.push(block.text);
    para.lines.set(block.lineId, existing);
  }

  const groups: ParagraphGroup[] = [];
  for (const [paragraphId, { y, lines }] of map) {
    // Join tokens within each line, then collect lines in order
    const lineStrings = [...lines.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, tokens]) => tokens.join(' '));

    groups.push({ paragraphId, y, lines: lineStrings });
  }

  return groups;
}

/**
 * Build the full prompt string that will be sent to the LLM.
 *
 * Design goals:
 * - Ground the model on pre-extracted OCR text so it cannot hallucinate.
 * - Provide spatial context (y-coordinate) so the model can distinguish
 *   headings from body text without needing pixel-level layout info.
 * - Produce clean Markdown without commentary or fabricated content.
 */
export function buildPrompt(paragraphs: ParagraphGroup[]): string {
  const systemInstruction = `You are a precise Markdown formatter. \
The text below was extracted from an image using Apple Vision OCR and is already \
grouped into paragraphs in reading order.

RULES — follow all of them strictly:
1. Do NOT add, invent, or paraphrase any words. Use only the text provided.
2. Use # / ## / ### only for paragraphs that look like titles or headings \
(typically short, few words, appearing near the top of the document, i.e. low y value).
3. Use - bullet points only when the original fragments already form a list \
(e.g. short items, enumeration markers visible in the text).
4. Join lines within the same paragraph into flowing prose when they form a sentence.
5. Preserve paragraph breaks as blank lines in the output.
6. Return ONLY the Markdown. No preamble, no commentary, no code fences.`;

  const paragraphBlocks = paragraphs
    .map(({ paragraphId, y, lines }) => {
      const yHint = y.toFixed(2);
      const header = `[Paragraph ${paragraphId}, y≈${yHint}]`;
      return `${header}\n${lines.join('\n')}`;
    })
    .join('\n\n');

  return `${systemInstruction}\n\n---\n\n${paragraphBlocks}`;
}
