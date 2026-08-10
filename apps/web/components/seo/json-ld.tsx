import { serializeJsonLd } from "@/lib/seo";

/**
 * Renders a JSON-LD <script>. Data is serialized with `<` escaped so page
 * content can never break out of the script context. Server component — emits
 * static markup crawlers read directly from the initial HTML.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
