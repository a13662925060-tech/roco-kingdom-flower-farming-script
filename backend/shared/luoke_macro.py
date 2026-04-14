import argparse
import ctypes
import json
import random
import subprocess
import sys
import threading
import time
from ctypes import wintypes
from pathlib import Path
from typing import Any, Callable, Optional

from backend.shared.config import (
    MacroConfig,
    macro_config_to_payload as shared_macro_config_to_payload,
    make_default_config,
    normalize_macro_config as shared_normalize_macro_config,
)
from backend.shared.runtime_io import (
    cleanup_runtime_artifacts,
    cleanup_stale_runtime_artifacts as shared_cleanup_stale_runtime_artifacts,
    default_command_path,
    default_profile_path,
    default_status_path,
    make_runtime_status as shared_make_runtime_status,
    publish_runtime_status as shared_publish_runtime_status,
    read_launcher_command,
    safe_unlink,
)


WH_KEYBOARD_LL = 13
HC_ACTION = 0
WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101
WM_SYSKEYDOWN = 0x0104
WM_SYSKEYUP = 0x0105
PM_REMOVE = 0x0001
WM_QUIT = 0x0012

VK_TAB = 0x09
VK_2 = 0x32
VK_ESCAPE = 0x1B
VK_SPACE = 0x20
VK_SHIFT = 0x10
VK_R = 0x52
VK_X = 0x58
VK_F8 = 0x77
VK_F9 = 0x78

WAIT_AFTER_DIALOG_MS = 7500
WAIT_RANDOM_EXTRA_MS = 1000

CTRL_C_EVENT = 0
CTRL_BREAK_EVENT = 1
CTRL_CLOSE_EVENT = 2
CTRL_LOGOFF_EVENT = 5
CTRL_SHUTDOWN_EVENT = 6

INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_SCANCODE = 0x0008
MAPVK_VK_TO_VSC = 0
LLKHF_INJECTED = 0x0010
CRYPTPROTECT_UI_FORBIDDEN = 0x0001
FILE_ATTRIBUTE_ENCRYPTED = 0x4000
INVALID_FILE_ATTRIBUTES = 0xFFFFFFFF
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
STILL_ACTIVE = 259

PROFILE_VERSION = 1
PROFILE_DESCRIPTION = "LuokeMacroHotkey private profile"
PROFILE_ENTROPY = b"LuokeMacroHotkey/private-profile"
PROFILE_DIR_NAME = "LuokeMacroHotkey"
PROFILE_FILE_NAME = "private_profile.dpapi"

STATUS_SCHEMA_VERSION = 1
STATUS_LOG_LIMIT = 40
STATUS_WRITE_RETRY_COUNT = 40
STATUS_WRITE_RETRY_DELAY_MS = 25

HOTKEY_HINT = "请先用鼠标选中需要运行脚本的窗口，再按 F8 执行。"
HOTKEYS = [
    {"key": "F8", "description": "开始/暂停"},
    {"key": "F9", "description": "退出脚本"},
]

COMMON_STEPS_PREFIX = (
    {"action": "wait", "ms": 600},
    {"action": "tap", "vk": VK_TAB, "hold_ms": 800},
    {"action": "wait", "ms": 400},
    {"action": "wait", "ms": 480},
    {"action": "tap", "vk": VK_2, "hold_ms": 120},
    {"action": "wait", "ms": 350},
    {"action": "wait", "ms": 480},
    {"action": "tap", "vk": VK_ESCAPE, "hold_ms": 100},
    {"action": "wait", "ms": 400},
    {"action": "tap", "vk": VK_SPACE, "hold_ms": 100},
)


ULONG_PTR = wintypes.WPARAM
LPBYTE = ctypes.POINTER(ctypes.c_ubyte)

user32 = ctypes.windll.user32
shell32 = ctypes.windll.shell32
kernel32 = ctypes.windll.kernel32
crypt32 = ctypes.windll.crypt32
user32.MapVirtualKeyW.argtypes = (wintypes.UINT, wintypes.UINT)
user32.MapVirtualKeyW.restype = wintypes.UINT
user32.SendInput.argtypes = (wintypes.UINT, ctypes.c_void_p, ctypes.c_int)
user32.SendInput.restype = wintypes.UINT
user32.GetAsyncKeyState.argtypes = (ctypes.c_int,)
user32.GetAsyncKeyState.restype = ctypes.c_short
user32.FindWindowW.argtypes = (wintypes.LPCWSTR, wintypes.LPCWSTR)
user32.FindWindowW.restype = wintypes.HWND
user32.GetForegroundWindow.argtypes = ()
user32.GetForegroundWindow.restype = wintypes.HWND
user32.IsWindow.argtypes = (wintypes.HWND,)
user32.IsWindow.restype = wintypes.BOOL
user32.ShowWindow.argtypes = (wintypes.HWND, ctypes.c_int)
user32.ShowWindow.restype = wintypes.BOOL
user32.SetForegroundWindow.argtypes = (wintypes.HWND,)
user32.SetForegroundWindow.restype = wintypes.BOOL
user32.CallNextHookEx.argtypes = (wintypes.HHOOK, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
user32.CallNextHookEx.restype = wintypes.LPARAM
user32.SetWindowsHookExW.argtypes = (ctypes.c_int, ctypes.c_void_p, wintypes.HINSTANCE, wintypes.DWORD)
user32.SetWindowsHookExW.restype = wintypes.HHOOK
user32.UnhookWindowsHookEx.argtypes = (wintypes.HHOOK,)
user32.UnhookWindowsHookEx.restype = wintypes.BOOL
user32.PeekMessageW.argtypes = (
    ctypes.POINTER(wintypes.MSG),
    wintypes.HWND,
    wintypes.UINT,
    wintypes.UINT,
    wintypes.UINT,
)
user32.PeekMessageW.restype = wintypes.BOOL
user32.PostQuitMessage.argtypes = (ctypes.c_int,)
user32.PostQuitMessage.restype = None
shell32.IsUserAnAdmin.restype = wintypes.BOOL
shell32.ShellExecuteW.argtypes = (
    wintypes.HWND,
    wintypes.LPCWSTR,
    wintypes.LPCWSTR,
    wintypes.LPCWSTR,
    wintypes.LPCWSTR,
    ctypes.c_int,
)
shell32.ShellExecuteW.restype = wintypes.HINSTANCE
kernel32.GetModuleHandleW.argtypes = (wintypes.LPCWSTR,)
kernel32.GetModuleHandleW.restype = wintypes.HMODULE
kernel32.GetFileAttributesW.argtypes = (wintypes.LPCWSTR,)
kernel32.GetFileAttributesW.restype = wintypes.DWORD
kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
kernel32.OpenProcess.restype = wintypes.HANDLE
kernel32.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
kernel32.GetExitCodeProcess.restype = wintypes.BOOL
kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
kernel32.CloseHandle.restype = wintypes.BOOL
kernel32.SetConsoleCtrlHandler.argtypes = (ctypes.c_void_p, wintypes.BOOL)
kernel32.SetConsoleCtrlHandler.restype = wintypes.BOOL
kernel32.LocalFree.argtypes = (ctypes.c_void_p,)
kernel32.LocalFree.restype = ctypes.c_void_p


LowLevelKeyboardProc = ctypes.WINFUNCTYPE(
    wintypes.LPARAM,
    ctypes.c_int,
    wintypes.WPARAM,
    wintypes.LPARAM,
)
ConsoleCtrlHandler = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD),
    ]


class INPUTUNION(ctypes.Union):
    _fields_ = [
        ("mi", MOUSEINPUT),
        ("ki", KEYBDINPUT),
        ("hi", HARDWAREINPUT),
    ]


class INPUT(ctypes.Structure):
    _anonymous_ = ("union",)
    _fields_ = [
        ("type", wintypes.DWORD),
        ("union", INPUTUNION),
    ]


class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("vkCode", wintypes.DWORD),
        ("scanCode", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", LPBYTE),
    ]


crypt32.CryptProtectData.argtypes = (
    ctypes.POINTER(DATA_BLOB),
    wintypes.LPCWSTR,
    ctypes.POINTER(DATA_BLOB),
    ctypes.c_void_p,
    ctypes.c_void_p,
    wintypes.DWORD,
    ctypes.POINTER(DATA_BLOB),
)
crypt32.CryptProtectData.restype = wintypes.BOOL
crypt32.CryptUnprotectData.argtypes = (
    ctypes.POINTER(DATA_BLOB),
    ctypes.POINTER(wintypes.LPWSTR),
    ctypes.POINTER(DATA_BLOB),
    ctypes.c_void_p,
    ctypes.c_void_p,
    wintypes.DWORD,
    ctypes.POINTER(DATA_BLOB),
)
crypt32.CryptUnprotectData.restype = wintypes.BOOL


def sleep_ms(ms: int) -> None:
    time.sleep(ms / 1000.0)


def interruptible_sleep_ms(
    ms: int,
    should_continue: Optional[Callable[[], bool]] = None,
    chunk_ms: int = 15,
) -> bool:
    if should_continue is None:
        sleep_ms(ms)
        return True

    deadline = time.perf_counter() + (ms / 1000.0)
    while True:
        if not should_continue():
            return False
        remaining = deadline - time.perf_counter()
        if remaining <= 0:
            return True
        time.sleep(min(chunk_ms / 1000.0, remaining))


def make_data_blob(data: bytes) -> tuple[DATA_BLOB, Any]:
    if not data:
        return DATA_BLOB(0, None), None

    buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    return DATA_BLOB(len(data), ctypes.cast(buffer, LPBYTE)), buffer


def free_local_memory(pointer: Any) -> None:
    if pointer:
        kernel32.LocalFree(ctypes.cast(pointer, ctypes.c_void_p))


def protect_bytes(data: bytes) -> bytes:
    input_blob, _input_buffer = make_data_blob(data)
    entropy_blob, _entropy_buffer = make_data_blob(PROFILE_ENTROPY)
    output_blob = DATA_BLOB()

    result = crypt32.CryptProtectData(
        ctypes.byref(input_blob),
        PROFILE_DESCRIPTION,
        ctypes.byref(entropy_blob),
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(output_blob),
    )
    if not result:
        raise ctypes.WinError()

    try:
        return ctypes.string_at(output_blob.pbData, output_blob.cbData)
    finally:
        free_local_memory(output_blob.pbData)


def unprotect_bytes(data: bytes) -> bytes:
    input_blob, _input_buffer = make_data_blob(data)
    entropy_blob, _entropy_buffer = make_data_blob(PROFILE_ENTROPY)
    output_blob = DATA_BLOB()
    description = wintypes.LPWSTR()

    result = crypt32.CryptUnprotectData(
        ctypes.byref(input_blob),
        ctypes.byref(description),
        ctypes.byref(entropy_blob),
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(output_blob),
    )
    if not result:
        raise ctypes.WinError()

    try:
        return ctypes.string_at(output_blob.pbData, output_blob.cbData)
    finally:
        free_local_memory(description)
        free_local_memory(output_blob.pbData)


def load_private_profile(
    path: Path,
    *,
    normalize_macro_config: Callable[[Any], MacroConfig],
) -> MacroConfig:
    raw = path.read_bytes()
    payload = json.loads(unprotect_bytes(raw).decode("utf-8"))
    return normalize_macro_config(payload)


def save_private_profile(
    path: Path,
    config: MacroConfig,
    *,
    macro_config_to_payload: Callable[[MacroConfig], dict[str, Any]],
) -> None:
    payload = macro_config_to_payload(config)
    encrypted = protect_bytes(
        json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encrypted)


def find_existing_path(path: Path) -> Optional[Path]:
    current = path.resolve(strict=False)
    while True:
        if current.exists():
            return current
        if current.parent == current:
            return None
        current = current.parent


def get_efs_status(path: Path) -> tuple[Optional[Path], Optional[bool]]:
    anchor = find_existing_path(path)
    if anchor is None:
        return None, None

    attributes = kernel32.GetFileAttributesW(str(anchor))
    if attributes == INVALID_FILE_ATTRIBUTES:
        return anchor, None
    return anchor, bool(attributes & FILE_ATTRIBUTE_ENCRYPTED)


def format_efs_status(path: Path) -> str:
    anchor, is_encrypted = get_efs_status(path)
    if anchor is None:
        return "未知"
    if is_encrypted is None:
        return f"未知（{anchor}）"
    if anchor == path.resolve(strict=False):
        scope = "当前路径"
    else:
        scope = f"最近存在的上级路径 {anchor}"
    return f"{'是' if is_encrypted else '否'}（{scope}）"


def print_privacy_status(script_path: Path, profile_path: Optional[Path]) -> None:
    print("隐私状态：")
    print(f"脚本路径 EFS 加密：{format_efs_status(script_path)}")
    if profile_path is not None:
        print(f"配置目标路径 EFS 加密：{format_efs_status(profile_path)}")
    print("说明：这里只检查 NTFS EFS，不检查 BitLocker 或设备加密。")


def send_key(vk: int, is_keyup: bool) -> None:
    scan = user32.MapVirtualKeyW(vk, MAPVK_VK_TO_VSC)
    if scan == 0:
        raise ValueError(f"MapVirtualKeyW 无法处理虚拟按键 {vk}")

    flags = KEYEVENTF_SCANCODE | (KEYEVENTF_KEYUP if is_keyup else 0)
    event = INPUT(
        type=INPUT_KEYBOARD,
        union=INPUTUNION(
            ki=KEYBDINPUT(
                wVk=0,
                wScan=scan,
                dwFlags=flags,
                time=0,
                dwExtraInfo=0,
            )
        ),
    )
    sent = user32.SendInput(1, ctypes.byref(event), ctypes.sizeof(INPUT))
    if sent != 1:
        raise ctypes.WinError()


def tap_key(
    vk: int,
    hold_ms: int,
    should_continue: Optional[Callable[[], bool]] = None,
) -> bool:
    send_key(vk, is_keyup=False)
    try:
        return interruptible_sleep_ms(hold_ms, should_continue=should_continue)
    finally:
        send_key(vk, is_keyup=True)


def press_modified_key(
    modifier_vk: int,
    vk: int,
    lead_ms: int,
    hold_ms: int,
    should_continue: Optional[Callable[[], bool]] = None,
) -> bool:
    send_key(modifier_vk, is_keyup=False)
    try:
        if lead_ms > 0 and not interruptible_sleep_ms(lead_ms, should_continue=should_continue):
            return False
        return tap_key(vk, hold_ms, should_continue=should_continue)
    finally:
        send_key(modifier_vk, is_keyup=True)


def focus_window_by_class(class_name: str) -> bool:
    hwnd = user32.FindWindowW(class_name, None)
    if not hwnd:
        return False
    user32.ShowWindow(hwnd, 5)
    return bool(user32.SetForegroundWindow(hwnd))


def focus_window_by_hwnd(hwnd: int) -> bool:
    if not hwnd or not user32.IsWindow(hwnd):
        return False
    user32.ShowWindow(hwnd, 5)
    return bool(user32.SetForegroundWindow(hwnd))


def is_admin() -> bool:
    try:
        return bool(shell32.IsUserAnAdmin())
    except Exception:
        return False


def ensure_admin(script_path: Path) -> None:
    if is_admin():
        return

    if getattr(sys, "frozen", False):
        executable = sys.executable
        params = subprocess.list2cmdline(sys.argv[1:])
    else:
        executable = sys.executable
        params = subprocess.list2cmdline([str(script_path), *sys.argv[1:]])

    result = shell32.ShellExecuteW(
        None,
        "runas",
        executable,
        params,
        None,
        1,
    )
    if result <= 32:
        raise RuntimeError(f"无法以管理员权限重新启动脚本：{result}")
    raise SystemExit(0)


def is_key_down(vk: int) -> bool:
    return bool(user32.GetAsyncKeyState(vk) & 0x8000)


def is_pid_running(pid: int) -> bool:
    if pid <= 0:
        return False

    process_handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not process_handle:
        return False

    try:
        exit_code = wintypes.DWORD()
        if not kernel32.GetExitCodeProcess(process_handle, ctypes.byref(exit_code)):
            return False
        return exit_code.value == STILL_ACTIVE
    finally:
        kernel32.CloseHandle(process_handle)


def install_console_close_handler(
    status_path: Path,
    command_path: Path,
    running_event: threading.Event,
    shutdown_event: threading.Event,
) -> ConsoleCtrlHandler:
    @ConsoleCtrlHandler
    def handler(ctrl_type: int) -> bool:
        if ctrl_type in (
            CTRL_C_EVENT,
            CTRL_BREAK_EVENT,
            CTRL_CLOSE_EVENT,
            CTRL_LOGOFF_EVENT,
            CTRL_SHUTDOWN_EVENT,
        ):
            running_event.clear()
            shutdown_event.set()
            cleanup_runtime_artifacts(status_path, command_path)
        return False

    if not kernel32.SetConsoleCtrlHandler(handler, True):
        raise ctypes.WinError()
    return handler


def run_once(
    steps: list[dict[str, Any]],
    dry_run: bool = False,
    should_continue: Optional[Callable[[], bool]] = None,
) -> bool:
    if should_continue is None:
        should_continue = lambda: True

    for step in steps:
        if not should_continue():
            return False

        action = step["action"]
        if action == "wait":
            wait_ms = int(step["ms"])
            if dry_run:
                print(f"等待 {wait_ms}ms")
            else:
                if not interruptible_sleep_ms(wait_ms, should_continue=should_continue):
                    return False
            continue

        if action == "wait_random":
            base_ms = int(step["base_ms"])
            random_extra_ms = int(step["random_extra_ms"])
            wait_ms = base_ms + random.randint(0, random_extra_ms)
            if dry_run:
                print(f"等待 {base_ms}ms + 随机 0-{random_extra_ms}ms -> {wait_ms}ms")
            else:
                if not interruptible_sleep_ms(wait_ms, should_continue=should_continue):
                    return False
            continue

        if action == "combo":
            modifier_vk = int(step["modifier_vk"])
            vk = int(step["vk"])
            lead_ms = int(step["lead_ms"])
            hold_ms = int(step["hold_ms"])
            if dry_run:
                print(
                    f"combo modifier_vk={modifier_vk}, vk={vk}, "
                    f"lead_ms={lead_ms}, hold_ms={hold_ms}"
                )
            else:
                if not press_modified_key(
                    modifier_vk,
                    vk,
                    lead_ms,
                    hold_ms,
                    should_continue=should_continue,
                ):
                    return False
            continue

        vk = int(step["vk"])
        hold_ms = int(step["hold_ms"])
        if dry_run:
            print(f"按键 vk={vk}，按住 {hold_ms}ms")
        else:
            if not tap_key(vk, hold_ms, should_continue=should_continue):
                return False

    return True


def parse_args(description: str) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--focus-class",
        default=None,
        help='可选：每轮执行前聚焦的窗口类名，例如 "UnrealWindow"。提供后会覆盖私有配置中的设置。',
    )
    parser.add_argument(
        "--profile",
        default=None,
        help="可选：DPAPI 加密私有配置文件路径。不填时，如果默认 LocalAppData 配置存在就会自动使用。",
    )
    parser.add_argument(
        "--write-profile",
        nargs="?",
        const="",
        default=None,
        metavar="PATH",
        help="把当前设置写入 DPAPI 加密私有配置后退出。不填 PATH 时使用默认 LocalAppData 路径。",
    )
    parser.add_argument(
        "--privacy-status",
        action="store_true",
        help="启动时打印脚本路径和私有配置路径的 EFS 状态。",
    )
    parser.add_argument(
        "--status-file",
        default=None,
        help="可选：运行状态 JSON 文件路径，供外部窗口读取当前状态和日志。",
    )
    parser.add_argument(
        "--command-file",
        default=None,
        help="可选：外部窗口发送控制命令的 JSON 文件路径。",
    )
    parser.add_argument(
        "--start-running",
        action="store_true",
        help="启动后立即开始运行。",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只打印执行步骤，不实际发送按键。",
    )
    return parser.parse_args()


def request_shutdown(
    publish_status: Callable[..., None],
    running_event: threading.Event,
    shutdown_event: threading.Event,
    message: str,
) -> None:
    publish_status(
        message=message,
        level="warn",
        phase="stopping",
        status_label="退出中",
        running=False,
    )
    shutdown_event.set()
    running_event.clear()


def command_watcher(
    command_path: Path,
    running_event: threading.Event,
    shutdown_event: threading.Event,
    publish_status: Callable[..., None],
) -> None:
    while not shutdown_event.is_set():
        command = read_launcher_command(command_path)
        if command in ("stop", "f9"):
            try:
                request_shutdown(
                    publish_status,
                    running_event,
                    shutdown_event,
                    "已请求退出",
                )
            except Exception:
                shutdown_event.set()
                running_event.clear()
            return
        time.sleep(0.2)


def macro_worker(
    running_event: threading.Event,
    shutdown_event: threading.Event,
    focus_class: str,
    target_hwnd_ref: dict[str, int],
    steps: list[dict[str, Any]],
    dry_run: bool,
    publish_status: Callable[..., None],
) -> None:
    cycle = 1

    try:
        while not shutdown_event.is_set():
            if not running_event.wait(0.1):
                continue
            if shutdown_event.is_set():
                break

            if focus_class:
                focused = focus_window_by_class(focus_class)
                print(f"聚焦窗口类 {focus_class!r}：{'成功' if focused else '未找到'}")
                time.sleep(0.1)
            elif target_hwnd_ref.get("hwnd"):
                focus_window_by_hwnd(target_hwnd_ref["hwnd"])
                time.sleep(0.05)

            publish_status(
                message=f"第 {cycle} 轮执行中...",
                level="success",
                phase="running",
                status_label="运行中",
                running=True,
                cycle=cycle,
                target_hwnd=int(target_hwnd_ref.get("hwnd") or 0),
            )
            completed = run_once(
                steps=steps,
                dry_run=dry_run,
                should_continue=lambda: running_event.is_set() and not shutdown_event.is_set(),
            )

            if shutdown_event.is_set():
                break

            if completed:
                cycle += 1
            else:
                publish_status(
                    message="已暂停",
                    level="warn",
                    phase="paused",
                    status_label="已暂停",
                    running=False,
                )
    except Exception as exc:
        running_event.clear()
        publish_status(
            message=f"宏执行线程出错：{exc}",
            level="error",
            phase="error",
            status_label="出错",
            running=False,
        )


def run_luoke_macro(
    *,
    script_path: Path,
    default_steps: tuple[dict[str, Any], ...],
    status_file_name: str,
    command_file_name: str,
    support_combo: bool,
    description: str = "热键宏脚本",
) -> None:
    args = parse_args(description)
    requested_profile_path = (
        Path(args.profile).expanduser().resolve(strict=False)
        if args.profile
        else default_profile_path(PROFILE_DIR_NAME, PROFILE_FILE_NAME)
    )
    status_path = (
        Path(args.status_file).expanduser().resolve(strict=False)
        if args.status_file
        else default_status_path(PROFILE_DIR_NAME, status_file_name)
    )
    command_path = (
        Path(args.command_file).expanduser().resolve(strict=False)
        if args.command_file
        else default_command_path(PROFILE_DIR_NAME, command_file_name)
    )
    config = make_default_config(default_steps)
    active_profile_path: Optional[Path] = None

    def normalize_macro_config(raw: Any) -> MacroConfig:
        return shared_normalize_macro_config(
            raw,
            profile_version=PROFILE_VERSION,
            default_steps=default_steps,
            support_combo=support_combo,
        )

    def macro_config_to_payload(config: MacroConfig) -> dict[str, Any]:
        return shared_macro_config_to_payload(config, profile_version=PROFILE_VERSION)

    shared_cleanup_stale_runtime_artifacts(
        status_path,
        command_path,
        is_pid_running=is_pid_running,
    )

    if requested_profile_path.exists():
        try:
            config = load_private_profile(
                requested_profile_path,
                normalize_macro_config=normalize_macro_config,
            )
            active_profile_path = requested_profile_path
        except Exception as exc:
            raise RuntimeError(
                f"加载私有配置失败 {requested_profile_path}：{exc}"
            ) from exc
    elif args.profile:
        raise FileNotFoundError(f"未找到私有配置文件：{requested_profile_path}")

    if args.focus_class is not None:
        config.focus_class = args.focus_class

    if args.write_profile is not None:
        save_profile_path = (
            default_profile_path(PROFILE_DIR_NAME, PROFILE_FILE_NAME)
            if args.write_profile == ""
            else Path(args.write_profile).expanduser().resolve(strict=False)
        )
        save_private_profile(
            save_profile_path,
            config,
            macro_config_to_payload=macro_config_to_payload,
        )
        print(f"已保存加密私有配置：{save_profile_path}")
        print("配置数据已使用 Windows DPAPI 绑定到当前用户账号。")
        print_privacy_status(script_path, save_profile_path)
        return

    if args.privacy_status:
        print_privacy_status(script_path, active_profile_path or requested_profile_path)

    runtime_status = shared_make_runtime_status(
        focus_class=config.focus_class,
        dry_run=args.dry_run,
        status_schema_version=STATUS_SCHEMA_VERSION,
        hint=HOTKEY_HINT,
        hotkeys=HOTKEYS,
    )
    runtime_status["status_file"] = str(status_path)
    runtime_status["command_file"] = str(command_path)
    if active_profile_path:
        runtime_status["active_profile"] = str(active_profile_path)
    status_lock = threading.Lock()
    safe_unlink(command_path)

    def publish_status(
        *,
        message: Optional[str] = None,
        level: str = "info",
        print_message: bool = True,
        **changes: Any,
    ) -> None:
        shared_publish_runtime_status(
            status_path,
            status_lock,
            runtime_status,
            log_limit=STATUS_LOG_LIMIT,
            retry_count=STATUS_WRITE_RETRY_COUNT,
            retry_delay_ms=STATUS_WRITE_RETRY_DELAY_MS,
            message=message,
            level=level,
            print_message=print_message,
            **changes,
        )

    if not is_admin():
        publish_status(
            message="正在请求管理员权限...",
            level="info",
            phase="elevating",
            status_label="请求管理员权限",
            running=False,
            print_message=False,
        )
    ensure_admin(script_path)

    running_event = threading.Event()
    shutdown_event = threading.Event()
    console_close_handler = install_console_close_handler(
        status_path,
        command_path,
        running_event,
        shutdown_event,
    )
    target_hwnd_ref = {"hwnd": 0}

    publish_status(
        phase="starting",
        status_label="启动中",
        running=False,
        print_message=False,
    )

    worker = threading.Thread(
        target=macro_worker,
        args=(
            running_event,
            shutdown_event,
            config.focus_class,
            target_hwnd_ref,
            config.steps,
            args.dry_run,
            publish_status,
        ),
        daemon=True,
    )
    worker.start()
    command_worker = threading.Thread(
        target=command_watcher,
        args=(
            command_path,
            running_event,
            shutdown_event,
            publish_status,
        ),
        daemon=True,
    )
    command_worker.start()

    if args.start_running:
        running_event.set()

    publish_status(
        message="管理员模式：已开启",
        level="success",
        phase="waiting_hotkey",
        status_label="等待 F8",
        running=bool(args.start_running),
        cycle=0,
        focus_class=config.focus_class,
    )
    publish_status(message="F8：开始/暂停，F9：退出", level="info")
    publish_status(message=HOTKEY_HINT, level="info")
    if active_profile_path:
        publish_status(message=f"私有配置：{active_profile_path}", level="info")
    elif config.focus_class:
        publish_status(message=f"目标窗口类：{config.focus_class}", level="info")
    else:
        publish_status(message="按下 F8 开始时，会记录当前选中的前台窗口。", level="info")

    pressed_hotkeys: set[int] = set()
    hotkey_lock = threading.Lock()
    start_hotkeys = (VK_F8,)
    stop_hotkeys = (VK_F9,)
    watched_hotkeys = start_hotkeys + stop_hotkeys
    hook_ref: dict[str, object] = {"handle": None, "proc": None}
    hotkey_poll_thread: Optional[threading.Thread] = None

    def handle_hotkey(vk: int) -> None:
        if vk in start_hotkeys:
            if running_event.is_set():
                running_event.clear()
                publish_status(
                    message="已请求暂停",
                    level="warn",
                    phase="pausing",
                    status_label="暂停中",
                    running=False,
                )
                return

            if not config.focus_class:
                hwnd = user32.GetForegroundWindow()
                target_hwnd_ref["hwnd"] = int(hwnd or 0)
                publish_status(
                    message=f"已记录目标窗口句柄：{target_hwnd_ref['hwnd']}",
                    level="info",
                    target_hwnd=target_hwnd_ref["hwnd"],
                )
            running_event.set()
            publish_status(
                message="开始运行",
                level="success",
                phase="running",
                status_label="运行中",
                running=True,
                target_hwnd=int(target_hwnd_ref.get("hwnd") or 0),
            )
            return

        publish_status(
            message="已请求退出",
            level="warn",
            phase="stopping",
            status_label="退出中",
            running=False,
        )
        shutdown_event.set()
        running_event.clear()
        user32.PostQuitMessage(0)

    def trigger_hotkey_down(vk: int) -> None:
        with hotkey_lock:
            if vk in pressed_hotkeys:
                return
            pressed_hotkeys.add(vk)
        handle_hotkey(vk)

    def trigger_hotkey_up(vk: int) -> None:
        with hotkey_lock:
            pressed_hotkeys.discard(vk)

    def hotkey_poll_worker() -> None:
        key_states = {vk: False for vk in watched_hotkeys}
        while not shutdown_event.is_set():
            for vk in watched_hotkeys:
                is_down = is_key_down(vk)
                was_down = key_states[vk]
                if is_down and not was_down:
                    trigger_hotkey_down(vk)
                elif not is_down and was_down:
                    trigger_hotkey_up(vk)
                key_states[vk] = is_down
            time.sleep(0.03)

    @LowLevelKeyboardProc
    def keyboard_proc(n_code: int, w_param: int, l_param: int) -> int:
        if n_code == HC_ACTION:
            kb = ctypes.cast(l_param, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents
            vk = int(kb.vkCode)
            if vk in watched_hotkeys:
                if w_param in (WM_KEYDOWN, WM_SYSKEYDOWN):
                    trigger_hotkey_down(vk)
                elif w_param in (WM_KEYUP, WM_SYSKEYUP):
                    trigger_hotkey_up(vk)
                return 1

            if kb.flags & LLKHF_INJECTED:
                return user32.CallNextHookEx(hook_ref["handle"], n_code, w_param, l_param)

        return user32.CallNextHookEx(hook_ref["handle"], n_code, w_param, l_param)

    hook_ref["proc"] = keyboard_proc
    module_handle = kernel32.GetModuleHandleW(None)
    hook_handle = user32.SetWindowsHookExW(WH_KEYBOARD_LL, keyboard_proc, module_handle, 0)
    if not hook_handle:
        raise ctypes.WinError()
    hook_ref["handle"] = hook_handle
    hotkey_poll_thread = threading.Thread(target=hotkey_poll_worker, daemon=True)
    hotkey_poll_thread.start()

    msg = wintypes.MSG()

    try:
        while not shutdown_event.is_set():
            has_message = user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, PM_REMOVE)
            if not has_message:
                time.sleep(0.01)
                continue
            if msg.message == WM_QUIT:
                break
    except KeyboardInterrupt:
        publish_status(
            message="已被用户停止",
            level="warn",
            phase="stopping",
            status_label="退出中",
            running=False,
        )
        shutdown_event.set()
        running_event.clear()
    finally:
        if hook_ref["handle"]:
            user32.UnhookWindowsHookEx(hook_ref["handle"])
        shutdown_event.set()
        running_event.set()
        worker.join(timeout=1.0)
        if hotkey_poll_thread is not None:
            hotkey_poll_thread.join(timeout=1.0)
        command_worker.join(timeout=1.0)
        publish_status(
            message="已退出",
            level="info",
            phase="exited",
            status_label="已退出",
            running=False,
        )
        cleanup_runtime_artifacts(status_path, command_path)
        kernel32.SetConsoleCtrlHandler(console_close_handler, False)
