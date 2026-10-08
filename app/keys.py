"""Key name tables (platform independent so config validation works anywhere).

SCAN_CODES: hardware scan codes (set 1) used with SendInput + KEYEVENTF_SCANCODE.
Games that read raw/DirectInput keyboard state expect scan codes, not virtual keys.
The bool marks "extended" keys (E0 prefix).
"""

SCAN_CODES = {
    "ESC": (0x01, False), "1": (0x02, False), "2": (0x03, False), "3": (0x04, False),
    "4": (0x05, False), "5": (0x06, False), "6": (0x07, False), "7": (0x08, False),
    "8": (0x09, False), "9": (0x0A, False), "0": (0x0B, False), "MINUS": (0x0C, False),
    "EQUALS": (0x0D, False), "BACKSPACE": (0x0E, False), "TAB": (0x0F, False),
    "Q": (0x10, False), "W": (0x11, False), "E": (0x12, False), "R": (0x13, False),
    "T": (0x14, False), "Y": (0x15, False), "U": (0x16, False), "I": (0x17, False),
    "O": (0x18, False), "P": (0x19, False), "ENTER": (0x1C, False), "LCTRL": (0x1D, False),
    "A": (0x1E, False), "S": (0x1F, False), "D": (0x20, False), "F": (0x21, False),
    "G": (0x22, False), "H": (0x23, False), "J": (0x24, False), "K": (0x25, False),
    "L": (0x26, False), "LSHIFT": (0x2A, False), "Z": (0x2C, False), "X": (0x2D, False),
    "C": (0x2E, False), "V": (0x2F, False), "B": (0x30, False), "N": (0x31, False),
    "M": (0x32, False), "RSHIFT": (0x36, False), "LALT": (0x38, False),
    "SPACE": (0x39, False), "CAPSLOCK": (0x3A, False),
    "F1": (0x3B, False), "F2": (0x3C, False), "F3": (0x3D, False), "F4": (0x3E, False),
    "F5": (0x3F, False), "F6": (0x40, False), "F7": (0x41, False), "F8": (0x42, False),
    "F9": (0x43, False), "F10": (0x44, False), "F11": (0x57, False), "F12": (0x58, False),
    "RCTRL": (0x1D, True), "RALT": (0x38, True),
    "UP": (0x48, True), "DOWN": (0x50, True), "LEFT": (0x4B, True), "RIGHT": (0x4D, True),
    "INSERT": (0x52, True), "DELETE": (0x53, True), "HOME": (0x47, True), "END": (0x4F, True),
    "PGUP": (0x49, True), "PGDN": (0x51, True),
}

ALIASES = {"CTRL": "LCTRL", "SHIFT": "LSHIFT", "ALT": "LALT", "ESCAPE": "ESC", "RETURN": "ENTER"}


def normalize_key(name) -> str:
    """Return canonical key name, or raise ValueError for unknown keys."""
    key = str(name).strip().upper()
    key = ALIASES.get(key, key)
    if key not in SCAN_CODES:
        raise ValueError(f"tombol tidak dikenal: {name!r}")
    return key


# Virtual-key codes, only needed for the global kill-switch hotkey (RegisterHotKey).
HOTKEY_VK = {f"F{i}": 0x6F + i for i in range(1, 25)}
HOTKEY_VK.update({"PAUSE": 0x13, "SCROLLLOCK": 0x91, "INSERT": 0x2D, "HOME": 0x24,
                  "END": 0x23, "DELETE": 0x2E, "PGUP": 0x21, "PGDN": 0x22})
HOTKEY_VK.update({c: ord(c) for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"})
HOTKEY_VK.update({f"NUMPAD{i}": 0x60 + i for i in range(10)})
HOTKEY_MODS = {"ALT": 0x1, "CTRL": 0x2, "SHIFT": 0x4, "WIN": 0x8}


def parse_hotkey(text: str):
    """'F12' or 'CTRL+SHIFT+P' -> (modifier flags, virtual-key code)."""
    *mods, key = [p.strip().upper() for p in text.split("+")]
    if key not in HOTKEY_VK or any(m not in HOTKEY_MODS for m in mods):
        raise ValueError(f"hotkey tidak valid: {text!r}")
    flags = 0
    for m in mods:
        flags |= HOTKEY_MODS[m]
    return flags, HOTKEY_VK[key]
