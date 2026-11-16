"""Export the crater-wide CTX terrain for the solar illumination simulation."""

import json
from math import cos, radians, sin

import numpy as np
from PIL import Image

from export_dem_ctx import DEM_PATH, OUTPUT_DIR


BLOCK_SIZE = 5
STEM = "jezero-crater"


def hillshade(elevation: np.ndarray, spacing: float) -> Image.Image:
    # Rows increase southward. The display light comes from the northwest.
    south_slope, east_slope = np.gradient(elevation, spacing)
    azimuth, altitude = radians(315), radians(45)
    light_east = cos(altitude) * sin(azimuth)
    light_north = cos(altitude) * cos(azimuth)
    light_up = sin(altitude)
    illumination = (
        -east_slope * light_east + south_slope * light_north + light_up
    ) / np.sqrt(1 + east_slope**2 + south_slope**2)
    brightness = 40 + 200 * np.clip(illumination, 0, 1)
    return Image.fromarray(np.nan_to_num(brightness, nan=16).astype(np.uint8))


def main() -> None:
    with Image.open(DEM_PATH) as dem:
        tags = dem.tag_v2
        pixel_width, pixel_height, _ = tags[33550]
        tie_column, tie_row, _, tie_x, tie_y, _ = tags[33922]
        longitude_origin, _, standard_parallel, false_easting, false_northing, radius, *_ = tags[34736]
        if (
            tags[34737].split("|")[0] != "Jezero_Crater_Projection"
            or longitude_origin != 0
            or false_easting != 0
            or false_northing != 0
            or pixel_width != pixel_height
        ):
            raise ValueError("Expected the Jezero CTX equirectangular DEM with square pixels.")

        width = dem.width // BLOCK_SIZE
        height = dem.height // BLOCK_SIZE
        pixels = np.array(
            dem.crop((0, 0, width * BLOCK_SIZE, height * BLOCK_SIZE)),
            dtype=np.float32,
        )
        nodata = np.float32(tags[42113])
        pixels[(pixels == nodata) | ~np.isfinite(pixels)] = np.nan

    # A coarse cell stays missing if any contributing source pixel is missing.
    blocks = pixels.reshape(height, BLOCK_SIZE, width, BLOCK_SIZE)
    elevation = blocks.mean(axis=(1, 3)).astype("<f4")
    spacing = pixel_width * BLOCK_SIZE
    meters_per_latitude_degree = radius * radians(1)
    meters_per_longitude_degree = meters_per_latitude_degree * cos(radians(standard_parallel))
    degrees_per_column = spacing / meters_per_longitude_degree
    degrees_per_row = spacing / meters_per_latitude_degree
    west = (tie_x - tie_column * pixel_width) / meters_per_longitude_degree
    north = (tie_y + tie_row * pixel_height) / meters_per_latitude_degree

    metadata = {
        "file": f"{STEM}.f32",
        "image": f"{STEM}.webp",
        "width": width,
        "height": height,
        "bounds": {
            "west": west,
            "south": north - height * degrees_per_row,
            "east": west + width * degrees_per_column,
            "north": north,
        },
        "degreesPerColumn": degrees_per_column,
        "degreesPerRow": degrees_per_row,
        "metersPerColumn": spacing,
        "metersPerRow": spacing,
        "coordinates": "Mars planetocentric degrees, east-positive, north up",
        "units": "meters",
        "source": {
            "mission": "Mars Reconnaissance Orbiter",
            "instrument": "Context Camera (CTX)",
            "publisher": "USGS Astrogeology Science Center",
            "productId": "M20_JezeroCrater_CTXDEM_20m.tif",
            "url": "https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic",
            "projectedMetersPerPixel": pixel_width,
        },
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / metadata["file"]).write_bytes(elevation.tobytes(order="C"))
    hillshade(elevation, spacing).save(OUTPUT_DIR / metadata["image"], quality=86)
    (OUTPUT_DIR / f"{STEM}.json").write_text(
        json.dumps(metadata, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Crater terrain: {width} × {height} cells at {spacing:g} m")
    print(f"Valid terrain: {np.isfinite(elevation).mean():.2%}")


if __name__ == "__main__":
    main()
