"""Tako.id + Trakteer.id: authentication + payload -> Donation.

Sources (checked Oct 2026, see README "Riset"):
- Trakteer webhook: POST JSON, header `X-Webhook-Token` = token from trakteer.id/manage/webhook.
  Fields: transaction_id, type, supporter_name, supporter_message, unit, quantity, price, net_amount.
- Trakteer WebSocket (trakteer.id/manage/webhook -> "Via Websocket", Pusher protocol):
  wss://socket.trakteer.id, channel `creator-stream.{hash}.{trstream-key}` where "My Channel ID"
  = base64("{hash}.{trstream-key}"); event BroadcastNotificationCreated, price "Rp 5.000".
- Tako API callback (tako.id/me/api-keys): POST {"event":"payment.success","data":{id, amount,
  relatedGiftId,...}}, header `X-Tako-Signature` = hex HMAC-SHA256(raw body, Callback Secret).
  Donor name/message via GET https://tako.id/api/v1/gift/{relatedGiftId} (Bearer API key).
  Field names come from community code, not official docs -> parser is tolerant and raw
  payloads can be logged (LOG_RAW_WEBHOOKS=1) so you can confirm with a test donation.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import re

import aiohttp

from .engine import Donation

log = logging.getLogger("platforms")

TRAKTEER_WS_URL = "wss://socket.trakteer.id/app/{app_key}?protocol=7&client=js&version=5.1.1&flash=false"
TRAKTEER_WS_APP_KEY = "2ae25d102cc6cd41100a"


def parse_amount(value) -> int:
    """5000, 5000.0, "5000", "Rp 5.000", "Rp5.000,00" -> 5000."""
    if isinstance(value, bool) or value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).split(",")[0]          # IDR: comma = decimal separator
    digits = re.sub(r"\D", "", text)
    return int(digits) if digits else 0


def _first(d: dict, *names, default=None):
    for n in names:
        v = d.get(n)
        if v not in (None, ""):
            return v
    return default


def _fallback_id(raw: bytes) -> str:
    return "sha1-" + hashlib.sha1(raw).hexdigest()


# ---- Trakteer --------------------------------------------------------------
def trakteer_token_ok(headers, expected: str) -> bool:
    got = headers.get("X-Webhook-Token", "")
    return bool(expected) and hmac.compare_digest(got.encode(), expected.encode())


def parse_trakteer(body: dict, raw: bytes = b"") -> Donation | None:
    if not isinstance(body, dict):
        return None
    if body.get("type") not in (None, "tip", "new-tip-success"):
        return None                             # other event types: ignore
    amount = parse_amount(_first(body, "price", "price_number", "amount", default=0))
    if not amount:
        return None
    return Donation(
        platform="trakteer",
        id=str(_first(body, "transaction_id", "order_id", "id", default=_fallback_id(raw))),
        donor=str(_first(body, "supporter_name", default="Seseorang"))[:60],
        amount=amount,
        message=str(_first(body, "supporter_message", default=""))[:300],
    )


def decode_channel_id(channel_id: str) -> tuple[str, str]:
    """'My Channel ID' from trakteer.id/manage/webhook/websocket is base64("{hash}.{trstream-key}").
    Returns (page_hash, stream_key)."""
    text = channel_id.strip()
    try:
        decoded = base64.b64decode(text + "=" * (-len(text) % 4)).decode()
    except (ValueError, UnicodeDecodeError) as e:
        raise ValueError("TRAKTEER_CHANNEL_ID tidak valid (salin persis dari halaman Via Websocket)") from e
    page_hash, _, stream_key = decoded.partition(".")
    if not page_hash or not stream_key.startswith("trstream-"):
        raise ValueError("TRAKTEER_CHANNEL_ID tidak valid (salin persis dari halaman Via Websocket)")
    return page_hash, stream_key


async def trakteer_ws_loop(engine, stream_key: str, page_hash: str, include_test: bool,
                           session: aiohttp.ClientSession, app_key: str = TRAKTEER_WS_APP_KEY):
    """Listen to Trakteer's overlay feed (no public URL needed). Reconnects forever."""
    channels = [f"creator-stream.{page_hash}.{stream_key}"]
    if include_test:
        channels.append(f"creator-stream-test.{page_hash}.{stream_key}")
    url = TRAKTEER_WS_URL.format(app_key=app_key)
    while True:
        try:
            async with session.ws_connect(url, heartbeat=None) as ws:
                log.info("Trakteer WebSocket tersambung")
                pinger = asyncio.create_task(_pusher_ping(ws))
                try:
                    async for msg in ws:
                        if msg.type != aiohttp.WSMsgType.TEXT:
                            continue
                        data = json.loads(msg.data)
                        event = data.get("event", "")
                        if event == "pusher:connection_established":
                            for ch in channels:
                                await ws.send_json({"event": "pusher:subscribe",
                                                    "data": {"auth": "", "channel": ch}})
                        elif event == "pusher_internal:subscription_succeeded":
                            log.info("Trakteer: siap menerima donasi (%s)", data.get("channel", "").split(".")[0])
                        elif event in ("pusher:error", "pusher:subscription_error"):
                            log.error("Trakteer WebSocket error: %s", data.get("data"))
                        elif event.endswith("BroadcastNotificationCreated"):
                            payload = data.get("data")
                            payload = json.loads(payload) if isinstance(payload, str) else payload
                            d = parse_trakteer(payload or {}, msg.data.encode())
                            if d:
                                if data.get("channel", "").startswith("creator-stream-test"):
                                    d.platform = "trakteer-test"
                                engine.submit(d)
                finally:
                    pinger.cancel()
        except Exception as e:
            log.warning("Trakteer WebSocket putus (%s), sambung ulang 5 detik lagi", e)
        await asyncio.sleep(5)


async def _pusher_ping(ws):
    while True:
        await asyncio.sleep(30)
        await ws.send_json({"event": "pusher:ping", "data": {}})


# ---- Tako ------------------------------------------------------------------
def tako_signature_ok(raw: bytes, headers, secret: str) -> bool:
    got = headers.get("X-Tako-Signature", "").strip().lower()
    if not secret or not got:
        return False
    if got.startswith("sha256="):
        got = got[7:]
    want = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(got, want)


def parse_tako(body: dict, raw: bytes = b"") -> tuple[Donation | None, str | None]:
    """Returns (donation, gift_id_for_name_lookup)."""
    if not isinstance(body, dict):
        return None, None
    event = body.get("event")
    if event is not None and event != "payment.success":
        return None, None
    d = body["data"] if isinstance(body.get("data"), dict) else body
    amount = parse_amount(_first(d, "amount", "grossAmount", "gross_amount", "price", "nominal", default=0))
    if not amount:
        return None, None
    donation = Donation(
        platform="tako",
        id=str(_first(d, "id", "transactionId", "transaction_id", "paymentId", default=_fallback_id(raw))),
        donor=str(_first(d, "gifterName", "gifter_name", "name", "donatorName", "supporter_name",
                         "username", default="Seseorang"))[:60],
        amount=amount,
        message=str(_first(d, "message", "gifterMessage", "supporter_message", default=""))[:300],
    )
    return donation, _first(d, "relatedGiftId", "giftId")


async def tako_fill_gift(session: aiohttp.ClientSession, api_key: str, gift_id, d: Donation):
    """Best effort: fetch donor name + message for an API callback. Never raises."""
    if not (api_key and gift_id):
        return
    try:
        async with session.get(f"https://tako.id/api/v1/gift/{gift_id}",
                               headers={"Authorization": f"Bearer {api_key}"},
                               timeout=aiohttp.ClientTimeout(total=4)) as r:
            gift = (await r.json(content_type=None) or {}).get("result") or {}
        d.donor = str(gift.get("gifterName") or d.donor)[:60]
        d.message = str(gift.get("message") or d.message)[:300]
    except Exception as e:
        log.warning("Tako: gagal ambil nama donatur (%s), pakai '%s'", e, d.donor)
