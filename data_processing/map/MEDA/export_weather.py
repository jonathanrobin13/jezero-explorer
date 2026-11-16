"""Pair archived NASA MEDA air temperature and pressure with Jezero's UV snapshots."""

import argparse
import csv
import hashlib
import io
import json
import math
import re
from bisect import bisect_left
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import urlopen
from xml.etree import ElementTree as ET

from export_uv import ARCHIVE, MAP_DATA, map_coordinates


OPACITY_URL = (
    "https://data.mendeley.com/public-files/datasets/gktjp9jptb/files/"
    "5eb62f12-eadf-4e87-b4bc-2966f7a5f00c/file_downloaded"
)
OPACITY_SHA256 = "00841f90df469a1839142898c372d360251e88e4412a3d43688fd8d3f43115cf"


def fetch_text(url):
    with urlopen(url, timeout=45) as response:
        return response.read().decode("utf-8-sig")


def observations(sol, collection, instrument, column, valid_min, valid_max):
    directory = f"{ARCHIVE}{collection}/sol_0540_0659/sol_{sol:04d}/"
    prefix = f"WE__{sol:04d}___________{instrument}"
    pattern = rf'href="({prefix}_+P(\d+)\.CSV)"'
    files = re.findall(pattern, fetch_text(directory), flags=re.IGNORECASE)
    if not files:
        raise RuntimeError(f"No {instrument} product listed at {directory}")

    filename, _ = max(files, key=lambda file: int(file[1]))
    url = urljoin(directory, filename)
    label_url = urljoin(directory, f"{filename[:-4]}.xml")
    label = ET.fromstring(fetch_text(label_url))
    rows = csv.DictReader(io.StringIO(fetch_text(url)))
    if not {"SCLK", column} <= set(rows.fieldnames or []):
        raise ValueError(f"Missing SCLK or {column} in {url}")

    readings = []
    for row in rows:
        try:
            clock = float(row["SCLK"])
            value = float(row[column])
        except (TypeError, ValueError):
            continue
        if math.isfinite(clock) and valid_min <= value <= valid_max:
            readings.append((clock, value))

    readings.sort()
    product = {
        "id": label.findtext(".//{*}logical_identifier"),
        "version": label.findtext(".//{*}version_id"),
        "url": url,
        "labelUrl": label_url,
        "column": column,
    }
    times = [clock for clock, _ in readings]
    values = [value for _, value in readings]
    return times, values, product


def nearby_value(clock, batch):
    times, values, _ = batch
    index = bisect_left(times, clock)
    neighbors = [i for i in (index - 1, index) if 0 <= i < len(times)]
    if not neighbors:
        return None
    nearest = min(neighbors, key=lambda i: abs(times[i] - clock))
    return values[nearest] if abs(times[nearest] - clock) <= 1 else None


def aerosol_opacity(samples, products, source_file):
    payload = source_file.read_bytes()
    if hashlib.sha256(payload).hexdigest() != OPACITY_SHA256:
        raise ValueError("Mastcam-Z optical depth file differs from the published version 2 file")

    sols = {point["sol"] for point in samples}
    geometry = {}
    for product in products:
        if "DER_ANCILLARY" in product["url"]:
            sol = int(re.search(r"/sol_(\d{4})/", product["url"])[1])
            geometry[sol] = product["url"]

    opacity = {}
    for row in csv.reader(io.StringIO(payload.decode("utf-8-sig"))):
        if len(row) < 19 or not row[2].strip().isdigit():
            continue
        sol = int(row[2])
        if sol not in sols:
            continue
        tau, uncertainty = float(row[12]), float(row[16])
        if tau < 0 or uncertainty < 0:
            continue
        clock = int(row[4])
        local_minutes = round((float(row[7]) - sol) * 1440)
        match = min(
            csv.DictReader(io.StringIO(fetch_text(geometry[sol]))),
            key=lambda record: abs(float(record["SCLK"]) - clock),
        )
        fields = ("ROVER_POSITION_X", "ROVER_POSITION_Y", "ROVER_POSITION_Z")
        if abs(float(match["SCLK"]) - clock) > 1 or not all(match[key] for key in fields):
            print(f"Sol {sol}: optical depth withheld because rover geometry is unavailable at SCLK {clock}")
            continue
        latitude, longitude = map_coordinates(*(float(match[key]) for key in fields))
        opacity.setdefault(sol, []).append({
            "tau": tau,
            "uncertainty": uncertainty,
            "localSolarTime": f"{local_minutes // 60:02d}:{local_minutes % 60:02d}",
            "sclk": clock,
            "sequence": row[5],
            "latitude": round(latitude, 6),
            "longitude": round(longitude, 6),
        })
    return opacity


def opacity_by_date(samples, by_sol):
    by_date = {}
    for sol, readings in by_sol.items():
        sol = int(sol)
        same_sol = [sample for sample in samples if sample["sol"] == sol]
        for reading in readings:
            anchor = min(same_sol, key=lambda sample: abs(sample["sclk"] - reading["sclk"]))
            delta = timedelta(seconds=reading["sclk"] - anchor["sclk"])
            utc = (datetime.fromisoformat(anchor["utc"]) + delta).strftime("%Y-%m-%dT%H:%M:%SZ")
            by_date.setdefault(utc[:10], []).append({**reading, "sol": sol, "utc": utc})
    return by_date


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("opacity_file", type=Path, help="Published Mastcam-Z optical depth version 2 table")
    args = parser.parse_args()
    folder = MAP_DATA / "MEDA"
    uv = json.loads((folder / "jezero-uv.json").read_text(encoding="utf-8"))
    samples = uv["samples"]
    opacity = aerosol_opacity(samples, uv["source"]["products"], args.opacity_file)
    weather = {}
    products = []

    for sol in sorted({sample["sol"] for sample in samples}):
        air = observations(sol, "data_calibrated_env", "CAL_ATS", "ATS_LOCAL_TEMP1", 100, 350)
        pressure = observations(sol, "data_derived_env", "DER_PS", "PRESSURE", 100, 1500)
        products.extend([air[2], pressure[2]])
        for sample in (sample for sample in samples if sample["sol"] == sol):
            kelvin = nearby_value(sample["sclk"], air)
            pascals = nearby_value(sample["sclk"], pressure)
            weather[sample["utc"]] = {
                "temperatureC": None if kelvin is None else round(kelvin - 273.15, 1),
                "pressurePa": None if pascals is None else round(pascals),
            }

    for day in sorted({sample["utc"][:10] for sample in samples}):
        readings = [fields for utc, fields in weather.items() if utc.startswith(day)]
        temperature_count = sum(fields["temperatureC"] is not None for fields in readings)
        pressure_count = sum(fields["pressurePa"] is not None for fields in readings)
        print(f"{day} UTC: {temperature_count} air temperature, {pressure_count} pressure matches")

    result = {
        "source": {
            "mission": "Mars 2020 Perseverance",
            "instrument": "MEDA Air Temperature Sensor 1 and Pressure Sensor",
            "publisher": "NASA Planetary Data System, Planetary Atmospheres Node",
            "url": uv["source"]["url"],
            "coverageUtc": uv["source"]["coverageUtc"],
            "resolution": "Rover point readings paired within one spacecraft-clock second of the UV snapshot",
            "products": products,
        },
        "snapshots": dict(sorted(weather.items())),
        "aerosol": {
            "source": {
                "mission": "Mars 2020 Perseverance",
                "instrument": "Mastcam-Z",
                "publisher": "Mark Lemmon, Mendeley Data",
                "product": "m20-ztau-merged-1717.txt, version 2",
                "url": "https://doi.org/10.17632/gktjp9jptb.2",
                "downloadUrl": OPACITY_URL,
                "license": "CC BY 4.0",
                "resolution": "One 880 nm atmospheric column opacity retrieval per available solar image sequence",
                "timeBasis": "UTC approximated from the nearest same-sol MEDA snapshot and spacecraft-clock offset",
                "geometry": [product for product in uv["source"]["products"] if "DER_ANCILLARY" in product["url"]],
            },
            "byDate": opacity_by_date(samples, opacity),
        },
    }
    (folder / "jezero-weather.json").write_text(
        json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
