# vectorbee-backend

Minimal Central Hub API for vectorbee, built with vanilla Kotlin, JDK `HttpServer`, and PostgreSQL via JDBC.

## Environment

Set these environment variables before starting the server:

- `PORT` default: `8080`
- `DB_URL` example: `jdbc:postgresql://localhost:5432/vectorbee`
- `DB_USER`
- `DB_PASSWORD`

You can also use `JDBC_DATABASE_URL`, `PGUSER`, and `PGPASSWORD` as fallbacks.

## Run

```powershell
gradle.bat run
```

## Endpoints

### `POST /api/keys`

Request body:

```json
{
  "organizationId": "11111111-1111-1111-1111-111111111111"
}
```

Response:

```json
{
  "id": "22222222-2222-2222-2222-222222222222",
  "organizationId": "11111111-1111-1111-1111-111111111111",
  "apiKey": "generated-raw-key",
  "createdAt": "2026-04-05T12:00:00Z"
}
```

### `POST /api/prompts`

Request body:

```json
{
  "organizationId": "11111111-1111-1111-1111-111111111111",
  "name": "support_reply",
  "description": "Customer support base prompt",
  "versionTag": "v1",
  "templateText": "Reply to {{customer_name}} with empathy.",
  "parameters": {
    "temperature": 0.2,
    "max_tokens": 300
  }
}
```

### `GET /api/prompts/:name`

Requires:

```http
Authorization: Bearer <raw-api-key>
```

Response includes the latest prompt version for the authenticated organization.

### `POST /api/audit/batch`

Requires:

```http
Authorization: Bearer <raw-api-key>
```

Accepts either a raw array:

```json
[
  {
    "promptVersionId": "33333333-3333-3333-3333-333333333333",
    "latencyMs": 421,
    "tokenCount": 982,
    "metadata": {
      "model": "gpt-4.1-mini",
      "source": "local-proxy"
    }
  }
]
```

Or an object with `logs`.
