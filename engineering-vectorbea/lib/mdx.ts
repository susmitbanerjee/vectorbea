import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { compileMDX } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypePrettyCode from "rehype-pretty-code";
import { MDXComponents } from "@/components/MDXComponents";

const CONTENT_DIR = path.join(process.cwd(), "content");

export interface FrontMatter {
  title: string;
  description: string;
  date: string;
  author: string;
  tags: string[];
  category: string;
  series?: string;
  part?: number;
  featured?: boolean;
}

export interface ContentEntry<T = FrontMatter> {
  slug: string;
  frontMatter: T;
  content: string;
}

function readDir(kind: "articles" | "rfcs" | "experiments"): ContentEntry[] {
  const dir = path.join(CONTENT_DIR, kind);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mdx"));

  return files.map((file) => {
    const slug = file.replace(/\.mdx$/, "");
    const raw = fs.readFileSync(path.join(dir, file), "utf-8");
    const { data, content } = matter(raw);
    return { slug, frontMatter: data as FrontMatter, content };
  });
}

export function getAllEntries(kind: "articles" | "rfcs" | "experiments") {
  return readDir(kind).sort(
    (a, b) => new Date(b.frontMatter.date).getTime() - new Date(a.frontMatter.date).getTime()
  );
}

export function getEntryBySlug(kind: "articles" | "rfcs" | "experiments", slug: string) {
  const dir = path.join(CONTENT_DIR, kind);
  const filePath = path.join(dir, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  return { slug, frontMatter: data as FrontMatter, content } as ContentEntry;
}

const prettyCodeOptions = {
  theme: "github-dark",
  keepBackground: true,
};

export async function compileContent(source: string) {
  const { content } = await compileMDX({
    source,
    components: MDXComponents,
    options: {
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [
          rehypeSlug,
          [rehypeAutolinkHeadings, { behavior: "wrap" }],
          [rehypePrettyCode as any, prettyCodeOptions],
        ] as any,
      },
      parseFrontmatter: false,
    },
  });
  return content;
}

export interface Heading {
  depth: number;
  text: string;
  slug: string;
}

export function extractHeadings(content: string): Heading[] {
  const lines = content.split("\n");
  const headings: Heading[] = [];
  for (const line of lines) {
    const match = /^(#{2,3})\s+(.*)$/.exec(line.trim());
    if (match) {
      const depth = match[1].length;
      const text = match[2].replace(/[`*_]/g, "").trim();
      const slug = text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
      headings.push({ depth, text, slug });
    }
  }
  return headings;
}
