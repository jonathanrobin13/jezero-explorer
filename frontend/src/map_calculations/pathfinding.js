const CTX_CELL_METERS = 20
const DEFAULT_SLOPE_WEIGHT = 8
const NEARBY_GRADE_WEIGHT = 4
const FLAT_SPEED_MPS = 0.8
const GRADE_TIME_PENALTY = 4

const ROUTE_FACTORS = [
  ['timeSeconds', 30, 'Less walking time', 'More walking time'],
  ['distanceMeters', 20, 'Shorter walk', 'Longer walk'],
  ['ascentMeters', 5, 'Less climbing', 'More climbing'],
  ['maxGrade', 0.02, 'Gentler steps', 'Steeper steps'],
  ['maxNeighborhoodGrade', 0.02, 'Gentler nearby terrain', 'Steeper nearby terrain'],
]

function walkingSeconds(distance, rise) {
  return (distance + GRADE_TIME_PENALTY * Math.abs(rise)) / FLAT_SPEED_MPS
}

function gridMoves(cellWidth, cellHeight) {
  const moves = []
  for (const dr of [-1, 0, 1]) {
    for (const dc of [-1, 0, 1]) {
      if (dr === 0 && dc === 0) continue
      moves.push({ dr, dc, distance: Math.hypot(dc * cellWidth, dr * cellHeight) })
    }
  }
  return moves
}

// Cache the steepest rise/run from a cell to any valid adjacent sample.
function neighborhoodGradeAt(grid, elevations) {
  const { width, height } = grid
  const moves = gridMoves(
    grid.cellWidthMeters ?? CTX_CELL_METERS,
    grid.cellHeightMeters ?? CTX_CELL_METERS,
  )
  const cache = new Float64Array(elevations.length).fill(-1)

  return (cell) => {
    if (cache[cell] >= 0) return cache[cell]
    const row = Math.floor(cell / width)
    const col = cell % width
    const center = elevations[cell]
    let steepest = 0
    for (const { dr, dc, distance } of moves) {
      const nextRow = row + dr
      const nextCol = col + dc
      if (nextRow < 0 || nextRow >= height || nextCol < 0 || nextCol >= width) continue
      const elevation = elevations[nextRow * width + nextCol]
      if (Number.isFinite(elevation)) {
        steepest = Math.max(steepest, Math.abs(elevation - center) / distance)
      }
    }
    cache[cell] = steepest
    return steepest
  }
}

class MinHeap {
  items = []

  get size() {
    return this.items.length
  }

  push(entry) {
    let index = this.items.length
    this.items.push(entry)

    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.items[parent].priority <= entry.priority) break
      this.items[index] = this.items[parent]
      index = parent
    }

    this.items[index] = entry
  }

  pop() {
    const first = this.items[0]
    const last = this.items.pop()
    if (!this.items.length) return first

    let index = 0
    while (index * 2 + 1 < this.items.length) {
      let child = index * 2 + 1
      const right = child + 1

      if (
        right < this.items.length &&
        this.items[right].priority < this.items[child].priority
      ) {
        child = right
      }

      if (last.priority <= this.items[child].priority) break
      this.items[index] = this.items[child]
      index = child
    }

    this.items[index] = last
    return first
  }
}
function darkScore(value) {
  return value === 255 ? 0 : value / 254
}

export function findRoute(grid, elevations, start, goal, {
  slopeWeight = DEFAULT_SLOPE_WEIGHT,
  optimizeTime = false,
  nearbyGrades,
  darkness,
  blendTime = false,
} = {}) {
  const { width, height } = grid
  const cellWidth = grid.cellWidthMeters ?? CTX_CELL_METERS
  const cellHeight = grid.cellHeightMeters ?? CTX_CELL_METERS
  const count = width * height

  if (
    !Number.isInteger(width) || width <= 0 ||
    !Number.isInteger(height) || height <= 0 ||
    elevations.length !== count ||
    !Number.isFinite(cellWidth) || cellWidth <= 0 ||
    !Number.isFinite(cellHeight) || cellHeight <= 0 ||
    !Number.isFinite(slopeWeight) || slopeWeight < 0
  ) {
    throw new Error('Invalid routing grid or settings.')
  }

  function isValidCell(cell) {
    return (
      Number.isInteger(cell) &&
      cell >= 0 &&
      cell < count &&
      Number.isFinite(elevations[cell])
    )
  }

  if (!isValidCell(start) || !isValidCell(goal)) {
    throw new Error('Both endpoints need elevation data.')
  }

  const goalRow = Math.floor(goal / width)
  const goalCol = goal % width

  const diagonalMeters = Math.hypot(cellWidth, cellHeight)
  const extraElevationCost = (rise) =>
    blendTime ? GRADE_TIME_PENALTY * Math.abs(rise) : 0

  function heuristic(row, col, cell) {
    const rows = Math.abs(goalRow - row)
    const cols = Math.abs(goalCol - col)
    const diagonalSteps = Math.min(rows, cols)
    const distance = diagonalSteps * diagonalMeters +
      (rows - diagonalSteps) * cellHeight + (cols - diagonalSteps) * cellWidth

    // Any route must cover at least this grid distance and net elevation change.
    const netRise = elevations[goal] - elevations[cell]
    return optimizeTime
      ? walkingSeconds(distance, netRise)
      : distance + extraElevationCost(netRise)
  }

  const moves = gridMoves(cellWidth, cellHeight)
  const bestCost = new Float64Array(count).fill(Infinity)
  const parent = new Int32Array(count).fill(-1)
  const frontier = new MinHeap()

  bestCost[start] = 0
  frontier.push({
    cell: start,
    cost: 0,
    priority: heuristic(Math.floor(start / width), start % width, start),
  })

  while (frontier.size > 0) {
    const { cell, cost } = frontier.pop()
    if (cost > bestCost[cell]) continue

    if (cell === goal) {
      const cells = []
      for (let current = goal; current !== -1; current = parent[current]) {
        cells.push(current)
      }
      cells.reverse()

      let distanceMeters = 0
      let ascentMeters = 0
      let maxGrade = 0
      let timeSeconds = 0

      for (let i = 1; i < cells.length; i++) {
        const from = cells[i - 1]
        const to = cells[i]
        const dr = Math.floor(to / width) - Math.floor(from / width)
        const dc = to % width - from % width
        const distance = Math.hypot(dc * cellWidth, dr * cellHeight)
        const rise = elevations[to] - elevations[from]

        distanceMeters += distance
        ascentMeters += Math.max(0, rise)
        maxGrade = Math.max(maxGrade, Math.abs(rise) / distance)
        timeSeconds += walkingSeconds(distance, rise)
      }

      return { cells, distanceMeters, ascentMeters, maxGrade, timeSeconds }
    }

    const row = Math.floor(cell / width)
    const col = cell % width

    for (const { dr, dc, distance } of moves) {
      const nextRow = row + dr
      const nextCol = col + dc
      if (nextRow < 0 || nextRow >= height || nextCol < 0 || nextCol >= width) {
        continue
      }

      const next = nextRow * width + nextCol
      if (!isValidCell(next)) continue

      if (dr !== 0 && dc !== 0) {
        if (!isValidCell(cell + dc) || !isValidCell(cell + dr * width)) continue
      }

      const rise = elevations[next] - elevations[cell]
      const grade = rise / distance
      const nearbyPenalty = nearbyGrades
        ? NEARBY_GRADE_WEIGHT * (nearbyGrades(cell) ** 2 + nearbyGrades(next) ** 2) / 2
        : 0
      const imagePenalty = darkness
        ? 0.25 * (darkScore(darkness[cell]) + darkScore(darkness[next])) / 2
        : 0
      const stepCost = optimizeTime
        ? walkingSeconds(distance, rise)
        : distance * (1 + slopeWeight * grade ** 2 + nearbyPenalty + imagePenalty)
          + extraElevationCost(rise)
      const nextCost = cost + stepCost
      if (nextCost >= bestCost[next]) continue

      bestCost[next] = nextCost
      parent[next] = cell
      frontier.push({
        cell: next,
        cost: nextCost,
        priority: nextCost + heuristic(nextRow, nextCol, next),
      })
    }
  }

  return null
}

export function findRouteOptions(grid, elevations, start, goal, darkness) {
  const shortest = findRoute(grid, elevations, start, goal, { slopeWeight: 0 })
  if (!shortest) return []

  const nearbyGrades = neighborhoodGradeAt(grid, elevations)
  const fastest = findRoute(grid, elevations, start, goal, { optimizeTime: true })
  const terrain = findRoute(grid, elevations, start, goal, { nearbyGrades })

  function describe(id, label, route) {
    let maxNeighborhoodGrade = 0
    for (const cell of route.cells) {
      maxNeighborhoodGrade = Math.max(maxNeighborhoodGrade, nearbyGrades(cell))
    }
    return { id, label, ...route, maxNeighborhoodGrade }
  }

  const options = [
    describe('terrain', 'Terrain-aware', terrain),
    describe('distance', 'Shortest distance', shortest),
    describe('time', 'Fastest estimated walk', fastest),
  ]

  if (darkness?.length === elevations.length) {
    const route = findRoute(grid, elevations, start, goal, {
      nearbyGrades,
      darkness,
    })
    options.push(describe('darkness', 'Avoid dark patches (experimental)', route))
  }

  const distinct = new Map()
  for (const option of options) {
    const geometry = option.cells.join(',')
    if (!distinct.has(geometry)) distinct.set(geometry, option)
  }

  if (distinct.size > 1) {
    const balanced = findRoute(grid, elevations, start, goal, { nearbyGrades, blendTime: true })
    const candidate = describe('blend', 'Balanced', balanced)
    const geometry = candidate.cells.join(',')
    if (!distinct.has(geometry) && [...distinct.values()].every((option) =>
      ROUTE_FACTORS.some(([key, tolerance]) =>
        Math.abs(candidate[key] - option[key]) >= tolerance,
      ),
    )) {
      distinct.set(geometry, candidate)
    }
  }

  const routes = [...distinct.values()]
  const comparisons = ROUTE_FACTORS.flatMap(([key, tolerance, good, drawback]) => {
    const values = routes.map((route) => route[key])
    const best = Math.min(...values)
    if (Math.max(...values) - best < tolerance) return []
    return [{ key, tolerance, best, good, drawback }]
  })

  return routes.map((route) => ({
    ...route,
    tradeoffs: comparisons.map(({ key, tolerance, best, good, drawback }) => {
      const favorable = route[key] - best < tolerance
      return { key, favorable, label: favorable ? good : drawback }
    }),
  }))
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = ({ data: { id, grid, elevations, start, goal, darkness } }) => {
    try {
      self.postMessage({ id, routes: findRouteOptions(grid, elevations, start, goal, darkness) })
    } catch (error) {
      self.postMessage({ id, error: error.message })
    }
  }
}
