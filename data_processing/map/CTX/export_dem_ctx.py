import json
from math import ceil, cos, floor, radians

import numpy as np
from PIL import Image

from inspect_ctx import JEZERO_REGION_BOUNDS, ROOT


DEM_PATH = ROOT / "data" / "map" / "CTX" / "Jezero_Crater_CTX_DEM.tif"
OUTPUT_DIR = ROOT / "frontend" / "public" / "data" / "map" / "CTX"


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