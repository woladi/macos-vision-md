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
  /** 0-based page index (for multi-page PDFs). */
  page: number;
}

/**
 * Group sorted layout blocks by paragraphId into ParagraphGroup objects.
 * Non-text blocks (faces, barcodes, etc.) are ignored.
 *
 * @param blocks  Blocks from a SINGLE page only (coordinates are page-local).
 * @param page    0-based page index to attach to every resulting group.
 */
export function groupByParagraph(blocks: LayoutBlock[], page = 0): ParagraphGroup[] {
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
    const lineStrings = [...lines.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, tokens]) => tokens.join(' '));

    groups.push({ paragraphId, y, lines: lineStrings, page });
  }

  return groups;
}

/**
 * Build the full prompt string that will be sent to the LLM.
 *
 * Design goals:
 * - Ground the model strictly on pre-extracted OCR text — no hallucination possible.
 * - Provide spatial context (y-coordinate, page) so the model can infer headings.
 * - Produce clean Markdown without any fabricated content.
 */
export function buildPrompt(paragraphs: ParagraphGroup[]): string {
  const systemInstruction = `You are a Markdown formatter. Your input is raw OCR text extracted \
from a document using Apple Vision. The paragraphs below are the COMPLETE and ONLY source of truth.

CRITICAL CONSTRAINT:
You are a copy-editor, not a writer. Your ONLY job is to apply Markdown formatting \
symbols (# ## ### - *) to the words already present in the input. Nothing else.

FORBIDDEN — doing any of these will produce a wrong result:
- Adding ANY word, phrase, or sentence not present in the paragraphs below
- Using your background knowledge to fill gaps, correct text, or add context
- Paraphrasing, summarising, or expanding any content
- Adding nicknames, dates, facts, titles, or descriptions from memory
- Inventing section headings that do not appear verbatim in the input

ALLOWED:
- Placing # / ## / ### before a line that is clearly a heading (short, isolated, low y value)
- Placing - before items that are clearly list entries in the source text
- Joining lines within the same paragraph into flowing prose
- Preserving blank lines between paragraphs
- Preserving [Page N] boundaries as a Markdown horizontal rule (---)

Return ONLY the Markdown. No preamble, no commentary, no code fences.`;

  // Group paragraphs by page, then render with page separators
  const pageGroups = new Map<number, ParagraphGroup[]>();
  for (const p of paragraphs) {
    const existing = pageGroups.get(p.page) ?? [];
    existing.push(p);
    pageGroups.set(p.page, existing);
  }

  const pages = [...pageGroups.entries()].sort(([a], [b]) => a - b);
  const multiPage = pages.length > 1;

  const body = pages
    .map(([pageIndex, groups]) => {
      const pageHeader = multiPage ? `[Page ${pageIndex + 1}]\n\n` : '';
      const blocks = groups
        .map(({ paragraphId, y, lines }) => {
          const yHint = y.toFixed(2);
          return `[Paragraph ${paragraphId}, y≈${yHint}]\n${lines.join('\n')}`;
        })
        .join('\n\n');
      return `${pageHeader}${blocks}`;
    })
    .join('\n\n---\n\n');

  return `${systemInstruction}\n\n---\n\n${body}`;
}
