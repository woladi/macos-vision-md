export interface OllamaOptions {
  /** Base URL of the Ollama server. Default: `http://localhost:11434` */
  baseUrl: string;
  /** Model name to use for generation. Default: `mistral-nemo` */
  model: string;
}

/**
 * Verify that the Ollama server is reachable.
 * Throws {@link OllamaUnavailableError} if the server cannot be contacted.
 */
export async function ping(baseUrl: string): Promise<void> {
  try {
    await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3_000) });
  } catch {
    throw new OllamaUnavailableError(baseUrl);
  }
}

/**
 * Send a prompt to the Ollama generate endpoint and return the response text.
 * Uses `stream: false` so the full response arrives in one shot.
 */
export async function generate(
  opts: OllamaOptions,
  prompt: string,
): Promise<string> {
  const res = await fetch(`${opts.baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: opts.model, prompt, stream: false }),
    signal: AbortSignal.timeout(600_000),
  });

  if (!res.ok) {
    throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { response: string };
  return data.response.trim();
}

export class OllamaUnavailableError extends Error {
  constructor(url: string) {
    super(
      `Ollama is not reachable at ${url}. ` +
        `Make sure Ollama is running (e.g. \`ollama serve\`) and the URL is correct.`,
    );
    this.name = 'OllamaUnavailableError';
  }
}
