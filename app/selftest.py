"""Check which inputs Windows accepts from the app, OUTSIDE the game.

  selftest.bat   (close Valorant first, open Notepad and click into it during the countdown)

Replays the skill sequence (Q, wait, hold K) key by key, then a small mouse move, and prints
OK / FAILED for every single press and release. If this all works in Notepad but fails in
Valorant, the game/Vanguard is rejecting injected input. That is not worked around.
"""
import sys
import time

from .inputs import IS_WINDOWS, make_backend


def main():
    if not IS_WINDOWS:
        sys.exit("Self-test hanya untuk Windows.")
    b = make_backend()
    print("Buka Notepad, lalu KLIK ke dalam Notepad sekarang. Tes mulai 5 detik lagi...")
    for i in range(5, 0, -1):
        print(f"  {i}...")
        time.sleep(1)
    print(f"Jendela aktif: {b.foreground_process()}\n")

    results = []

    def attempt(label, fn):
        try:
            fn()
            results.append((label, "OK"))
        except OSError as e:
            results.append((label, f"GAGAL: {e}"))

    # Same order and timing as the "Random skill" action.
    attempt("Q tekan", lambda: b.key_down("Q"))
    time.sleep(0.04)
    attempt("Q lepas", lambda: b.key_up("Q"))
    time.sleep(0.9)
    attempt("K tekan", lambda: b.key_down("K"))
    time.sleep(0.15)
    attempt("K lepas", lambda: b.key_up("K"))
    time.sleep(0.2)
    attempt("SPACE tekan", lambda: b.key_down("SPACE"))
    time.sleep(0.04)
    attempt("SPACE lepas", lambda: b.key_up("SPACE"))
    time.sleep(0.2)
    attempt("Mouse gerak", lambda: [b.mouse_move(10, 0), b.mouse_move(-10, 0)])

    print("Hasil:")
    for label, res in results:
        print(f"  {label:12}: {res}")
    print("\nDi Notepad harus muncul huruf 'qk' dan satu spasi.")
    print("Kirim screenshot jendela ini ke developer.")


if __name__ == "__main__":
    main()
