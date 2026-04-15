import json
import os
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional


def local_appdata_dir() -> Path:
    local_appdata = os.environ.get("LOCALAPPDATA")
    if not local_appdata:
        local_appdata = str(Path.home() / "AppData" / "Local")
    return Path(local_appdata)


def default_profile_path(profile_dir_name: str, profile_file_name: str) -> Path:
    return local_appdata_dir() / profile_dir_name / profile_file_name


def default_status_path(profile_dir_name: str, status_file_name: str) -> Path:
    return local_appdata_dir() / profile_dir_name / status_file_name


def default_command_path(profile_dir_name: str, command_file_name: str) -> Path:
    return local_appdata_dir() / profile_dir_name / command_file_name


def current_timestamp_ms() -> int:
    return int(time.time() * 1000)


def current_time_label() -> str:
    return datetime.now().strftime("%H:%M:%S")


def write_json_atomically(
    path: Path,
    payload: dict[str, Any],
    *,
    retry_count: int,
    retry_delay_ms: int,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload_text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    temp_path = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    temp_path.write_text(payload_text, encoding="utf-8")

    last_error: Optional[PermissionError] = None
    for _ in range(retry_count):
        try:
            os.replace(temp_path, path)
            return
        except PermissionError as exc:
            last_error = exc
            time.sleep(retry_delay_ms / 1000.0)

    try:
        temp_path.unlink()
    except FileNotFoundError:
        pass

    if last_error is not None:
        raise last_error
    raise RuntimeError(f"Unable to write status file: {path}")


def safe_unlink(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    except PermissionError:
        pass


def read_runtime_pid(status_path: Path) -> Optional[int]:
    if not status_path.exists():
        return None

    try:
        payload = json.loads(status_path.read_text(encoding="utf-8"))
    except Exception:
        return None

    pid = payload.get("pid")
    if isinstance(pid, int) and pid > 0:
        return pid
    return None


def cleanup_runtime_artifacts(status_path: Path, command_path: Path) -> None:
    safe_unlink(command_path)
    safe_unlink(status_path)


def cleanup_stale_runtime_artifacts(
    status_path: Path,
    command_path: Path,
    *,
    is_pid_running: Callable[[int], bool],
) -> None:
    if not status_path.exists() and not command_path.exists():
        return

    stale_pid = read_runtime_pid(status_path)
    if stale_pid is None or not is_pid_running(stale_pid):
        cleanup_runtime_artifacts(status_path, command_path)


def make_runtime_status(
    *,
    focus_class: str,
    dry_run: bool,
    status_schema_version: int,
    hint: str,
    hotkeys: list[dict[str, str]],
) -> dict[str, Any]:
    now_ms = current_timestamp_ms()
    return {
        "version": status_schema_version,
        "pid": os.getpid(),
        "started_at_ms": now_ms,
        "updated_at_ms": now_ms,
        "phase": "starting",
        "status_label": "启动中",
        "running": False,
        "cycle": 0,
        "focus_class": focus_class,
        "target_hwnd": 0,
        "dry_run": dry_run,
        "hint": hint,
        "hotkeys": hotkeys,
        "logs": [],
    }


def append_runtime_log(
    runtime_status: dict[str, Any],
    message: str,
    level: str,
    *,
    log_limit: int,
) -> None:
    logs = runtime_status.setdefault("logs", [])
    logs.insert(
        0,
        {
            "message": message,
            "level": level,
            "time": current_time_label(),
            "timestamp_ms": current_timestamp_ms(),
            "cycle": int(runtime_status.get("cycle", 0)),
        },
    )
    del logs[log_limit:]


def flush_runtime_status(
    status_path: Path,
    runtime_status: dict[str, Any],
    *,
    retry_count: int,
    retry_delay_ms: int,
) -> None:
    write_json_atomically(
        status_path,
        runtime_status,
        retry_count=retry_count,
        retry_delay_ms=retry_delay_ms,
    )


def read_launcher_command(command_path: Path) -> Optional[str]:
    if not command_path.exists():
        return None

    try:
        payload = json.loads(command_path.read_text(encoding="utf-8"))
        command = payload.get("command")
        return command if isinstance(command, str) else None
    except Exception:
        return None
    finally:
        try:
            command_path.unlink()
        except FileNotFoundError:
            pass


def publish_runtime_status(
    status_path: Path,
    status_lock: threading.Lock,
    runtime_status: dict[str, Any],
    *,
    log_limit: int,
    retry_count: int,
    retry_delay_ms: int,
    message: Optional[str] = None,
    level: str = "info",
    print_message: bool = True,
    **changes: Any,
) -> None:
    if message is not None and print_message:
        print(message)

    with status_lock:
        runtime_status.update(changes)
        runtime_status["updated_at_ms"] = current_timestamp_ms()
        if message is not None:
            runtime_status["last_message"] = message
            append_runtime_log(runtime_status, message, level, log_limit=log_limit)
        flush_runtime_status(
            status_path,
            runtime_status,
            retry_count=retry_count,
            retry_delay_ms=retry_delay_ms,
        )
