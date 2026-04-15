---
name: luoke-script-handoff
description: Understand, maintain, and hand off this Luoke Kingdom Windows automation repository. Use when Codex needs repository onboarding, architecture context, launcher/backend contract details, packaging guidance, risk analysis, or a safe starting point before changing the launcher, backend variants, runtime protocol, or release flow in this repo.
---

# Luoke Script Handoff

Build context in this order:

1. Read `docs/project-handoff.md` for the high-level architecture, runtime flow, release path, and current shortcomings.
2. Read `references/project-map.md` when you need a compact map from user-facing behavior to code locations.
3. Read `references/known-risks.md` before refactors, packaging changes, runtime protocol changes, or hotkey logic edits.
4. Use the source files only after you know which layer you are touching.

Follow these routing rules:

- For launcher process lifecycle, runtime discovery, start/stop behavior, or packaging entry points, inspect `launcher/src/main.ts` first.
- For launcher UI changes, inspect `launcher/src/renderer.tsx`, `launcher/src/preload.ts`, and `launcher/styles.css`.
- For macro behavior, hotkeys, admin elevation, DPAPI profile handling, logging, or window focus behavior, inspect `backend/shared/luoke_macro.py` first.
- For config schema or step validation, inspect `backend/shared/config.py`.
- For launcher/backend file protocol, inspect `backend/shared/runtime_io.py` and the snapshot handling in `launcher/src/main.ts`.
- For mode-specific behavior, inspect only the tiny entry files in `backend/solo`, `backend/double`, and `backend/doubleLaugh` after understanding the shared engine.
- For release or packaging issues, inspect `launcher/package.json`, `launcher/build-backend-if-needed.cjs`, and the three `*.spec` files.

Use these repo assumptions:

- This project is Windows-only in practice.
- The launcher is an Electron shell; the real automation is Python.
- The launcher and backend communicate through JSON files under `%LOCALAPPDATA%\\LuokeMacroHotkey`.
- All current script modes are thin wrappers over one shared Python runtime.
- Admin elevation is part of the normal backend startup path.

Use this maintenance workflow:

1. Identify whether the change belongs to `launcher`, `backend/shared`, or one of the three mode wrappers.
2. Check whether the change affects the launcher/backend JSON contract.
3. Check whether the change affects all variants or only one variant.
4. Prefer changing `backend/shared` once rather than copying logic into mode wrappers.
5. Rebuild or repackage only after basic source-level validation succeeds.

Use this validation checklist after meaningful changes:

- Run `npx tsc --project tsconfig.json --noEmit` in `launcher/`.
- Run `npm run build` in `launcher/`.
- Run `py -3 -m py_compile backend/shared/config.py backend/shared/runtime_io.py backend/shared/luoke_macro.py backend/solo/luoke_macro_hotkey.py backend/double/luoke_macro_hotkey_double.py backend/doubleLaugh/luoke_macro_hotkey_double_laugh.py` at repo root.
- If packaging behavior changed, run `npm run package:folder` in `launcher/`.

Watch for these handoff traps:

- `backend/shared/luoke_macro.py` and `launcher/src/main.ts` are still the two main complexity hotspots.
- The repo contains stale naming from the earlier `SoloBow` phase; do not assume product naming, package metadata, and docs are fully synchronized.
- PowerShell and Windows console encoding can make Chinese text look broken even when the source file is UTF-8.
- Generated packaging artifacts can be mistaken for source files; keep edits focused on real source locations.

When summarizing or handing off work, always call out:

- Which layer changed: launcher UI, launcher process control, shared backend runtime, or variant wrapper.
- Whether the JSON runtime contract changed.
- Whether packaging or only source-mode execution was verified.
- Any Windows/admin-rights assumptions that the next maintainer must preserve.
