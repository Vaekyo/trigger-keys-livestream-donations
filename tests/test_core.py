"""Run: python -m unittest discover tests"""
import asyncio
import hashlib
import hmac
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

import yaml

from app.config import ConfigError, ConfigStore, describe_steps, match_action, money, validate
from app.engine import Aborted, Donation, Engine, StepRunner
from app.platforms import decode_channel_id, parse_amount, parse_tako, parse_trakteer, tako_signature_ok, trakteer_token_ok

ROOT = Path(__file__).resolve().parent.parent
SAFETY = {"max_hold_s": 10, "tap_ms": 10}


class FakeInput:
    real = True

    def __init__(self):
        self.events, self.down = [], set()

    def key_down(self, k):
        self.events.append(("down", k)); self.down.add(k)

    def key_up(self, k):
        self.events.append(("up", k)); self.down.discard(k)

    def mouse_move(self, dx, dy):
        self.events.append(("move", dx, dy))

    def mouse_button(self, button, down):
        self.events.append(("click-down" if down else "click-up", button))
        (self.down.add if down else self.down.discard)("MOUSE_" + button)

    def foreground_process(self):
        return "VALORANT-Win64-Shipping.exe"


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.cfg = validate(yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8")))

    def test_default_config_is_valid(self):
        self.assertEqual(len(self.cfg["actions"]), 5)
        amounts = [a["min_amount"] for a in self.cfg["actions"]]
        self.assertEqual(amounts, list(range(2000, 12000, 2000)))   # kelipatan 2.000
        self.assertTrue(all(a["cooldown_s"] == 0 for a in self.cfg["actions"]))

    def test_tier_match_highest_not_above_amount(self):
        acts = self.cfg["actions"]
        self.assertIsNone(match_action(acts, 1999))
        self.assertEqual(match_action(acts, 2000)["name"], "Jump")
        self.assertEqual(match_action(acts, 5999)["name"], "Crouch spam")
        self.assertEqual(match_action(acts, 6000)["name"], "Random skill")
        self.assertEqual(match_action(acts, 9000)["name"], "Drop weapon")
        self.assertEqual(match_action(acts, 1_000_000)["name"], "Ultimate")

    def test_disabled_tier_falls_back_to_lower(self):
        acts = [dict(a) for a in self.cfg["actions"]]
        next(a for a in acts if a["name"] == "Ultimate")["enabled"] = False
        self.assertEqual(match_action(acts, 10000)["name"], "Drop weapon")

    def test_skills_use_keyboard_fire_not_mouse(self):
        for a in self.cfg["actions"]:
            kinds = [next(iter(st)) for st in a["steps"]]
            self.assertFalse({"click", "mouse", "jitter"} & set(kinds), a["name"])
        skill = next(a for a in self.cfg["actions"] if a["name"] == "Random skill")
        self.assertEqual(skill["steps"][-1], {"hold": {"key": "K", "ms": 150}})
        self.assertGreaterEqual(skill["steps"][1]["wait"], 800)   # wait for the ability to come out

    def test_money_is_whiskas(self):
        self.assertEqual(money(self.cfg, 6000), "6.000 WHISKAS")
        self.assertNotIn("Rp", self.cfg["overlay"]["template"])

    def test_describe_steps(self):
        skill = next(a for a in self.cfg["actions"] if a["name"] == "Random skill")
        self.assertEqual(describe_steps(skill["steps"]), "C/Q/E → tunggu 0.9 dtk → tahan K")
        self.assertIn("KLIK MOUSE", describe_steps([{"click": "LEFT"}]))

    def test_broken_edit_keeps_old_config_and_reports_error(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "config.yaml"
            path.write_text((ROOT / "config.yaml").read_text(encoding="utf-8"), encoding="utf-8")
            store = ConfigStore(path)
            text = path.read_text(encoding="utf-8").replace("hold: {key: K, ms: 150}", "click: K", 1)
            path.write_text(text, encoding="utf-8")
            import os
            os.utime(path, (time.time() + 5, time.time() + 5))
            self.assertEqual(len(store.get()["actions"]), 5)
            self.assertIn("click harus LEFT atau RIGHT", store.error)

    def test_bad_key_rejected(self):
        with self.assertRaises(ConfigError):
            validate({"actions": [{"name": "x", "min_amount": 1, "steps": [{"tap": "NOPE"}]}]})

    def test_bad_step_rejected(self):
        with self.assertRaises(ConfigError):
            validate({"actions": [{"name": "x", "min_amount": 1, "steps": [{"click": "MIDDLE"}]}]})
        with self.assertRaises(ConfigError):
            validate({"actions": [{"name": "x", "min_amount": 1, "steps": [{"shoot": "LEFT"}]}]})


class RunnerTests(unittest.TestCase):
    def test_hold_is_capped_and_released(self):
        fake = FakeInput()
        r = StepRunner(fake, {"max_hold_s": 0.1, "tap_ms": 10}, threading.Event(), time.monotonic() + 5)
        t = time.monotonic()
        r.run([{"hold": {"key": "LSHIFT", "ms": 10000}}])
        self.assertLess(time.monotonic() - t, 1)
        self.assertEqual(fake.down, set())

    def test_kill_switch_releases_held_keys(self):
        fake, cancel = FakeInput(), threading.Event()
        r = StepRunner(fake, SAFETY, cancel, time.monotonic() + 30)
        threading.Timer(0.1, cancel.set).start()
        with self.assertRaises(Aborted):
            r.run([{"hold": {"key": "LSHIFT", "ms": 5000}}])
        self.assertEqual(fake.down, set())
        self.assertEqual(fake.events[-1], ("up", "LSHIFT"))

    def test_deadline_aborts_and_releases(self):
        fake = FakeInput()
        r = StepRunner(fake, SAFETY, threading.Event(), time.monotonic() + 0.15)
        with self.assertRaises(Aborted):
            r.run([{"spam": {"key": "LCTRL", "ms": 3000, "every": 20}}])
        self.assertEqual(fake.down, set())

    def test_error_mid_action_releases(self):
        class Boom(FakeInput):
            def mouse_move(self, dx, dy):
                raise OSError("boom")
        fake = Boom()
        r = StepRunner(fake, SAFETY, threading.Event(), time.monotonic() + 5)
        with self.assertRaises(OSError):
            r.run([{"hold": {"key": "LSHIFT", "ms": 50}}, {"tap": ["Y"]},
                   {"mouse": {"dx": 10, "dy": 0, "ms": 20}}])
        self.assertEqual(fake.down, set())

    def test_skill_then_click(self):
        fake = FakeInput()
        r = StepRunner(fake, SAFETY, threading.Event(), time.monotonic() + 5)
        r.run([{"random_tap": ["C"]}, {"wait": 20}, {"click": "LEFT"}])
        self.assertEqual(fake.events, [("down", "C"), ("up", "C"), ("click-down", "LEFT"), ("click-up", "LEFT")])

    def test_failed_click_is_reported(self):
        class Blocked(FakeInput):
            def mouse_button(self, button, down):
                raise OSError("SendInput gagal (error 87)")
        fake = Blocked()
        r = StepRunner(fake, SAFETY, threading.Event(), time.monotonic() + 5)
        with self.assertRaises(OSError):
            r.run([{"tap": ["Q"]}, {"click": "LEFT"}])
        self.assertEqual(fake.down, set())

    def test_mouse_total_and_jitter_returns_home(self):
        fake = FakeInput()
        r = StepRunner(fake, SAFETY, threading.Event(), time.monotonic() + 5)
        r.run([{"mouse": {"dx": 1001, "dy": -7, "ms": 50}}])
        self.assertEqual(sum(e[1] for e in fake.events), 1001)
        self.assertEqual(sum(e[2] for e in fake.events), -7)
        fake.events.clear()
        r.run([{"jitter": {"ms": 100, "strength": 30, "every": 10}}])
        self.assertEqual(sum(e[1] for e in fake.events), 0)
        self.assertEqual(sum(e[2] for e in fake.events), 0)


class PlatformTests(unittest.TestCase):
    def test_amounts(self):
        for v, want in [(5000, 5000), ("5000", 5000), ("Rp 5.000", 5000), ("Rp5.000,00", 5000), (None, 0)]:
            self.assertEqual(parse_amount(v), want)

    def test_trakteer_webhook(self):
        d = parse_trakteer({"transaction_id": "t1", "type": "tip", "supporter_name": "Budi",
                            "supporter_message": "gas", "price": 10000, "net_amount": 9500})
        self.assertEqual((d.id, d.donor, d.amount, d.message), ("t1", "Budi", 10000, "gas"))

    def test_trakteer_websocket_payload(self):
        d = parse_trakteer({"order_id": "o1", "id": "n1", "supporter_name": "Ani", "price": "Rp 25.000",
                            "supporter_message": None, "type": "new-tip-success"})
        self.assertEqual((d.id, d.amount, d.message), ("o1", 25000, ""))

    def test_trakteer_channel_id(self):
        import base64
        cid = base64.b64encode(b"abc123.trstream-XyZ").decode()
        self.assertEqual(decode_channel_id(cid), ("abc123", "trstream-XyZ"))
        self.assertEqual(decode_channel_id(cid.rstrip("=") + "  "), ("abc123", "trstream-XyZ"))
        with self.assertRaises(ValueError):
            decode_channel_id("not-a-channel-id")

    def test_trakteer_token(self):
        self.assertTrue(trakteer_token_ok({"X-Webhook-Token": "abc"}, "abc"))
        self.assertFalse(trakteer_token_ok({"X-Webhook-Token": "abd"}, "abc"))
        self.assertFalse(trakteer_token_ok({}, ""))

    def test_tako_callback_and_signature(self):
        body = {"event": "payment.success", "data": {"id": "p1", "amount": 7000, "relatedGiftId": "g1"}}
        raw = json.dumps(body).encode()
        sig = hmac.new(b"s3cret", raw, hashlib.sha256).hexdigest()
        self.assertTrue(tako_signature_ok(raw, {"X-Tako-Signature": sig}, "s3cret"))
        self.assertFalse(tako_signature_ok(raw + b" ", {"X-Tako-Signature": sig}, "s3cret"))
        d, gift = parse_tako(body, raw)
        self.assertEqual((d.id, d.amount, d.donor, gift), ("p1", 7000, "Seseorang", "g1"))
        self.assertEqual(parse_tako({"event": "payment.pending", "data": {"amount": 1}}), (None, None))


class EngineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        cfg = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))
        cfg["safety"].update(start_paused=False, gap_between_actions_s=0, max_queue_age_s=1, tap_ms=10)
        path = Path(self.tmp.name) / "config.yaml"
        path.write_text(yaml.safe_dump(cfg), encoding="utf-8")
        self.fake = FakeInput()
        self.engine = Engine(ConfigStore(path), self.fake, Path(self.tmp.name) / "logs")
        self.worker = asyncio.create_task(self.engine.worker())

    async def asyncTearDown(self):
        self.worker.cancel()
        self.tmp.cleanup()

    async def test_duplicate_ignored_and_action_runs(self):
        d = Donation("test", "same", "A", 2000)
        self.assertEqual(self.engine.submit(d)["status"], "queued")
        self.assertEqual(self.engine.submit(Donation("test", "same", "A", 2000))["status"], "duplicate")
        await asyncio.wait_for(self.engine.queue.join(), 5)
        self.assertIn(("down", "SPACE"), self.fake.events)
        self.assertEqual(self.fake.down, set())

    async def test_queue_runs_back_to_back_in_order(self):
        for i, amount in enumerate((2000, 8000, 2000)):
            self.engine.submit(Donation("test", f"q{i}", "A", amount))
        await asyncio.wait_for(self.engine.queue.join(), 5)
        presses = [e[1] for e in self.fake.events if e[0] == "down"]
        self.assertEqual(presses, ["SPACE", "G", "SPACE"])

    async def test_log_shows_keys_sent(self):
        self.engine.submit(Donation("test", "k1", "A", 6000))
        await asyncio.wait_for(self.engine.queue.join(), 5)
        result = self.engine.recent_log[-1]["result"]
        self.assertRegex(result, r"^ok \| tombol: [CQE] → K$")

    async def test_state_flags_mouse_actions(self):
        self.assertEqual(self.engine.state()["mouse_actions"], [])

    async def test_paused_donation_expires_without_input(self):
        self.engine.set_paused(True)
        self.engine.submit(Donation("test", "p1", "A", 8000))
        await asyncio.wait_for(self.engine.queue.join(), 5)
        self.assertNotIn(("down", "G"), self.fake.events)
        self.assertIn("dilewati", self.engine.recent_log[-1]["result"])

    async def test_unfocused_waits(self):
        self.fake.foreground_process = lambda: "obs64.exe"
        self.engine.submit(Donation("test", "f1", "A", 8000))
        await asyncio.wait_for(self.engine.queue.join(), 5)
        self.assertNotIn(("down", "G"), self.fake.events)
        self.assertIn("tidak fokus", self.engine.recent_log[-1]["result"])

    async def test_pause_mid_action_releases_keys(self):
        self.engine.submit(Donation("test", "w1", "A", 4000))   # Crouch spam: 3 s
        for _ in range(100):
            if ("down", "LCTRL") in self.fake.events:
                break
            await asyncio.sleep(0.01)
        self.engine.set_paused(True)
        await asyncio.wait_for(self.engine.queue.join(), 5)
        self.assertEqual(self.fake.down, set())
        self.assertIn("kill switch", self.engine.recent_log[-1]["result"])


if __name__ == "__main__":
    unittest.main()
