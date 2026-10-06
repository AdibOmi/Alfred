"""Screenshot decoding, downscaling, and a perceptual hash used as part of the cache key."""
from __future__ import annotations

import base64
import binascii
import io
from dataclasses import dataclass

from PIL import Image, UnidentifiedImageError

from . import config


class InvalidScreenshot(ValueError):
    pass


@dataclass
class Screenshot:
    jpeg: bytes
    width: int
    height: int
    phash: str


def difference_hash(image: Image.Image, size: int = 16) -> str:
    """dHash: tiny greyscale thumbnail, compare neighbouring pixels.

    Two screenshots of the same screen give the same hash even if a clock ticked
    or the cursor blinked, so repeated questions hit the cache.
    """
    small = image.convert("L").resize((size + 1, size), Image.Resampling.LANCZOS)
    pixels = small.tobytes()  # one byte per pixel in "L" mode
    bits = []
    for row in range(size):
        for col in range(size):
            left = pixels[row * (size + 1) + col]
            right = pixels[row * (size + 1) + col + 1]
            bits.append("1" if left > right else "0")
    return f"{int(''.join(bits), 2):0{size * size // 4}x}"


def decode_screenshot(data: str) -> Screenshot:
    if "," in data and data.lstrip().startswith("data:"):
        data = data.split(",", 1)[1]
    try:
        raw = base64.b64decode(data, validate=True)
        image = Image.open(io.BytesIO(raw))
        image.load()
    except (binascii.Error, UnidentifiedImageError, OSError) as error:
        raise InvalidScreenshot("screenshot must be a base64-encoded PNG or JPEG") from error

    image = image.convert("RGB")
    if image.width > config.SCREENSHOT_MAX_WIDTH:
        ratio = config.SCREENSHOT_MAX_WIDTH / image.width
        image = image.resize((config.SCREENSHOT_MAX_WIDTH, round(image.height * ratio)), Image.Resampling.LANCZOS)

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=82)
    return Screenshot(jpeg=buffer.getvalue(), width=image.width, height=image.height, phash=difference_hash(image))
