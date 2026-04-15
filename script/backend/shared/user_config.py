import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


USER_BEHAVIOR_CONFIG_VERSION = 1
USER_BEHAVIOR_FILE_NAME = "luoke_user_config.json"
DEFAULT_ACTION_BAR_SLOT = 2


@dataclass(frozen=True)
class ScriptUserBehavior:
    action_bar_slot: int = DEFAULT_ACTION_BAR_SLOT


@dataclass(frozen=True)
class UserBehaviorConfig:
    solo: ScriptUserBehavior = field(default_factory=ScriptUserBehavior)
    double: ScriptUserBehavior = field(default_factory=ScriptUserBehavior)


def require_action_bar_slot(name: str, value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} must be an integer")
    if value < 1 or value > 9:
        raise ValueError(f"{name} must be between 1 and 9")
    return value


def default_user_behavior_payload() -> dict[str, Any]:
    return {
        "version": USER_BEHAVIOR_CONFIG_VERSION,
        "solo": {
            "action_bar_slot": DEFAULT_ACTION_BAR_SLOT,
        },
        "double": {
            "action_bar_slot": DEFAULT_ACTION_BAR_SLOT,
        },
    }


def write_user_behavior_config(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = default_user_behavior_payload()
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def normalize_script_user_behavior(name: str, raw: Any) -> ScriptUserBehavior:
    if raw is None:
        return ScriptUserBehavior()
    if not isinstance(raw, dict):
        raise ValueError(f"{name} must be an object")
    return ScriptUserBehavior(
        action_bar_slot=require_action_bar_slot(
            f"{name}.action_bar_slot",
            raw.get("action_bar_slot", DEFAULT_ACTION_BAR_SLOT),
        ),
    )


def normalize_user_behavior_config(raw: Any) -> UserBehaviorConfig:
    if not isinstance(raw, dict):
        raise ValueError("Configuration must be a JSON object")

    version = raw.get("version", USER_BEHAVIOR_CONFIG_VERSION)
    if version != USER_BEHAVIOR_CONFIG_VERSION:
        raise ValueError(f"Unsupported config version: {version}")

    return UserBehaviorConfig(
        solo=normalize_script_user_behavior("solo", raw.get("solo")),
        double=normalize_script_user_behavior("double", raw.get("double")),
    )


def load_or_create_user_behavior_config(path: Path) -> tuple[UserBehaviorConfig, bool]:
    created = False
    if not path.exists():
        write_user_behavior_config(path)
        created = True

    payload = json.loads(path.read_text(encoding="utf-8"))
    return normalize_user_behavior_config(payload), created


def resolve_user_behavior_config_path(project_root: Path) -> Path:
    if getattr(sys, "frozen", False):
        portable_dir = os.environ.get("PORTABLE_EXECUTABLE_DIR")
        if portable_dir:
            return Path(portable_dir).expanduser().resolve(strict=False) / USER_BEHAVIOR_FILE_NAME
        return Path.cwd() / USER_BEHAVIOR_FILE_NAME
    return project_root / USER_BEHAVIOR_FILE_NAME


def action_bar_slot_to_vk(slot: int) -> int:
    return 0x30 + slot
