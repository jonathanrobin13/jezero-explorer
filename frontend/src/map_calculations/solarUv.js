const RAD = Math.PI / 180
const MARS_RADIUS_METERS = 3_396_190
const ORBIT_PERTURBATIONS = [
  [0.0071, 2.2353, 49.409],
  [0.0057, 2.7543, 168.173],
  [0.0039, 1.1177, 191.837],
  [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704],
  [0.0020, 2.4694, 95.528],
  [0.0018, 32.8493, 49.095],
]

const sinDegrees = (angle) => Math.sin(angle * RAD)

// Mars24 Sunclock, NASA GISS. The default TT offset applies to the 2022 MEDA archive.
export function marsSunDirection(utc, latitude, longitude, ttMinusUtc = 69.184) {
  const julianTt = 2440587.5 + (Date.parse(utc) / 1000 + ttMinusUtc) / 86400
  if (!Number.isFinite(julianTt)) throw new Error('The selected UTC date is invalid.')
  const daysSinceJ2000 = julianTt - 2451545.0
  const anomaly = 19.3871 + 0.52402073 * daysSinceJ2000
  const fictitiousMeanSun = 270.3871 + 0.524038496 * daysSinceJ2000
  const perturbation = ORBIT_PERTURBATIONS.reduce((sum, [amplitude, period, phase]) => (
    sum + amplitude * Math.cos((0.985626 * daysSinceJ2000 / period + phase) * RAD)
  ), 0)
  const equationOfCenter = (10.691 + 0.0000003 * daysSinceJ2000) * sinDegrees(anomaly)
    + 0.623 * sinDegrees(2 * anomaly) + 0.050 * sinDegrees(3 * anomaly)
    + 0.005 * sinDegrees(4 * anomaly) + 0.0005 * sinDegrees(5 * anomaly) + perturbation
  const solarLongitude = fictitiousMeanSun + equationOfCenter
  const equationOfTime = 2.861 * sinDegrees(2 * solarLongitude) - 0.071 * sinDegrees(4 * solarLongitude)
    + 0.002 * sinDegrees(6 * solarLongitude) - equationOfCenter
  const meanSolarDays = (julianTt - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626
  const subsolarLongitude = 180 - 360 * (meanSolarDays % 1) - equationOfTime
  const hourAngle = (longitude - subsolarLongitude) * RAD

  // The DEM latitude and local vertical use the spherical Mars 2000 datum.
  const latitudeRadians = latitude * RAD
  const declination = Math.asin(0.42565 * sinDegrees(solarLongitude))
  const east = -Math.cos(declination) * Math.sin(hourAngle)
  const north = Math.sin(declination) * Math.cos(latitudeRadians)
    - Math.cos(declination) * Math.cos(hourAngle) * Math.sin(latitudeRadians)
  const up = Math.sin(declination) * Math.sin(latitudeRadians)
    + Math.cos(declination) * Math.cos(hourAngle) * Math.cos(latitudeRadians)
  const distanceAu = 1.52367934 * (1.00436
    - 0.09309 * Math.cos(anomaly * RAD) - 0.004336 * Math.cos(2 * anomaly * RAD)
    - 0.00031 * Math.cos(3 * anomaly * RAD) - 0.00003 * Math.cos(4 * anomaly * RAD))
  return { east, north, up, distanceAu }
}

function traceOffsets(grid, sun) {
  const eastRate = sun.east / grid.metersPerColumn
  const southRate = -sun.north / grid.metersPerRow
  const alongColumns = Math.abs(eastRate) >= Math.abs(southRate)
  const majorRate = alongColumns ? eastRate : southRate
  const minorRate = alongColumns ? southRate : eastRate
  const majorLength = alongColumns ? grid.width : grid.height
  const minorLength = alongColumns ? grid.height : grid.width
  const majorStride = alongColumns ? 1 : grid.width
  const minorStride = alongColumns ? grid.width : 1
  const offsets = []
  if (majorRate === 0) return { offsets, alongColumns }

  // At each whole step on the dominant axis, interpolate along the other axis.
  for (let step = 1; step <= majorLength; step++) {
    const major = Math.sign(majorRate) * step
    const minor = step * minorRate / Math.abs(majorRate)
    const minorBefore = Math.floor(minor)
    const fraction = minor - minorBefore
    const time = step / Math.abs(majorRate)
    const distance = time * Math.hypot(sun.east, sun.north)
    offsets.push({
      major,
      minorBefore,
      fraction,
      index: major * majorStride + minorBefore * minorStride,
      distance,
      curvature: distance ** 2 / (2 * MARS_RADIUS_METERS),
    })
  }
  return { offsets, alongColumns, majorLength, minorLength, minorStride }
}

function shadowState(elevations, highest, cell, height, major, minor, trace, solarSlope) {
  let hasGap = false
  for (const offset of trace.offsets) {
    const rayHeight = height + offset.distance * solarSlope + offset.curvature
    // No higher elevation in the DEM can intercept the ray beyond this point.
    if (rayHeight > highest) break
    const nextMajor = major + offset.major
    const nextMinor = minor + offset.minorBefore
    const nextMinorAfter = nextMinor + Number(offset.fraction > 0)
    if (nextMajor < 0 || nextMajor >= trace.majorLength || nextMinor < 0 || nextMinorAfter >= trace.minorLength) {
      return NaN
    }
    const before = elevations[cell + offset.index]
    const after = elevations[cell + offset.index + Number(offset.fraction > 0) * trace.minorStride]
    if (!Number.isFinite(before) || !Number.isFinite(after)) {
      hasGap = true
      continue
    }
    if (before + (after - before) * offset.fraction > rayHeight + 0.01) return 0
  }
  return hasGap ? NaN : 1
}

export function highestTerrainElevation(elevations) {
  let highest = -Infinity
  for (const elevation of elevations) {
    if (Number.isFinite(elevation)) highest = Math.max(highest, elevation)
  }
  return highest
}

export function directSunAtPoint(grid, elevations, highest, point, sun) {
  const column = Math.floor((point.longitude - grid.bounds.west) / grid.degreesPerColumn)
  const row = Math.floor((grid.bounds.north - point.latitude) / grid.degreesPerRow)
  if (row < 0 || row >= grid.height || column < 0 || column >= grid.width) return NaN
  const cell = row * grid.width + column
  const elevation = elevations[cell]
  if (!Number.isFinite(elevation)) return NaN
  if (sun.up <= 0) return 0

  const trace = traceOffsets(grid, sun)
  return shadowState(elevations, highest, cell, elevation,
    trace.alongColumns ? column : row, trace.alongColumns ? row : column,
    trace, sun.up / Math.hypot(sun.east, sun.north))
}

function slope(previous, height, next, spacing) {
  if (!Number.isFinite(previous)) return (next - height) / spacing
  if (!Number.isFinite(next)) return (height - previous) / spacing
  return (next - previous) / (2 * spacing)
}

export function calculateDirectUvExposure(grid, elevations, sun) {
  const { width, height, metersPerColumn, metersPerRow } = grid
  if (elevations.length !== width * height) throw new Error('The DEM dimensions do not match its samples.')

  const highest = highestTerrainElevation(elevations)
  const trace = traceOffsets(grid, sun)
  const centralHorizontal = Math.hypot(sun.east, sun.north)
  const exposure = new Float32Array(elevations.length).fill(NaN)
  for (let row = 0; row < height; row++) {
    const northOffset = ((height - 1) / 2 - row) * metersPerRow / MARS_RADIUS_METERS
    for (let column = 0; column < width; column++) {
      const cell = row * width + column
      const elevation = elevations[cell]
      if (!Number.isFinite(elevation)) continue
      const eastOffset = (column - (width - 1) / 2) * metersPerColumn / MARS_RADIUS_METERS
      // Rotate the local vertical to first order across the spherical DEM.
      const up = Math.min(1, sun.up + sun.east * eastOffset + sun.north * northOffset)
      if (up <= 0) {
        exposure[cell] = 0
        continue
      }
      const horizontal = Math.sqrt(1 - up * up)
      const horizontalScale = centralHorizontal > 0 ? horizontal / centralHorizontal : 0

      const eastSlope = slope(
        column > 0 ? elevations[cell - 1] : NaN,
        elevation,
        column < width - 1 ? elevations[cell + 1] : NaN,
        metersPerColumn,
      )
      const southSlope = slope(
        row > 0 ? elevations[cell - width] : NaN,
        elevation,
        row < height - 1 ? elevations[cell + width] : NaN,
        metersPerRow,
      )
      const incidence = (up + (southSlope * sun.north - eastSlope * sun.east) * horizontalScale)
        / Math.hypot(eastSlope, southSlope, 1)
      exposure[cell] = incidence > 0
        ? Math.min(1, incidence) * shadowState(
          elevations, highest, cell, elevation,
          trace.alongColumns ? column : row, trace.alongColumns ? row : column, trace, up / horizontal,
        )
        : Math.max(0, incidence)
    }
  }
  return exposure
}
