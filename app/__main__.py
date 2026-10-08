"""Entry point: python -m app"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path

import aiohttp
from aiohttp import web

from .config import ConfigError, ConfigStore
from .engine import Engine
from .inputs import make_backend, start_hotkey_thread
from .platforms import decode_channel_id, trakteer_ws_loop
from .server import Hub, build_local_app, build_webhook_app
from .streamerbot import StreamerBot

ROOT = Path(__file__).resolve().parent.parent
log = logging.getLogger("app")

ENV_KEYS = ["TRAKTEER_MODE", "TRAKTEER_CHANNEL_ID", "TRAKTEER_WEBHOOK_TOKEN", "TRAKTEER_STREAM_KEY", "TRAKTEER_PAGE_HASH",
            "TRAKTEER_WS_TEST_CHANNEL", "TAKO_CALLBACK_SECRET", "TAKO_WEBHOOK_KEY", "TAKO_API_KEY",
            "STREAMERBOT_ENABLED", "STREAMERBOT_URL", "STREAMERBOT_PASSWORD",
            "STREAMERBOT_ALERT_ACTION", "STREAMERBOT_STATE_ACTION", "CONTROL_TOKEN", "LOG_RAW_WEBHOOKS"]


def load_env(path: Path) -> dict:
    """Minimal .env reader (KEY=VALUE per line, # comments). Real env vars win."""
    values = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                values[k.strip()] = v.strip().strip('"').strip("'")
    return {k: os.environ.get(k, values.get(k, "")).strip() for k in ENV_KEYS}


def truthy(v: str) -> bool:
    return v.lower() in ("1", "true", "yes", "on")


async def main():
    env = load_env(ROOT / ".env")
    try:
        store = ConfigStore(ROOT / "config.yaml")
    except (ConfigError, OSError) as e:
        sys.exit(f"config.yaml error: {e}")
    cfg = store.get()

    backend = make_backend()
    engine = Engine(store, backend, ROOT / "logs")
    hub = Hub()
    engine.listeners.append(hub.publish)

    async with aiohttp.ClientSession() as session:
        tasks = [asyncio.create_task(engine.worker())]

        if truthy(env["STREAMERBOT_ENABLED"]):
            sb = StreamerBot(session, env["STREAMERBOT_URL"] or "ws://127.0.0.1:8080/",
                             env["STREAMERBOT_PASSWORD"], env["STREAMERBOT_ALERT_ACTION"],
                             env["STREAMERBOT_STATE_ACTION"])
            engine.listeners.append(sb.on_event)
            tasks.append(asyncio.create_task(sb.run()))

        mode = (env["TRAKTEER_MODE"] or "webhook").lower()
        if mode == "websocket":
            page_hash, stream_key = env["TRAKTEER_PAGE_HASH"], env["TRAKTEER_STREAM_KEY"]
            if env["TRAKTEER_CHANNEL_ID"]:
                try:
                    page_hash, stream_key = decode_channel_id(env["TRAKTEER_CHANNEL_ID"])
                except ValueError as e:
                    log.error("%s", e)
            if page_hash and stream_key:
                tasks.append(asyncio.create_task(trakteer_ws_loop(
                    engine, stream_key, page_hash, truthy(env["TRAKTEER_WS_TEST_CHANNEL"]), session)))
            else:
                log.error("TRAKTEER_MODE=websocket butuh TRAKTEER_CHANNEL_ID (dari halaman Via Websocket)")
        if mode == "webhook" and not env["TRAKTEER_WEBHOOK_TOKEN"]:
            log.warning("TRAKTEER_WEBHOOK_TOKEN kosong: webhook Trakteer akan ditolak")
        if not (env["TAKO_CALLBACK_SECRET"] or env["TAKO_WEBHOOK_KEY"]):
            log.warning("TAKO_CALLBACK_SECRET / TAKO_WEBHOOK_KEY kosong: webhook Tako akan ditolak")

        raw_log = ROOT / "logs" / "raw_webhooks.jsonl" if truthy(env["LOG_RAW_WEBHOOKS"]) else None
        ports = cfg["server"]
        runners = []
        for app, port in ((build_local_app(engine, store, hub, env["CONTROL_TOKEN"]), ports["panel_port"]),
                          (build_webhook_app(engine, env, session, raw_log), ports["webhook_port"])):
            runner = web.AppRunner(app, access_log=None)
            await runner.setup()
            await web.TCPSite(runner, "127.0.0.1", port).start()
            runners.append(runner)

        hotkey = str(cfg["safety"]["kill_switch_key"])
        has_hotkey = start_hotkey_thread(hotkey, engine.hotkey_pressed)
        p = ports["panel_port"]
        print(f"""
=== Donation Controls siap ===
 Panel test     : http://127.0.0.1:{p}/panel
 Overlay (OBS)  : http://127.0.0.1:{p}/overlay
 Price list     : http://127.0.0.1:{p}/pricelist
 Webhook (tunnel ke port ini): http://127.0.0.1:{ports['webhook_port']}  ->  /webhook/trakteer , /webhook/tako
 Kill switch    : {hotkey if has_hotkey else 'TIDAK AKTIF (lihat error di atas)'}
 Status awal    : {'PAUSED (tekan ' + hotkey + ' / tombol di panel untuk ON)' if engine.paused else 'ON'}
""")
        try:
            await asyncio.gather(*tasks)
        finally:
            engine.cancel.set()
            engine.release_everything()
            for r in runners:
                await r.cleanup()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
                        datefmt="%H:%M:%S")
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Berhenti.")
