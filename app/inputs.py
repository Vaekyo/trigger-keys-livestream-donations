"""OS input. Windows: plain user32 SendInput (the documented API, no drivers,
no hooks into the game, no memory access). Other OS / dry_run: log only.

Mouse: relative movement and left/right button clicks only (used to confirm abilities).
There is no aim logic of any kind: the app never looks at the screen or targets anything.
"""
from __future__ import annotations

import logging
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


if IS_WINDOWS:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    ULONG_PTR = ctypes.c_size_t

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                    ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                    ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]

    class HARDWAREINPUT(ctypes.Structure):
        _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD), ("wParamH", wintypes.WORD)]

    class _INPUTUNION(ctypes.Union):
        _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]

    class INPUT(ctypes.Structure):
        _anonymous_ = ("u",)
        _fields_ = [("type", wintypes.DWORD), ("u", _INPUTUNION)]

    INPUT_MOUSE, INPUT_KEYBOARD = 0, 1
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE = 0x1, 0x2, 0x8
    MOUSEEVENTF_MOVE = 0x1
    MOUSE_BUTTON_FLAGS = {("LEFT", True): 0x2, ("LEFT", False): 0x4,
                          ("RIGHT", True): 0x8, ("RIGHT", False): 0x10}
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    WM_HOTKEY, MOD_NOREPEAT = 0x0312, 0x4000

    user32.SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int)
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetWindowThreadProcessId.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.DWORD))
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.QueryFullProcessImageNameW.argtypes = (wintypes.HANDLE, wintypes.DWORD,
                                                    wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD))

    def _send(inp, what):
        """what: human description for errors, e.g. 'keyboard K tekan' or 'mouse LEFT lepas'."""
        if user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT)) != 1:
            err = ctypes.get_last_error()
            fg = WindowsInput().foreground_process() or "?"
            raise OSError(f"SendInput gagal (error {err}) saat {what} | jendela aktif: {fg} | "
                          f"INPUT={ctypes.sizeof(INPUT)}B type={inp.type} Python {sys.version.split()[0]} "
                          f"{8 * ctypes.sizeof(ctypes.c_void_p)}-bit")

    class WindowsInput:
        real = True

        def _key(self, key, up):
            scan, extended = SCAN_CODES[key]
            flags = KEYEVENTF_SCANCODE | (KEYEVENTF_KEYUP if up else 0) | (KEYEVENTF_EXTENDEDKEY if extended else 0)
            inp = INPUT(type=INPUT_KEYBOARD)
            inp.ki = KEYBDINPUT(0, scan, flags, 0, 0)
            _send(inp, f"keyboard {key} {'lepas' if up else 'tekan'}")

        def key_down(self, key):
            self._key(key, False)

        def key_up(self, key):
            self._key(key, True)

        def mouse_move(self, dx, dy):
            inp = INPUT(type=INPUT_MOUSE)
            inp.mi = MOUSEINPUT(int(dx), int(dy), 0, MOUSEEVENTF_MOVE, 0, 0)
            _send(inp, "mouse gerak")

        def mouse_button(self, button, down):
            inp = INPUT(type=INPUT_MOUSE)
            inp.mi = MOUSEINPUT(0, 0, 0, MOUSE_BUTTON_FLAGS[(button, down)], 0, 0)
            _send(inp, f"mouse {button} {'tekan' if down else 'lepas'}")

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
