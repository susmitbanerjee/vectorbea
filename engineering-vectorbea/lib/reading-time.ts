import readingTime from "reading-time";

export function getReadingTime(content: string): string {
  const stats = readingTime(content);
  const minutes = Math.max(1, Math.round(stats.minutes));
  return `${minutes} min read`;
}
