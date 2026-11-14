from math import cos, floor, isfinite, radians
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[3]
DEM_PATH = ROOT / "data" / "map" / "CTX" / "Jezero_Crater_CTX_DEM.tif"


def elevation_at(latitude: float, longitude: float) -> float | None:
    """Return the elevation of the containing DEM cell in meters."""
    with Image.open(DEM_PATH) as dem:
        tags = dem.tag_v2
        pixel_width, pixel_height, _ = tags[33550]
        tie_col, tie_row, _, tie_x, tie_y, _ = tags[33922]

        # Projection parameters for this specific CTX DEM.
        standard_parallel = tags[34736][2]
        radius_m = tags[34736][5]

        # This DEM has zero central longitude and no false offsets.
        x = radius_m * radians(longitude) * cos(radians(standard_parallel))
        y = radius_m * radians(latitude)

        col = floor(tie_col + (x - tie_x) / pixel_width)
        row = floor(tie_row + (tie_y - y) / pixel_height)

        if not (0 <= col < dem.width and 0 <= row < dem.height):
            return None

        elevation = dem.getpixel((col, row))
        nodata = float(tags[42113])
        if not isfinite(elevation) or elevation == nodata:
            return None

        return elevation


if __name__ == "__main__":
    print("Lat: 18.38 - 18.66 Long: 77.18 - 77.6 ")
    while True:
        coordinates = input("Coordinates: ")
        coordinates = coordinates.split(", ")
        latitude, longitude = coordinates
        elevation = elevation_at(float(latitude), float(longitude))
        if elevation is None:
            print("Elevation unavailable at this location.")
        else:
            print(f"Elevation: {elevation:,.1f} m")