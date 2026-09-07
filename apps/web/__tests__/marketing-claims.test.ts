import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLAIMS, GATED_CAPABILITIES, FORBIDDEN_PATTERNS, DENIAL_MARKERS,
} from "@/lib/marketing/claims";

/* ══════════════════════════════════════════════════════════════════════════════
   NOTHING ON THE MARKETING SITE MAY CLAIM WHAT IS NOT SHIPPED AND ON.

   ── WHY A TEST AND NOT A REVIEW ─────────────────────────────────────────────
   An audit is a snapshot. The claim that gets added next month — by whoever is
   writing a landing page in a hurry, in good faith, from a feature list — is the
   one that undoes it. Two things are worth pinning mechanically:

     1. Reliability and compliance words that we have no basis for. Uptime, SLA,
        SOC 2, ISO 27001, HIPAA. These are the first things a serious buyer
        verifies, and the first one found untrue is the last claim of ours they
        believe. The test refuses them outright rather than asking for a
        qualification.

     2. Capabilities that exist but are gated. A page may describe them; a page
        that describes them without saying so is the failure. The test requires
        the qualification to be on the page that raises the subject, because a
        qualification three pages away is one nobody reads.

   ── WHAT IT CANNOT CATCH ────────────────────────────────────────────────────
   A false claim written in words nobody thought to forbid. This is a floor, not
   a ceiling, and `lib/marketing/claims.ts` is where the reasoning lives.
══════════════════════════════════════════════════════════════════════════════ */

const WEB = path.resolve(__dirname, "..");

/**
 * Every public marketing source. Deliberately not the signed-in app.
 *
 * ── src/components/marketing IS THE LIVE ONE, AND WAS MISSED ────────────────
 * The first version of this guard scanned `components/marketing` and stopped
 * there. `app/(marketing)/page.tsx` renders `~/components/marketing/landing`,
 * and `components/marketing/home-content.tsx` — which looks exactly like a
 * homepage and reads exactly like one — is dead: nothing imports it.
 *
 * So the guard was auditing a file that does not ship while the page that does
 * carried an unqualified "SOC 2 is in progress" and a private-runner deployment
 * model that does not exist. Both roots are scanned now, and the dead file is
 * scanned too: it stays in the repo per CLAUDE.md, and a legacy file with a
 * false claim in it is one revert away from being live again.
 */
function marketingFiles(): string[] {
  const roots = [
    path.join(WEB, "app", "(marketing)"),
    path.join(WEB, "components", "marketing"),
    path.join(WEB, "src", "components", "marketing"),
  ];
  const out: string[] = [];

  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  roots.forEach(walk);
  return out;
}

/**
 * Source with the audit commentary removed.
 *
 * The comments explaining WHY a claim was changed necessarily quote the claim —
 * "this said 0 lost", "this line read 284ms" — and a guard that read them would
 * fire on its own explanation. Stripping comments is also what stops a future
 * qualification from being satisfied by a comment rather than by rendered text.
 */
function renderedText(file: string): string {
  return fs.readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * The sentence containing [at], lowercased.
 *
 * Sentence boundaries are approximated with `.`/`!`/`?` followed by whitespace —
 * good enough for prose, and deliberately NOT clever: a parser that got
 * "e.g." right and "Inc." wrong would fail open on exactly the marketing copy
 * that names a company.
 */
function sentenceAround(text: string, at: number): string {
  const before = text.slice(0, at);
  /* A JSX boundary counts as a sentence boundary too: adjacent props and
     elements are not prose, and letting a `>` bleed one attribute's words into
     the next is how an unrelated "not" ends up excusing a claim. */
  const starts = [/[.!?]\s/g, /[>}]\s*\n/g]
    .flatMap((re) => [...before.matchAll(re)].map((m) => (m.index ?? 0) + m[0].length));
  const start = starts.length > 0 ? Math.max(...starts) : 0;

  const after = text.slice(at);
  const ends = [after.search(/[.!?](\s|$)/), after.search(/\n\s*[<{]/)]
    .filter((n) => n >= 0);
  const end = ends.length > 0 ? at + Math.min(...ends) + 1 : text.length;

  return text.slice(start, end).toLowerCase();
}

const FILES = marketingFiles();
const rel = (file: string) => path.relative(WEB, file).replace(/\\/g, "/");

describe("the guard is actually reading the site", () => {
  it("found the marketing pages", () => {
    // Without this, every assertion below passes by finding nothing.
    expect(FILES.length).toBeGreaterThan(10);
    expect(FILES.some((f) => f.includes("pricing"))).toBe(true);
  });

  it("reads the homepage the route actually renders", () => {
    /* The specific miss this pins: `app/(marketing)/page.tsx` renders
       `~/components/marketing/landing`, not `components/marketing/home-content`.
       A guard that scanned only the second was auditing a dead file — which is
       exactly how "SOC 2 is in progress" survived on the live page. */
    const homepage = fs.readFileSync(path.join(WEB, "app", "(marketing)", "page.tsx"), "utf8");
    const rendered = /components\/marketing\/([a-z-]+)/.exec(homepage.replace(/^\/\/.*$/gm, ""));
    expect(rendered, "the homepage no longer imports a marketing component").not.toBeNull();
    expect(
      FILES.some((f) => f.endsWith(`${rendered![1]}.tsx`)),
      `the homepage renders ${rendered![1]}, which this guard is not scanning`,
    ).toBe(true);
  });

  it("strips comments, so an audit note cannot satisfy or trip a rule", () => {
    const home = renderedText(FILES.find((f) => f.endsWith("home-content.tsx"))!);
    expect(home).not.toContain("AUDIT:");
  });
});

describe("no claim we have no basis for", () => {
  it.each(FORBIDDEN_PATTERNS)("$id never appears un-denied", ({ pattern, why }) => {
    const offences: string[] = [];

    for (const file of FILES) {
      const text = renderedText(file);
      const global = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
      for (const match of text.matchAll(global)) {
        const at = match.index ?? 0;
        /* THE SENTENCE, not a fixed window.
           A ±220 character window was the first version, and it was too
           generous in exactly the direction that matters: an unrelated "not"
           two sentences away marked a genuine SLA claim as denied. The denial
           has to be in the same sentence the claim is in, because that is the
           sentence a reader reads. */
        const denied = DENIAL_MARKERS.some((marker) =>
          sentenceAround(text, at).includes(marker));
        if (!denied) {
          offences.push(`${rel(file)}: “…${text.slice(Math.max(0, at - 60), at + 60).trim()}…”`);
        }
      }
    }

    expect(
      offences,
      `${why}\n\nFound:\n${offences.join("\n")}`,
    ).toEqual([]);
  });
});

describe("a gated capability is qualified on the page that raises it", () => {
  it.each(GATED_CAPABILITIES)("$id", ({ mentions, qualifier, why }) => {
    const missing: string[] = [];

    for (const file of FILES) {
      const text = renderedText(file);
      if (!mentions.test(text)) continue;
      // The register's own source and the shared components that RENDER the
      // qualification are exempt: they carry the words, not the claim.
      if (rel(file).includes("components/marketing/content.tsx")) continue;
      if (!text.includes(qualifier)) missing.push(rel(file));
    }

    expect(
      missing,
      `${why}\n\nThese pages mention it without the qualifier “${qualifier}”:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});

describe("the register itself stays honest", () => {
  it("gives every claim a piece of evidence", () => {
    for (const claim of CLAIMS) {
      expect(claim.evidence.length, `${claim.id} has no evidence`).toBeGreaterThan(30);
    }
  });

  it("says what was done about everything that is not plainly true", () => {
    // A verdict of "false" with no action is an audit finding nobody acted on.
    for (const claim of CLAIMS) {
      if (claim.verdict === "true") continue;
      expect(claim.action, `${claim.id} is "${claim.verdict}" with no action recorded`).toBeTruthy();
    }
  });

  it("has no unresolved false claim", () => {
    for (const claim of CLAIMS.filter((c) => c.verdict === "false")) {
      expect(
        claim.action,
        `"${claim.claim}" is recorded as false — its action must say it was removed or replaced`,
      ).toMatch(/remov|replac|delet/i);
    }
  });
});
