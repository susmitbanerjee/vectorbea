import "server-only";

import { NextResponse } from "next/server";
import type { ZodError } from "zod";

import { NotFoundError, ValidationError } from "@/server/services/agent-jobs";
import { formatZodErrors } from "@/server/validation/agent-jobs";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function created<T>(data: T) {
  return NextResponse.json(data, { status: 201 });
}

export function badRequest(message: string, errors?: Record<string, string>) {
  return NextResponse.json({ error: message, ...(errors && { errors }) }, { status: 400 });
}

export function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function conflict(message: string) {
  return NextResponse.json({ error: message }, { status: 409 });
}

export function internalError(message = "An unexpected error occurred.") {
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * Centrally handle errors thrown by service functions.
 * Returns a NextResponse with an appropriate status and message.
 */
export function handleServiceError(error: unknown, fallback: string): NextResponse {
  if (error instanceof NotFoundError) return notFound(error.message);
  if (error instanceof ValidationError) return badRequest(error.message);

  // Zod parse errors bubbled up from service code (shouldn't happen normally —
  // routes parse first — but guard for safety).
  if (isZodError(error)) {
    return badRequest("Validation failed", formatZodErrors(error.issues));
  }

  console.error("[api error]", error);
  return internalError(fallback);
}

function isZodError(e: unknown): e is ZodError {
  return (
    typeof e === "object" &&
    e !== null &&
    "issues" in e &&
    Array.isArray((e as { issues: unknown }).issues)
  );
}
