import json
from math import ceil, cos, floor, radians

import numpy as np
from PIL import Image

from inspect_ctx import CTX_PATH, JEZERO_REGION_BOUNDS, ROOT, crop_ctx_image


DEM_PATH = ROOT / "data" / "map" / "CTX" / "Jezero_Crater_CTX_DEM.tif"
OUTPUT_DIR = ROOT / "frontend" / "public" / "data" / "map" / "CTX"

def box_sum(values, radius=15):
    padded = np.pad(values.astype(float), radius)
    sums = np.pad(padded, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    size = 2 * radius + 1
    return (
        sums[size:, size:] - sums[:-size, size:]
        - sums[size:, :-size] + sums[:-size, :-size]
    )


def measure_darkness(metadata, dem):
    height, width = dem.shape

    with Image.open(CTX_PATH) as source:
        nodata = int(source.tag_v2[42113])
        crop, bounds = crop_ctx_image(source)
        pixels = np.asarray(crop)

    lon_step = (bounds["east"] - bounds["west"]) / crop.width
    lat_step = (bounds["north"] - bounds["south"]) / crop.height
    lon = bounds["west"] + (np.arange(crop.width) + 0.5) * lon_step
    lat = bounds["north"] - (np.arange(crop.height) + 0.5) * lat_step

    cols = np.floor(
        (lon - metadata["west"]) / metadata["degreesPerColumn"]
    ).astype(int)
    rows = np.floor(
        (metadata["north"] - lat) / metadata["degreesPerRow"]
    ).astype(int)

    valid = (
        (rows[:, None] >= 0) & (rows[:, None] < height)
        & (cols[None, :] >= 0) & (cols[None, :] < width)
        & (pixels != nodata)
    )
    cells = (rows[:, None] * width + cols[None, :])[valid]
    counts = np.bincount(cells, minlength=dem.size).reshape(dem.shape)
    totals = np.bincount(
        cells, weights=pixels[valid], minlength=dem.size
    ).reshape(dem.shape)

    available = (counts >= 8) & np.isfinite(dem)
    mean = np.divide(totals, counts, out=np.zeros_like(totals), where=available)
    support = box_sum(available)
    background = np.divide(
        box_sum(mean), support, out=np.zeros_like(mean), where=support > 0
    )
    contrast = np.divide(
        background - mean, background,
        out=np.zeros_like(mean), where=background > 0,
    )

    darkness = measure_darkness(metadata, grid)
    metadata["darkness"] = {
        "file": "jezero-darkness.u8",
        "unknown": 255,
        "maxScore": 254,
        "localWindowCells": 31,
        "thresholdFraction": 0.15,
        "saturationFraction": 0.35,
        "sourceMetadata": "jezero-ctx.json",
    }
    (OUTPUT_DIR / metadata["darkness"]["file"]).write_bytes(
        darkness.tobytes(order="C")
    )
    print(f"Darkness coverage: {(darkness != 255).mean():.2%}")
    
    known = (
        available
        & (support >= 0.8 * box_sum(np.ones_like(mean)))
        & (background > 0)
    )

    scores = np.full(dem.shape, 255, dtype=np.uint8)
    scores[known] = np.rint(
        254 * np.clip((contrast[known] - 0.15) / 0.20, 0, 1)
    ).astype(np.uint8)
    return scores

def main() -> None:
    west, south, east, north = JEZERO_REGION_BOUNDS
    if west >= east or south >= north:
        raise ValueError("Expected bounds in west, south, east, north order.")

    with Image.open(DEM_PATH) as dem:
        tags = dem.tag_v2
        if tags[34737].split("|")[0] != "Jezero_Crater_Projection":
            raise ValueError("Unexpected projection for the Jezero CTX DEM.")

        pixel_width, pixel_height, _ = tags[33550]
        tie_col, tie_row, _, tie_x, tie_y, _ = tags[33922]

        # This DEM uses zero central longitude and zero false offsets.
        projection = tags[34736]
        standard_parallel = projection[2]
        radius_m = projection[5]
        meters_per_lat_degree = radius_m * radians(1)
        meters_per_lon_degree = meters_per_lat_degree * cos(
            radians(standard_parallel)
        )

        origin_x = tie_x - tie_col * pixel_width
        origin_y = tie_y + tie_row * pixel_height

        left = floor((west * meters_per_lon_degree - origin_x) / pixel_width)
        right = ceil((east * meters_per_lon_degree - origin_x) / pixel_width)
        top = floor((origin_y - north * meters_per_lat_degree) / pixel_height)
        bottom = ceil((origin_y - south * meters_per_lat_degree) / pixel_height)

        if not (0 <= left < right <= dem.width and 0 <= top < bottom <= dem.height):
            raise ValueError("The requested region extends outside the DEM.")

        grid = np.array(dem.crop((left, top, right, bottom)), dtype="<f4")
        nodata = np.float32(tags[42113])
        grid[(grid == nodata) | ~np.isfinite(grid)] = np.nan

    metadata = {
        "file": "jezero-elevation.f32",
        "width": right - left,
        "height": bottom - top,
        "west": (origin_x + left * pixel_width) / meters_per_lon_degree,
        "north": (origin_y - top * pixel_height) / meters_per_lat_degree,
        "degreesPerColumn": pixel_width / meters_per_lon_degree,
        "degreesPerRow": pixel_height / meters_per_lat_degree,
        "units": "meters",
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / metadata["file"]).write_bytes(grid.tobytes(order="C"))
    (OUTPUT_DIR / "jezero-elevation.json").write_text(
        json.dumps(metadata, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Exported {grid.shape[1]:,} × {grid.shape[0]:,} elevation cells")
    print(f"Valid coverage: {np.isfinite(grid).mean():.2%}")
    print(f"Output: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()