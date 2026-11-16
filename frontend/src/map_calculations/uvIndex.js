import { directSunAtPoint, marsSunDirection } from './solarUv.js'
import referenceSpectrum from './solarUvReference.json' with { type: 'json' }

// The geometry puts the Sun at about 08:15 local true solar time at the rover.
const REFERENCE_UTC = '2022-11-11T10:51:16Z'
// Illustrative vertical UV optical depth, assumed constant across 250–400 nm.
export const REFERENCE_UV_OPTICAL_DEPTH = 0.5

export function simulatedUvIndex(point, grid, elevations, highest) {
  const sun = marsSunDirection(REFERENCE_UTC, point.latitude, point.longitude)
  const visible = directSunAtPoint(grid, elevations, highest, point, sun)
  if (!Number.isFinite(visible)) return null
  if (visible === 0) return 0

  const sunDistanceScale = (referenceSpectrum.referenceDistanceAu / sun.distanceAu) ** 2
  const beamTransmission = Math.exp(-REFERENCE_UV_OPTICAL_DEPTH / sun.up)
  const erythemalIrradiance = referenceSpectrum.erythemalIrradianceWm2
    * sunDistanceScale * sun.up * beamTransmission
  return 40 * erythemalIrradiance
}
