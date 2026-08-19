import { DAY, HOUR, type TimeRange, type TimeRangeId } from "./model";

/**
 * The ranges Control offers, and how to resolve one from the URL.
 *
 * Moved out of the fixtures with the view models: a time range is a piece of UI
 * configuration, not sample data, and real-data code needs it too.
 *
 * A caveat the bands have to live with: `GET /api/runs` accepts no time-range
 * parameter (API-GAPS.md), so the selection is applied CLIENT-SIDE to the page
 * of runs already fetched. Ranges wider than that page are incomplete, which is
 * why `useControlData` reports `complete`.
 */
export const TIME_RANGES: TimeRange[] = [
  { id: "1h", label: "1h", durationMs: HOUR, bucketMs: 5 * 60_000, tickFormat: "time" },
  { id: "24h", label: "24h", durationMs: DAY, bucketMs: HOUR, tickFormat: "time" },
  { id: "7d", label: "7d", durationMs: 7 * DAY, bucketMs: 6 * HOUR, tickFormat: "day" },
  { id: "30d", label: "30d", durationMs: 30 * DAY, bucketMs: DAY, tickFormat: "day" },
];

export const DEFAULT_RANGE: TimeRangeId = "24h";

export function resolveRange(id: string | null | undefined): TimeRange {
  return TIME_RANGES.find((r) => r.id === id) ?? TIME_RANGES[1]!;
}
