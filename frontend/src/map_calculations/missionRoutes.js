export function routeCell(terrain, point) {
  if (!terrain || !point) return null
  const { grid, elevations } = terrain
  const { north, west } = grid.bounds ?? grid
  const row = Math.floor((north - point.latitude) / grid.degreesPerRow)
  const column = Math.floor((point.longitude - west) / grid.degreesPerColumn)
  if (row < 0 || row >= grid.height || column < 0 || column >= grid.width) return null
  const index = row * grid.width + column
  return Number.isFinite(elevations[index]) ? index : null
}

export function routeCoordinates(grid, cell) {
  const { north, west } = grid.bounds ?? grid
  return {
    latitude: north - (Math.floor(cell / grid.width) + 0.5) * grid.degreesPerRow,
    longitude: west + (cell % grid.width + 0.5) * grid.degreesPerColumn,
  }
}

function limitRegionalTerrain(terrain, coverage) {
  if (!terrain || !coverage) return terrain
  const { grid, elevations } = terrain
  const { north, west } = grid.bounds
  const { degreesPerColumn, degreesPerRow } = grid
  const firstCol = Math.max(0, Math.ceil((coverage.west - west) / degreesPerColumn - 0.5))
  const lastCol = Math.min(grid.width - 1, Math.floor((coverage.east - west) / degreesPerColumn - 0.5))
  const firstRow = Math.max(0, Math.ceil((north - coverage.north) / degreesPerRow - 0.5))
  const lastRow = Math.min(grid.height - 1, Math.floor((north - coverage.south) / degreesPerRow - 0.5))
  const width = lastCol - firstCol + 1
  const height = lastRow - firstRow + 1
  if (width < 1 || height < 1) return null
  const cells = new Float32Array(width * height)
  for (let row = 0; row < height; row++) {
    const offset = (firstRow + row) * grid.width + firstCol
    cells.set(elevations.subarray(offset, offset + width), row * width)
  }
  return {
    grid: { ...grid, width, height, bounds: {
      west: west + firstCol * degreesPerColumn,
      east: west + (lastCol + 1) * degreesPerColumn,
      north: north - firstRow * degreesPerRow,
      south: north - (lastRow + 1) * degreesPerRow,
    } },
    elevations: cells,
  }
}

export function prepareRoute(western, regional, start, destination, coverage) {
  const westernStart = routeCell(western, start)
  const westernFinish = routeCell(western, destination)
  if (westernStart === null || westernFinish === null) regional = limitRegionalTerrain(regional, coverage)
  for (const terrain of [western, regional]) {
    const first = routeCell(terrain, start)
    const last = routeCell(terrain, destination)
    if (first === null || last === null) continue
    if (first === last) return { error: 'Choose endpoints in different elevation cells.' }
    const { grid, elevations, darkness } = terrain
    return {
      grid: { ...grid, cellWidthMeters: grid.metersPerColumn ?? grid.cellWidthMeters ?? 20, cellHeightMeters: grid.metersPerRow ?? grid.cellHeightMeters ?? 20 },
      elevations, darkness, start: first, goal: last,
    }
  }
  return { error: 'Choose both endpoints inside CTX elevation coverage.' }
}

export function distanceAlong(points, position) {
  let closest = Infinity
  let progress = 0
  let length = 0
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]
    const b = points[index]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const segment = Math.hypot(dx, dz)
    if (!segment) continue
    const fraction = Math.max(0, Math.min(1, ((position.x - a.x) * dx + (position.z - a.z) * dz) / (segment * segment)))
    const offset = Math.hypot(position.x - a.x - dx * fraction, position.z - a.z - dz * fraction)
    if (offset < closest) {
      closest = offset
      progress = length + segment * fraction
    }
    length += segment
  }
  return Math.max(0, length - progress)
}

export const formatDistance = (meters) => meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`
