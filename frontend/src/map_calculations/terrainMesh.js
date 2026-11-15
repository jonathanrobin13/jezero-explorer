import { BufferAttribute, BufferGeometry } from 'three'

export const SOURCE_CELL_METERS = 20
export const MESH_STEP = 4

function sampleIndices(first, last) {
  const indices = []
  for (let index = first; index < last; index += MESH_STEP) indices.push(index)
  indices.push(last)
  return indices
}

function hasElevation(elevations, width, left, right, top, bottom) {
  for (let row = top; row <= bottom; row++) {
    for (let column = left; column <= right; column++) {
      if (!Number.isFinite(elevations[row * width + column])) return false
    }
  }
  return true
}

export function createTerrainMesh({ grid, elevations }, bounds) {
  const { west, north, width, height, degreesPerColumn, degreesPerRow } = grid
  // The DEM origin and CTX image bounds are pixel edges. Sample the DEM at cell centers.
  const firstColumn = Math.max(0, Math.ceil((bounds.west - west) / degreesPerColumn - 0.5))
  const lastColumn = Math.min(width - 1, Math.floor((bounds.east - west) / degreesPerColumn - 0.5))
  const firstRow = Math.max(0, Math.ceil((north - bounds.north) / degreesPerRow - 0.5))
  const lastRow = Math.min(height - 1, Math.floor((north - bounds.south) / degreesPerRow - 0.5))

  if (grid.units !== 'meters' || firstColumn >= lastColumn || firstRow >= lastRow) {
    throw new Error('The CTX elevation grid and image have no usable overlap in meters.')
  }

  const columns = sampleIndices(firstColumn, lastColumn)
  const rows = sampleIndices(firstRow, lastRow)
  const midColumn = (firstColumn + lastColumn) / 2
  const midRow = (firstRow + lastRow) / 2
  const cellKilometers = SOURCE_CELL_METERS / 1000
  const positions = new Float32Array(rows.length * columns.length * 3)
  const uvs = new Float32Array(rows.length * columns.length * 2)
  const indices = []
  let minElevation = Infinity
  let maxElevation = -Infinity

  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < columns.length; x++) {
      const row = rows[y]
      const column = columns[x]
      const vertex = y * columns.length + x
      const elevation = elevations[row * width + column]
      const hasData = Number.isFinite(elevation)
      if (hasData) {
        minElevation = Math.min(minElevation, elevation)
        maxElevation = Math.max(maxElevation, elevation)
      }

      positions[3 * vertex] = (column - midColumn) * cellKilometers
      positions[3 * vertex + 1] = hasData ? elevation / 1000 : 0
      positions[3 * vertex + 2] = (row - midRow) * cellKilometers

      const longitude = west + (column + 0.5) * degreesPerColumn
      const latitude = north - (row + 0.5) * degreesPerRow
      uvs[2 * vertex] = (longitude - bounds.west) / (bounds.east - bounds.west)
      uvs[2 * vertex + 1] = (latitude - bounds.south) / (bounds.north - bounds.south)

      if (x === 0 || y === 0) continue
      // Check every source cell inside this quad, including those skipped by the mesh stride.
      if (!hasElevation(elevations, width, columns[x - 1], column, rows[y - 1], row)) continue

      const northWest = vertex - columns.length - 1
      const northEast = northWest + 1
      const southWest = vertex - 1
      indices.push(northWest, southWest, northEast, northEast, southWest, vertex)
    }
  }

  if (indices.length === 0) throw new Error('There is too little elevation coverage to draw this terrain.')

  const centerElevation = (minElevation + maxElevation) / 2000
  for (let offset = 1; offset < positions.length; offset += 3) {
    positions[offset] -= centerElevation
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  return {
    geometry,
    minElevation,
    maxElevation,
    elevationOriginMeters: centerElevation * 1000,
    hasGaps: indices.length < (rows.length - 1) * (columns.length - 1) * 6,
    horizontalRadius: Math.hypot(lastColumn - firstColumn, lastRow - firstRow) * cellKilometers / 2,
  }
}
