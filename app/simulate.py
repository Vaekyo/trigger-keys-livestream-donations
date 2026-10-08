"""TEST MODE from the command line (no real money).

  python -m app.simulate 5000 --name Budi --message "halo"
  python -m app.simulate 5000 --via trakteer     # full path: fake Trakteer webhook + token check
  python -m app.simulate 5000 --via tako         # full path: fake Tako callback + HMAC signature
  python -m app.simulate 5000 --id abc --id-repeat   # sends the same id twice -> 2nd is ignored
  python -m app.simulate pause | resume | toggle
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

import yaml

from .__main__ import ROOT, load_env


def http(url, body: dict, headers=None):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except urllib.error.URLError as e:
        raise SystemExit(f"Tidak bisa konek ke {url}: {e.reason}. Aplikasinya sudah jalan?")


def main():
    p = argparse.ArgumentParser(description="Simulasi donasi (TEST MODE)")
    p.add_argument("amount", help="nominal Rupiah, atau: pause / resume / toggle")
    p.add_argument("--name", default="Tester")
    p.add_argument("--message", default="donasi tes")
    p.add_argument("--id", default=None)
    p.add_argument("--id-repeat", action="store_true", help="kirim 2x dengan id yang sama")
    p.add_argument("--via", choices=["panel", "trakteer", "tako"], default="panel")
    a = p.parse_args()

    ports = (yaml.safe_load(Path(ROOT / "config.yaml").read_text(encoding="utf-8")) or {}).get("server") or {}
    panel = f"http://127.0.0.1:{ports.get('panel_port', 8787)}"
    hook = f"http://127.0.0.1:{ports.get('webhook_port', 8788)}"
    env = load_env(ROOT / ".env")

    if a.amount in ("pause", "resume", "toggle"):
        print(http(f"{panel}/api/{a.amount}", {}))
        return

    amount = int(a.amount.replace(".", ""))
    did = a.id or f"sim-{int(time.time() * 1000)}"
    for _ in range(2 if a.id_repeat else 1):
        if a.via == "panel":
            res = http(f"{panel}/api/test", {"donor": a.name, "amount": amount, "message": a.message, "id": did})
        elif a.via == "trakteer":
            body = {"created_at": time.strftime("%Y-%m-%dT%H:%M:%S+07:00"), "transaction_id": did,
                    "type": "tip", "supporter_name": a.name, "supporter_message": a.message,
                    "unit": "Cendol", "quantity": 1, "price": amount, "net_amount": int(amount * 0.95)}
            res = http(f"{hook}/webhook/trakteer", body, {"X-Webhook-Token": env["TRAKTEER_WEBHOOK_TOKEN"]})
        else:
            body = {"event": "payment.success",
                    "data": {"id": did, "amount": amount, "paymentMethod": "qris",
                             "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "relatedGiftId": None,
                             "gifterName": a.name, "message": a.message}}
            raw = json.dumps(body).encode()
            url, headers = f"{hook}/webhook/tako", {}
            if env["TAKO_CALLBACK_SECRET"]:
                headers["X-Tako-Signature"] = hmac.new(env["TAKO_CALLBACK_SECRET"].encode(), raw,
                                                       hashlib.sha256).hexdigest()
            else:
                url += f"?key={env['TAKO_WEBHOOK_KEY']}"
            res = http(url, body, headers)
        print(res)


if __name__ == "__main__":
    main()
