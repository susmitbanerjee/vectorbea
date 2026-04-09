# vectorbee-proxy

Local proxy sidecar for `vectorbee`.

## Environment

- `VECTORBEE_HUB_URL`
- `VECTORBEE_KEY`

The proxy binds to the Unix domain socket:

- `/tmp/vectorbee.sock`

## Run on the JVM

```powershell
gradle.bat run
```

## Build a native binary

```powershell
gradle.bat nativeCompile
```

## API

### `GET /v1/prompts/{name}`

- Checks the in-memory `ConcurrentHashMap` cache first
- On miss, fetches from `${VECTORBEE_HUB_URL}/api/prompts/{name}`
- Stores the result locally and returns JSON

### `POST /v1/audit`

- Returns `202 Accepted` immediately
- Enqueues the payload for background flushes

Example payload:

```json
{
  "promptVersionId": "33333333-3333-3333-3333-333333333333",
  "latencyMs": 128,
  "tokenCount": 512,
  "metadata": {
    "model": "gpt-4.1-mini",
    "agent": "local-sidecar"
  }
}
```
