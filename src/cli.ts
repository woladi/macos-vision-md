#!/usr/bin/env node
/**
 * macos-vision-md CLI
 *
 * Usage:
 *   macos-vision-md <file>              → writes <file>.md next to the source
 *   macos-vision-md <file> -o out.md    → writes to specified path
 *   macos-vision-md <file> --stdout     → prints to stdout
 *   macos-vision-md <file> --model llama3.2
 *   macos-vision-md <file> --ollama-url http://localhost:11434
 */

import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { VisionScribe } from './index.js';

function printHelp(): void {
  console.log(`
Usage: macos-vision-md <image-or-pdf> [options]

Options:
  -o, --output <path>        Write Markdown to specified file
  --stdout                   Print Markdown to stdout instead of a file
  --model <name>             Ollama model name (default: mistral-nemo)
  --ollama-url <url>         Ollama base URL (default: http://localhost:11434)
  -h, --help                 Show this help

Examples:
  macos-vision-md invoice.png
  macos-vision-md scan.pdf -o notes.md
  macos-vision-md receipt.jpg --stdout | pbcopy
`);
}

function parseArgs(argv: string[]): {
  input: string;
  output?: string;
  stdout: boolean;
  model: string;
  ollamaUrl: string;
} {
  const args = argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  const input = args[0];
  let output: string | undefined;
  let stdout = false;
  let model = 'mistral-nemo';
  let ollamaUrl = 'http://localhost:11434';

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '-o' || arg === '--output') && args[i + 1]) {
      output = args[++i];
    } else if (arg === '--stdout') {
      stdout = true;
    } else if (arg === '--model' && args[i + 1]) {
      model = args[++i];
    } else if (arg === '--ollama-url' && args[i + 1]) {
      ollamaUrl = args[++i];
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  return { input, output, stdout, model, ollamaUrl };
}

async function main(): Promise<void> {
  const { input, output, stdout, model, ollamaUrl } = parseArgs(process.argv);

  if (!existsSync(input)) {
    console.error(`Error: file not found: ${input}`);
    process.exit(1);
  }

  const scribe = new VisionScribe({ model, ollamaUrl });

  if (!stdout) {
    process.stderr.write(`Converting ${input}…\n`);
  }

  const markdown = await scribe.toMarkdown(input);

  if (stdout) {
    process.stdout.write(markdown);
    return;
  }

  const outPath = output ?? path.join(
    path.dirname(path.resolve(input)),
    path.basename(input, path.extname(input)) + '.md',
  );

  await writeFile(outPath, markdown, 'utf8');
  process.stderr.write(`Saved: ${outPath}\n`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
