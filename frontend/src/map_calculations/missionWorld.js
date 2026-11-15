import { BufferAttribute, BufferGeometry } from 'three'
import { createTerrainMesh } from './terrainMesh.js'

const PLAY_MARGIN = 3600
const SCENERY_MARGIN = 12000
const OUTER_STEP = 160

function triangleHeight(fractionX, fractionZ, nw, ne, sw, se) {
  if (fractionX + fractionZ <= 1) {
    return nw + (ne - nw) * fractionX + (sw - nw) * fractionZ
  }
  return se + (sw - se) * (1 - fractionX) + (ne - se) * (1 - fractionZ)
}

function segment(axis, value) {
  let low = 0
  let high = axis.length - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (axis[middle] <= value) low = middle
    else high = middle
  }
  return low
}

function paddedAxis(axis) {
  const steps = SCENERY_MARGIN / OUTER_STEP
  const start = axis[0]
  const end = axis.at(-1)
  return [
    ...Array.from({ length: steps }, (_, i) => start - (steps - i) * OUTER_STEP),
    ...axis,
    ...Array.from({ length: steps }, (_, i) => end + (i + 1) * OUTER_STEP),
  ]
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

export function createMissionWorld(terrain, bounds) {
  const model = createTerrainMesh(terrain, bounds)
  const realGeometry = model.geometry.scale(1000, 1000, 1000)
  const positions = realGeometry.getAttribute('position')
  const uvs = realGeometry.getAttribute('uv')
  let columns = 1
  while (columns < positions.count && positions.getZ(columns) === positions.getZ(0)) columns++
  const rows = positions.count / columns
  const realX = Array.from({ length: columns }, (_, i) => positions.getX(i))
  const realZ = Array.from({ length: rows }, (_, i) => positions.getZ(i * columns))
  const xMin = realX[0]
  const xMax = realX.at(-1)
  const zMin = realZ[0]
  const zMax = realZ.at(-1)
  const real = { xMin, xMax, zMin, zMax }
  const play = {
    xMin: xMin - PLAY_MARGIN, xMax: xMax + PLAY_MARGIN,
    zMin: zMin - PLAY_MARGIN, zMax: zMax + PLAY_MARGIN,
  }

  const realFaces = new Uint8Array((columns - 1) * (rows - 1))
  const realIndex = realGeometry.index.array
  for (let index = 0; index < realIndex.length; index += 6) {
    const vertex = realIndex[index]
    realFaces[Math.floor(vertex / columns) * (columns - 1) + vertex % columns] = 1
  }

  function realHeight(x, z) {
    const col = segment(realX, x)
    const row = segment(realZ, z)
    if (!realFaces[row * (columns - 1) + col]) return null
    const index = row * columns + col
    return triangleHeight(
      (x - realX[col]) / (realX[col + 1] - realX[col]),
      (z - realZ[row]) / (realZ[row + 1] - realZ[row]),
      positions.getY(index), positions.getY(index + 1),
      positions.getY(index + columns), positions.getY(index + columns + 1),
    )
  }

  function generatedHeight(x, z) {
    const edgeX = clamp(x, xMin, xMax)
    const edgeZ = clamp(z, zMin, zMax)
    const distance = Math.hypot(x - edgeX, z - edgeZ)
    const blend = Math.min(1, distance / 1850)
    const smooth = blend * blend * (3 - 2 * blend)
    const relief = -90 + 72 * Math.sin(x / 875) * Math.cos(z / 960)
      + 41 * Math.sin((x + z) / 480)
      + 184 * Math.cos(x / 3000) * Math.sin(z / 2400)
    return (realHeight(edgeX, edgeZ) ?? 0) * (1 - smooth) + relief * smooth
  }

  const xs = paddedAxis(realX)
  const zs = paddedAxis(realZ)
  const ground = new Float32Array(xs.length * zs.length * 3)
  const faces = []
  for (let row = 0; row < zs.length; row++) {
    for (let col = 0; col < xs.length; col++) {
      const x = xs[col]
      const z = zs[row]
      const vertex = row * xs.length + col
      ground[vertex * 3] = x
      ground[vertex * 3 + 1] = generatedHeight(x, z)
      ground[vertex * 3 + 2] = z
      if (!col || !row) continue
      if (xs[col - 1] >= xMin && x <= xMax && zs[row - 1] >= zMin && z <= zMax) continue
      const nw = vertex - xs.length - 1
      faces.push(nw, vertex - 1, nw + 1, nw + 1, vertex - 1, vertex)
    }
  }
  const exterior = new BufferGeometry()
  exterior.setAttribute('position', new BufferAttribute(ground, 3))
  exterior.setIndex(faces)
  exterior.computeVertexNormals()

  function inside(extent, x, z) {
    return x >= extent.xMin && x <= extent.xMax && z >= extent.zMin && z <= extent.zMax
  }

  function heightAt(x, z) {
    if (inside(real, x, z)) return realHeight(x, z)
    const col = segment(xs, x)
    const row = segment(zs, z)
    const nw = row * xs.length + col
    const y = (index) => ground[index * 3 + 1]
    return triangleHeight(
      (x - xs[col]) / (xs[col + 1] - xs[col]),
      (z - zs[row]) / (zs[row + 1] - zs[row]),
      y(nw), y(nw + 1), y(nw + xs.length), y(nw + xs.length + 1),
    )
  }

  const firstU = uvs.getX(0)
  const firstV = uvs.getY(0)
  const lastU = uvs.getX(positions.count - 1)
  const lastV = uvs.getY(positions.count - 1)

  function groundPosition(u, v) {
    return {
      x: xMin + (u - firstU) / (lastU - firstU) * (xMax - xMin),
      z: zMin + (1 - v - firstV) / (lastV - firstV) * (zMax - zMin),
    }
  }

  function coordinates(x, z) {
    const u = firstU + (x - xMin) / (xMax - xMin) * (lastU - firstU)
    const v = firstV + (z - zMin) / (zMax - zMin) * (lastV - firstV)
    return {
      longitude: bounds.west + u * (bounds.east - bounds.west),
      latitude: bounds.south + v * (bounds.north - bounds.south),
    }
  }

  function telemetry(x, z) {
    if (!inside(real, x, z)) return { source: 'generated', elevation: null, grade: null }
    const height = realHeight(x, z)
    if (height === null) return { source: 'gap', elevation: null, grade: null }
    // Use differences on the displayed surface and avoid crossing the data edge.
    const left = Math.max(xMin, x - 10)
    const right = Math.min(xMax, x + 10)
    const top = Math.max(zMin, z - 10)
    const bottom = Math.min(zMax, z + 10)
    const west = realHeight(left, z)
    const east = realHeight(right, z)
    const north = realHeight(x, top)
    const south = realHeight(x, bottom)
    const grade = [west, east, north, south].includes(null) ? null
      : 100 * Math.hypot((east - west) / (right - left), (south - north) / (bottom - top))
    return { source: 'ctx', elevation: height + model.elevationOriginMeters, grade }
  }

  return { real, play, realX, realZ, realGeometry, exterior, heightAt, groundPosition, coordinates, telemetry }
}
