# Known Risks

## High-risk areas

- `backend/shared/luoke_macro.py` is still a large mixed-responsibility file.
  Small edits here can affect hotkeys, window focus, admin elevation, profile loading, runtime status writes, and shutdown behavior at once.
- `launcher/src/main.ts` is also a large mixed-responsibility file.
  Small edits here can affect process discovery, variant routing, snapshot state, packaging assumptions, and stop behavior.
- The launcher/backend contract is file-based and implicit.
  Renaming fields or changing state semantics can silently break the renderer.

## Operational risks

- The backend expects Windows APIs, foreground-window behavior, and administrator elevation.
- Start and stop flows depend on PowerShell plus process polling, which are harder to test than a pure in-process design.
- Runtime files live in `%LOCALAPPDATA%`, so stale files from previous runs can affect observed state.
- Logs are intentionally truncated, so debugging from the UI alone has limited history.

## Handoff risks

- Product naming is partially migrated.
  The packaged app is now `洛克刷花脚本`, but repository identifiers and some metadata still say `SoloBow`.
- README and planning docs do not yet fully reflect the current three-mode launcher and the latest packaging setup.
- Build artifacts and historical packaging leftovers can distract maintainers from the true source files.

## Validation risks

- There is still no automated test suite for the core logic.
- Most confidence currently comes from `tsc`, frontend build success, Python compile checks, and manual runtime testing.
- Packaging success does not guarantee runtime success after elevation or hotkey capture.

## Practical guardrails

- Touch shared backend code only after identifying which variants depend on the behavior.
- Avoid changing status payload fields unless the launcher is updated and revalidated in the same pass.
- Keep release verification separate from source-mode verification.
- Prefer adding documentation and small validations before large refactors in the shared engine.
