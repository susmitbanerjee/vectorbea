#!/usr/bin/env python3
"""Simple keep-alive latency probe for the local VectorBea proxy."""

from __future__ import annotations

import time
from typing import Final

import requests

BASE_URL: Final[str] = "http://localhost:8080"
PROMPT_NAME: Final[str] = "support-agent-2"
REQUESTS_COUNT: Final[int] = 5
TIMEOUT_SECONDS: Final[float] = 3.0


def main() -> None:
    url = f"{BASE_URL}/v1/prompts/{PROMPT_NAME}"
    with requests.Session() as session:
        print(f"GET {url}")
        for idx in range(REQUESTS_COUNT):
            started = time.perf_counter()
            response = session.get(url, timeout=TIMEOUT_SECONDS)
            elapsed_ms = (time.perf_counter() - started) * 1000
            print(f"request {idx + 1}: {elapsed_ms:.3f} ms (status={response.status_code})")
            response.raise_for_status()


if __name__ == "__main__":
    main()
