"""Load + validate config.yaml. The file is re-read automatically when it changes."""
from __future__ import annotations

import copy
import logging
from pathlib import Path

import yaml

from .keys import normalize_key, parse_hotkey

log = logging.getLogger("config")

SAFETY_DEFAULTS = {
    "kill_switch_key": "F12",
    "start_paused": True,
    "gap_between_actions_s": 3,
    "max_actions_per_minute": 6,
    "max_hold_s": 10,
    "max_action_s": 20,
    "max_queue_age_s": 180,
    "require_focus": True,
    "focus_process": "VALORANT-Win64-Shipping.exe",
    "when_unfocused": "wait",
    "dry_run": False,
    "tap_ms": 40,
    # Valorant rejects injected mouse clicks (error 87). Every "click: LEFT" step therefore presses this
    # keyboard key instead (bind it as the second Fire key in Valorant). Empty = real mouse click.
    "fire_key": "K",
}
SERVER_DEFAULTS = {"panel_port": 8787, "webhook_port": 8788, "allow_lan": False}
OVERLAY_DEFAULTS = {"template": "{donor} donated {amount} → {action}!", "duration_s": 6,
                    "money_format": "{amount} WHISKAS", "money_divisor": 1000,
                    "default_sound": None}


class ConfigError(Exception):
    pass


def _num(value, what, minimum=0):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < minimum:
        raise ConfigError(f"{what} harus angka >= {minimum} (sekarang: {value!r})")
    return value


def _check_step(step, where, names):
    if not isinstance(step, dict) or len(step) != 1:
        raise ConfigError(f"{where}: setiap step harus satu item, contoh '- tap: SPACE'")
    (kind, arg), = step.items()
    try:
        if kind == "tap":
            keys = [arg] if isinstance(arg, (str, int)) else arg
            return {"tap": [normalize_key(k) for k in keys]}
        if kind == "click":
            button = str(arg).strip().upper()
            if button not in ("LEFT", "RIGHT"):
                raise ConfigError(f"{where}: click harus LEFT atau RIGHT")
            return {"click": button}
        if kind == "random_tap":
            return {"random_tap": [normalize_key(k) for k in arg]}
        if kind == "hold":
            return {"hold": {"key": normalize_key(arg["key"]), "ms": _num(arg["ms"], "hold.ms")}}
        if kind == "wait":
            return {"wait": _num(arg, "wait")}
        if kind == "spam":
            return {"spam": {"key": normalize_key(arg["key"]), "ms": _num(arg["ms"], "spam.ms"),
                             "every": _num(arg.get("every", 150), "spam.every", 20)}}
        if kind == "mouse":
            return {"mouse": {"dx": int(arg.get("dx", 0)), "dy": int(arg.get("dy", 0)),
                              "ms": _num(arg.get("ms", 500), "mouse.ms", 10)}}
        if kind == "jitter":
            return {"jitter": {"ms": _num(arg["ms"], "jitter.ms"),
                               "strength": int(_num(arg.get("strength", 40), "jitter.strength", 1)),
                               "every": _num(arg.get("every", 25), "jitter.every", 10)}}
        if kind == "chaos":
            pool = arg.get("pool", "all")
            if pool != "all":
                unknown = [p for p in pool if p not in names]
                if unknown:
                    raise ConfigError(f"chaos.pool berisi aksi yang tidak ada: {unknown}")
            return {"chaos": {"count": int(_num(arg.get("count", 3), "chaos.count", 1)), "pool": pool}}
    except (KeyError, TypeError) as e:
        raise ConfigError(f"{where}: format step '{kind}' salah ({e})") from e
    except ValueError as e:
        raise ConfigError(f"{where}: {e}") from e
    raise ConfigError(f"{where}: jenis step tidak dikenal '{kind}'. "
                      "Pilihan: tap, random_tap, click, hold, wait, spam, mouse, jitter, chaos")


def validate(raw) -> dict:
    if not isinstance(raw, dict):
        raise ConfigError("config.yaml kosong atau formatnya salah")
    cfg = {
        "safety": {**SAFETY_DEFAULTS, **(raw.get("safety") or {})},
        "server": {**SERVER_DEFAULTS, **(raw.get("server") or {})},
        "overlay": {**OVERLAY_DEFAULTS, **(raw.get("overlay") or {})},
    }
    _num(cfg["overlay"]["money_divisor"], "overlay.money_divisor", 1)
    s = cfg["safety"]
    for k in ("gap_between_actions_s", "max_hold_s", "max_action_s", "max_queue_age_s"):
        _num(s[k], f"safety.{k}")
    _num(s["max_actions_per_minute"], "safety.max_actions_per_minute", 1)
    _num(s["tap_ms"], "safety.tap_ms", 10)
    if s["when_unfocused"] not in ("wait", "skip"):
        raise ConfigError("safety.when_unfocused harus 'wait' atau 'skip'")
    try:
        parse_hotkey(str(s["kill_switch_key"]))
        s["fire_key"] = normalize_key(s["fire_key"]) if s["fire_key"] else None
    except ValueError as e:
        raise ConfigError(f"safety: {e}") from e

    actions_raw = raw.get("actions") or []
    names = [a.get("name") for a in actions_raw if isinstance(a, dict)]
    if len(set(names)) != len(names) or not all(names):
        raise ConfigError("setiap aksi wajib punya 'name' yang unik")
    actions = []
    for a in actions_raw:
        where = f"aksi '{a['name']}'"
        steps = a.get("steps")
        if not steps:
            raise ConfigError(f"{where}: 'steps' wajib diisi")
        actions.append({
            "name": a["name"],
            "min_amount": int(_num(a.get("min_amount"), f"{where}.min_amount", 1)),
            "enabled": bool(a.get("enabled", True)),
            "cooldown_s": _num(a.get("cooldown_s", 0), f"{where}.cooldown_s"),
            "overlay_text": a.get("overlay_text") or a["name"],
            "sound": a.get("sound") or None,
            "steps": [_check_step(st, where, names) for st in steps],
        })
    cfg["actions"] = sorted(actions, key=lambda x: x["min_amount"])
    return cfg


def describe_steps(steps, fire_key=None) -> str:
    """Human summary of an action's input, e.g. 'C/Q/E → tunggu 0.9 dtk → tahan K'."""
    out = []
    for step in steps:
        (kind, arg), = step.items()
        if kind == "tap":
            out.append(" → ".join(arg))
        elif kind == "random_tap":
            out.append("/".join(arg))
        elif kind == "click":
            out.append(f"tahan {fire_key}" if fire_key and arg == "LEFT" else f"KLIK MOUSE {arg}")
        elif kind == "hold":
            out.append(f"tahan {arg['key']}" + (f" {arg['ms'] / 1000:g} dtk" if arg["ms"] >= 1000 else ""))
        elif kind == "wait":
            out.append(f"tunggu {arg / 1000:g} dtk")
        elif kind == "spam":
            out.append(f"{arg['key']} berulang {arg['ms'] / 1000:g} dtk")
        elif kind in ("mouse", "jitter"):
            out.append(f"GERAK MOUSE ({kind})")
        elif kind == "chaos":
            out.append(f"{arg['count']} aksi acak")
    return " → ".join(out)


def money(cfg, amount) -> str:
    """Rp6000 -> '6 WHISKAS' (amount / overlay.money_divisor, shown with overlay.money_format)."""
    value = round(amount / (cfg["overlay"]["money_divisor"] or 1), 1)
    whole, _, frac = f"{value:,.1f}".partition(".")
    number = whole.replace(",", ".") + ("" if frac == "0" else "," + frac)   # 2.5 -> "2,5", 12000 -> "12.000"
    return str(cfg["overlay"]["money_format"]).replace("{amount}", number)


def match_action(actions, amount):
    """Highest enabled tier whose min_amount <= amount (None if below every tier)."""
    best = None
    for a in actions:
        if a["enabled"] and a["min_amount"] <= amount:
            if best is None or a["min_amount"] >= best["min_amount"]:
                best = a
    return best


class ConfigStore:
    """Holds the current config; reloads when the file's mtime changes.
    A broken edit is logged and the previous good config stays active."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._mtime = self.path.stat().st_mtime
        self._cfg = validate(yaml.safe_load(self.path.read_text(encoding="utf-8")))
        self.error: str | None = None     # last reload error; shown as a warning in the panel

    def get(self) -> dict:
        try:
            mtime = self.path.stat().st_mtime
        except OSError:
            return self._cfg
        if mtime != self._mtime:
            self._mtime = mtime
            try:
                self._cfg = validate(yaml.safe_load(self.path.read_text(encoding="utf-8")))
                self.error = None
                log.info("config.yaml dimuat ulang")
            except (ConfigError, yaml.YAMLError) as e:
                self.error = str(e)
                log.error("config.yaml error, tetap pakai config lama: %s", e)
        return self._cfg

    def snapshot(self) -> dict:
        return copy.deepcopy(self.get())
