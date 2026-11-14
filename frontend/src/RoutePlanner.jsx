import { useEffect, useRef, useState } from 'react'

const MIN_DRAG_PIXELS = 5
const formatMeters = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
})

function emptySelection() {
  return { start: null, goal: null, route: null, busy: false, message: '' }
}

async function fetchFile(url, signal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('Could not load the CTX elevation grid.')
  return response
}

export function useRoutePlanner() {
  const [terrain, setTerrain] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [selection, setSelection] = useState(emptySelection)
  const workerRef = useRef(null)
  const requestId = useRef(0)
  const gestureRef = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller

    async function load() {
      const url = new URL(
        `${import.meta.env.BASE_URL}data/map/CTX/jezero-elevation.json`,
        document.baseURI,
      )
      const grid = await (await fetchFile(url, signal)).json()
      const binary = await fetchFile(new URL(grid.file, url), signal)
      const samples = new DataView(await binary.arrayBuffer())
      const count = grid.width * grid.height

      if (samples.byteLength !== count * 4) {
        throw new Error('Elevation file size does not match the grid.')
      }

      const elevations = new Float32Array(count)
      for (let cell = 0; cell < count; cell++) {
        elevations[cell] = samples.getFloat32(cell * 4, true)
      }

      if (!signal.aborted) setTerrain({ grid, elevations })
    }

    load().catch((error) => {
      if (!signal.aborted) setLoadError(error.message)
    })

    return () => controller.abort()
  }, [])

  useEffect(() => () => workerRef.current?.terminate(), [])

  function reset() {
    requestId.current++
    workerRef.current?.terminate()
    workerRef.current = null
    setSelection(emptySelection())
  }

  function selectCell(event, bounds, view) {
    if (!terrain || selection.busy || selection.goal !== null) return

    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width - view.x) / view.zoom
    const y = ((event.clientY - rect.top) / rect.height - view.y) / view.zoom
    if (x < 0 || x >= 1 || y < 0 || y >= 1) return

    const longitude = bounds.west + x * (bounds.east - bounds.west)
    const latitude = bounds.north - y * (bounds.north - bounds.south)
    const { grid, elevations } = terrain
    const row = Math.floor((grid.north - latitude) / grid.degreesPerRow)
    const col = Math.floor((longitude - grid.west) / grid.degreesPerColumn)
    const cell = row * grid.width + col

    if (
      row < 0 || row >= grid.height || col < 0 || col >= grid.width ||
      !Number.isFinite(elevations[cell])
    ) {
      setSelection((current) => ({
        ...current,
        message: 'Pick a point with CTX elevation coverage.',
      }))
      return
    }

    if (selection.start === null) {
      setSelection({ ...emptySelection(), start: cell })
      return
    }

    if (cell === selection.start) {
      setSelection((current) => ({
        ...current,
        message: 'Pick a destination in a different elevation cell.',
      }))
      return
    }

    const start = selection.start
    const id = ++requestId.current
    setSelection({ ...emptySelection(), start, goal: cell, busy: true })

    function finish({ route = null, error = '' }) {
      if (id !== requestId.current) return
      workerRef.current?.terminate()
      workerRef.current = null
      setSelection({
        ...emptySelection(),
        start,
        goal: cell,
        route,
        message: error || (route ? '' : 'No route through the available elevation cells.'),
      })
    }

    try {
      const worker = new Worker(
        new URL('./map_calculations/pathfinding.js', import.meta.url),
        { type: 'module' },
      )
      workerRef.current = worker
      worker.onmessage = ({ data }) => {
        if (data.id === id) finish(data)
      }
      worker.onerror = () => finish({ error: 'The route calculation failed.' })
      worker.postMessage({ id, grid, elevations, start, goal: cell })
    } catch (error) {
      finish({ error: error.message })
    }
  }

  function pointerHandlers(bounds, view) {
    function recordMovement(event) {
      const gesture = gestureRef.current
      if (gesture?.id !== event.pointerId) return
      if (
        Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >=
        MIN_DRAG_PIXELS
      ) {
        gesture.moved = true
      }
    }

    function clearGesture(event) {
      if (gestureRef.current?.id === event.pointerId) gestureRef.current = null
    }

    return {
      onPointerDownCapture(event) {
        if (!event.isPrimary || event.button !== 0) return
        gestureRef.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          moved: false,
        }
      },
      onPointerMoveCapture: recordMovement,
      onPointerCancelCapture: clearGesture,
      onLostPointerCaptureCapture: clearGesture,
      onPointerUpCapture(event) {
        const gesture = gestureRef.current
        if (gesture?.id !== event.pointerId) return
        recordMovement(event)
        clearGesture(event)
        if (!gesture.moved) selectCell(event, bounds, view)
      },
    }
  }

  return { ...selection, terrain, loadError, pointerHandlers, reset }
}

export function RouteControls({ planner }) {
  const { terrain, loadError, start, goal, route, busy, message, reset } = planner
  const status = message || (
    busy ? 'Calculating route…' :
    !terrain ? 'Loading routing data…' :
    start === null ? 'Click the map to choose a start.' :
    goal === null ? 'Click the map to choose a destination.' :
    route ? 'Route ready.' : ''
  )

  return (
    <div className="mb-3 space-y-2">
      <button
        type="button"
        onClick={reset}
        disabled={start === null && !message}
        className="rounded bg-slate-700 px-3 py-1 disabled:opacity-50"
      >
        New route
      </button>

      {loadError ? <p role="alert">{loadError}</p> : <p role="status">{status}</p>}

      {route && (
        <p className="text-sm text-slate-200">
          {formatMeters.format(route.distanceMeters)} m horizontal ·{' '}
          {formatMeters.format(route.ascentMeters)} m ascent ·{' '}
          {(100 * route.maxGrade).toFixed(1)}% steepest step
        </p>
      )}

      <p className="text-sm text-slate-300">
        CTX terrain model at 20 m spacing. Smaller hazards may be missed.
      </p>
    </div>
  )
}

export function RouteOverlay({ planner, map }) {
  const { terrain, start, goal, route } = planner
  if (!terrain || start === null) return null

  const { grid } = terrain
  const { bounds, width, height } = map

  function point(cell) {
    const row = Math.floor(cell / grid.width)
    const col = cell % grid.width
    const longitude = grid.west + (col + 0.5) * grid.degreesPerColumn
    const latitude = grid.north - (row + 0.5) * grid.degreesPerRow

    return {
      x: width * (longitude - bounds.west) / (bounds.east - bounds.west),
      y: height * (bounds.north - latitude) / (bounds.north - bounds.south),
    }
  }

  const first = point(start)
  const last = goal === null ? null : point(goal)
  const points = route?.cells
    .map(point)
    .map(({ x, y }) => `${x},${y}`)
    .join(' ')

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      {points && (
        <>
          <polyline
            points={points}
            fill="none"
            stroke="#0f172a"
            strokeWidth="6"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={points}
            fill="none"
            stroke="#22d3ee"
            strokeWidth="3"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
      <circle cx={first.x} cy={first.y} r="8" fill="#22c55e" stroke="#0f172a" />
      {last && (
        <circle cx={last.x} cy={last.y} r="8" fill="#fbbf24" stroke="#0f172a" />
      )}
    </svg>
  )
}