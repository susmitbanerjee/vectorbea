"use client";

import type { PromptListItem } from "@/lib/api";
import { useRouter } from "next/navigation";
import { FileText, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function relativeTime(value: string | null): string {
  if (!value) return "Unknown";
  const now = Date.now();
  const then = new Date(value).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

type FilterTab = "all" | "published" | "draft";

export function PromptsTable({
  prompts,
  initialQuery,
}: {
  prompts: PromptListItem[];
  initialQuery: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<FilterTab>("all");

  const counts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchesQuery = (p: PromptListItem) =>
      !q ||
      [p.name, p.description ?? "", p.latestVersion].some((f) =>
        f.toLowerCase().includes(q),
      );
    return {
      all: prompts.filter(matchesQuery).length,
      published: prompts.filter((p) => matchesQuery(p) && p.isPublished).length,
      draft: prompts.filter((p) => matchesQuery(p) && !p.isPublished).length,
    };
  }, [prompts, query]);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return prompts.filter((prompt) => {
      const matchesQuery =
        !value ||
        [prompt.name, prompt.description ?? "", prompt.latestVersion].some(
          (field) => field.toLowerCase().includes(value),
        );
      const matchesFilter =
        filter === "all" ||
        (filter === "published" ? prompt.isPublished : !prompt.isPublished);
      return matchesQuery && matchesFilter;
    });
  }, [filter, prompts, query]);

  return (
    <Card className="animate-fade-in">
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <CardTitle>Prompt Registry</CardTitle>
          <p className="text-sm text-muted-foreground">
            {prompts.length} prompt{prompts.length === 1 ? "" : "s"} total
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            placeholder="Search by name or description..."
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs
          value={filter}
          onValueChange={(v) => setFilter(v as FilterTab)}
        >
          <TabsList>
            <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
            <TabsTrigger value="published">
              Published ({counts.published})
            </TabsTrigger>
            <TabsTrigger value="draft">Draft ({counts.draft})</TabsTrigger>
          </TabsList>
        </Tabs>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center animate-fade-in">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">No prompts found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {query.trim()
                  ? "Try adjusting your search or filter."
                  : "Create your first prompt to get started."}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">
                    Description
                  </TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((prompt, i) => (
                  <TableRow
                    key={prompt.id}
                    className={`cursor-pointer transition-colors hover:bg-accent/50 animate-slide-up stagger-${Math.min(i + 1, 5)}`}
                    onClick={() => router.push(`/prompts/${prompt.id}`)}
                  >
                    <TableCell className="font-medium">{prompt.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{prompt.latestVersion}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={prompt.isPublished ? "success" : "secondary"}
                      >
                        {prompt.isPublished ? "Published" : "Draft"}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden max-w-xs truncate text-muted-foreground md:table-cell">
                      {prompt.description ?? "No description"}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {relativeTime(prompt.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
