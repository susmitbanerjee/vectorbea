export interface RequestField {
  name: string;
  value: string;
  enabled: boolean;
  secret: boolean;
  fileName?: string;
  fileBase64?: string;
  contentType?: string;
}
export type BodyType = "none" | "json" | "raw" | "form" | "multipart";
export interface HttpDraft {
  importWarnings: string[];
  method: string;
  url: string;
  query: RequestField[];
  headers: RequestField[];
  bodyType: BodyType;
  body: string;
  fields: RequestField[];
  auth: "none" | "bearer" | "basic" | "api-key";
  authName: string;
  authValue: string;
  authLocation: "header" | "query";
  username: string;
  timeoutMs: number;
}
export interface HttpRequestPayload {
  method: string;
  url: string;
  headers: RequestField[];
  bodyType: BodyType;
  body: string;
  fields: RequestField[];
  timeoutMs: number;
  sensitiveValues: string[];
}
export interface HttpResponseResult {
  status: number | null;
  latencyMs: number;
  headers: Record<string, string[]>;
  body: string;
  sizeBytes: number;
  truncated: boolean;
  errorCode?: string | null;
  message?: string | null;
}
export const isSecretName = (name: string) => /token|secret|password|authorization|cookie|api[-_]?key/i.test(name);
export const field = (name = "", value = ""): RequestField => ({ name, value, enabled: true, secret: isSecretName(name) });
export const emptyHttpDraft = (): HttpDraft => ({
  importWarnings: [],
  method: "GET", url: "", query: [], headers: [], bodyType: "none", body: "", fields: [],
  auth: "none", authName: "X-API-Key", authValue: "", authLocation: "header", username: "", timeoutMs: 30000,
});
export function splitRequestUrl(value: string): { url: string; query: RequestField[] } {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("Use an HTTP(S) URL without embedded credentials or a fragment.");
  const query = [...url.searchParams].map(([name, value]) => field(name, value));
  url.search = "";
  return { url: url.toString(), query };
}
export function requestPayload(draft: HttpDraft): HttpRequestPayload {
  if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(draft.method)) throw new Error("Unsupported HTTP method.");
  const url = new URL(draft.url);
  splitRequestUrl(draft.url);
  const enabled = (rows: RequestField[]) => rows.filter((row) => row.enabled && row.name.trim());
  const headers = enabled(draft.headers).map((row) => ({ ...row, secret: row.secret || isSecretName(row.name) }));
  for (const row of enabled(draft.query)) url.searchParams.append(row.name, row.value);
  const sensitiveValues = [...enabled(draft.query), ...headers, ...enabled(draft.fields)]
    .filter((row) => row.secret || isSecretName(row.name)).map((row) => row.value);
  for (const [name, value] of url.searchParams) if (isSecretName(name)) sensitiveValues.push(value);
  if (draft.auth !== "none") {
    if (!draft.authValue) throw new Error("Enter the authorization credential.");
    sensitiveValues.push(draft.authValue);
    let name = "Authorization";
    let value = draft.authValue;
    if (draft.auth === "bearer") value = `Bearer ${value}`;
    if (draft.auth === "basic") {
      if (draft.username.includes(":")) throw new Error("Basic auth username cannot contain a colon.");
      value = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${draft.username}:${value}`)))}`;
    }
    if (draft.auth === "api-key") {
      name = draft.authName.trim();
      if (!name) throw new Error("Enter the API key name.");
      if (draft.authLocation === "query") url.searchParams.set(name, value);
    }
    if (!(draft.auth === "api-key" && draft.authLocation === "query")) {
      if (headers.some((row) => row.name.toLowerCase() === name.toLowerCase())) throw new Error(`Set ${name} in either Headers or Authorization, not both.`);
      headers.push({ ...field(name, value), secret: true });
    }
    sensitiveValues.push(value);
  }
  if (["GET", "HEAD"].includes(draft.method) && draft.bodyType !== "none") throw new Error("GET and HEAD cannot carry a body. Change the method or select No body.");
  if (draft.bodyType === "json") { try { JSON.parse(draft.body); } catch { throw new Error("Request body is not valid JSON."); } }
  if (draft.bodyType === "multipart" && enabled(draft.fields).length === 0) throw new Error("Add a multipart field or file.");
  if (headers.some((row) => !/^[!#$%&'*+.^_`|~0-9a-zA-Z-]+$/.test(row.name) || /[\r\n\0]/.test(row.value))) throw new Error("A header has an invalid name or value.");
  if (!Number.isInteger(draft.timeoutMs) || draft.timeoutMs < 1000 || draft.timeoutMs > 30000) throw new Error("Timeout must be 1000–30000 ms.");
  if (new TextEncoder().encode(draft.body).length + enabled(draft.fields).reduce((n, row) => n + (row.fileBase64 ? row.fileBase64.length * 0.75 : new TextEncoder().encode(row.value).length), 0) > 1024 * 1024) throw new Error("Request body and files must total less than 1 MiB.");
  return { method: draft.method, url: url.toString(), headers, bodyType: draft.bodyType, body: draft.body, fields: enabled(draft.fields), timeoutMs: draft.timeoutMs, sensitiveValues };
}

/** Tokenize a pasted command; never invoke a shell or expand variables/files. */
export function curlTokens(command: string): string[] {
  const input = command.replace(/\\\r?\n/g, "").trim();
  const tokens: string[] = [];
  let token = "", quote = "", active = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && ['"', "\\"].includes(input[i + 1] ?? "")) token += input[++i];
      else token += c;
    } else if (c === "'" || c === '"') { quote = c; active = true; }
    else if (/\s/.test(c)) { if (active) { tokens.push(token); token = ""; active = false; } }
    else if (c === "\\" && i + 1 < input.length) { token += input[++i]; active = true; }
    else if (/[|;&<>`]/.test(c)) throw new Error("Paste one cURL request without shell operators. Quote URLs that contain &.");
    else { token += c; active = true; }
  }
  if (quote) throw new Error("The cURL command has an unclosed quote.");
  if (active) tokens.push(token);
  if (tokens.some((value) => /\$\(|\$\{|`/.test(value))) throw new Error("Shell expansion is unsupported. Paste literal values.");
  return tokens;
}
export function importCurl(command: string): HttpDraft {
  const tokens = curlTokens(command);
  if (!/^curl(?:\.exe)?$/.test(tokens.shift() ?? "")) throw new Error("The command must start with curl.");
  const draft = emptyHttpDraft();
  let url = "", explicitMethod = false, get = false;
  const data: string[] = [];
  const setUrl = (value: string) => { if (url) throw new Error("Import one URL at a time."); url = value; };
  for (let i = 0; i < tokens.length; i++) {
    let flag = tokens[i]!;
    let inline: string | undefined;
    if (flag.startsWith("--") && flag.includes("=")) { const at = flag.indexOf("="); inline = flag.slice(at + 1); flag = flag.slice(0, at); }
    else if (/^-[XHduF]/.test(flag) && flag.length > 2) { inline = flag.slice(2); flag = flag.slice(0, 2); }
    const value = () => { const next = inline ?? tokens[++i]; if (next === undefined) throw new Error(`Missing value for ${flag}.`); return next; };
    switch (flag) {
      case "--url": setUrl(value()); break;
      case "-X": case "--request": draft.method = value().toUpperCase(); explicitMethod = true; break;
      case "-H": case "--header": {
        const header = value(), at = header.indexOf(":");
        if (at < 1) throw new Error("Headers must use Name: value.");
        draft.headers.push(field(header.slice(0, at).trim(), header.slice(at + 1).trim())); break;
      }
      case "-d": case "--data": case "--data-binary": case "--data-raw": case "--json": {
        const text = value();
        if (flag !== "--data-raw" && text.startsWith("@")) throw new Error("Local file references are unsupported. Paste the body or attach a multipart file.");
        data.push(text);
        if (flag === "--json") draft.headers.push(field("Content-Type", "application/json"));
        break;
      }
      case "--data-urlencode": {
        const text = value(), at = text.indexOf("=");
        if (at < 0 || text.slice(0, at).includes("@")) throw new Error("Use --data-urlencode name=value. File references are unsupported.");
        draft.fields.push(field(text.slice(0, at), text.slice(at + 1))); draft.bodyType = "form"; break;
      }
      case "-F": case "--form": case "--form-string": {
        const text = value(), at = text.indexOf("=");
        if (at < 1) throw new Error("Form fields must use name=value.");
        const content = text.slice(at + 1);
        if (flag !== "--form-string" && (/^[@<]/.test(content) || content.includes(";"))) throw new Error("Attach multipart files in the Body tab; cURL file references and form directives are unsupported.");
        draft.fields.push(field(text.slice(0, at), content)); draft.bodyType = "multipart"; break;
      }
      case "-u": case "--user": {
        const credentials = value(), at = credentials.indexOf(":");
        if (at < 0) throw new Error("Basic auth requires username:password.");
        draft.auth = "basic"; draft.username = credentials.slice(0, at); draft.authValue = credentials.slice(at + 1); break;
      }
      case "--oauth2-bearer": draft.auth = "bearer"; draft.authValue = value(); break;
      case "-G": case "--get": get = true; break;
      case "-I": case "--head": draft.method = "HEAD"; explicitMethod = true; break;
      case "-L": case "--location": draft.importWarnings.push("Redirect following was requested in cURL. This client shows redirects without following them."); break;
      case "-b": case "--cookie": {
        const cookie = value();
        if (!cookie.includes("=")) throw new Error("Cookie file references are unsupported. Use Cookie headers or name=value.");
        draft.headers.push(field("Cookie", cookie)); break;
      }
      case "-s": case "--silent": case "-S": case "--show-error": case "--compressed": break;
      default:
        if (/^https?:\/\//.test(flag)) setUrl(flag);
        else throw new Error(`Unsupported cURL option: ${flag.split("=")[0]}. Remove it before import.`);
    }
  }
  if (!url) throw new Error("The cURL command has no URL.");
  Object.assign(draft, splitRequestUrl(url));
  if (data.length && draft.fields.length) throw new Error("Mixed body encodings are unsupported. Use one body format.");
  if (data.length) {
    draft.body = data.join("&");
    const type = draft.headers.find((header) => header.name.toLowerCase() === "content-type")?.value ?? "application/x-www-form-urlencoded";
    draft.bodyType = type.includes("json") ? "json" : "raw";
    if (!draft.headers.some((header) => header.name.toLowerCase() === "content-type")) draft.headers.push(field("Content-Type", type));
  }
  if (get) {
    if (draft.bodyType === "multipart") throw new Error("GET cannot use multipart data.");
    draft.query.push(...draft.fields, ...[...new URLSearchParams(draft.body)].map(([name, value]) => field(name, value)));
    draft.bodyType = "none"; draft.body = ""; draft.fields = []; if (!explicitMethod) draft.method = "GET";
  } else if (!explicitMethod && draft.bodyType !== "none") draft.method = "POST";
  return draft;
}
