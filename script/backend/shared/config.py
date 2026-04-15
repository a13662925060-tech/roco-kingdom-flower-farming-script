from dataclasses import dataclass, field
from typing import Any


@dataclass
class MacroConfig:
    focus_class: str = ""
    steps: list[dict[str, Any]] = field(default_factory=list)


def clone_steps(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [dict(step) for step in steps]


def make_default_config(default_steps: tuple[dict[str, Any], ...]) -> MacroConfig:
    return MacroConfig(steps=clone_steps(list(default_steps)))


def require_nonnegative_int(name: str, value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} must be an integer")
    if value < 0:
        raise ValueError(f"{name} must be greater than or equal to 0")
    return value


def normalize_step(index: int, step: Any, *, support_combo: bool = False) -> dict[str, Any]:
    if not isinstance(step, dict):
        raise ValueError(f"steps[{index}] must be an object")

    action = step.get("action")
    if action == "wait":
        return {
            "action": "wait",
            "ms": require_nonnegative_int(f"steps[{index}].ms", step.get("ms")),
        }
    if action == "tap":
        return {
            "action": "tap",
            "vk": require_nonnegative_int(f"steps[{index}].vk", step.get("vk")),
            "hold_ms": require_nonnegative_int(f"steps[{index}].hold_ms", step.get("hold_ms")),
        }
    if action == "wait_random":
        return {
            "action": "wait_random",
            "base_ms": require_nonnegative_int(f"steps[{index}].base_ms", step.get("base_ms")),
            "random_extra_ms": require_nonnegative_int(
                f"steps[{index}].random_extra_ms",
                step.get("random_extra_ms"),
            ),
        }
    if support_combo and action == "combo":
        return {
            "action": "combo",
            "modifier_vk": require_nonnegative_int(
                f"steps[{index}].modifier_vk",
                step.get("modifier_vk"),
            ),
            "vk": require_nonnegative_int(f"steps[{index}].vk", step.get("vk")),
            "lead_ms": require_nonnegative_int(f"steps[{index}].lead_ms", step.get("lead_ms")),
            "hold_ms": require_nonnegative_int(f"steps[{index}].hold_ms", step.get("hold_ms")),
        }
    raise ValueError(f"steps[{index}].action contains an unsupported action")


def normalize_macro_config(
    raw: Any,
    *,
    profile_version: int,
    default_steps: tuple[dict[str, Any], ...],
    support_combo: bool = False,
) -> MacroConfig:
    if not isinstance(raw, dict):
        raise ValueError("Configuration must be a JSON object")

    version = raw.get("version", profile_version)
    if version != profile_version:
        raise ValueError(f"Unsupported config version: {version}")

    focus_class = raw.get("focus_class", "")
    if focus_class is None:
        focus_class = ""
    if not isinstance(focus_class, str):
        raise ValueError("focus_class must be a string")

    raw_steps = raw.get("steps", clone_steps(list(default_steps)))
    if not isinstance(raw_steps, list) or not raw_steps:
        raise ValueError("steps must be a non-empty list")

    return MacroConfig(
        focus_class=focus_class,
        steps=[
            normalize_step(index, step, support_combo=support_combo)
            for index, step in enumerate(raw_steps)
        ],
    )


def macro_config_to_payload(config: MacroConfig, *, profile_version: int) -> dict[str, Any]:
    return {
        "version": profile_version,
        "focus_class": config.focus_class,
        "steps": clone_steps(config.steps),
    }
