# vectorbea-proxy

Local proxy sidecar for `vectorbea`.

## Environment

- `VECTORBEA_HUB_URL`
- `VECTORBEA_KEY`

The proxy binds to the Unix domain socket:

- `/tmp/vectorbea.sock`

## Run on the JVM

```powershell
gradle.bat run
```

## Build a native binary

```powershell
gradle.bat nativeCompile
```

The native binary will be written to:

```text
build/native/nativeCompile/vectorbea-proxy
```

## Run the hardened native container

The default Docker tags now point at the GraalVM native-image build, so
customers can keep pulling the same tag names without changing their setup.

```powershell
docker run --rm -p 8080:8080 `
  -e VECTORBEA_HUB_URL="https://dev.vectorbea.com" `
  -e VECTORBEA_KEY="vb_your_workspace_api_key" `
  -e VECTORBEA_HTTP_PORT="8080" `
  vectorbea/vectorbea-proxy:dev
```

Production/stable tag:

```text
vectorbea/vectorbea-proxy:latest
```

JVM compatibility fallback tags remain available if needed:

```text
vectorbea/vectorbea-proxy:dev-jvm
vectorbea/vectorbea-proxy:latest-jvm
```

## API

### `GET /v1/prompts/{name}`

- Checks the in-memory `ConcurrentHashMap` cache first
- On miss, fetches from `${VECTORBEA_HUB_URL}/api/prompts/{name}`
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
