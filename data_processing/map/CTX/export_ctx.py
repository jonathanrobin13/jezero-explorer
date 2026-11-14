import json

from PIL import Image

from inspect_ctx import CTX_PATH, ROOT, crop_ctx_image


MAX_EDGE = 1800
OUTPUT_DIR = ROOT / "frontend" / "public" / "data" / "map" / "CTX"


def main() -> None:
    with Image.open(CTX_PATH) as source:
        overview, bounds = crop_ctx_image(source)
        pixel_width_m, pixel_height_m, _ = source.tag_v2[33550]

    overview.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    image_path = OUTPUT_DIR / "jezero-ctx.webp"
    overview.save(image_path, format="WEBP", quality=82, method=6)

    metadata = {
        "image": image_path.name,
        "width": overview.width,
        "height": overview.height,
        "bounds": bounds,
        "coordinates": "Mars planetocentric degrees, east-positive, north up",
        "source": {
            "mission": "Mars Reconnaissance Orbiter",
            "instrument": "CTX",
            "publisher": "USGS Astrogeology Science Center",
            "productId": "JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0",
            "url": "https://doi.org/10.5066/P9GV1ND3",
            "projectedMetersPerPixel": [pixel_width_m, pixel_height_m],
        },
    }

    metadata_path = OUTPUT_DIR / "jezero-ctx.json"
    metadata_path.write_text(
        json.dumps(metadata, indent=2) + "\n",
        encoding="utf-8",
    )

    size_kib = image_path.stat().st_size / 1024
    print(f"{image_path} ({overview.width} × {overview.height}, {size_kib:.0f} KiB)")
    print(metadata_path)


if __name__ == "__main__":
    main()