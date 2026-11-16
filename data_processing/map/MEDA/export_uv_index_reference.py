"""Integrate the 250–400 nm TSIS-1 reference spectrum for the Crater UV model."""

import argparse
import csv
import json
from itertools import pairwise
from pathlib import Path


def erythema_weight(wavelength):
    if wavelength <= 298:
        return 1.0
    if wavelength <= 328:
        return 10 ** (0.094 * (298 - wavelength))
    return 10 ** (0.015 * (140 - wavelength))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("spectrum", type=Path, help="LASP LISIRD tsis1_hsrs_p1nm CSV")
    args = parser.parse_args()
    with args.spectrum.open(newline="", encoding="utf-8") as handle:
        rows = []
        for row in csv.DictReader(handle):
            wavelength = float(row["wavelength (nm)"])
            if 250 <= wavelength <= 400:
                irradiance = float(row["irradiance (W/m^2/nm)"])
                rows.append((wavelength, irradiance * erythema_weight(wavelength)))
    if not rows or rows[0][0] != 250 or rows[-1][0] != 400:
        raise ValueError("Expected the complete 250–400 nm spectrum.")
    if any(not 0 < right[0] - left[0] <= 0.026 for left, right in pairwise(rows)):
        raise ValueError("Unexpected spectral sampling or missing data in the source CSV.")

    integral = sum(
        (right_nm - left_nm) * (left_flux + right_flux) / 2
        for (left_nm, left_flux), (right_nm, right_flux) in pairwise(rows)
    )
    output = Path(__file__).resolve().parents[3] / "frontend/src/map_calculations/solarUvReference.json"
    output.write_text(json.dumps({
        "mission": "Total and Spectral Solar Irradiance Sensor-1 (TSIS-1)",
        "instrument": "Spectral Irradiance Monitor and hybrid reference spectra",
        "publisher": "LASP Interactive Solar Irradiance Data Center",
        "product": "tsis1_hsrs_p1nm",
        "source": "https://lasp.colorado.edu/lisird/latis/dap/tsis1_hsrs_p1nm.csv",
        "wavelengthRangeNm": [250, 400],
        "wavelengthSampleSpacingNm": 0.025,
        "spectralBandwidthNm": 0.1,
        "referenceDistanceAu": 1,
        "erythemalIrradianceWm2": round(integral, 8),
    }, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
