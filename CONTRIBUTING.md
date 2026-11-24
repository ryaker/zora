# Contributing

Thanks for your interest in contributing to Zora.

## What this repo is today

This repository is spec-first. Code will land after the core architecture and security model are stable. Contributions are welcome in documentation, design review, and implementation scaffolding.

## How to contribute

1. Open an issue describing the change.
2. Keep scope focused and aligned with the current spec under `specs/`.
3. Use clear, atomic commits.

## Dependencies

The repo-root `.npmrc` sets `min-release-age=3`: npm (11.x or newer) will not resolve versions published in the last 3 days. Older npm ignores the key. Exemption rule: to adopt a newer release urgently (e.g. a security fix), pass `--min-release-age=0` for that single install, state the package, version and reason in the PR description, and have the reviewer confirm. Do not change `.npmrc` to grant a standing exemption. Lockfile installs (`npm ci`) are unaffected because they use pinned versions.

## Proposals

If you are proposing architectural changes, please include:
- Problem statement
- Alternatives considered
- Impact on security policy and provider routing

## Code of Conduct

By participating, you agree to abide by the Code of Conduct in `CODE_OF_CONDUCT.md`.
