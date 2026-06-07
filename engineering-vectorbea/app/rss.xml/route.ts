import { getAllArticles } from "@/lib/articles";
import { SITE } from "@/lib/constants";

export const dynamic = "force-static";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const articles = getAllArticles();

  const items = articles
    .map((a) => {
      const url = `${SITE.url}/articles/${a.slug}`;
      return `
    <item>
      <title>${escapeXml(a.frontMatter.title)}</title>
      <link>${url}</link>
      <guid>${url}</guid>
      <pubDate>${new Date(a.frontMatter.date).toUTCString()}</pubDate>
      <description>${escapeXml(a.frontMatter.description)}</description>
      <author>${escapeXml(a.frontMatter.author)}</author>
      ${a.frontMatter.tags.map((t) => `<category>${escapeXml(t)}</category>`).join("\n      ")}
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE.name)}</title>
    <link>${SITE.url}</link>
    <atom:link href="${SITE.url}${SITE.rssPath}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(SITE.description)}</description>
    <language>en-us</language>
    ${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
