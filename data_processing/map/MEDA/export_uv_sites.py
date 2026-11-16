"""Average calibrated Perseverance UV readings at separate, mapped rover stops."""

import argparse
import json
import math
from pathlib import Path
from statistics import fmean

from export_uv import FRAME, LANDING, MAP_DATA, inside, map_coordinates, read_product


WAYPOINTS = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"
MARS_RADIUS_M = 3_396_190
SOLAR_ZENITH_DEGREES = (35, 45)
MAX_ROVER_TILT_DEGREES = 15
SITE_RADIUS_M = 100
MIN_SAMPLES = 60
# Observation sol, archive directory, and NASA end-of-drive location (latitude, longitude).
# These waypoints select source files and filter out readings from a different stop.
TARGETS = (
    (154, "sol_0090_0179", 18.4284, 77.4520),
    (380, "sol_0300_0419", 18.4462, 77.4515),
    (403, "sol_0300_0419", 18.4606, 77.4300),
    (614, "sol_0540_0659", 18.4536, 77.3992),
    (756, "sol_0660_0779", 18.4713, 77.3774),
    (785, "sol_0780_0899", 18.4827, 77.3686),
    (910, "sol_0900_1019", 18.4833, 77.3507),
    (995, "sol_0900_1019", 18.4997, 77.3513),
    (1020, "sol_1020_1139", 18.4927, 77.3400),
    (1097, "sol_1020_1139", 18.4921, 77.3265),
    (1178, "sol_1140_1259", 18.4961, 77.3038),
    (1267, "sol_1260_1379", 18.4842, 77.3006),
    (1316, "sol_1260_1379", 18.4688, 77.2918),
    (1352, "sol_1260_1379", 18.4594, 77.2723),
)


def distance_m(latitude, longitude, other_latitude, other_longitude):
    north = math.radians(latitude - other_latitude)
    east = math.radians(longitude - other_longitude) * math.cos(
        math.radians((latitude + other_latitude) / 2)
    )
    return MARS_RADIUS_M * math.hypot(north, east)


def uv_site(source_dir, bounds, target):
    sol, sol_range, waypoint_latitude, waypoint_longitude = target
    rows, start, stop, radiation_product = read_product(
        source_dir, sol, "CAL_RDS", "data_calibrated_env", sol_range,
    )
    positions, _, _, position_product = read_product(
        source_dir, sol, "DER_ANCILLARY", "data_derived_env", sol_range,
    )
    geometry = {row["SCLK"]: row for row in positions}
    first, last = int(rows[0]["SCLK"]), int(rows[-1]["SCLK"])
    if last <= first or abs((stop - start).total_seconds() - (last - first)) > 2:
        raise ValueError(f"Unexpected SCLK-to-UTC duration for sol {sol}")

    samples = []
    fields = (
        "SOLAR_ZENITHAL_ANGLE", "ROVER_POSITION_X", "ROVER_POSITION_Y",
        "ROVER_POSITION_Z", "ROVER_PITCH", "ROVER_ROLL",
    )
    for row in rows:
        if not row["RDS_TOP_3"] or row["ROVER_STILL"] != "1" or row["ROVER_HGA_STILL"] == "0":
            continue
        uv = float(row["RDS_TOP_3"])
        if not 0 < uv <= 91.25:
            continue
        position = geometry.get(row["SCLK"])
        if not position or row["LTST"] != position["LTST"] or not all(position[key] for key in fields):
            continue
        zenith, north, west, up, pitch, roll = (float(position[key]) for key in fields)
        if not SOLAR_ZENITH_DEGREES[0] <= zenith <= SOLAR_ZENITH_DEGREES[1]:
            continue
        if not math.hypot(pitch, roll) <= MAX_ROVER_TILT_DEGREES:
            continue
        latitude, longitude = map_coordinates(north, west, up)
        if not inside(bounds, latitude, longitude):
            continue
        if distance_m(latitude, longitude, waypoint_latitude, waypoint_longitude) > SITE_RADIUS_M:
            continue
        samples.append((latitude, longitude, uv, int(row["SCLK"])))

    if len(samples) < MIN_SAMPLES:
        return None, []

    def timestamp(clock):
        utc = start + (stop - start) * ((clock - first) / (last - first))
        return utc.isoformat(timespec="seconds").replace("+00:00", "Z")

    return {
        "id": f"sol-{sol:04d}",
        "latitude": round(fmean(sample[0] for sample in samples), 6),
        "longitude": round(fmean(sample[1] for sample in samples), 6),
        "meanWm2": round(fmean(sample[2] for sample in samples), 8),
        "count": len(samples),
        "sols": [sol],
        "utcStart": timestamp(samples[0][3]),
        "utcEnd": timestamp(samples[-1][3]),
        "productIds": [radiation_product["id"], position_product["id"]],
    }, [radiation_product, position_product]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_dir", type=Path, help="Directory containing the selected PDS CSVs and XML labels")
    args = parser.parse_args()

    bounds = json.loads((MAP_DATA / "CTX/jezero-crater.json").read_text())["bounds"]
    sites, products = [], []
    for target in TARGETS:
        site, sources = uv_site(args.source_dir, bounds, target)
        if site is None:
            print(f"Sol {target[0]} had fewer than {MIN_SAMPLES} matching samples.")
            continue
        sites.append(site)
        products.extend(sources)

    if len(sites) < 2:
        raise ValueError("At least two rover observation sites are required.")

    result = {
        "source": {
            "mission": "Mars 2020 Perseverance",
            "instrument": "MEDA Radiation and Dust Sensor, top photodiode 3",
            "publisher": "NASA Planetary Data System, Planetary Atmospheres Node",
            "url": "https://doi.org/10.17189/1522849",
            "instrumentPaper": "https://doi.org/10.1007/s11214-021-00816-9",
            "frameKernel": FRAME,
            "landingSiteCoordinates": LANDING,
            "waypointIndex": WAYPOINTS,
            "units": "W/m²",
            "coordinates": "Mars planetocentric degrees, east-positive",
            "wavelengthNm": [250, 400],
            "coverageUtc": [min(site["utcStart"] for site in sites), max(site["utcEnd"] for site in sites)],
            "resolution": "Rover point observations, native approximately 1 Hz during instrument sessions",
            "products": products,
        },
        "method": {
            "description": "Arithmetic mean of calibrated TOP 3 readings from matching stationary rover geometry near each selected waypoint.",
            "solarZenithDegrees": list(SOLAR_ZENITH_DEGREES),
            "maxRoverTiltDegrees": MAX_ROVER_TILT_DEGREES,
            "siteRadiusMeters": SITE_RADIUS_M,
            "minimumSamples": MIN_SAMPLES,
        },
        "sites": sites,
    }
    target = MAP_DATA / "MEDA/jezero-uv-sites.json"
    target.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Exported {len(sites)} sites from {sum(site['count'] for site in sites):,} calibrated readings.")


if __name__ == "__main__":
    main()
