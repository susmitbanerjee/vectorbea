# @vectorbea-ai/node

Official Node.js / TypeScript SDK for the [VectorBea](https://vectorbea.com) prompt management platform.

## Requirements

- Node.js 18+

## Installation

```bash
npm install @vectorbea-ai/node
```

## Quick start

```ts
import { VectorBeaClient } from "@vectorbea-ai/node";

// API key is read from VECTORBEA_API_KEY env var by default
const client = new VectorBeaClient({
  apiKey:  "vbagent_your_token_here",  // replace with your key
  baseUrl: "http://localhost:8080",    // omit to use VectorBea Cloud
});

const prompt  = await client.prompts.get("greet-user");
const message = prompt.compile({ name: "Alice", product: "Acme AI" });
console.log(message);
```

## With environment variables

```bash
export VECTORBEA_API_KEY=vbagent_your_token_here
export VECTORBEA_BASE_URL=http://localhost:8080  # optional
```

```ts
// Picks up VECTORBEA_API_KEY automatically
const client = new VectorBeaClient();
const prompt  = await client.prompts.get("customer-support-reply");
const message = prompt.compile({ customer_name: "Bob", issue: "billing" });
```

## Audit telemetry

`prompts.get()` automatically records proxy fetch latency. Call `logAudit()` after your LLM responds to add token counts and LLM latency:

```ts
const prompt  = await client.prompts.get("greet-user");
const message = prompt.compile({ name: "Alice" });

// ... call your LLM ...

await client.prompts.logAudit(prompt, {
  llmLatencyMs: 432,
  tokenCount: 87,
  metadata: { model: "gpt-4o" },
});
```

## Error handling

```ts
import {
  VectorBeaClient,
  AuthenticationError,
  NotFoundError,
  ConnectionError,
  TimeoutError,
} from "@vectorbea-ai/node";

try {
  const prompt = await client.prompts.get("my-prompt");
} catch (err) {
  if (err instanceof AuthenticationError) {
    console.error("Invalid API key");
  } else if (err instanceof NotFoundError) {
    console.error("Prompt not found");
  } else if (err instanceof TimeoutError) {
    console.error("Request timed out");
  } else if (err instanceof ConnectionError) {
    console.error("Could not reach the proxy");
  }
}
```

## License

MIT — see [LICENSE](./LICENSE).
