"""OS input. Windows: plain user32 SendInput (the documented API, no drivers,
no hooks into the game, no memory access). Other OS / dry_run: log only.

Mouse: relative movement and left/right button clicks only (used to confirm abilities).
There is no aim logic of any kind: the app never looks at the screen or targets anything.
"""
from __future__ import annotations

import logging
import struct
import sys
import threading

from .keys import SCAN_CODES, parse_hotkey

log = logging.getLogger("input")
IS_WINDOWS = sys.platform == "win32"


class DryRunInput:
    """Logs what would be sent. Used for dry_run and on non-Windows machines."""

    real = False

    def key_down(self, key):
        log.info("[dry-run] tekan %s", key)

    def key_up(self, key):
        log.info("[dry-run] lepas %s", key)

    def mouse_move(self, dx, dy):
        log.debug("[dry-run] mouse %+d %+d", dx, dy)

    def mouse_button(self, button, down):
        log.info("[dry-run] mouse %s %s", button, "tekan" if down else "lepas")

    def foreground_process(self):
        return None


# ---- raw INPUT records ----------------------------------------------------------------------
# Built byte by byte with struct.pack instead of ctypes Structure/Union classes: on Python 3.14
# for Windows the ctypes version produced INPUT records with type=0 (mouse) for keyboard events,
# so keys were sent as garbage mouse data and Windows answered error 87. These layouts follow
# winuser.h exactly (x64: 40 bytes, x86: 28 bytes) and do not depend on ctypes layout rules.
INPUT_MOUSE, INPUT_KEYBOARD = 0, 1
KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE = 0x1, 0x2, 0x8
MOUSEEVENTF_MOVE = 0x1
MOUSE_BUTTON_FLAGS = {("LEFT", True): 0x2, ("LEFT", False): 0x4,
                      ("RIGHT", True): 0x8, ("RIGHT", False): 0x10}


def input_size(ptr64: bool) -> int:
    return 40 if ptr64 else 28


def pack_keyboard(scan: int, flags: int, ptr64: bool) -> bytes:
    """INPUT{type=KEYBOARD, ki={wVk=0, wScan, dwFlags, time=0, dwExtraInfo=0}}"""
    if ptr64:   # DWORD type, 4 pad | WORD vk, WORD scan, DWORD flags, DWORD time, 4 pad, ULONG_PTR extra
        raw = struct.pack("<I4xHHII4xQ", INPUT_KEYBOARD, 0, scan, flags, 0, 0)
    else:
        raw = struct.pack("<IHHIII", INPUT_KEYBOARD, 0, scan, flags, 0, 0)
    return raw.ljust(input_size(ptr64), b"\0")      # union is as large as MOUSEINPUT


def pack_mouse(dx: int, dy: int, flags: int, ptr64: bool) -> bytes:
    """INPUT{type=MOUSE, mi={dx, dy, mouseData=0, dwFlags, time=0, dwExtraInfo=0}}"""
    if ptr64:   # DWORD type, 4 pad | LONG dx, LONG dy, DWORD data, DWORD flags, DWORD time, 4 pad, ULONG_PTR extra
        raw = struct.pack("<I4xiiIII4xQ", INPUT_MOUSE, dx, dy, 0, flags, 0, 0)
    else:
        raw = struct.pack("<IiiIIII", INPUT_MOUSE, dx, dy, 0, flags, 0, 0)
    return raw


if IS_WINDOWS:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    PTR64 = ctypes.sizeof(ctypes.c_void_p) == 8
    INPUT_SIZE = input_size(PTR64)

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    WM_HOTKEY, MOD_NOREPEAT = 0x0312, 0x4000

    user32.SendInput.argtypes = (wintypes.UINT, ctypes.c_void_p, ctypes.c_int)
    user32.SendInput.restype = wintypes.UINT
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetWindowThreadProcessId.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.DWORD))
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.QueryFullProcessImageNameW.argtypes = (wintypes.HANDLE, wintypes.DWORD,
                                                    wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD))

    def _send(raw: bytes, what):
        """raw: one packed INPUT record. what: description for errors, e.g. 'keyboard K tekan'."""
        assert len(raw) == INPUT_SIZE
        buf = ctypes.create_string_buffer(raw, INPUT_SIZE)
        if user32.SendInput(1, buf, INPUT_SIZE) != 1:
            err = ctypes.get_last_error()
            fg = WindowsInput().foreground_process() or "?"
            raise OSError(f"SendInput gagal (error {err}) saat {what} | jendela aktif: {fg} | "
                          f"INPUT={INPUT_SIZE}B type={raw[0]} Python {sys.version.split()[0]} "
                          f"{64 if PTR64 else 32}-bit")

    class WindowsInput:
        real = True

        def _key(self, key, up):
            scan, extended = SCAN_CODES[key]
            flags = KEYEVENTF_SCANCODE | (KEYEVENTF_KEYUP if up else 0) | (KEYEVENTF_EXTENDEDKEY if extended else 0)
            _send(pack_keyboard(scan, flags, PTR64), f"keyboard {key} {'lepas' if up else 'tekan'}")

        def key_down(self, key):
            self._key(key, False)

        def key_up(self, key):
            self._key(key, True)

        def mouse_move(self, dx, dy):
            _send(pack_mouse(int(dx), int(dy), MOUSEEVENTF_MOVE, PTR64), "mouse gerak")

        def mouse_button(self, button, down):
            _send(pack_mouse(0, 0, MOUSE_BUTTON_FLAGS[(button, down)], PTR64),
                  f"mouse {button} {'tekan' if down else 'lepas'}")

        def foreground_process(self):
            """File name of the process that owns the focused window, e.g. 'VALORANT-Win64-Shipping.exe'."""
            hwnd = user32.GetForegroundWindow()
            if not hwnd:
                return None
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
            if not handle:
                return None
            try:
                buf = ctypes.create_unicode_buffer(1024)
                size = wintypes.DWORD(len(buf))
                if not kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
                    return None
                return buf.value.replace("/", "\\").rsplit("\\", 1)[-1]
            finally:
                kernel32.CloseHandle(handle)


def make_backend():
    if IS_WINDOWS:
        return WindowsInput()
    log.warning("Bukan Windows: input game TIDAK dikirim (mode dry-run otomatis)")
    return DryRunInput()


def start_hotkey_thread(hotkey: str, on_press) -> bool:
    """Register a global hotkey (works while the game is focused). Returns False if unavailable."""
    if not IS_WINDOWS:
        log.warning("Hotkey kill switch hanya tersedia di Windows (pakai panel / API)")
        return False
    mods, vk = parse_hotkey(hotkey)
    ready = threading.Event()
    ok = [False]

    def loop():
        # RegisterHotKey binds to the calling thread, so the message loop must run here too.
        ok[0] = bool(user32.RegisterHotKey(None, 1, mods | MOD_NOREPEAT, vk))
        ready.set()
        if not ok[0]:
            return
        msg = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            if msg.message == WM_HOTKEY:
                try:
                    on_press()
                except Exception:
                    log.exception("kill switch handler error")

    threading.Thread(target=loop, name="kill-switch", daemon=True).start()
    ready.wait(2)
    if not ok[0]:
        log.error("Hotkey %s gagal didaftarkan (dipakai aplikasi lain?). Ganti safety.kill_switch_key "
                  "di config.yaml, mis. F10 atau PAUSE, lalu restart.", hotkey)
    return ok[0]
