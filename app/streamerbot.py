"""Tiny Streamer.bot WebSocket client: runs your Streamer.bot actions on alerts / state changes.

Protocol (Streamer.bot WebSocket Server, default ws://127.0.0.1:8080/):
  server -> {"request":"Hello", "authentication":{"salt","challenge"}?}
  client -> {"request":"Authenticate","id":..,"authentication": b64(sha256(b64(sha256(pw+salt))+challenge))}
  client -> {"request":"DoAction","id":..,"action":{"name":..},"args":{..}}
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import uuid

import aiohttp

log = logging.getLogger("streamerbot")


def _sha_b64(text: str) -> str:
    return base64.b64encode(hashlib.sha256(text.encode()).digest()).decode()


class StreamerBot:
    def __init__(self, session, url, password, alert_action, state_action):
        self.session, self.url, self.password = session, url, password
        self.alert_action, self.state_action = alert_action, state_action
        self.ws = None
        self._last_paused = None

    async def run(self):
        while True:
            try:
                async with self.session.ws_connect(self.url, heartbeat=30) as ws:
                    async for msg in ws:
                        if msg.type != aiohttp.WSMsgType.TEXT:
                            continue
                        data = json.loads(msg.data)
                        if data.get("request") == "Hello":
                            auth = data.get("authentication")
                            if auth:
                                secret = _sha_b64(self.password + auth["salt"])
                                await ws.send_json({"request": "Authenticate", "id": "auth",
                                                    "authentication": _sha_b64(secret + auth["challenge"])})
                            else:
                                self.ws = ws
                                log.info("Streamer.bot tersambung")
                        elif data.get("id") == "auth":
                            if data.get("status") == "ok":
                                self.ws = ws
                                log.info("Streamer.bot tersambung (auth OK)")
                            else:
                                log.error("Streamer.bot: password salah (STREAMERBOT_PASSWORD)")
            except Exception as e:
                log.debug("Streamer.bot error: %s", e)
            if self.ws is not None:
                log.warning("Streamer.bot terputus, mencoba lagi…")
            self.ws = None
            await asyncio.sleep(5)

    async def do_action(self, name, args):
        if not (name and self.ws is not None and not self.ws.closed):
            return
        args = {k: ("" if v is None else str(v)) for k, v in args.items()}
        try:
            await self.ws.send_json({"request": "DoAction", "id": str(uuid.uuid4()),
                                     "action": {"name": name}, "args": args})
        except Exception as e:
            log.warning("Streamer.bot DoAction '%s' gagal: %s", name, e)

    def on_event(self, kind, data):
        """Engine listener: forward alerts + pause/resume changes."""
        if kind == "alert" and not data.get("skipped"):
            asyncio.ensure_future(self.do_action(self.alert_action, {
                "donor": data["donor"], "amount": data["amount"], "amountText": data["amount_text"],
                "platform": data["platform"], "message": data["message"],
                "action": data["action"], "actionName": data["action_name"]}))
        elif kind == "state" and data["paused"] != self._last_paused:
            self._last_paused = data["paused"]
            asyncio.ensure_future(self.do_action(self.state_action, {
                "paused": str(data["paused"]).lower(), "state": "PAUSED" if data["paused"] else "ON"}))
