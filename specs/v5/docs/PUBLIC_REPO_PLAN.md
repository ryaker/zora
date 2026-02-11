# Zora v0.5 - Public Repo Plan (No Overwrites)

This plan assumes we do not overwrite existing files. New files are created under docs_v5 or as new top-level files for later review.

## Recommended repository layout (public)

- `README.md` (existing)
- `ZORA_AGENT_SPEC.md` (existing v0.5)
- `IMPLEMENTATION_PLAN.md` (existing, update later)
- `docs/` (new, when ready to publish)
- `LICENSE` (new)
- `CONTRIBUTING.md` (new)
- `CODE_OF_CONDUCT.md` (new)
- `SECURITY.md` (new)
- `.github/ISSUE_TEMPLATE/` (new)
- `.github/PULL_REQUEST_TEMPLATE.md` (new)

## Public-facing docs to add

- `docs/QUICK_START.md`
- `docs/SECURITY_DEFAULTS.md`
- `docs/CONFIGURATION.md`
- `docs/ARCHITECTURE.md`
- `docs/POLICY_REFERENCE.md`

## Proposed new files (drafts)

- `docs_v5/ONBOARDING_INSTALL.md`
- `docs_v5/SECURITY_DEFAULTS.md`
- `docs_v5/AI_WALKTHROUGH_PROMPT.md`

These drafts can be copied into `docs/` when you are ready to publish. This avoids overwriting existing files.

## Public repo checklist

1. Remove private email addresses and internal hostnames from docs.
2. Confirm all paths are examples (no real home directories unless clearly marked).
3. Add `LICENSE` and `SECURITY.md`.
4. Add `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`.
5. Ensure README references existing docs only.
6. Add `.gitignore` for local state if needed.
7. Add release badge or label: "Developer Preview".
