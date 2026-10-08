"""Check whether Windows accepts the app's keyboard + mouse input, OUTSIDE the game.

  selftest.bat   (close Valorant first)

Moves the mouse in a small square and taps SHIFT. If this works on the desktop but
mouse actions fail in Valorant (error 87), Valorant/Vanguard is blocking injected mouse
input. That is not worked around: use the keyboard Fire bind for abilities instead.
"""
import sys
import time

from .inputs import IS_WINDOWS, make_backend


def main():
    if not IS_WINDOWS:
        sys.exit("Self-test hanya untuk Windows.")
    b = make_backend()
    print("Self-test mulai 3 detik lagi. Lepas mouse & keyboard, jangan buka Valorant.")
    time.sleep(3)
    results = {}
    try:
        b.key_down("LSHIFT")
        time.sleep(0.05)
        b.key_up("LSHIFT")
        results["Keyboard"] = "OK"
    except OSError as e:
        results["Keyboard"] = f"GAGAL: {e}"
    try:
        for dx, dy in ((80, 0), (0, 80), (-80, 0), (0, -80)):
            for _ in range(8):
                b.mouse_move(dx // 8, dy // 8)
                time.sleep(0.02)
        results["Gerak mouse"] = "OK (kursor harus bergerak membentuk kotak kecil)"
    except OSError as e:
        results["Gerak mouse"] = f"GAGAL: {e}"
    print()
    for name, res in results.items():
        print(f"  {name:12}: {res}")
    print("\nKalau semua OK di sini tapi mouse gagal di Valorant, berarti Valorant memblokir mouse buatan.")
    print("Skill: pakai tombol Fire kedua (lihat config.yaml). Spin & Drunk aim: matikan (enabled: false).")


if __name__ == "__main__":
    main()
