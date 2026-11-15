import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { RouteControls, RouteOverlay, useRoutePlanner } from './RoutePlanner.jsx'

const TerrainView = lazy(() => import('./TerrainView.jsx'))
const MissionView = lazy(() => import('./MissionView.jsx'))

const mapViews = [
  ['map', '2D map'],
  ['terrain', '3D terrain'],
  ['mission', 'Astronaut mission'],
]

const ctxUrl = new URL(
  `${import.meta.env.BASE_URL}data/map/CTX/`,
  document.baseURI,
)

async function fetchFile(url, signal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Could not load ${url}`)
  return response
}

function HeatLayer({ bounds }) {
  const canvasRef = useRef(null)
  const [layer, setLayer] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller

    async function load() {
      const url = new URL('jezero-elevation.json', ctxUrl)
      const grid = await (await fetchFile(url, signal)).json()
      const response = await fetchFile(new URL(grid.file, url), signal)
      const samples = new DataView(await response.arrayBuffer())
      const count = grid.width * grid.height

      if (samples.byteLength !== count * 4) {
        throw new Error('Elevation file size does not match the grid.')
      }

      let low = Infinity
      let high = -Infinity

      for (let cell = 0; cell < count; cell++) {
        const meters = samples.getFloat32(cell * 4, true)
        if (!Number.isFinite(meters)) continue
        low = Math.min(low, meters)
        high = Math.max(high, meters)
      }

      if (!Number.isFinite(low)) throw new Error('No elevation data in this area.')

      const colors = new ImageData(grid.width, grid.height)
      for (let cell = 0; cell < count; cell++) {
        const offset = cell * 4
        const meters = samples.getFloat32(offset, true)
        if (!Number.isFinite(meters)) continue

        const t = (meters - low) / (high - low || 1)
        colors.data[offset] = 32 + 221 * t
        colors.data[offset + 1] = 76 + 138 * t
        colors.data[offset + 2] = 145 - 68 * t
        colors.data[offset + 3] = 160
      }

      if (!signal.aborted) setLayer({ grid, colors, low, high })
    }

    load().catch((error) => {
      if (!signal.aborted) setError(error.message)
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (layer) {
      canvasRef.current.getContext('2d').putImageData(layer.colors, 0, 0)
    }
  }, [layer])

  if (error) return <p role="alert">{error}</p>
  if (!layer) return <p role="status">Loading elevation…</p>

  const { grid, low, high } = layer
  const longitudeSpan = bounds.east - bounds.west
  const latitudeSpan = bounds.north - bounds.south

  return (
    <>
      <canvas
        ref={canvasRef}
        width={grid.width}
        height={grid.height}
        role="img"
        aria-label="Elevation overlay. Blue is lower and gold is higher."
        className="pointer-events-none absolute"
        style={{
          left: `${100 * (grid.west - bounds.west) / longitudeSpan}%`,
          top: `${100 * (bounds.north - grid.north) / latitudeSpan}%`,
          width: `${100 * grid.width * grid.degreesPerColumn / longitudeSpan}%`,
          height: `${100 * grid.height * grid.degreesPerRow / latitudeSpan}%`,
        }}
      />
      <div className="absolute bottom-3 left-3 rounded bg-slate-950/90 p-2 text-sm text-white">
        <div>Elevation (m)</div>
        <div
          className="my-1 h-2 w-36 rounded"
          style={{ background: 'linear-gradient(to right, #204c91, #fdd64d)' }}
        />
        <div className="flex justify-between">
          <span>{Math.round(low).toLocaleString()}</span>
          <span>{Math.round(high).toLocaleString()}</span>
        </div>
      </div>
    </>
  )
}
const HOME_VIEW = { zoom: 1, x: 0, y: 0 }

function constrainView(zoom, x, y) {
  return {
    zoom,
    x: Math.max(1 - zoom, Math.min(0, x)),
    y: Math.max(1 - zoom, Math.min(0, y)),
  }
}

function zoomAt(view, factor, anchorX = 0.5, anchorY = 0.5) {
  const zoom = Math.max(1, Math.min(4, view.zoom * factor))
  const ratio = zoom / view.zoom

  return constrainView(
    zoom,
    anchorX - (anchorX - view.x) * ratio,
    anchorY - (anchorY - view.y) * ratio,
  )
}

export default function ElevationMap() {
  const [map, setMap] = useState(null)
  const [error, setError] = useState(null)
  const [mapView, setMapView] = useState('map')
  const [showElevation, setShowElevation] = useState(false)
	const [view, setView] = useState(HOME_VIEW)
	const [detail, setDetail] = useState(null)
	const viewportRef = useRef(null)
	const dragRef = useRef(null)
const planner = useRoutePlanner()

function startDrag(event) {
  if (!event.isPrimary || event.button !== 0 || view.zoom <= 1) return

  event.currentTarget.setPointerCapture(event.pointerId)
  dragRef.current = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
  }
}

function moveDrag(event) {
  const drag = dragRef.current
  if (drag?.pointerId !== event.pointerId) return

  const rect = event.currentTarget.getBoundingClientRect()
  const dx = (event.clientX - drag.x) / rect.width
  const dy = (event.clientY - drag.y) / rect.height

  drag.x = event.clientX
  drag.y = event.clientY

  setView((current) =>
    constrainView(current.zoom, current.x + dx, current.y + dy),
  )
}

function endDrag(event) {
  if (dragRef.current?.pointerId === event.pointerId) {
    dragRef.current = null
  }
}


useEffect(() => {
  const controller = new AbortController()
  const url = new URL('../HiRISE/jezero-western-delta.json', ctxUrl)

  fetchFile(url, controller.signal)
    .then((response) => response.json())
    .then((metadata) => {
      if (!controller.signal.aborted) {
        setDetail({ ...metadata, src: new URL(metadata.image, url).href })
      }
    })
    .catch((error) => {
      if (!controller.signal.aborted) console.warn('HiRISE detail unavailable', error)
    })

  return () => controller.abort()
}, [])

useEffect(() => {
  const viewport = viewportRef.current
  if (!viewport) return

  function onWheel(event) {
    if (event.deltaY === 0) return
    event.preventDefault()

    const rect = viewport.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1
    const delta = Math.max(-120, Math.min(120, event.deltaY * unit))

    setView((current) => zoomAt(current, Math.exp(-delta * 0.002), x, y))
  }

  viewport.addEventListener('wheel', onWheel, { passive: false })
  return () => viewport.removeEventListener('wheel', onWheel)
}, [map, mapView])

	
  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller

    fetchFile(new URL('jezero-ctx.json', ctxUrl), signal)
      .then((response) => response.json())
      .then((metadata) => {
        if (!signal.aborted) setMap(metadata)
      })
      .catch((error) => {
        if (!signal.aborted) setError(error.message)
      })

    return () => controller.abort()
  }, [])

  if (error) return <p role="alert">{error}</p>
  if (!map) return <p role="status">Loading CTX map…</p>

  return (
    <section className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Map view">
        {mapViews.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mapView === value}
            onClick={() => setMapView(value)}
            className="rounded-lg border border-slate-600 px-4 py-2 font-medium aria-pressed:border-cyan-300 aria-pressed:bg-cyan-200 aria-pressed:text-slate-950"
          >
            {label}
          </button>
        ))}
      </div>

      {mapView === 'mission' ? (
        <Suspense fallback={<p role="status">Loading astronaut mission…</p>}>
          <MissionView
            terrain={planner.terrain}
            loadError={planner.loadError}
            bounds={map.bounds}
            image={new URL(map.image, ctxUrl).href}
          />
        </Suspense>
      ) : mapView === 'terrain' ? (
        <Suspense fallback={<p role="status">Loading 3D terrain…</p>}>
          <TerrainView
            terrain={planner.terrain}
            loadError={planner.loadError}
            bounds={map.bounds}
            image={new URL(map.image, ctxUrl).href}
            imagerySource={map.source.url}
          />
        </Suspense>
      ) : (
      <>
      <label className="mb-3 flex items-center gap-2">
        <input
          type="checkbox"
          checked={showElevation}
          onChange={(event) => setShowElevation(event.target.checked)}
        />
        Show elevation
      </label>

		<div className="mb-3 flex gap-2" role="group" aria-label="Map zoom">
		  <button
			type="button"
			className="rounded bg-slate-700 px-3 py-1"
			aria-label="Zoom out"
			onClick={() => setView((current) => zoomAt(current, 1 / 1.5))}
		  >
			−
		  </button>
		  <button
			type="button"
			className="rounded bg-slate-700 px-3 py-1"
			aria-label="Zoom in"
			onClick={() => setView((current) => zoomAt(current, 1.5))}
		  >
			+
		  </button>
		  <button
			type="button"
			className="rounded bg-slate-700 px-3 py-1"
			onClick={() => setView(HOME_VIEW)}
		  >
			Reset
		  </button>
		</div>

		<div
  ref={viewportRef}
  className={`relative select-none overflow-hidden rounded-lg ${
    view.zoom > 1 ? 'touch-none cursor-grab active:cursor-grabbing' : ''
  }`}
  style={{ aspectRatio: `${map.width} / ${map.height}` }}
  onPointerDown={startDrag}
  onPointerMove={moveDrag}
  onPointerUp={endDrag}
  onPointerCancel={endDrag}
  onLostPointerCapture={endDrag}
  onDragStart={(event) => event.preventDefault()}
>
		  <div
			className="absolute inset-0 origin-top-left"
			style={{
			  transform: `translate(${view.x * 100}%, ${view.y * 100}%) scale(${view.zoom})`,
			}}
		  >
			<img
			  src={new URL(map.image, ctxUrl).href}
			  alt="CTX orbital image of western Jezero Crater"
			  className="block h-full w-full"
			/>

			{detail && view.zoom >= 2 && (
			  <img
				src={detail.src}
				alt="HiRISE close-up of Jezero’s western delta"
				className="pointer-events-none absolute"
				style={{
				  left: `${100 * (detail.bounds.west - map.bounds.west) / (map.bounds.east - map.bounds.west)}%`,
				  top: `${100 * (map.bounds.north - detail.bounds.north) / (map.bounds.north - map.bounds.south)}%`,
				  width: `${100 * (detail.bounds.east - detail.bounds.west) / (map.bounds.east - map.bounds.west)}%`,
				  height: `${100 * (detail.bounds.north - detail.bounds.south) / (map.bounds.north - map.bounds.south)}%`,
				}}
			  />
			)}

			{showElevation && <HeatLayer bounds={map.bounds} />}
		  </div>
		</div>
        <p className="mt-2 text-sm text-slate-300">
          Jezero Crater · Mars Reconnaissance Orbiter CTX mosaic · USGS Astrogeology
        </p>
      </>
      )}
    </section>
  )
}
