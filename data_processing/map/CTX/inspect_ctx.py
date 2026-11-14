from math import ceil, floor, radians
from pathlib import Path

from PIL import Image


# West, south, east, north in Mars planetocentric degrees.
JEZERO_REGION_BOUNDS = (77.18332, 18.38852, 77.60080, 18.66592)

ROOT = Path(__file__).resolve().parents[3]
CTX_PATH = ROOT / "data" / "map" / "CTX" / "MRO_CTX_Jezero_Mosaic_Controlled.tif"


def crop_ctx_image(
    image: Image.Image,
) -> tuple[Image.Image, dict[str, float]]:
    """Crop the controlled CTX basemap and return its actual pixel-edge bounds."""
    west, south, east, north = JEZERO_REGION_BOUNDS
    if west >= east or south >= north:
        raise ValueError("Bounds must be ordered west, south, east, north.")

    tags = image.tag_v2
    projection = tags[34737].split("|")[0]
    if projection != "Equirectangular Mars 2000 Sphere IAU":
        raise ValueError(f"Unexpected CTX projection: {projection}")

    # This basemap uses a zero central longitude and standard parallel.
    pixel_width, pixel_height, _ = tags[33550]
    tie_col, tie_row, _, tie_x, tie_y, _ = tags[33922]
    meters_per_degree = tags[34736][5] * radians(1)
    origin_x = tie_x - tie_col * pixel_width
    origin_y = tie_y + tie_row * pixel_height

    left = floor((west * meters_per_degree - origin_x) / pixel_width)
    right = ceil((east * meters_per_degree - origin_x) / pixel_width)
    top = floor((origin_y - north * meters_per_degree) / pixel_height)
    bottom = ceil((origin_y - south * meters_per_degree) / pixel_height)

    if not (0 <= left < right <= image.width and 0 <= top < bottom <= image.height):
        raise ValueError("The requested rectangle extends beyond the CTX raster.")

    bounds = {
        "west": (origin_x + left * pixel_width) / meters_per_degree,
        "south": (origin_y - bottom * pixel_height) / meters_per_degree,
        "east": (origin_x + right * pixel_width) / meters_per_degree,
        "north": (origin_y - top * pixel_height) / meters_per_degree,
    }
    return image.crop((left, top, right, bottom)), bounds


def main() -> None:
    import numpy as np

    with Image.open(CTX_PATH) as image:
        crop, _ = crop_ctx_image(image)
        pixel_width, pixel_height, _ = image.tag_v2[33550]
        nodata = int(image.tag_v2[42113])

        print(f"Source: {CTX_PATH.name}")
        print(f"Projection: {image.tag_v2[34737].split('|')[0]}")
        print(f"Source dimensions: {image.width:,} × {image.height:,} pixels")
        print(f"Pixel spacing: {pixel_width:g} × {pixel_height:g} m")
        print(f"NoData value: {nodata}")

    pixels = np.asarray(crop)
    valid = pixels[pixels != nodata]

    print(f"Crop dimensions: {crop.width:,} × {crop.height:,} pixels")
    print(f"Valid imagery: {valid.size / pixels.size:.2%}")
    print(f"Missing pixels: {pixels.size - valid.size:,}")

    if valid.size:
        low, high = np.percentile(valid, [2, 98])
        print(f"Brightness range: {valid.min()} to {valid.max()}")
        print(f"Mean brightness: {valid.mean():.1f}")
        print(f"Brightness, 2nd to 98th percentile: {low:.0f} to {high:.0f}")


if __name__ == "__main__":
    main()