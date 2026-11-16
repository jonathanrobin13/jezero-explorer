import { useEffect, useMemo, useRef, useState } from 'react'

const MIN_DRAG_PIXELS = 5
const formatMeters = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
})

function emptySelection() {
  return { start: null, goal: null, routes: [], routeId: null, busy: false, message: '' }
}

function formatDuration(seconds) {
  const rounded = Math.round(seconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor(rounded % 3600 / 60)
  const remainder = rounded % 60

  return [hours && `${hours} h`, minutes && `${minutes} min`, `${remainder} s`]
    .filter(Boolean)
    .join(' ')
}

async function fetchFile(url, signal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('Could not load the CTX elevation grid.')
  return response
}

function cellCoordinates(cell, grid) {
  const row = Math.floor(cell / grid.width)
  const col = cell % grid.width

  return {
    latitude: grid.north - (row + 0.5) * grid.degreesPerRow,
    longitude: grid.west + (col + 0.5) * grid.degreesPerColumn,
  }
}

function formatCoordinates(cell, grid) {
  const { latitude, longitude } = cellCoordinates(cell, grid)

  return `${Math.abs(latitude).toFixed(5)}° ${latitude < 0 ? 'S' : 'N'}, `
    + `${longitude.toFixed(5)}° E`
}

function pointerCoordinates(event, bounds, view) {
  const rect = event.currentTarget.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width - view.x) / view.scaleX
  const y = ((event.clientY - rect.top) / rect.height - view.y) / view.scaleY

  if (!(x >= 0 && x < 1 && y >= 0 && y < 1)) return null

  return {
    latitude: bounds.north - y * (bounds.north - bounds.south),
    longitude: bounds.west + x * (bounds.east - bounds.west),
  }
}

export function useRoutePlanner() {
  const [terrain, setTerrain] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [selection, setSelection] = useState(emptySelection)
  const workerRef = useRef(null)
  const requestId = useRef(0)
  const gestureRef = useRef(null)
  const [cursor, setCursor] = useState(null)

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

      let darkness = null

      if (grid.darkness?.file) {
        try {
          const response = await fetchFile(new URL(grid.darkness.file, url), signal)
          const scores = new Uint8Array(await response.arrayBuffer())
          if (scores.length !== count) {
            throw new Error('CTX darkness file size does not match the elevation grid.')
          }
          darkness = scores
        } catch (error) {
          if (!signal.aborted) console.warn('CTX darkness scores unavailable', error)
        }
      }

      if (!signal.aborted) setTerrain({ grid, elevations, darkness })    }

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

  function selectCoordinates({ latitude, longitude }) {
    if (
      !terrain ||
      selection.busy ||
      selection.goal !== null ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return
    }

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
      return true
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

    function finish({ routes = [], error = '' }) {
      if (id !== requestId.current) return
      workerRef.current?.terminate()
      workerRef.current = null
      setSelection({
        ...emptySelection(),
        start,
        goal: cell,
        routes,
        routeId: routes.find(({ id }) => id === 'terrain')?.id ?? routes[0]?.id ?? null,
        message: error || (routes.length ? '' : 'No route through the available elevation cells.'),
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
          worker.postMessage({
        id, grid, elevations, start, goal: cell, darkness: terrain.darkness,
      })
    } catch (error) {
      finish({ error: error.message })
    }
    return true
  }

  function pointerHandlers(bounds, view, onMapPick, pickRoute) {
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
      onPointerMoveCapture(event) {
        recordMovement(event)

        if (event.pointerType === 'mouse') {
          setCursor(
            event.buttons === 0 ? pointerCoordinates(event, bounds, view) : null,
          )
        }
      },
      onPointerLeave() {
        setCursor(null)
      },
      onPointerCancelCapture: clearGesture,
      onLostPointerCaptureCapture: clearGesture,
      onPointerUpCapture(event) {
        const gesture = gestureRef.current
        if (gesture?.id !== event.pointerId) return
        recordMovement(event)
        clearGesture(event)
        if (gesture.moved || event.target.closest('[data-map-route], [data-geology-marker]')) return
        const coordinates = pointerCoordinates(event, bounds, view)
        if (!coordinates) return
        onMapPick?.(coordinates)
        if (pickRoute) selectCoordinates(coordinates)
      },
    }
  }

  return {
    ...selection,
    route: selection.routes.find(({ id }) => id === selection.routeId),
    selectRoute(routeId) {
      setSelection((current) => ({ ...current, routeId }))
    },
    terrain,
    loadError,
    cursor,
    pointerHandlers,
    reset,
    selectCoordinates,
  }
}
export function RouteControls({ planner, onMinimize }) {
  const { terrain, loadError, start, goal, routes, routeId, selectRoute, busy, message, reset } = planner
  const statusRef = useRef(null)
  const touchStart = useRef(null)
  const lastWheel = useRef(0)
  const index = routes.findIndex((route) => route.id === routeId)
  const route = routes[index]
  const tradeoff = route?.tradeoffs.find((option) => !option.favorable) ?? route?.tradeoffs[0]
  const titles = { terrain: 'Terrain-aware', distance: 'Shortest distance', time: 'Estimated time', blend: 'Balanced', darkness: 'Experimental brightness' }
  const status = loadError || message || (busy ? 'Calculating routes…' : !terrain ? 'Loading routing data…' :
    start === null ? 'Select a start on the map.' : goal === null ? 'Select a destination on the map.' : '')

  function changeRoute(direction) {
    const next = routes[index + direction]
    if (next) selectRoute(next.id)
  }

  return (
    <div className="route-drawer-body">
      <p ref={statusRef} role={loadError ? 'alert' : 'status'} tabIndex={-1}
        className={loadError || message ? 'text-amber-200' : 'text-telemetry'}>{status}</p>
      <button type="button" className="survey-small-button planner-minimize" onClick={onMinimize}>
        {goal === null ? 'Pick on map' : 'View full map'}
      </button>
      {terrain && (
        <dl className="route-endpoints">
          <div><dt><span className="route-start-icon" aria-hidden="true" /> Start</dt><dd>{start === null ? '—' : formatCoordinates(start, terrain.grid)}</dd></div>
          <div><dt><span className="route-dest-icon" aria-hidden="true" /> Destination</dt><dd>{goal === null ? '—' : formatCoordinates(goal, terrain.grid)}</dd></div>
        </dl>
      )}
      {terrain && goal === null && (
        <details className="coordinate-disclosure">
          <summary>Enter coordinates</summary>
          <form onSubmit={(event) => {
            event.preventDefault()
            const form = event.currentTarget
            const latitude = form.elements.namedItem('latitude')
            const longitude = form.elements.namedItem('longitude')
            if (!planner.selectCoordinates({ latitude: latitude.valueAsNumber, longitude: longitude.valueAsNumber })) return
            form.reset()
            if (start === null) latitude.focus()
            else statusRef.current?.focus()
          }}>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-xs">Latitude (° N)
                <input name="latitude" type="number" inputMode="decimal" step="any" required placeholder="18.44460" className="console-input w-full font-mono text-sm" />
              </label>
              <label className="grid gap-1 text-xs">Longitude (° E)
                <input name="longitude" type="number" inputMode="decimal" step="any" required placeholder="77.45090" className="console-input w-full font-mono text-sm" />
              </label>
            </div>
            <button type="submit" className="survey-small-button">{start === null ? 'Set start' : 'Set destination'}</button>
          </form>
        </details>
      )}

      {route && (
        <section className="route-carousel" aria-label="Route options" onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          changeRoute(event.key === 'ArrowRight' ? 1 : -1)
        }} onWheel={(event) => {
          if (Math.abs(event.deltaX) < 12 || Math.abs(event.deltaX) < Math.abs(event.deltaY)) return
          const now = performance.now()
          if (now - lastWheel.current < 320) return
          lastWheel.current = now
          changeRoute(Math.sign(event.deltaX))
        }} onTouchStart={(event) => {
          touchStart.current = [event.changedTouches[0].clientX, event.changedTouches[0].clientY]
        }} onTouchEnd={(event) => {
          if (!touchStart.current) return
          const dx = event.changedTouches[0].clientX - touchStart.current[0]
          const dy = event.changedTouches[0].clientY - touchStart.current[1]
          touchStart.current = null
          if (Math.abs(dx) > 34 && Math.abs(dx) > Math.abs(dy)) changeRoute(-Math.sign(dx))
        }}>
          <div className="route-stepper">
            <button type="button" aria-label="Previous route" disabled={index <= 0} onClick={() => changeRoute(-1)}>←</button>
            <span aria-live="polite">{index + 1} of {routes.length}</span>
            <button type="button" aria-label="Next route" disabled={index >= routes.length - 1} onClick={() => changeRoute(1)}>→</button>
          </div>
          <article key={route.id} className="route-option" aria-label={'Route ' + (index + 1)}>
            <h3>{titles[route.id] ?? 'Route ' + (index + 1)}</h3>
            <dl>
              <div><dt>Distance</dt><dd>{formatMeters.format(route.distanceMeters)} m</dd></div>
              <div><dt>Walking time</dt><dd>{formatDuration(route.timeSeconds)}</dd></div>
              <div><dt>Ascent</dt><dd>{formatMeters.format(route.ascentMeters)} m</dd></div>
              <div><dt>Steepest step</dt><dd>{(route.maxGrade * 100).toFixed(1)}%</dd></div>
            </dl>
            {tradeoff && <p className={tradeoff.favorable ? 'text-cyan-100' : 'text-amber-200'}>{tradeoff.label}</p>}
          </article>
        </section>
      )}
      <p className="route-limit">Prototype terrain assessment · 20 m cells may miss small hazards.</p>
      {(start !== null || message) && (
        <button type="button" className="survey-small-button" onClick={() => {
          reset()
          statusRef.current?.focus()
        }}>New route</button>
      )}
    </div>
  )
}

export function RouteOverlay({ planner, map }) {
  const { terrain, start, goal, routeId, routes } = planner
  const grid = terrain?.grid
  const { bounds, width, height } = map

  const { first, last, lines } = useMemo(() => {
    if (!grid || start === null) return { lines: [] }
    function point(cell) {
      const { latitude, longitude } = cellCoordinates(cell, grid)
      return {
        x: width * (longitude - bounds.west) / (bounds.east - bounds.west),
        y: height * (bounds.north - latitude) / (bounds.north - bounds.south),
      }
    }
    return {
      first: point(start),
      last: goal === null ? null : point(goal),
      lines: routes.map(({ id, cells }) => ({
        id,
        points: cells.map((cell) => {
          const { x, y } = point(cell)
          return x + ',' + y
        }).join(' '),
      })),
    }
  }, [grid, bounds, width, height, start, goal, routes])

  if (!first) return null
  return (
    <svg viewBox={'0 0 ' + width + ' ' + height} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {lines.map(({ id, points }) => (
        <g key={id} className="route-line" data-current={id === routeId} data-map-route={id}>
          <polyline points={points} pathLength="1" className="route-trace" fill="none" stroke="#09202b"
            strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <polyline points={points} pathLength="1" className="route-trace" fill="none" stroke="#99efff"
            strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </g>
      ))}
      <circle cx={first.x} cy={first.y} r="8" fill="#101113" stroke="#a5f3fc" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {last && <rect x={last.x - 6} y={last.y - 6} width="12" height="12"
        transform={'rotate(45 ' + last.x + ' ' + last.y + ')'} fill="#101113" stroke="#fde68a"
        strokeWidth="2" vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}
