"""Donation queue + safety gates + step runner.

Flow: submit() -> dedupe -> queue -> worker waits for (not paused, cooldowns,
rate limit, game focused) -> runs the action's steps in a thread -> releases every key.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

from .config import match_action
from .inputs import DryRunInput

log = logging.getLogger("engine")


@dataclass
class Donation:
    platform: str          # "trakteer", "tako", "test"
    id: str                # platform transaction id (used for dedupe)
    donor: str
    amount: int            # IDR
    message: str = ""
    received_at: float = field(default_factory=time.time)


def used_keys(actions) -> set[str]:
    keys = set()
    for a in actions:
        for step in a["steps"]:
            (kind, arg), = step.items()
            if kind in ("tap", "random_tap"):
                keys.update(arg)
            elif kind in ("hold", "spam"):
                keys.add(arg["key"])
            elif kind == "click":
                keys.add("MOUSE_" + arg)
    return keys


def release(backend, key):
    """Key-up for a key name, or button-up for 'MOUSE_LEFT' / 'MOUSE_RIGHT'."""
    if key.startswith("MOUSE_"):
        backend.mouse_button(key[6:], False)
    else:
        backend.key_up(key)


def _summarize(keys: list[str]) -> str:
    """['C', 'K'] -> 'C → K';  ['LCTRL'] * 20 -> 'LCTRL ×20'."""
    parts: list[list] = []
    for k in keys:
        if parts and parts[-1][0] == k:
            parts[-1][1] += 1
        else:
            parts.append([k, 1])
    return " → ".join(k if n == 1 else f"{k} ×{n}" for k, n in parts)


def rupiah(amount: int) -> str:
    return f"{int(amount):,}".replace(",", ".")


class Aborted(Exception):
    pass


class StepRunner:
    """Executes steps in a worker thread. Every key it presses is tracked and
    released in `finally`, so an error/abort/timeout never leaves a key held."""

    def __init__(self, backend, safety, cancel: threading.Event, deadline: float):
        self.b, self.s, self.cancel, self.deadline = backend, safety, cancel, deadline
        self.held: set[str] = set()
        self.sent: list[str] = []      # keys/buttons pressed, shown in the log

    def run(self, steps):
        try:
            for step in steps:
                self._step(step)
        finally:
            self.release_all()

    def release_all(self):
        for key in list(self.held):
            try:
                release(self.b, key)
            except Exception:
                log.exception("gagal melepas %s", key)
        self.held.clear()

    def sleep(self, seconds):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise Aborted("batas max_action_s")
        if self.cancel.wait(min(seconds, remaining)):
            raise Aborted("kill switch")
        if seconds > remaining:
            raise Aborted("batas max_action_s")

    def _cap(self, ms):
        return min(ms / 1000, self.s["max_hold_s"])

    def _down(self, key):
        self.held.add(key)
        self.b.key_down(key)
        self.sent.append(key)

    def _up(self, key):
        self.b.key_up(key)
        self.held.discard(key)

    def _click(self, button):
        self.b.mouse_button(button, True)
        self.held.add("MOUSE_" + button)
        self.sent.append("MOUSE_" + button)
        try:
            self.sleep(self.s["tap_ms"] / 1000)
        finally:
            self.b.mouse_button(button, False)
            self.held.discard("MOUSE_" + button)

    def _tap(self, key):
        self._down(key)
        try:
            self.sleep(self.s["tap_ms"] / 1000)
        finally:
            self._up(key)

    def _step(self, step):
        (kind, arg), = step.items()
        if kind == "tap":
            for i, key in enumerate(arg):
                if i:
                    self.sleep(self.s["tap_ms"] / 1000)
                self._tap(key)
        elif kind == "random_tap":
            self._tap(random.choice(arg))
        elif kind == "click":
            self._click(arg)
        elif kind == "hold":
            self._down(arg["key"])
            self.sleep(self._cap(arg["ms"]))
            self._up(arg["key"])
        elif kind == "wait":
            self.sleep(self._cap(arg))
        elif kind == "spam":
            end = time.monotonic() + self._cap(arg["ms"])
            while time.monotonic() < end:
                self._tap(arg["key"])
                self.sleep(arg["every"] / 1000)
        elif kind == "mouse":
            chunks = max(1, int(arg["ms"] // 10))
            sent_x = sent_y = 0
            for i in range(1, chunks + 1):
                x, y = arg["dx"] * i // chunks, arg["dy"] * i // chunks
                self.b.mouse_move(x - sent_x, y - sent_y)
                sent_x, sent_y = x, y
                self.sleep(arg["ms"] / 1000 / chunks)
        elif kind == "jitter":
            # Random wobble that ends where it started (net movement zero).
            end = time.monotonic() + self._cap(arg["ms"])
            off_x = off_y = 0
            r = arg["strength"]
            while time.monotonic() < end:
                dx, dy = random.randint(-r, r), random.randint(-r, r)
                self.b.mouse_move(dx, dy)
                off_x, off_y = off_x + dx, off_y + dy
                self.sleep(arg["every"] / 1000)
            self.b.mouse_move(-off_x, -off_y)
        else:
            raise ValueError(f"step tidak didukung di sini: {kind}")


class SeenIds:
    """Remembers processed donation ids (also across restarts) to drop duplicates."""

    def __init__(self, path: Path, keep=5000):
        self.path, self.keep = path, keep
        self.order: deque[str] = deque()
        self.ids: set[str] = set()
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines()[-keep:]:
                self._remember(line.strip())

    def _remember(self, key):
        if key and key not in self.ids:
            self.ids.add(key)
            self.order.append(key)
            if len(self.order) > self.keep:
                self.ids.discard(self.order.popleft())

    def add(self, key: str) -> bool:
        """True if new, False if already seen."""
        if key in self.ids:
            return False
        self._remember(key)
        with self.path.open("a", encoding="utf-8") as f:
            f.write(key + "\n")
        return True


class Engine:
    def __init__(self, store, backend, log_dir: Path):
        self.store = store
        self.backend = backend
        self.dry = DryRunInput()
        log_dir.mkdir(parents=True, exist_ok=True)
        self.events_file = log_dir / "events.jsonl"
        self.seen = SeenIds(log_dir / "seen_ids.txt")
        self.queue: asyncio.Queue[Donation] = asyncio.Queue()
        self.paused = bool(store.get()["safety"]["start_paused"])
        self.cancel = threading.Event()
        self.current: str | None = None
        self.last_end = 0.0
        self.last_used: dict[str, float] = {}
        self.recent: deque[float] = deque()
        self.recent_log: deque[dict] = deque(maxlen=200)
        self.listeners = []          # callables(event_type, data)
        self.loop: asyncio.AbstractEventLoop | None = None

    # ---- events / logging -------------------------------------------------
    def emit(self, kind, data):
        for fn in self.listeners:
            try:
                fn(kind, data)
            except Exception:
                log.exception("listener error")

    def record(self, d: Donation, action: str | None, result: str):
        entry = {"time": time.strftime("%Y-%m-%d %H:%M:%S"), "platform": d.platform, "id": d.id,
                 "donor": d.donor, "amount": d.amount, "message": d.message,
                 "action": action, "result": result}
        with self.events_file.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        self.recent_log.append(entry)
        log.info("[%s] %s Rp%s -> %s : %s", d.platform, d.donor, rupiah(d.amount), action or "-", result)
        self.emit("log", entry)

    def state(self) -> dict:
        s = self.store.get()["safety"]
        fg = None if s["dry_run"] else self.backend.foreground_process()
        return {"paused": self.paused, "queue": self.queue.qsize(), "current": self.current,
                "dry_run": s["dry_run"] or not self.backend.real,
                "foreground": fg, "focus_process": s["focus_process"],
                "config_error": self.store.error}

    # ---- control ----------------------------------------------------------
    def set_paused(self, paused: bool, source="api"):
        if paused:
            self.cancel.set()                 # abort the running action now
            self.release_everything()
        if paused != self.paused:
            self.paused = paused
            log.warning("Donation controls %s (via %s)", "PAUSED" if paused else "ON", source)
        self.emit("state", self.state())

    def hotkey_pressed(self):
        """Called from the hotkey thread: stop input immediately, then update state on the loop."""
        if not self.paused:
            self.cancel.set()
            self.release_everything()
        target = not self.paused
        self.loop.call_soon_threadsafe(self.set_paused, target, "hotkey")

    def release_everything(self):
        """Emergency key-up for every key used in config.yaml (harmless if not held)."""
        cfg = self.store.get()
        if cfg["safety"]["dry_run"] or not self.backend.real:
            return
        for key in used_keys(cfg["actions"]):
            try:
                release(self.backend, key)
            except Exception:
                log.exception("gagal melepas %s", key)

    # ---- intake -----------------------------------------------------------
    def submit(self, d: Donation) -> dict:
        if not self.seen.add(f"{d.platform}:{d.id}"):
            self.record(d, None, "duplicate (diabaikan)")
            return {"status": "duplicate"}
        action = match_action(self.store.get()["actions"], d.amount)
        if not action:
            self.record(d, None, "di bawah tier minimum")
            return {"status": "below_min"}
        self.queue.put_nowait(d)
        self.record(d, action["name"], f"masuk antrian (#{self.queue.qsize()})")
        self.emit("state", self.state())
        return {"status": "queued", "action": action["name"], "position": self.queue.qsize()}

    # ---- worker -----------------------------------------------------------
    def _cooldown_wait(self, action, s) -> float:
        now = time.monotonic()
        while self.recent and now - self.recent[0] >= 60:
            self.recent.popleft()
        waits = [self.last_end + s["gap_between_actions_s"] - now,
                 self.last_used.get(action["name"], -1e9) + action["cooldown_s"] - now]
        if len(self.recent) >= s["max_actions_per_minute"]:
            waits.append(self.recent[0] + 60 - now)
        return max(waits)

    def _focused(self, s) -> bool:
        if not s["require_focus"] or s["dry_run"] or not self.backend.real:
            return True
        fg = self.backend.foreground_process() or ""
        return fg.lower() == s["focus_process"].lower()

    def _expand(self, action, actions):
        """Return (steps, overlay label, log name). Chaos runs N random other actions one after another."""
        steps, picks, names = [], [], []
        for step in action["steps"]:
            if "chaos" not in step:
                steps.append(step)
                continue
            c = step["chaos"]
            pool = [a for a in actions if a["enabled"] and not any("chaos" in st for st in a["steps"])
                    and (c["pool"] == "all" or a["name"] in c["pool"])]
            for a in random.sample(pool, min(c["count"], len(pool))):
                picks.append(a["overlay_text"])
                names.append(a["name"])
                steps.extend(a["steps"])
                steps.append({"wait": 400})
        label = action["overlay_text"] + (f" ({' + '.join(picks)})" if picks else "")
        return steps, label, action["name"] + (f" ({' + '.join(names)})" if names else "")

    async def worker(self):
        self.loop = asyncio.get_running_loop()
        while True:
            d = await self.queue.get()
            try:
                await self._process(d)
            except Exception as e:
                log.exception("worker error")
                self.record(d, None, f"error: {e}")
            finally:
                self.current = None
                self.queue.task_done()
                self.emit("state", self.state())

    def _waiting(self, text):
        if text != self.current:
            self.current = text
            self.emit("state", self.state())

    async def _process(self, d: Donation):
        cfg = self.store.get()
        action = match_action(cfg["actions"], d.amount)
        if not action:
            return self.record(d, None, "tidak ada aksi aktif untuk nominal ini")
        reason = ""
        while True:
            cfg = self.store.get()
            s = cfg["safety"]
            if time.time() - d.received_at > s["max_queue_age_s"]:
                self.record(d, action["name"], f"dilewati: kelamaan menunggu ({reason or 'antrian'})")
                self.emit("alert", self._alert(d, action, cfg, skipped=True))
                return
            if self.paused:
                reason = "kontrol PAUSED"
            elif (wait := self._cooldown_wait(action, s)) > 0:
                reason = "cooldown / rate limit"
                self._waiting(f"menunggu ({reason} {wait:.0f}s): {action['name']}")
                await asyncio.sleep(min(wait, 0.5))
                continue
            elif not self._focused(s):
                reason = "Valorant tidak fokus"
                if s["when_unfocused"] == "skip":
                    self.record(d, action["name"], "dilewati: Valorant tidak fokus")
                    return
            else:
                break
            self._waiting(f"menunggu ({reason}): {action['name']}")
            await asyncio.sleep(0.25)

        steps, label, log_name = self._expand(action, cfg["actions"])
        backend = self.dry if s["dry_run"] else self.backend
        self.cancel = threading.Event()
        self.current = label
        self.emit("alert", self._alert(d, action, cfg, label=label))
        self.emit("state", self.state())
        runner = StepRunner(backend, s, self.cancel, time.monotonic() + s["max_action_s"])
        try:
            await asyncio.to_thread(runner.run, steps)
            result = "ok" + (" (dry-run)" if not backend.real else "")
        except Aborted as e:
            result = f"dihentikan: {e}"
        except Exception as e:
            log.exception("aksi gagal")
            result = f"error: {e}"
        finally:
            now = time.monotonic()
            self.last_end = now
            self.last_used[action["name"]] = now
            self.recent.append(now)
        if runner.sent:
            result += " | tombol: " + _summarize(runner.sent)
        self.record(d, log_name, result)

    def _alert(self, d, action, cfg, label=None, skipped=False):
        return {"donor": d.donor, "amount": d.amount, "amount_text": rupiah(d.amount),
                "platform": d.platform, "message": d.message, "action": label or action["overlay_text"],
                "action_name": action["name"], "skipped": skipped,
                "sound": action["sound"] or cfg["overlay"]["default_sound"]}

