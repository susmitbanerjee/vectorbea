# HTTP requests: testing and agent tools

Open **Integrations → Generic HTTP → Open HTTP client**. OpenAPI/Postman import is a separate action and opens the API document importer directly.

The client sends a real request with temporary values. It supports HTTP methods, query parameters, headers, API-key/Bearer/Basic authorization, JSON, raw text/XML, URL-encoded forms and multipart files. cURL can be pasted or uploaded as text; it is parsed, never executed by a shell. Unsupported flags and file references produce an error. Redirects are displayed without following them. Requests are limited to 1 MiB, responses to 256 KiB and timeouts to 30 seconds. Private destinations are blocked by the public tester. Demo mode never sends requests.

## Define inputs for an agent

Use `{customerId}` or `{{customerId}}` in the path, and `{{query}}` as a query/header/form value. JSON bodies can contain typed placeholders:

```json
{"source":"{{source}}","target":"{{target}}"}
```

In **Agent inputs**, give each discovered input a type and description. Fill temporary test values, then **Send request**. JSON values consisting of a double-braced placeholder preserve their declared type; embedded placeholders produce strings. Object and array test variables are supported in JSON/raw bodies; path, query, header and form variables use scalar types. Query/header/form mappings use whole placeholders, and distinct wire fields need distinct input names. JSON field names and the API origin stay fixed.

**Create agent tool** transfers the unresolved template into the tool creation wizard. Choose the saved connection, name the tool, review its request and generated input schema, and set approval/risk policies before saving. Test values are not saved as defaults. Constants stay bound and are excluded from the agent schema. Inputs are required at runtime.

For Apyhub fuzzy search, use POST, the `/apyhub/fuzzy-search` URL, the two boolean query flags, API key authorization with header name `apy_token`, and the body above. Supply the key for the temporary test; the saved tool reads its credential from the selected connection. A single token header imported from cURL is converted to connection-backed authorization when creating the tool. Multiple custom secrets must be configured through the tool's authentication editor, not pasted into the saved template.

An agent supplies an arguments object such as `{"source":"ing","target":"finding things bring"}`. The existing HTTP resolver maps those arguments to the path/query/header/body, applies the connection credential, and performs response extraction and pagination. A connection test does not grant the tool to an agent; configure the agent's tool grants and run it through the governed execution flow.

Uploaded test files are temporary and cannot be embedded in a saved tool. Configure runtime file inputs in the HTTP tool editor. OAuth access tokens can be tested as Bearer tokens; token acquisition and advanced authentication use the saved tool/connection configuration.
