import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([{ name: "vectorbea-access-token", value: "local-dev", domain: "localhost", path: "/" }]);
const p = await ctx.newPage();
const api = [];
const errs = [];
p.on("request", r => { if (r.url().includes(":8080")) api.push(`REQ  ${r.method()} ${r.url().replace("http://localhost:8080","")}`); });
p.on("response", r => { if (r.url().includes(":8080")) api.push(`RESP ${r.status()} ${r.url().replace("http://localhost:8080","")}`); });
p.on("requestfailed", r => { if (r.url().includes(":8080")) api.push(`FAIL ${r.url().replace("http://localhost:8080","")} ${r.failure()?.errorText}`); });
p.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
p.on("pageerror", e => errs.push("PAGEERROR " + e.message.slice(0, 200)));

await p.goto("http://localhost:3000/control", { waitUntil: "domcontentloaded", timeout: 120000 });
await p.waitForSelector("h1", { timeout: 90000 });
await p.waitForTimeout(6000);

console.log("API calls made by the browser:");
for (const c of api) console.log("  " + c);

const main = await p.locator("main, [role=main]").first().innerText().catch(() => "");
console.log("\n── Control DOM ──");
console.log(main.split("\n").filter(Boolean).slice(0, 42).join("\n"));

console.log("\nfixture markers present:",
  ["Acme Platform","ws_acme_eu","run_01JBQZ8XK4","inc_7c2f18ab90de"].filter(m => main.includes(m)));
console.log("console errors:", errs.length ? errs.slice(0,4) : "none");
await b.close();
