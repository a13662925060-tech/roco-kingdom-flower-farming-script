# Project Map

## Product shape

- `launcher/` is the Electron desktop shell.
- `backend/shared/` is the real automation engine and runtime protocol layer.
- `backend/solo/`, `backend/double/`, and `backend/doubleLaugh/` are thin variant entry points.
- `docs/` contains planning notes and now the main handoff document.

## Core files

- `launcher/src/main.ts`
  Owns launcher state, runtime discovery, start/stop flow, privilege escalation via PowerShell, snapshot broadcasting, and cleanup.
- `launcher/src/renderer.tsx`
  Owns the fixed-size desktop UI, mode selection, log display, and button state.
- `launcher/src/preload.ts`
  Exposes the narrow IPC bridge used by the renderer.
- `launcher/styles.css`
  Owns all layout and the compact mode selector styling.
- `backend/shared/luoke_macro.py`
  Owns Win32 API bindings, input simulation, DPAPI profile handling, admin restart, hotkeys, worker threads, focus logic, and runtime log redirection.
- `backend/shared/config.py`
  Owns macro config normalization and step validation.
- `backend/shared/runtime_io.py`
  Owns runtime file paths, JSON writes, command reads, and status/log payload helpers.

## Variant wrappers

- `backend/solo/luoke_macro_hotkey.py`
  Defines the single-window bowing default steps and the solo status/command filenames.
- `backend/double/luoke_macro_hotkey_double.py`
  Defines the double-window bow-jump sequence and enables `combo`.
- `backend/doubleLaugh/luoke_macro_hotkey_double_laugh.py`
  Defines the laugh variant sequence and its own runtime file names.

## Runtime contract

- Status file:
  Stored under `%LOCALAPPDATA%\\LuokeMacroHotkey\\launcher_status*.json`
- Command file:
  Stored under `%LOCALAPPDATA%\\LuokeMacroHotkey\\launcher_command*.json`
- The launcher polls status files and writes command files.
- The backend owns actual execution state and emits logs into the status payload.

## Packaging path

- `launcher/build-backend-if-needed.cjs`
  Rebuilds backend executables when source or shared modules change.
- `launcher/SoloBowBackend.spec`
- `launcher/DoubleBowBackend.spec`
- `launcher/DoubleLaughBowBackend.spec`
- `launcher/package.json`
  Controls Electron build, output naming, and extra backend resources.

## Safe entry points for common tasks

- Rename or add a mode:
  Start with `launcher/src/main.ts` variant config and `launcher/src/renderer.tsx` option list.
- Change a macro sequence:
  Edit only the relevant variant wrapper if the shared engine does not need new behavior.
- Change logging or hotkey behavior:
  Start in `backend/shared/luoke_macro.py`.
- Change runtime status fields:
  Update `backend/shared/runtime_io.py` and then audit `launcher/src/main.ts` snapshot parsing.
- Change packaging:
  Update `launcher/package.json`, `build-backend-if-needed.cjs`, and relevant `*.spec` files together.
