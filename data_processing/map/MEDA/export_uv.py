"""Export geolocated daylight UV snapshots from the November 2022 MEDA files."""

import argparse
import csv
import json
import math
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[3]
MAP_DATA = ROOT / "frontend/public/data/map"
ARCHIVE = "https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/"
FRAME = ("https://naif.jpl.nasa.gov/pub/naif/pds/pds4/mars2020/"
         "mars2020_spice/spice_kernels/fk/m2020_v04.tf")
LANDING = "https://ntrs.nasa.gov/api/citations/20210024320/downloads/MEADSreconstruction.pdf"
START = datetime.fromisoformat("2022-11-11T00:00:00Z")
STOP = datetime.fromisoformat("2022-11-19T00:00:00Z")
# The landing-site origin is planetocentric. The topocentric frame's outward
# normal uses the Gaussian latitude from the NAIF frame kernel.
LANDING_LONGITUDE = math.radians(77.45088572)
LANDING_LATITUDE = math.radians(18.44462715)
LANDING_RADIUS_M = 3391936.53
NORMAL_LATITUDE = math.radians(18.64875816)


def map_coordinates(north, west, up):
    """Translate the M2020_TOPO north/west/up position into Mars body-fixed angles."""
    radial = (
        LANDING_RADIUS_M * math.cos(LANDING_LATITUDE)
        - north * math.sin(NORMAL_LATITUDE)
        + up * math.cos(NORMAL_LATITUDE)
    )
    z = (
        LANDING_RADIUS_M * math.sin(LANDING_LATITUDE)
        + north * math.cos(NORMAL_LATITUDE)
        + up * math.sin(NORMAL_LATITUDE)
    )
    latitude = math.degrees(math.atan2(z, math.hypot(radial, west)))
    longitude = math.degrees(LANDING_LONGITUDE - math.atan2(west, radial)) % 360
    return latitude, longitude


def inside(bounds, latitude, longitude):
    return (
        bounds["south"] <= latitude <= bounds["north"]
        and bounds["west"] <= longitude <= bounds["east"]
    )


def read_product(source_dir, sol, product, collection, sol_range="sol_0540_0659"):
    path = sorted(source_dir.glob(f"*WE__{sol:04d}*{product}*.CSV"))[-1]
    label = ET.parse(path.with_suffix(".xml"))
    time = label.find(".//{*}Time_Coordinates")
    start = datetime.fromisoformat(time.findtext("{*}start_date_time"))
    stop = datetime.fromisoformat(time.findtext("{*}stop_date_time"))
    filename = label.findtext(".//{*}File/{*}file_name")
    product_id = label.findtext(".//{*}logical_identifier")
    version = label.findtext(".//{*}version_id")
    url = f"{ARCHIVE}{collection}/{sol_range}/sol_{sol:04d}/{filename}"
    with path.open(newline="", encoding="ascii") as handle:
        rows = list(csv.DictReader(handle))
    return rows, start, stop, {"id": product_id, "version": version, "url": url}


def samples_for_sol(source_dir, sol, map_bounds):
    rds, start, stop, rds_product = read_product(source_dir, sol, "CAL_RDS", "data_calibrated_env")
    ancillary, _, _, position_product = read_product(
        source_dir, sol, "DER_ANCILLARY", "data_derived_env",
    )
    geometry = {r["SCLK"]: r for r in ancillary}
    first = int(rds[0]["SCLK"])
    last = int(rds[-1]["SCLK"])
    if abs((stop - start).total_seconds() - (last - first)) > 2:
        raise ValueError(f"Unexpected SCLK-to-UTC duration for sol {sol}")

    buckets = {}
    for row in rds:
        if not row["RDS_TOP_3"] or row["ROVER_STILL"] != "1" or row["ROVER_HGA_STILL"] == "0":
            continue
        value = float(row["RDS_TOP_3"])
        if not 0 < value <= 91.25:
            continue
        position = geometry.get(row["SCLK"])
        if not position or row["LTST"] != position["LTST"]:
            continue
        fields = ["SOLAR_ZENITHAL_ANGLE", "ROVER_POSITION_X", "ROVER_POSITION_Y", "ROVER_POSITION_Z"]
        if not all(position[field] for field in fields):
            continue
        zenith, north, west, up = (float(position[field]) for field in fields)
        if not 0 <= zenith < 90:
            continue
        latitude, longitude = map_coordinates(north, west, up)
        if not inside(map_bounds, latitude, longitude):
            continue

        sclk = int(row["SCLK"])
        # PDS supplies SCLK seconds per row and UTC at each file endpoint.
        # Interpolation provides an approximate UTC within the product.
        utc = start + (stop - start) * ((sclk - first) / (last - first))
        if not START <= utc < STOP:
            continue
        ltst_sol, local_time = row["LTST"].split()
        hour, minute, second = map(int, local_time.split(":"))
        seconds = hour * 3600 + minute * 60 + second
        bucket, offset = divmod(seconds, 1800)
        midpoint_distance = abs(offset - 900)
        if bucket in buckets and buckets[bucket][0] <= midpoint_distance:
            continue
        buckets[bucket] = midpoint_distance, {
            "sol": int(ltst_sol),
            "sclk": sclk,
            "utc": utc.isoformat(timespec="seconds").replace("+00:00", "Z"),
            "localSolarTime": local_time,
            "latitude": round(latitude, 6),
            "longitude": round(longitude, 6),
            "wattsPerSquareMeter": value,
        }

    return [sample for _, sample in buckets.values()], [rds_product, position_product]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_dir", type=Path, help="Directory containing the paired PDS CSV/XML files")
    args = parser.parse_args()
    map_bounds = json.loads((MAP_DATA / "CTX/jezero-ctx.json").read_text())["bounds"]
    high_res_bounds = json.loads((MAP_DATA / "HiRISE/jezero-western-delta.json").read_text())["bounds"]
    samples, products = [], []
    for sol in range(613, 622):
        points, sources = samples_for_sol(args.source_dir, sol, map_bounds)
        samples.extend(points)
        if points:
            products.extend(sources)
    samples.sort(key=lambda point: point["utc"])
    dates = {point["utc"][:10] for point in samples}
    if len(dates) != 8:
        raise ValueError(f"Expected all 8 UTC dates, got {sorted(dates)}")
    high_res_count = sum(inside(high_res_bounds, p["latitude"], p["longitude"]) for p in samples)

    result = {
        "source": {
            "mission": "Mars 2020 Perseverance",
            "instrument": "MEDA Radiation and Dust Sensor, top photodiode 3",
            "publisher": "NASA Planetary Data System, Planetary Atmospheres Node",
            "url": "https://doi.org/10.17189/1522849",
            "instrumentPaper": "https://doi.org/10.1007/s11214-021-00816-9",
            "frameKernel": FRAME,
            "landingSiteCoordinates": LANDING,
            "products": products,
            "wavelengthNm": [250, 400],
            "units": "W/m²",
            "coverageUtc": ["2022-11-11", "2022-11-18"],
            "resolution": "Rover point observations, native ~1 Hz when observing, one snapshot per occupied 30-minute local true solar time bin per product",
            "coordinates": "Mars planetocentric degrees, east-positive",
        },
        "samples": samples,
    }
    target = MAP_DATA / "MEDA/jezero-uv.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(samples)} snapshots for {len(dates)} UTC dates in CTX bounds; {high_res_count} also inside HiRISE bounds")


if __name__ == "__main__":
    main()
