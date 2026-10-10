"""Check which inputs Windows accepts from the app. Prints OK / GAGAL for every press and release.

  selftest.bat        Notepad test: replays the skill sequence (Q, wait, hold K) + Space + a tiny mouse move.
  selftest-game.bat   Valorant test (Practice Range): Space, K, Space, Q, K, Space, one per 1.5 s,
                      so we can see whether only K (the Fire bind) is rejected or everything after the first key.

Diagnostics only. If Valorant rejects a key, that is reported, never worked around.
"""
import sys
import time

from .inputs import IS_WINDOWS, make_backend


def countdown(text, seconds):
    print(text)
    for i in range(seconds, 0, -1):
        print(f"  {i}...")
        time.sleep(1)


def run(b, sequence):
    """sequence: list of (key, hold_seconds, pause_after_seconds). Returns [(label, result)]."""
    results = []
    for key, hold, pause in sequence:
        for label, fn in ((f"{key} tekan", lambda: b.key_down(key)), (f"{key} lepas", lambda: b.key_up(key))):
            try:
                fn()
                results.append((label, "OK"))
            except OSError as e:
                results.append((label, f"GAGAL: {e}"))
            if label.endswith("tekan"):
                time.sleep(hold)
        time.sleep(pause)
    return results


def main():
    if not IS_WINDOWS:
        sys.exit("Self-test hanya untuk Windows.")
    b = make_backend()
    game = len(sys.argv) > 1 and sys.argv[1] == "game"
    if game:
        countdown("Buka Valorant -> Practice Range, lalu KLIK ke dalam game sekarang (jangan pegang keyboard).\n"
                  "Catatan: K tanpa skill = senjata menembak sekali. Tes mulai 10 detik lagi...", 10)
        sequence = [("SPACE", 0.04, 1.5), ("K", 0.15, 1.5), ("SPACE", 0.04, 1.5),
                    ("Q", 0.04, 1.5), ("K", 0.15, 1.5), ("SPACE", 0.04, 0.5)]
    else:
        countdown("Buka Notepad, lalu KLIK ke dalam Notepad sekarang. Tes mulai 5 detik lagi...", 5)
        sequence = [("Q", 0.04, 0.9), ("K", 0.15, 0.2), ("SPACE", 0.04, 0.2)]
    print(f"Jendela aktif: {b.foreground_process()}\n")
    results = run(b, sequence)
    if not game:
        try:
            b.mouse_move(10, 0)
            b.mouse_move(-10, 0)
            results.append(("Mouse gerak", "OK"))
        except OSError as e:
            results.append(("Mouse gerak", f"GAGAL: {e}"))

    print("Hasil:")
    for label, res in results:
        print(f"  {label:12}: {res}")
    if game:
        print("\nKalau hanya K yang GAGAL: Valorant menolak tombol Fire buatan.")
        print("Kalau semua setelah tombol pertama GAGAL: Valorant menolak input buatan berurutan.")
    else:
        print("\nDi Notepad harus muncul huruf 'qk' dan satu spasi.")
    print("Kirim screenshot jendela ini ke developer.")


if __name__ == "__main__":
    main()
