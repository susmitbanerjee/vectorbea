/**
 * Shared form-field classes for the creation/edit screens (connections, tools,
 * agents). Centralised here so every screen renders the SAME input and dropdown
 * theme — previously each page declared its own copy and they drifted out of sync.
 *
 * The select uses `appearance-none` + a custom chevron (encoded SVG background)
 * so the dropdown arrow is identical across browsers/OSes instead of the
 * inconsistent native OS arrow.
 */

/** Standard text input. */
export const inputCls =
  "h-9 w-full rounded-[8px] border border-[#E0E3E6] bg-white px-3 text-[13px] text-[#0B0D0F] placeholder:text-[#B6BCC2] focus:border-[#007F4E] focus:outline-none focus:ring-2 focus:ring-[#007F4E]/15";

/** Standard dropdown — matches [inputCls] tokens, with a consistent custom chevron. */
export const selectCls =
  "h-9 w-full cursor-pointer appearance-none rounded-[8px] border border-[#E0E3E6] bg-white px-3 pr-9 text-[12.5px] text-[#0B0D0F] bg-no-repeat bg-[length:14px] bg-[right_0.625rem_center] bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B7280%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] focus:border-[#007F4E] focus:outline-none focus:ring-2 focus:ring-[#007F4E]/15";

/** Compact dropdown variant (e.g. an HTTP method picker) — same theme, caller sets width. */
export const selectCompactCls =
  "h-9 cursor-pointer appearance-none rounded-[8px] border border-[#E0E3E6] bg-white px-3 pr-8 text-[12px] text-[#0B0D0F] bg-no-repeat bg-[length:14px] bg-[right_0.5rem_center] bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B7280%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] focus:border-[#007F4E] focus:outline-none focus:ring-2 focus:ring-[#007F4E]/15";
