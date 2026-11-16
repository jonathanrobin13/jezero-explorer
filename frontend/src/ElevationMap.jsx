import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { RouteControls, RouteOverlay, useRoutePlanner } from './RoutePlanner.jsx'
import { DustContext, LayerReadout } from './MapInstruments.jsx'
import { SolarUvOverlay } from './SolarUvMap.jsx'
import WeatherPanel from './WeatherPanel.jsx'
import { useRadiationLayer } from './useRadiationLayer.js'
import { useSolarUvModel } from './useSolarUvModel.js'
import { useWeatherArchive } from './useWeatherArchive.js'

const MissionView = lazy(() => import('./MissionView.jsx'))

const westernDelta = { latitude: 18.473, longitude: 77.415 }
const mapModes = [
  ['elevation', 'Elevation'], ['uv', 'UV Radiation'], ['dust', 'Dust'],
  ['temperature', 'Temperature'], ['pressure', 'Pressure'],
]

function dustAtTime(archive, sample) {
  if (!sample) return null
  const observations = archive?.aerosol?.byDate[sample.utc.slice(0, 10)] ?? []
  const referenceTime = Date.parse(sample.utc)
  return observations.reduce((nearest, observation) => (
    !nearest || Math.abs(Date.parse(observation.utc) - referenceTime) <
      Math.abs(Date.parse(nearest.utc) - referenceTime) ? observation : nearest
  ), null)
}

const ctxUrl = new URL(
  `${import.meta.env.BASE_URL}data/map/CTX/`,
  document.baseURI,
)

async function fetchFile(url, signal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Could not load ${url}`)
  return response
}

function HeatLayer({ bounds, visible, onRange }) {
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

      if (!signal.aborted) {
        setLayer({ grid, colors })
        onRange([low, high])
      }
    }

    load().catch((error) => {
      if (!signal.aborted) setError(error.message)
    })
    return () => controller.abort()
  }, [onRange])

  useEffect(() => {
    if (layer) {
      canvasRef.current.getContext('2d').putImageData(layer.colors, 0, 0)
    }
  }, [layer])

  if (error) return visible && <p role="alert" className="map-chip absolute bottom-3 left-3">{error}</p>
  if (!layer) return visible && <p role="status" className="map-chip absolute bottom-3 left-3">Loading elevation…</p>

  const { grid } = layer
  const longitudeSpan = bounds.east - bounds.west
  const latitudeSpan = bounds.north - bounds.south

  return (
    <div className="map-overlay absolute inset-0" data-visible={visible} aria-hidden={!visible}>
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
    </div>
  )
}
const HOME_VIEW = { zoom: 1, x: 0.5, y: 0.5 }

function useMapCamera() {
  const [view, setView] = useState(HOME_VIEW)
  const current = useRef(HOME_VIEW)
  const target = useRef(HOME_VIEW)
  const frame = useRef(null)

  const moveTo = useCallback((destination, duration = 240) => {
    const end = typeof destination === 'function'
      ? destination(duration ? target.current : current.current)
      : destination
    const start = current.current
    target.current = end
    cancelAnimationFrame(frame.current)
    frame.current = null

    if (
      !duration ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      (start.zoom === end.zoom && start.x === end.x && start.y === end.y)
    ) {
      current.current = end
      setView(end)
      return
    }

    const started = performance.now()
    function tick(now) {
      const progress = Math.min(1, (now - started) / duration)
      const eased = 1 - (1 - progress) ** 3
      current.current = progress === 1 ? end : {
        zoom: start.zoom + (end.zoom - start.zoom) * eased,
        x: start.x + (end.x - start.x) * eased,
        y: start.y + (end.y - start.y) * eased,
      }
      setView(current.current)
      frame.current = progress < 1 ? requestAnimationFrame(tick) : null
    }
    frame.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  return [view, moveTo]
}

export default function ElevationMap({ mapView }) {
  const [map, setMap] = useState(null)
  const [error, setError] = useState(null)
  const [detail, setDetail] = useState(null)
  const [geology, setGeology] = useState(null)
  const [selected, setSelected] = useState(null)
  const [showScience, setShowScience] = useState(false)
  const [mode, setMode] = useState('elevation')
  const [elevationRange, setElevationRange] = useState(null)
  const [showSimulatedUv, setShowSimulatedUv] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [preview, setPreview] = useState(false)
  const [sheet, setSheet] = useState(null)
  const [size, setSize] = useState(null)
  const [view, moveCamera] = useMapCamera()
  const viewportRef = useRef(null)
  const dragRef = useRef(null)
  const plannerButton = useRef(null)
  const dustButton = useRef(null)
  const radiation = useRadiationLayer(true)
  const weather = useWeatherArchive(true)
  const modelEnabled = mapView === 'map' && mode === 'uv' && showSimulatedUv
  const model = useSolarUvModel(modelEnabled, radiation.sample?.utc)
  const planner = useRoutePlanner()
  const dust = dustAtTime(weather.archive, radiation.sample)
  const isMission = mapView === 'mission'

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    const load = (url) => fetchFile(url, signal).then((response) => response.json())
    load(new URL('jezero-ctx.json', ctxUrl)).then((metadata) => {
      if (!signal.aborted) setMap(metadata)
    }).catch(() => {
      if (!signal.aborted) setError('Could not load the Jezero map.')
    })
    const detailUrl = new URL('../HiRISE/jezero-western-delta.json', ctxUrl)
    load(detailUrl).then((metadata) => {
      if (!signal.aborted) setDetail({ ...metadata, src: new URL(metadata.image, detailUrl).href })
    }).catch((failure) => {
      if (!signal.aborted) console.warn('HiRISE detail unavailable', failure)
    })
    load(new URL('../geology/jezero-water-minerals.json', ctxUrl)).then((metadata) => {
      if (!signal.aborted) setGeology(metadata)
    }).catch((failure) => {
      if (!signal.aborted) console.warn('Jezero geology markers unavailable', failure)
    })
    return () => controller.abort()
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = viewport
      setSize((current) => current?.width === width && current?.height === height ? current : { width, height })
    }
    const observer = new ResizeObserver(measure)
    measure()
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [map, isMission])

  // Cover the viewport with a uniformly scaled raster. Camera centers stay in
  // normalized raster coordinates so raster overlays and picking share a frame.
  const aspect = map ? map.width / map.height : 1
  const viewportAspect = size?.height ? size.width / size.height : aspect
  const coverX = Math.max(1, aspect / viewportAspect)
  const coverY = Math.max(1, viewportAspect / aspect)

  const clampCamera = useCallback((zoom, x, y) => {
    const insetX = 0.5 / (coverX * zoom)
    const insetY = 0.5 / (coverY * zoom)
    return { zoom, x: Math.min(1 - insetX, Math.max(insetX, x)), y: Math.min(1 - insetY, Math.max(insetY, y)) }
  }, [coverX, coverY])

  const zoomAt = useCallback((factor, anchorX = 0.5, anchorY = 0.5, duration = 240) => {
    moveCamera((current) => {
      const { x, y } = clampCamera(current.zoom, current.x, current.y)
      const zoom = Math.min(6, Math.max(1, current.zoom * factor))
      const shift = 1 / current.zoom - 1 / zoom
      return clampCamera(zoom, x + (anchorX - 0.5) * shift / coverX, y + (anchorY - 0.5) * shift / coverY)
    }, duration)
  }, [clampCamera, coverX, coverY, moveCamera])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    function onWheel(event) {
      if (!event.deltaY) return
      event.preventDefault()
      const rect = viewport.getBoundingClientRect()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1)
      zoomAt(Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.002), (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height, 180)
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [map, isMission, zoomAt])

  if (error) return <p role="alert" className="p-6">{error}</p>
  if (!map) return <p role="status" className="p-6">Loading CTX map…</p>

  const image = new URL(map.image, ctxUrl).href
  if (isMission) {
    return (
      <Suspense fallback={<p role="status">Loading astronaut mission…</p>}>
        <MissionView weatherPoint={selected} onWeatherPoint={setSelected}
          renderWeatherPanel={(point, craterTerrain, craterLoading) => (
            <WeatherPanel point={point} layer={radiation} weather={weather} westernTerrain={planner.terrain}
              craterTerrain={craterTerrain} terrainLoading={(!planner.terrain && !planner.loadError) || craterLoading} />
          )}
          terrain={planner.terrain} loadError={planner.loadError} bounds={map.bounds} image={image}
          detail={detail} regionalUrl={new URL('jezero-crater.json', ctxUrl).href} geology={geology}
          radiation={radiation} weather={weather} />
      </Suspense>
    )
  }

  const { west, east, north, south } = map.bounds
  const camera = clampCamera(view.zoom, view.x, view.y)
  const scaleX = view.zoom * coverX
  const scaleY = view.zoom * coverY
  const projection = { x: 0.5 - camera.x * scaleX, y: 0.5 - camera.y * scaleY, scaleX, scaleY }

  function mapPosition(point) {
    return { x: (point.longitude - west) / (east - west), y: (north - point.latitude) / (north - south) }
  }

  function screenPoint(point) {
    const { x, y } = mapPosition(point)
    return { x: projection.x + x * scaleX, y: projection.y + y * scaleY }
  }

  function markerPosition(point) {
    const { x, y } = screenPoint(point)
    if (x < 0 || x > 1 || y < 0 || y > 1) return null
    return { left: 100 * x + '%', top: 100 * y + '%' }
  }

  function focusScience(point) {
    const { x, y } = mapPosition(point)
    const zoom = Math.max(2.1, view.zoom)
    setSelected(point)
    setShowScience(true)
    moveCamera(clampCamera(zoom, x, y), 490)
  }

  const pointerHandlers = planner.pointerHandlers(map.bounds, projection, () => setShowScience(false), pinned)
  const observation = mode === 'dust' || (pinned && mode === 'elevation') ? dust : mode === 'elevation' ? null : radiation.sample
  const observationPosition = observation && markerPosition(observation)
  const deltaPosition = markerPosition(westernDelta)
  const features = showScience ? geology?.features ?? [] : []

  function startDrag(event) {
    if (!event.isPrimary || event.button !== 0 || event.target.closest('[data-geology-marker]')) return
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, active: false }
  }

  function moveDrag(event) {
    const drag = dragRef.current
    if (drag?.id !== event.pointerId) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.active) {
      if (Math.hypot(dx, dy) < 5) return
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.active = true
    }
    drag.x = event.clientX
    drag.y = event.clientY
    const { clientWidth, clientHeight } = event.currentTarget
    moveCamera((current) => {
      const center = clampCamera(current.zoom, current.x, current.y)
      return clampCamera(current.zoom, center.x - dx / (clientWidth * coverX * current.zoom),
        center.y - dy / (clientHeight * coverY * current.zoom))
    }, 0)
  }

  function endDrag(event) {
    if (dragRef.current?.id === event.pointerId) dragRef.current = null
  }

  function togglePlanner() {
    if (pinned && sheet === 'planner') {
      setPinned(false)
      setPreview(false)
      setSheet(null)
    } else {
      setPinned(true)
      setSheet('planner')
    }
  }

  function closePlanner() {
    setPinned(false)
    setPreview(false)
    setSheet(null)
    plannerButton.current?.focus()
  }

  return (
    <section className="survey-workspace" aria-label="Jezero Mars map" onKeyDown={(event) => {
      if (event.key !== 'Escape') return
      if (sheet === 'dust') {
        setSheet('planner')
        dustButton.current?.focus()
      } else if (pinned) closePlanner()
      else if (showScience) setShowScience(false)
      else setPreview(false)
    }}>
      <div ref={viewportRef} className={'survey-surface ' + (pinned ? 'is-planning' : '')}
        {...pointerHandlers} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag}
        onPointerCancel={endDrag} onLostPointerCapture={endDrag}
        onPointerLeave={(event) => {
          pointerHandlers.onPointerLeave()
          if (!dragRef.current?.active) endDrag(event)
        }}>
        <div className="survey-raster" style={{
          width: 100 * coverX + '%', height: 100 * coverY + '%',
          transform: 'translate(' + 100 * projection.x / coverX + '%, ' + 100 * projection.y / coverY + '%) scale(' + view.zoom + ')',
        }}>
          <img src={image} alt="CTX orbital imagery of western Jezero Crater" className="survey-base" draggable="false" />
          {detail && <img src={detail.src} alt="" className="map-overlay survey-detail" draggable="false"
            data-visible={view.zoom >= 2} style={{
              left: 100 * (detail.bounds.west - west) / (east - west) + '%',
              top: 100 * (north - detail.bounds.north) / (north - south) + '%',
              width: 100 * (detail.bounds.east - detail.bounds.west) / (east - west) + '%',
              height: 100 * (detail.bounds.north - detail.bounds.south) / (north - south) + '%',
            }} />}
          <HeatLayer bounds={map.bounds} visible={mode === 'elevation'} onRange={setElevationRange} />
          <SolarUvOverlay model={model} bounds={map.bounds} visible={modelEnabled} />
          <RouteOverlay planner={planner} map={map} />
        </div>
        {deltaPosition && <button data-geology-marker type="button" className="survey-pin delta-pin" style={deltaPosition}
          onClick={() => focusScience(westernDelta)}><span aria-hidden="true">◇</span> Western delta</button>}
        {features.map((feature) => {
          const position = markerPosition(feature)
          return position && <button key={feature.id} data-geology-marker type="button" style={position}
            aria-label={feature.title} title={feature.title} className="survey-pin science-pin"
            aria-pressed={selected?.id === feature.id}
            onClick={() => focusScience(feature)}>{feature.kind === 'water' ? '≈' : '◆'}</button>
        })}
        {observationPosition && <span className="survey-pin rover-pin" style={observationPosition} aria-hidden="true">● <span>Perseverance</span></span>}
      </div>

      <header className="survey-toolbar frosted">
        <a href="#home" className="survey-home" aria-label="Jezero Explorer home"><span className="crater-emblem" /><span>Jezero Explorer</span></a>
        <nav className="survey-modes" aria-label="Environmental layers">
          {mapModes.map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value}
            onClick={() => setMode(value)}>{label}</button>)}
        </nav>
        <a href="#references" className="survey-references">References <span aria-hidden="true">↗</span></a>
      </header>

      <div className="survey-left" data-pinned={pinned} data-sheet={sheet}
        onPointerLeave={(event) => { if (event.pointerType === 'mouse') setPreview(false) }}>
        <button ref={plannerButton} type="button" className="survey-tool frosted" aria-controls="planner-drawer"
          aria-expanded={pinned && sheet === 'planner'} onPointerEnter={(event) => {
            if (event.pointerType === 'mouse' && !pinned && matchMedia('(min-width: 768px)').matches) setPreview(true)
          }} onClick={togglePlanner}><span aria-hidden="true">⌁</span> Plan route</button>
        {((pinned && sheet === 'planner') || (!pinned && preview)) && (
          <aside id="planner-drawer" className="survey-drawer frosted" aria-label="Route planning">
            <div className="drawer-heading"><h2>Marswalk planner</h2>{pinned &&
              <button type="button" aria-label="Close route planner" onClick={closePlanner}>×</button>}
            </div>
            {pinned ? <RouteControls planner={planner} onMinimize={() => {
              setSheet(null)
              plannerButton.current?.focus()
            }} /> : <p className="drawer-preview">Choose two points and compare possible paths.</p>}
          </aside>
        )}
      </div>

      {pinned && <div className="survey-right" data-sheet={sheet}>
        <button ref={dustButton} type="button" className="survey-tool frosted dust-tool" aria-controls="dust-drawer"
          aria-expanded={sheet === 'dust'} onClick={() => setSheet(sheet === 'dust' ? 'planner' : 'dust')}>Dust context</button>
        <aside id="dust-drawer" className="survey-drawer frosted" aria-label="Dust context">
          <div className="drawer-heading"><h2>Dust context</h2>
            <button type="button" className="dust-close" aria-label="Close dust context" onClick={() => {
              setSheet('planner')
              dustButton.current?.focus()
            }}>×</button>
          </div>
          <DustContext planner={planner} dust={dust} loading={!weather.archive && !weather.error} />
        </aside>
      </div>}

      {showScience && selected && (
        <aside className="survey-science frosted" aria-label="Science stop">
          <div className="drawer-heading"><h2>{selected.title ?? 'Western delta'}</h2>
            <button type="button" aria-label="Close science details" onClick={() => setShowScience(false)}>×</button>
          </div>
          <p>{selected.keyPoint ?? 'Perseverance photographed layered sediment consistent with a river flowing into an ancient lake.'}</p>
          {pinned && planner.terrain && planner.goal === null && (
            <button type="button" className="survey-small-button science-route" onClick={() => {
              if (planner.selectCoordinates(selected)) setShowScience(false)
            }}>{planner.start === null ? 'Use as start' : 'Use as destination'}</button>
          )}
          <a href="#references" className="console-link">Science sources ↗</a>
        </aside>
      )}

      <div className="survey-instrument frosted">
        <LayerReadout key={mode} mode={mode} range={elevationRange} radiation={radiation} weather={weather} dust={dust}
          modelEnabled={modelEnabled} setModelEnabled={setShowSimulatedUv} model={model} />
      </div>
      <div className="survey-tools frosted" aria-label="Map tools" role="group">
        <button type="button" className="delta-tool" aria-label="Locate western delta" title="Locate western delta" onClick={() => focusScience(westernDelta)}>◇</button>
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.4)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.4)}>−</button>
        <button type="button" aria-label="Reset map view" onClick={() => moveCamera(HOME_VIEW)}>↺</button>
      </div>
      <footer className="survey-credit"><span>↑ N · Western Jezero</span><span>MRO CTX / USGS{view.zoom >= 2 && detail ? ' · HiRISE' : ''}</span></footer>
    </section>
  )
}
