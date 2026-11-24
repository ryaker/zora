# Contributing

Thanks for your interest in contributing to Zora.

## What this repo is today

This repository is spec-first. Code will land after the core architecture and security model are stable. Contributions are welcome in documentation, design review, and implementation scaffolding.

## How to contribute

1. Open an issue describing the change.
2. Keep scope focused and aligned with the current spec under `specs/`.
3. Use clear, atomic commits.

## Dependencies

The repo-root `.npmrc` sets `min-release-age=3`: npm 11.10.0 or newer will not resolve versions published in the last 3 days, including transitive dependencies. Older npm is not expected to enforce it. There is no contributor-level exemption: do not pass `--min-release-age=0` or edit `.npmrc` to bypass the gate. Any exemption needs Richard's prior approval on issue #217. `npm ci --ignore-scripts` (what CI runs) installs from the committed lockfile; a dry run with this `.npmrc` completed cleanly.

## Proposals

If you are proposing architectural changes, please include:
- Problem statement
- Alternatives considered
- Impact on security policy and provider routing

## Code of Conduct

By participating, you agree to abide by the Code of Conduct in `CODE_OF_CONDUCT.md`.
