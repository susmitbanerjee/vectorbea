import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([{ name: "vectorbea-access-token", value: "local-dev", domain: "localhost", path: "/" }]);
const p = await ctx.newPage();
await p.goto("http://localhost:3000/control", { waitUntil: "domcontentloaded", timeout: 120000 });
await p.waitForSelector("h1", { timeout: 90000 });
await p.waitForTimeout(7000);

const bell = p.locator('button[aria-label^="Notifications"]');
console.log("bell   :", await bell.getAttribute("aria-label"));
const summary = p.locator("button", { hasText: "attention" }).first();
console.log("control:", (await summary.innerText()).replace(/\s+/g," ").trim());

await bell.click();
await p.waitForTimeout(800);
const pop = p.locator('[role="dialog"]').last();
const txt = await pop.innerText().catch(() => "");
console.log("\ninbox (first 16 lines):");
console.log(txt.split("\n").filter(Boolean).slice(0, 16).map(l => "  " + l).join("\n"));
const all = await p.locator("body").innerText();
console.log("\nfixture markers on page:", ["Acme Platform","ws_acme_eu","run_01JBQZ8XK4","inc_7c2f18ab90de"].filter(m => all.includes(m)));
await b.close();
