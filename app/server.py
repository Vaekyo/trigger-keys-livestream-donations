"""Two small HTTP servers (both bind to 127.0.0.1):

- webhook server (port 8788): ONLY /webhook/trakteer and /webhook/tako. Point your tunnel here.
- local server   (port 8787): overlay, price list, test panel, control API. Never tunnel this one.
"""
from __future__ import annotations

import asyncio
import hmac
import ipaddress
import json
import logging
import time
import uuid
from pathlib import Path

from aiohttp import web

from .config import describe_steps
from .engine import Donation
from .platforms import parse_tako, parse_trakteer, tako_fill_gift, tako_signature_ok, trakteer_token_ok

log = logging.getLogger("server")
WEB = Path(__file__).resolve().parent.parent / "web"
SOUNDS = Path(__file__).resolve().parent.parent / "sounds"


class Hub:
    """Server-Sent Events fan-out for the overlay / panel."""

    def __init__(self):
        self.clients: set[asyncio.Queue] = set()

    def publish(self, kind, data):
        msg = f"event: {kind}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        for q in self.clients:
            q.put_nowait(msg)


# ---- webhook server ----------------------------------------------------------
def build_webhook_app(engine, settings, session, raw_log: Path | None) -> web.Application:
    def log_raw(platform, request, raw):
        if raw_log:
            safe = {k: v for k, v in request.headers.items()
                    if k.lower() not in ("x-webhook-token", "x-tako-signature", "authorization")}
            with raw_log.open("a", encoding="utf-8") as f:
                f.write(json.dumps({"time": time.strftime("%Y-%m-%d %H:%M:%S"), "platform": platform,
                                    "headers": safe, "body": raw.decode("utf-8", "replace")},
                                   ensure_ascii=False) + "\n")

    async def trakteer(request: web.Request):
        raw = await request.read()
        log_raw("trakteer", request, raw)
        if not trakteer_token_ok(request.headers, settings["TRAKTEER_WEBHOOK_TOKEN"]):
            log.warning("Trakteer webhook DITOLAK: X-Webhook-Token salah/kosong")
            return web.json_response({"error": "unauthorized"}, status=401)
        try:
            body = json.loads(raw)
        except ValueError:
            return web.json_response({"error": "bad json"}, status=400)
        d = parse_trakteer(body, raw)
        return web.json_response(engine.submit(d) if d else {"status": "ignored"})

    async def tako(request: web.Request):
        raw = await request.read()
        log_raw("tako", request, raw)
        secret, key = settings["TAKO_CALLBACK_SECRET"], settings["TAKO_WEBHOOK_KEY"]
        if "X-Tako-Signature" in request.headers and secret:
            ok = tako_signature_ok(raw, request.headers, secret)
        elif key:
            ok = hmac.compare_digest(request.query.get("key", "").encode(), key.encode())
        else:
            ok = False
        if not ok:
            log.warning("Tako webhook DITOLAK: signature / ?key= tidak cocok")
            return web.json_response({"error": "unauthorized"}, status=401)
        try:
            body = json.loads(raw)
        except ValueError:
            return web.json_response({"error": "bad json"}, status=400)
        d, gift_id = parse_tako(body, raw)
        if not d:
            return web.json_response({"status": "ignored"})
        await tako_fill_gift(session, settings["TAKO_API_KEY"], gift_id, d)
        return web.json_response(engine.submit(d))

    async def health(_):
        return web.json_response({"ok": True})

    app = web.Application(client_max_size=256 * 1024)
    app.router.add_get("/", health)
    app.router.add_post("/webhook/trakteer", trakteer)
    app.router.add_post("/webhook/tako", tako)
    return app


# ---- local server -------------------------------------------------------------
def _is_local(request) -> bool:
    try:
        ip = ipaddress.ip_address((request.remote or "").split("%")[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_loopback


def lan_guard(token: str):
    """Requests from this PC pass. Requests from a phone/laptop on the WiFi need the token once
    (…/panel?token=XXX); it is then kept in a cookie."""
    @web.middleware
    async def guard(request, handler):
        if _is_local(request):
            return await handler(request)
        given = request.query.get("token") or request.cookies.get("dc_token", "")
        if not (token and hmac.compare_digest(given.encode(), token.encode())):
            return web.Response(status=403, text="Token salah / tidak ada. Buka link lengkap dari console "
                                                 "(http://IP-PC:8787/panel?token=...)")
        resp = await handler(request)
        if request.query.get("token") and not resp.prepared:
            resp.set_cookie("dc_token", given, max_age=60 * 60 * 24 * 90, httponly=True, samesite="Strict")
        return resp
    return guard


def build_local_app(engine, store, hub: Hub, control_token: str) -> web.Application:
    def page(name):
        async def handler(_):
            return web.FileResponse(WEB / name, headers={"Cache-Control": "no-store"})
        return handler

    async def events(request):
        resp = web.StreamResponse(headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"})
        await resp.prepare(request)
        q: asyncio.Queue = asyncio.Queue()
        hub.clients.add(q)
        q.put_nowait(f"event: state\ndata: {json.dumps(engine.state())}\n\n")
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), 15)
                except asyncio.TimeoutError:
                    msg = ": ping\n\n"
                await resp.write(msg.encode())
        except (ConnectionResetError, asyncio.CancelledError):
            pass
        finally:
            hub.clients.discard(q)
        return resp

    def json_only(handler):
        # Requiring a JSON content type blocks drive-by form posts from other websites (CSRF).
        async def wrapped(request):
            if request.content_type != "application/json":
                return web.json_response({"error": "Content-Type harus application/json"}, status=415)
            return await handler(request)
        return wrapped

    async def state(_):
        return web.json_response(engine.state())

    async def config(_):
        cfg = store.get()
        return web.json_response({
            "overlay": cfg["overlay"],
            "actions": [{"name": a["name"], "min_amount": a["min_amount"], "enabled": a["enabled"],
                         "overlay_text": a["overlay_text"], "cooldown_s": a["cooldown_s"],
                         "inputs": describe_steps(a["steps"])}
                        for a in cfg["actions"]]})

    async def recent(_):
        return web.json_response(list(engine.recent_log)[-50:])

    @json_only
    async def test(request):
        body = await request.json()
        try:
            amount = int(body.get("amount", 0))
        except (TypeError, ValueError):
            amount = 0
        if amount <= 0:
            return web.json_response({"error": "amount harus > 0"}, status=400)
        d = Donation(platform="test", id=str(body.get("id") or uuid.uuid4()),
                     donor=str(body.get("donor") or "Tester")[:60], amount=amount,
                     message=str(body.get("message") or "")[:300])
        return web.json_response(engine.submit(d))

    @json_only
    async def control(request):
        what = request.match_info["what"]
        engine.set_paused({"pause": True, "resume": False, "toggle": not engine.paused}[what], "panel")
        return web.json_response(engine.state())

    async def control_get(request):
        """For Streamer.bot 'Fetch URL' / Stream Deck: GET /api/toggle?token=CONTROL_TOKEN"""
        token = request.query.get("token", "")
        if not control_token or not hmac.compare_digest(token.encode(), control_token.encode()):
            return web.json_response({"error": "token salah / CONTROL_TOKEN belum diisi"}, status=403)
        what = request.match_info["what"]
        engine.set_paused({"pause": True, "resume": False, "toggle": not engine.paused}[what], "streamerbot")
        return web.Response(text="PAUSED" if engine.paused else "ON")

    app = web.Application(middlewares=[lan_guard(control_token)])
    app.router.add_get("/", page("panel.html"))
    app.router.add_get("/panel", page("panel.html"))
    app.router.add_get("/overlay", page("overlay.html"))
    app.router.add_get("/pricelist", page("pricelist.html"))
    app.router.add_get("/events", events)
    app.router.add_get("/api/state", state)
    app.router.add_get("/api/config", config)
    app.router.add_get("/api/log", recent)
    app.router.add_post("/api/test", test)
    app.router.add_post("/api/{what:pause|resume|toggle}", control)
    app.router.add_get("/api/{what:pause|resume|toggle}", control_get)
    SOUNDS.mkdir(exist_ok=True)
    app.router.add_static("/sounds/", SOUNDS)
    return app
