/**
 * Workspace and environment types.
 *
 * Kept separate from the provider so server components can import the shapes
 * without pulling a "use client" module into the server graph.
 */

export type Environment = "development" | "staging" | "production";

export interface Workspace {
  id: string;
  name: string;
  /** Present in fixtures and the API's workspace list; not required to resolve scope. */
  members?: number;
}
