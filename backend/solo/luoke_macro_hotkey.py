import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.shared.luoke_macro import (
    COMMON_STEPS_PREFIX,
    WAIT_AFTER_DIALOG_MS,
    WAIT_RANDOM_EXTRA_MS,
    run_luoke_macro,
)


STATUS_FILE_NAME = "launcher_status.json"
COMMAND_FILE_NAME = "launcher_command.json"

DEFAULT_STEPS = COMMON_STEPS_PREFIX + (
    {
        "action": "wait_random",
        "base_ms": WAIT_AFTER_DIALOG_MS,
        "random_extra_ms": WAIT_RANDOM_EXTRA_MS,
    },
)


def main() -> None:
    run_luoke_macro(
        script_path=Path(__file__).resolve(),
        default_steps=DEFAULT_STEPS,
        status_file_name=STATUS_FILE_NAME,
        command_file_name=COMMAND_FILE_NAME,
        support_combo=False,
    )


if __name__ == "__main__":
    main()
