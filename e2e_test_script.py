"""Minimal E2E sandbox verifier for the VectorBee Docker Compose stack.

This script waits for the backend and frontend to become available, creates a
dummy prompt through the backend API, inserts an audit log, and then verifies
that the frontend proxy API returns the same data a developer would consume.
"""

from __future__ import annotations

import sys
import time
from typing import Any

import httpx

FRONTEND_URL = "http://localhost:3000"


def wait_for_service(url: str, timeout_seconds: int = 120) -> None:
    """Poll a URL until it returns a successful response or time out."""

    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None

    with httpx.Client(timeout=5.0) as client:
        while time.time() < deadline:
            try:
                response = client.get(url)
                if response.is_success:
                    return
            except Exception as exc:  # pragma: no cover - diagnostic path
                last_error = exc
            time.sleep(2)

    if last_error:
        raise RuntimeError(f"Timed out waiting for {url}: {last_error}") from last_error
    raise RuntimeError(f"Timed out waiting for {url}")


def main() -> None:
    """Run the VectorBee E2E verification flow."""

    print("Waiting for frontend to become healthy...")
    wait_for_service(f"{FRONTEND_URL}/settings")

    prompt_name = f"e2e-prompt-{int(time.time())}"
    version_tag = "v1.0.0"

    with httpx.Client(timeout=10.0) as client:
        create_prompt_response = client.post(
            f"{FRONTEND_URL}/api/prompts",
            json={
                "name": prompt_name,
                "description": "Prompt created by the Docker Compose E2E sandbox.",
                "versionTag": version_tag,
                "templateText": "Answer the user using {{user_input}}.",
                "parameters": {
                    "temperature": 0.2,
                    "max_tokens": 256,
                    "top_p": 0.95,
                    "model_name": "gpt-4.1-mini",
                },
            },
        )
        create_prompt_response.raise_for_status()
        created_prompt: dict[str, Any] = create_prompt_response.json()
        prompt_version_id = created_prompt["promptVersionId"]

        audit_response = client.post(
            f"{FRONTEND_URL}/api/audit/batch",
            json=[
                {
                    "promptVersionId": prompt_version_id,
                    "latencyMs": 123,
                    "tokenCount": 456,
                    "metadata": {
                        "source": "e2e_test_script",
                        "prompt_name": prompt_name,
                    },
                }
            ],
        )
        audit_response.raise_for_status()

    print("Audit log inserted. Verifying frontend API response...")

    deadline = time.time() + 60

    with httpx.Client(timeout=5.0) as client:
        while time.time() < deadline:
            response = client.get(f"{FRONTEND_URL}/api/audit")
            response.raise_for_status()
            rows: list[dict[str, Any]] = response.json()

            if any(
                (row.get("prompt_name") == prompt_name or row.get("promptName") == prompt_name)
                and (row.get("version_tag") == version_tag or row.get("versionTag") == version_tag)
                and (row.get("latency_ms") == 123 or row.get("latencyMs") == 123)
                and (row.get("token_count") == 456 or row.get("tokenCount") == 456)
                for row in rows
            ):
                print("Success: frontend API returned the audit data fetched from the backend.")
                return

            time.sleep(2)

    raise RuntimeError(
        "Frontend API did not return the expected audit row before timeout."
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"E2E verification failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
