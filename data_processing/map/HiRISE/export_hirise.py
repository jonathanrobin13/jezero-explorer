"""Export a lightweight basemap of Jezero's western delta for the browser."""

import json
from math import ceil, cos, floor, radians
from pathlib import Path

from PIL import Image

# Requested map bounds in Mars latitude and east-positive longitude, in degrees.
# Edit this tuple to change the region.
JEZERO_REGION_BOUNDS = (
    77.18332,  # west
    18.38852,  # south
    77.60080,  # east
    18.66592,  # north
)

WEST, SOUTH, EAST, NORTH = JEZERO_REGION_BOUNDS

ROOT = Path(__file__).resolve().parents[3]
PRODUCT_ID = "PSP_002387_1985_RED_C_01_ORTHO"
SOURCE = ROOT / "data" / "map" / "HiRISE" / f"{PRODUCT_ID}.JP2"
OUTPUT = ROOT / "frontend" / "public" / "data" / "map" / "HiRISE"

# From this JP2's embedded GeoTIFF keys and tiepoint. The origin is the
# upper-left pixel edge. Coordinates use planetocentric latitude and east longitude.
SOURCE_SIZE = (6934, 11538)
ORIGIN_X_M = -3780.6256127794495
ORIGIN_Y_M = 1101403.9199241658
PIXEL_M = 1.0096476466229
RADIUS_M = 3394839.8133163
CENTRAL_LONGITUDE = 77.41
STANDARD_PARALLEL = 15
LATITUDE_METERS_PER_DEGREE = RADIUS_M * radians(1)
LONGITUDE_METERS_PER_DEGREE = LATITUDE_METERS_PER_DEGREE * cos(radians(STANDARD_PARALLEL))

# Editorial viewport around the western delta and nearby crater floor.
# The east side extends to the edge of this HiRISE observation.

def main() -> None:
    left = (LONGITUDE_METERS_PER_DEGREE * (WEST - CENTRAL_LONGITUDE) - ORIGIN_X_M) / PIXEL_M
    right = (LONGITUDE_METERS_PER_DEGREE * (EAST - CENTRAL_LONGITUDE) - ORIGIN_X_M) / PIXEL_M
    top = (ORIGIN_Y_M - LATITUDE_METERS_PER_DEGREE * NORTH) / PIXEL_M
    bottom = (ORIGIN_Y_M - LATITUDE_METERS_PER_DEGREE * SOUTH) / PIXEL_M

    with Image.open(SOURCE) as source:
        if source.size != SOURCE_SIZE or source.mode != "L":
            raise ValueError("Unexpected raster dimensions or mode for this HiRISE product")
        x0, y0 = max(0, floor(left)), max(0, floor(top))
        x1, y1 = min(source.width, ceil(right)), min(source.height, ceil(bottom))
        image = source.crop((x0, y0, x1, y1))
    
        # Make the zero-valued padding at the edges of each row transparent.
    pixels = image.tobytes()
    width, height = image.size
    alpha = bytearray(width * height)

    for y in range(height):
        offset = y * width
        row = pixels[offset:offset + width]
        left = width - len(row.lstrip(b"\x00"))
        right = len(row.rstrip(b"\x00"))

        if left < right:
            alpha[offset + left:offset + right] = b"\xff" * (right - left)

    image = image.convert("RGBA")
    image.putalpha(Image.frombytes("L", (width, height), bytes(alpha)))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    image_path = OUTPUT / "jezero-western-delta.webp"
    image.save(image_path, quality=82, method=6)

    metadata = {
        "image": image_path.name,
        "width": image.width,
        "height": image.height,
        "bounds": {
            "west": CENTRAL_LONGITUDE + (ORIGIN_X_M + x0 * PIXEL_M) / LONGITUDE_METERS_PER_DEGREE,
            "south": (ORIGIN_Y_M - y1 * PIXEL_M) / LATITUDE_METERS_PER_DEGREE,
            "east": CENTRAL_LONGITUDE + (ORIGIN_X_M + x1 * PIXEL_M) / LONGITUDE_METERS_PER_DEGREE,
            "north": (ORIGIN_Y_M - y0 * PIXEL_M) / LATITUDE_METERS_PER_DEGREE,
        },
        "coordinates": "Mars planetocentric degrees, east-positive, north up",
        "displayMetersPerPixel": {
            "x": PIXEL_M * (x1 - x0) / image.width,
            "y": PIXEL_M * (y1 - y0) / image.height,
        },
        "source": {
            "mission": "Mars Reconnaissance Orbiter",
            "instrument": "HiRISE",
            "publisher": "University of Arizona HiRISE team",
            "credit": "NASA/JPL-Caltech/UArizona",
            "productId": PRODUCT_ID,
            "url": "https://www.uahirise.org/dtm/dtm.php?ID=PSP_002387_1985",
            "projectedMetersPerPixel": PIXEL_M,
        },
    }
    metadata_path = OUTPUT / "jezero-western-delta.json"
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"{image_path.name}: {image.width} x {image.height}, {image_path.stat().st_size:,} bytes")
    print(metadata_path)


if __name__ == "__main__":
    main()
