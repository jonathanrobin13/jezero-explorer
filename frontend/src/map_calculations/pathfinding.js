const CTX_CELL_METERS = 20
const DEFAULT_SLOPE_WEIGHT = 8

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

export function findRoute(grid, elevations, start, goal, {
  slopeWeight = DEFAULT_SLOPE_WEIGHT,
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

  function heuristic(row, col) {
    return Math.hypot(
      (goalCol - col) * cellWidth,
      (goalRow - row) * cellHeight,
    )
  }

  const moves = []
  for (const dr of [-1, 0, 1]) {
    for (const dc of [-1, 0, 1]) {
      if (dr === 0 && dc === 0) continue
      moves.push({ dr, dc, distance: Math.hypot(dc * cellWidth, dr * cellHeight) })
    }
  }

  const bestCost = new Float64Array(count).fill(Infinity)
  const parent = new Int32Array(count).fill(-1)
  const frontier = new MinHeap()

  bestCost[start] = 0
  frontier.push({
    cell: start,
    cost: 0,
    priority: heuristic(Math.floor(start / width), start % width),
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
      }

      return { cells, distanceMeters, ascentMeters, maxGrade }
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

      const grade = (elevations[next] - elevations[cell]) / distance
      const nextCost = cost + distance * (1 + slopeWeight * grade ** 2)
      if (nextCost >= bestCost[next]) continue

      bestCost[next] = nextCost
      parent[next] = cell
      frontier.push({
        cell: next,
        cost: nextCost,
        priority: nextCost + heuristic(nextRow, nextCol),
      })
    }
  }

  return null
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = ({ data: { id, grid, elevations, start, goal } }) => {
    try {
      self.postMessage({ id, route: findRoute(grid, elevations, start, goal) })
    } catch (error) {
      self.postMessage({ id, error: error.message })
    }
  }
}