#!/usr/bin/env python3
"""
macOS Big Sur–style squircle masking for the app icon.

macOS doesn't auto-round app icons in the Dock — the PNG you ship is what
shows up. This script takes the raw square illustration, scales it to fit
inside the macOS icon safe area (~824/1024), and clips the result with a
rounded square so the dock icon matches every other modern Mac app.
"""

from __future__ import annotations

import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

# Big Sur template: 1024 canvas, 824 content area, 22.37% corner radius.
# Tuned the radius slightly tighter (180) than the spec so the rounded
# corners read as "app-like" without revealing too much background.
CANVAS = 1024
CONTENT = 824
CORNER_RADIUS = 230  # ~22.4% of 1024
SHADOW_OFFSET = 4
SHADOW_BLUR = 10
SHADOW_OPACITY = 60  # 0-255


def round_icon(src_path: Path, dst_path: Path) -> None:
    src = Image.open(src_path).convert("RGBA")
    # Resize the illustration to the content area, preserving aspect ratio.
    src.thumbnail((CONTENT, CONTENT), Image.LANCZOS)

    # Center the resized art on a transparent canvas.
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    paste_x = (CANVAS - src.width) // 2
    paste_y = (CANVAS - src.height) // 2
    canvas.paste(src, (paste_x, paste_y), src)

    # Build the rounded-square alpha mask.
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (0, 0, CANVAS - 1, CANVAS - 1),
        radius=CORNER_RADIUS,
        fill=255,
    )

    # Apply the mask to the alpha channel so corners turn transparent.
    r, g, b, a = canvas.split()
    a = Image.eval(a, lambda v: v)  # ensure modifiable
    a = Image.composite(a, Image.new("L", (CANVAS, CANVAS), 0), mask)
    rounded = Image.merge("RGBA", (r, g, b, a))

    # Add a soft shadow under the icon shape — matches the subtle elevation
    # Apple's templates ship with. Drawn into a separate layer so it doesn't
    # tint the artwork.
    shadow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    shadow_mask = mask.point(lambda v: SHADOW_OPACITY if v > 128 else 0)
    shadow.putalpha(shadow_mask)
    shadow = shadow.filter(ImageFilter.GaussianBlur(SHADOW_BLUR))
    # Shift the shadow down a few px.
    shifted = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    shifted.paste(shadow, (0, SHADOW_OFFSET))

    out = Image.alpha_composite(shifted, rounded)
    out.save(dst_path, "PNG", optimize=True)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: round-icon.py <src> <dst>", file=sys.stderr)
        return 2
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    if not src.exists():
        print(f"source not found: {src}", file=sys.stderr)
        return 1
    round_icon(src, dst)
    print(f"wrote {dst} ({dst.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
