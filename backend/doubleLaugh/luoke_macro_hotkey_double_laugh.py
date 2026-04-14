import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.shared.luoke_macro import (
    VK_ESCAPE,
    VK_R,
    VK_SHIFT,
    VK_TAB,
    VK_X,
    WAIT_AFTER_DIALOG_MS,
    run_luoke_macro,
)


STATUS_FILE_NAME = "launcher_status_double.json"
COMMAND_FILE_NAME = "launcher_command_double.json"
VK_3 = 0x33

DEFAULT_STEPS = (
    {"action": "wait", "ms": 600},
    {"action": "tap", "vk": VK_TAB, "hold_ms": 800},
    {"action": "wait", "ms": 400},
    {"action": "wait", "ms": 480},
    {"action": "tap", "vk": VK_3, "hold_ms": 120},
    {"action": "wait", "ms": 350},
    {"action": "wait", "ms": 480},
    {"action": "tap", "vk": VK_ESCAPE, "hold_ms": 100},
    {"action": "wait", "ms": 800},
    {"action": "combo", "modifier_vk": VK_SHIFT, "vk": VK_R, "lead_ms": 40, "hold_ms": 100},
    {"action": "wait", "ms": WAIT_AFTER_DIALOG_MS},
    {"action": "combo", "modifier_vk": VK_SHIFT, "vk": VK_X, "lead_ms": 40, "hold_ms": 100},
)


def main() -> None:
    run_luoke_macro(
        script_path=Path(__file__).resolve(),
        default_steps=DEFAULT_STEPS,
        status_file_name=STATUS_FILE_NAME,
        command_file_name=COMMAND_FILE_NAME,
        support_combo=True,
    )


if __name__ == "__main__":
    main()
