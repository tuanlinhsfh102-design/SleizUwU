"""Repair mojibake in text files using ftfy.

ftfy handles all variants of UTF-8 -> cp1252/Windows-1252 -> UTF-8 damage
without us having to know how many rounds of damage occurred. We just feed
each file through it and keep the result if it got smaller (a clear sign of
mojibake being fixed; legitimate UTF-8 text won't shrink).
"""
import os
import sys

import ftfy


SKIP_DIRS = {
    ".git", "node_modules", "dist", "build", "out", ".next",
    "release", "data", "coverage", ".claude",
}
TEXT_EXTS = {".md", ".txt", ".json", ".ts", ".tsx", ".js", ".cjs", ".mjs", ".html", ".css", ".yaml", ".yml"}


def fix_file(path: str) -> tuple[str, str]:
    with open(path, "rb") as f:
        data = f.read()
    if b"\x00" in data[:8192]:
        return "SKIP", "binary"
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return "SKIP", "not valid UTF-8"
    fixed = ftfy.fix_text(text)
    fixed_bytes = fixed.encode("utf-8")
    if len(fixed_bytes) >= len(data):
        return "KEEP", f"no shrink ({len(data)} -> {len(fixed_bytes)} bytes)"
    # Sanity check: fixed should be valid UTF-8 and re-decodable
    try:
        fixed_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        return "FAIL", f"invalid UTF-8 after fix: {exc}"
    with open(path, "wb") as f:
        f.write(fixed_bytes)
    return "FIXED", f"{len(data)} -> {len(fixed_bytes)} bytes ({100 * (1 - len(fixed_bytes) / len(data)):.1f}% smaller)"


def main() -> int:
    targets: list[str] = []
    for root, dirs, files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fn in files:
            ext = os.path.splitext(fn)[1].lower()
            if ext in TEXT_EXTS:
                targets.append(os.path.join(root, fn))
    fixed_total = 0
    for path in sorted(targets):
        status, detail = fix_file(path)
        if status == "FIXED":
            fixed_total += 1
            print(f"FIXED  {path}  ({detail})")
        elif status == "FAIL":
            print(f"FAIL   {path}  ({detail})")
    print(f"\n=== {fixed_total} files fixed ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
