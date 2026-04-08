#!/usr/bin/env tsx
/**
 * Evaluation runner for macos-vision-md.
 *
 * Usage:
 *   npm run eval
 *   ANTHROPIC_API_KEY=sk-... npm run eval
 *
 * Prerequisites:
 *   - npm run eval:setup   (clone the benchmark dataset)
 *   - Ollama running       (unless using Claude as judge)
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { VisionScribe } from '../src/index.js';
import { computeCER, llmJudge } from './metrics.js';

const ROOT = new URL('..', import.meta.url).pathname;
const BENCH_PDFS = path.join(ROOT, 'eval/bench/pdfs');
const BENCH_GT = path.join(ROOT, 'eval/bench/ground-truth');
const PREDICTIONS_DIR = path.join(ROOT, 'eval/predictions');
const REPORTS_DIR = path.join(ROOT, 'eval/reports');

export interface EvalResult {
  file: string;
  cer: number;        // 0–1, lower is better
  llmScore: number;   // 1–10, higher is better
  llmReason: string;
  passed: boolean;    // llmScore >= 8
  error?: string;
}

async function run(): Promise<void> {
  // Sanity checks
  if (!existsSync(BENCH_PDFS)) {
    console.error(
      '✗ Benchmark not found. Run `npm run eval:setup` first to clone the dataset.',
    );
    process.exit(1);
  }

  await mkdir(PREDICTIONS_DIR, { recursive: true });
  await mkdir(REPORTS_DIR, { recursive: true });

  const scribe = new VisionScribe();
  const pdfFiles = (await readdir(BENCH_PDFS)).filter(f => f.endsWith('.pdf'));

  if (pdfFiles.length === 0) {
    console.error('✗ No PDF files found in eval/bench/pdfs/');
    process.exit(1);
  }

  console.log(`\nEvaluating ${pdfFiles.length} file(s)...\n`);

  const results: EvalResult[] = [];

  for (const filename of pdfFiles) {
    const stem = path.basename(filename, '.pdf');
    const pdfPath = path.join(BENCH_PDFS, filename);
    const gtPath = path.join(BENCH_GT, `${stem}.md`);
    process.stdout.write(`  ${filename} … `);

    let prediction = '';
    let error: string | undefined;

    try {
      prediction = await scribe.toMarkdown(pdfPath);
      await writeFile(path.join(PREDICTIONS_DIR, `${stem}.md`), prediction, 'utf8');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      process.stdout.write(`ERROR (${error})\n`);
      results.push({ file: filename, cer: 1, llmScore: 0, llmReason: '', passed: false, error });
      continue;
    }

    // Load ground truth (skip LLM judge if missing)
    if (!existsSync(gtPath)) {
      process.stdout.write('no ground-truth, skipping metrics\n');
      results.push({ file: filename, cer: 0, llmScore: 0, llmReason: 'no ground-truth', passed: false });
      continue;
    }

    const groundTruth = await readFile(gtPath, 'utf8');
    const cer = computeCER(prediction, groundTruth);

    let llmScore = 0;
    let llmReason = '';
    try {
      const judgeResult = await llmJudge(prediction, groundTruth);
      llmScore = judgeResult.score;
      llmReason = judgeResult.reason;
    } catch (err) {
      llmReason = `judge error: ${err instanceof Error ? err.message : String(err)}`;
    }

    const passed = llmScore >= 8;
    const icon = passed ? '✓' : '✗';
    process.stdout.write(`${icon}  CER=${(cer * 100).toFixed(1)}%  score=${llmScore}/10\n`);

    results.push({ file: filename, cer, llmScore, llmReason, passed, error });
  }

  // Write report
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(REPORTS_DIR, `report-${timestamp}.json`);
  await writeFile(reportPath, JSON.stringify(results, null, 2), 'utf8');

  // Print summary
  const evaluated = results.filter(r => r.llmScore > 0);
  const passed = results.filter(r => r.passed).length;
  const avgCER = evaluated.length
    ? evaluated.reduce((s, r) => s + r.cer, 0) / evaluated.length
    : 0;
  const avgScore = evaluated.length
    ? evaluated.reduce((s, r) => s + r.llmScore, 0) / evaluated.length
    : 0;

  console.log('\n────────────────────────────────');
  console.log(`  Total files:  ${results.length}`);
  console.log(`  Passed (≥8):  ${passed} / ${results.length}`);
  console.log(`  Avg CER:      ${(avgCER * 100).toFixed(1)}%`);
  console.log(`  Avg LLM score: ${avgScore.toFixed(1)} / 10`);
  console.log(`\n  Report saved: ${reportPath}`);
  console.log('────────────────────────────────\n');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
