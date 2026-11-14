import re
from pathlib import Path

import numpy as np
from PIL import Image


DATA_DIR = Path(__file__).resolve().parents[3] / "data" / "map" / "HiRISE"
DTM_PATH = DATA_DIR / "DTEEC_002387_1985_003798_1985_A01.IMG"
ORTHO_PATH = DATA_DIR / "PSP_002387_1985_RED_C_01_ORTHO.JP2"


def label_value(label: str, key: str) -> str:
    """Read the first token from a PDS label field."""
    match = re.search(rf"^\s*{re.escape(key)}\s*=\s*(\S+)", label, re.MULTILINE)
    if match is None:
        raise ValueError(f"Missing PDS label field {key}")
    return match.group(1)


def load_terrain(path: Path) -> tuple[np.ndarray, np.ndarray, str]:
    """Return elevation in meters, a valid-cell mask, and the PDS label."""
    with path.open("rb") as source:
        # The metadata for this product fits in the first 8 KiB.
        label = source.read(8192).decode("ascii", errors="replace")

    rows = int(label_value(label, "LINES"))
    cols = int(label_value(label, "LINE_SAMPLES"))
    record_bytes = int(label_value(label, "RECORD_BYTES"))
    image_record = int(label_value(label, "^IMAGE"))
    if (
        label_value(label, "SAMPLE_TYPE") != "PC_REAL"
        or int(label_value(label, "SAMPLE_BITS")) != 32
        or int(label_value(label, "BANDS")) != 1
        or record_bytes != cols * 4
    ):
        raise ValueError("Expected one band of 32-bit little-endian elevation values")

    # PDS record numbering starts at 1.
    image_offset = (image_record - 1) * record_bytes
    raw = np.memmap(
        path, dtype="<f4", mode="r", offset=image_offset, shape=(rows, cols)
    )

    # Compare the exact stored bits before applying scale and offset.
    missing_hex = label_value(label, "MISSING_CONSTANT").split("#")[1]
    valid = (raw.view("<u4") != int(missing_hex, 16)) & np.isfinite(raw)

    scale = float(label_value(label, "SCALING_FACTOR"))
    offset = float(label_value(label, "OFFSET"))
    elevation_m = np.full(raw.shape, np.nan, dtype=np.float32)
    elevation_m[valid] = raw[valid] * scale + offset
    return elevation_m, valid, label


def main() -> None:
    elevation_m, valid, label = load_terrain(DTM_PATH)
    rows, cols = elevation_m.shape
    spacing_m = float(label_value(label, "MAP_SCALE"))

    print(f"Terrain grid: {cols:,} columns × {rows:,} rows")
    print(f"Projected grid spacing: {spacing_m:.5f} m/pixel")
    print(f"Valid terrain coverage: {valid.mean():.1%}")
    if valid.any():
        low = np.nanmin(elevation_m)
        high = np.nanmax(elevation_m)
        print(f"Elevation range: {low:,.1f} to {high:,.1f} m")

    with Image.open(ORTHO_PATH) as ortho:
        print(f"Orthoimage: {ortho.width:,} × {ortho.height:,} pixels")
        print(f"Orthoimage bands: {len(ortho.getbands())}")


if __name__ == "__main__":
    main()
