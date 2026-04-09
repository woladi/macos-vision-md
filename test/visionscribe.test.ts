import { describe, it, expect, vi, beforeEach } from 'vitest';
import { groupByParagraph, buildPrompt } from '../src/prompt.js';
import type { LayoutBlock } from 'macos-vision';

// ---------------------------------------------------------------------------
// groupByParagraph
// ---------------------------------------------------------------------------

describe('groupByParagraph', () => {
  it('groups text blocks by paragraphId', () => {
    const blocks: LayoutBlock[] = [
      { kind: 'text', text: 'Hello', x: 0.1, y: 0.05, width: 0.2, height: 0.03, lineId: 0, paragraphId: 0 },
      { kind: 'text', text: 'World', x: 0.3, y: 0.05, width: 0.2, height: 0.03, lineId: 0, paragraphId: 0 },
      { kind: 'text', text: 'Second paragraph', x: 0.1, y: 0.15, width: 0.4, height: 0.03, lineId: 1, paragraphId: 1 },
    ];

    const groups = groupByParagraph(blocks);
    expect(groups).toHaveLength(2);

    const p0 = groups.find(g => g.paragraphId === 0)!;
    expect(p0.lines).toEqual(['Hello World']);

    const p1 = groups.find(g => g.paragraphId === 1)!;
    expect(p1.lines).toEqual(['Second paragraph']);
  });

  it('skips non-text blocks', () => {
    const blocks: LayoutBlock[] = [
      { kind: 'text', text: 'Only text', x: 0.1, y: 0.1, width: 0.3, height: 0.03, lineId: 0, paragraphId: 0 },
      { kind: 'face', x: 0.5, y: 0.5, width: 0.1, height: 0.1 } as LayoutBlock,
    ];

    const groups = groupByParagraph(blocks);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toEqual(['Only text']);
  });

  it('returns empty array for no text blocks', () => {
    expect(groupByParagraph([])).toEqual([]);
  });

  it('preserves y of the first block in a paragraph', () => {
    const blocks: LayoutBlock[] = [
      { kind: 'text', text: 'Top', x: 0.1, y: 0.07, width: 0.2, height: 0.03, lineId: 0, paragraphId: 0 },
    ];
    const [group] = groupByParagraph(blocks);
    expect(group.y).toBe(0.07);
  });
});

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

describe('buildPrompt', () => {
  it('includes the system instruction', () => {
    const prompt = buildPrompt([{ paragraphId: 0, y: 0.1, lines: ['Hello'], page: 0 }]);
    expect(prompt).toContain('Markdown formatter');
    expect(prompt).toContain('FORBIDDEN');
    expect(prompt).toContain('CRITICAL CONSTRAINT');
  });

  it('includes paragraph headers with y hint', () => {
    const prompt = buildPrompt([{ paragraphId: 2, y: 0.123, lines: ['Test line'], page: 0 }]);
    expect(prompt).toContain('[Paragraph 2, y≈0.12]');
    expect(prompt).toContain('Test line');
  });

  it('separates multiple paragraphs with blank lines', () => {
    const prompt = buildPrompt([
      { paragraphId: 0, y: 0.05, lines: ['First'], page: 0 },
      { paragraphId: 1, y: 0.20, lines: ['Second'], page: 0 },
    ]);
    expect(prompt).toContain('First');
    expect(prompt).toContain('Second');
    expect(prompt).toMatch(/First[\s\S]*\n\n[\s\S]*Second/);
  });
});

// ---------------------------------------------------------------------------
// VisionScribe — integration (top-level mocks)
// ---------------------------------------------------------------------------

const mockPing = vi.fn<() => Promise<void>>();
const mockGenerate = vi.fn<() => Promise<string>>();
const mockOcr = vi.fn<() => Promise<LayoutBlock[]>>();
const mockInferLayout = vi.fn<() => LayoutBlock[]>();
const mockSortBlocks = vi.fn<() => LayoutBlock[]>();

vi.mock('../src/ollama.js', () => ({
  OllamaUnavailableError: class OllamaUnavailableError extends Error {
    constructor(url: string) {
      super(`Ollama not reachable at ${url}`);
      this.name = 'OllamaUnavailableError';
    }
  },
  ping: (...args: unknown[]) => mockPing(...args),
  generate: (...args: unknown[]) => mockGenerate(...args),
}));

vi.mock('macos-vision', () => ({
  ocr: (...args: unknown[]) => mockOcr(...args),
  inferLayout: (...args: unknown[]) => mockInferLayout(...args),
  sortBlocksByReadingOrder: (...args: unknown[]) => mockSortBlocks(...args),
}));

describe('VisionScribe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOcr.mockResolvedValue([]);
    mockInferLayout.mockReturnValue([]);
    mockSortBlocks.mockReturnValue([]);
    mockGenerate.mockResolvedValue('');
  });

  it('throws OllamaUnavailableError when Ollama is down', async () => {
    const { OllamaUnavailableError } = await import('../src/ollama.js');
    mockPing.mockRejectedValue(new OllamaUnavailableError('http://localhost:11434'));

    const { VisionScribe } = await import('../src/index.js');
    const scribe = new VisionScribe();
    await expect(scribe.toMarkdown('image.png')).rejects.toBeInstanceOf(OllamaUnavailableError);
  });

  it('returns empty string when OCR finds no text', async () => {
    mockPing.mockResolvedValue(undefined);

    const { VisionScribe } = await import('../src/index.js');
    const scribe = new VisionScribe();
    const result = await scribe.toMarkdown('empty.png');
    expect(result).toBe('');
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('calls generate with a prompt when text is found', async () => {
    mockPing.mockResolvedValue(undefined);
    const block: LayoutBlock = {
      kind: 'text', text: 'Hello', x: 0.1, y: 0.05,
      width: 0.2, height: 0.03, lineId: 0, paragraphId: 0,
    };
    mockOcr.mockResolvedValue([block]);
    mockInferLayout.mockReturnValue([block]);
    mockSortBlocks.mockReturnValue([block]);
    mockGenerate.mockResolvedValue('# Hello');

    const { VisionScribe } = await import('../src/index.js');
    const scribe = new VisionScribe({ model: 'mistral-nemo', ollamaUrl: 'http://localhost:11434' });
    const result = await scribe.toMarkdown('doc.png');

    expect(result).toBe('# Hello');
    expect(mockGenerate).toHaveBeenCalledOnce();
    const [opts, prompt] = mockGenerate.mock.calls[0] as [{ model: string; baseUrl: string }, string];
    expect(opts.model).toBe('mistral-nemo');
    expect(prompt).toContain('Hello');
  });
});
