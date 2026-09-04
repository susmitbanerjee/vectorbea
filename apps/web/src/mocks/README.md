# `src/mocks` — fixture data

Built in **P06**, before any Phase 3 screen.

Layouts that only work with three tidy rows are the failure mode this directory exists to prevent.
Fixtures must reproduce the real shape of production data:

- **163 runs** with the real 58 succeeded / 83 failed / 22 other split
- **11 workflows**, **17 agents**, **32 tools**
- **6 connections, 3 of them failed** — including the `Postgres Answers` failure and its incident
- runs long enough to exercise Ribbon compression (>40 nodes) and ID middle-truncation

Fixtures are typed against the same domain types the components consume, are imported by Storybook
stories and Playwright visual tests, and must never be imported by production route code.
