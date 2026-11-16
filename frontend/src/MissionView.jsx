import { useEffect, useMemo, useRef, useState } from 'react'
import { CanvasTexture, ImageLoader, TextureLoader } from 'three'
import { loadCraterElevations } from './map_calculations/craterTerrain.js'
import { createMissionWorld } from './map_calculations/missionWorld.js'
import { startMissionScene } from './missionSimulation.js'
import { useSolarUvModel } from './useSolarUvModel.js'
import { distanceAlong, prepareRoute, routeCoordinates, formatDistance } from './map_calculations/missionRoutes.js'
import { EnvironmentPanel, RouteOptions } from './MissionNavigation.jsx'
import { useMissionRouteSearch } from './useMissionRouteSearch.js'
import './MissionView.css'

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const NO_SCIENCE_FEATURES = []
const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const mapKeys = new Map([
  ['ArrowLeft', [-1, 0]], ['ArrowRight', [1, 0]],
  ['ArrowUp', [0, -1]], ['ArrowDown', [0, 1]],
])
const movement = [
  ['left', '←', 'Move left'], ['forward', '↑', 'Move forward'],
  ['back', '↓', 'Move back'], ['right', '→', 'Move right'],
  ['turnLeft', '↶', 'Look left'], ['turnRight', '↷', 'Look right'],
]
const phaseLabel = {
  loading: 'Preparing flight systems',
  landing: 'Powered descent',
  touchdown: 'Touchdown · engines safing',
  egress: 'Airlock open · crew egress',
  eva: 'Surface operations',
}

async function loadMissionTexture(image, bounds, detail) {
  const loader = new TextureLoader()
  if (!detail) return loader.loadAsync(image)
  const images = new ImageLoader()
  try {
    const [base, closeup] = await Promise.all([
      images.loadAsync(image),
      images.loadAsync(new URL('jezero-western-delta-mission.webp', detail.src).href),
    ])
    const canvas = document.createElement('canvas')
    canvas.width = 4096
    canvas.height = Math.round(canvas.width * base.height / base.width)
    const context = canvas.getContext('2d')
    context.drawImage(base, 0, 0, canvas.width, canvas.height)
    const { west, east, north, south } = detail.bounds
    const scaleX = canvas.width / (bounds.east - bounds.west)
    const scaleY = canvas.height / (bounds.north - bounds.south)
    context.globalAlpha = 0.72
    context.drawImage(closeup, (west - bounds.west) * scaleX, (bounds.north - north) * scaleY,
      (east - west) * scaleX, (north - south) * scaleY)
    return new CanvasTexture(canvas)
  } catch {
    return loader.loadAsync(image)
  }
}

function difficulty(grade) {
  if (grade === null) return 'Unavailable'
  if (grade < 8) return 'Easy'
  if (grade < 18) return 'Moderate'
  return 'Steep'
}

function coordinatesText(world, point) {
  const { latitude, longitude } = world.coordinates(point.x, point.z)
  return `${latitude.toFixed(5)}° N · ${longitude.toFixed(5)}° E`
}

function MissionPlot({ world, image, regional, bounds, landing, player, destination, onSelect, planning, weatherPoint, scienceFeatures = [], landmarks = [] }) {
  const extent = planning ? world.real : world.play
  const width = extent.xMax - extent.xMin
  const height = extent.zMax - extent.zMin
  const selected = planning ? landing : destination
  const weatherMarker = weatherPoint && pointAtCoordinates(world, bounds, weatherPoint.latitude, weatherPoint.longitude)
  const scienceMarkers = scienceFeatures.flatMap((feature) => {
    const point = pointAtCoordinates(world, bounds, feature.latitude, feature.longitude)
    const visible = point.x >= extent.xMin && point.x <= extent.xMax && point.z >= extent.zMin && point.z <= extent.zMax
    return visible ? [{ feature, point }] : []
  })
  const visibleLandmarks = landmarks.flatMap((landmark) => {
    const point = pointAtCoordinates(world, bounds, landmark.latitude, landmark.longitude)
    const visible = point.x >= extent.xMin && point.x <= extent.xMax && point.z >= extent.zMin && point.z <= extent.zMax
    return visible ? [{ landmark, point }] : []
  })
  const position = (point) => ({
    left: `${100 * (point.x - extent.xMin) / width}%`,
    top: `${100 * (point.z - extent.zMin) / height}%`,
  })
  function imageStyle(imageBounds) {
    const northwest = pointAtCoordinates(world, bounds, imageBounds.north, imageBounds.west)
    const southeast = pointAtCoordinates(world, bounds, imageBounds.south, imageBounds.east)
    return {
      ...position(northwest),
      width: `${100 * (southeast.x - northwest.x) / width}%`,
      height: `${100 * (southeast.z - northwest.z) / height}%`,
    }
  }

  function pointAt(event) {
    if (event.detail === 0) {
      onSelect(selected ?? player ?? { x: 0, z: 0 })
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    onSelect({
      x: extent.xMin + width * clamp((event.clientX - rect.left) / rect.width, 0, 1),
      z: extent.zMin + height * clamp((event.clientY - rect.top) / rect.height, 0, 1),
    })
  }

  function moveMarker(event) {
    const change = mapKeys.get(event.key)
    if (!change) return
    event.preventDefault()
    const point = selected ?? player ?? { x: 0, z: 0 }
    onSelect({
      x: clamp(point.x + width * change[0] / 60, extent.xMin, extent.xMax),
      z: clamp(point.z + height * change[1] / 60, extent.zMin, extent.zMax),
    })
  }

  return (
    <button
      type="button"
      className="mission-plot"
      style={{ aspectRatio: width / height }}
      aria-label={planning ? 'Landing site map. Click or use arrow keys to choose a site.' : 'Destination map. Click or use arrow keys to set a waypoint.'}
      onClick={pointAt}
      onKeyDown={moveMarker}
    >
      {!planning && regional && <img alt="" src={regional.image} className="mission-plot-regional" style={imageStyle(regional.grid.bounds)} draggable={false} />}
      <img alt="" src={image} className="mission-plot-photo" style={imageStyle(bounds)} draggable={false} />
      <span className="mission-plot-label">↑ N · WESTERN CTX</span>
      {visibleLandmarks.map(({ landmark, point }) => (
        <span key={landmark.id} className="mission-place-label" style={position(point)} title={`${landmark.name} · ${landmark.type}`}>
          <strong>{landmark.name}</strong><small>{landmark.type}</small>
        </span>
      ))}
      {scienceMarkers.map(({ feature, point }) => (
        <span
          key={feature.id}
          aria-hidden="true"
          title={`${feature.title}\nKey point: ${feature.keyPoint}\nWhy it matters: ${feature.whyItMatters}`}
          className={`mission-science-marker ${feature.kind === 'water' ? 'is-water' : 'is-mineral'}`}
          style={position(point)}
        >{feature.kind === 'water' ? '≈' : '◆'}</span>
      ))}
      {landing && (
        <>
          <span className="mission-plot-marker is-landing" style={position(landing)} />
          {planning && <span className="mission-marker-label" style={position(landing)}>TOUCHDOWN</span>}
        </>
      )}
      {player && <span className="mission-plot-marker is-player" style={position(player)} />}
      {destination && <span className="mission-plot-marker is-target" style={position(destination)} />}
      {weatherMarker && <span className="mission-plot-marker is-weather" style={position(weatherMarker)} />}
    </button>
  )
}

function pointAtCoordinates(world, bounds, latitude, longitude) {
  return world.groundPosition((longitude - bounds.west) / (bounds.east - bounds.west),
    (bounds.north - latitude) / (bounds.north - bounds.south))
}

function Visor({ telemetry, mode, target, returning }) {
  if (!telemetry) return null
  const { heading, grade, elevation, source, speed, atLimit, distanceFromLander } = telemetry
  const compass = directions[Math.round(heading / 45) % directions.length]
  const measured = source === 'ctx' || source === 'regional'
  const dx = target ? target.x - telemetry.x : 0
  const dz = target ? target.z - telemetry.z : 0
  const distance = Math.hypot(dx, dz)
  const bearing = ((Math.atan2(dx, -dz) * 180 / Math.PI) + 360) % 360
  const headingText = String(Math.round(heading) % 360).padStart(3, '0')
  const bearingText = String(Math.round(bearing) % 360).padStart(3, '0')
  const targetDistance = distance < 1000 ? `${number.format(distance)} m` : `${(distance / 1000).toFixed(2)} km`

  return (
    <div className="mission-visor">
      <div className="mission-hud">
        <div className={`mission-panel${measured ? '' : ' is-generated'}`}>
          <small>Surface source</small>
          <strong>{source === 'ctx' ? 'Western CTX' : source === 'regional' ? 'Regional CTX mesh' : source === 'gap' ? 'CTX data gap' : 'Generated terrain'}</strong>
        </div>
        <div className="mission-panel">
          <small>Elevation</small>
          <strong>{elevation === null ? 'Unavailable' : `${number.format(elevation)} m`}</strong>
        </div>
        <div className="mission-panel">
          <small>Terrain difficulty</small>
          <strong>{difficulty(grade)}</strong>
          {grade !== null && <small>{grade.toFixed(1)}% estimated grade</small>}
        </div>
        <div className="mission-panel">
          <small>{mode === 'walk' ? 'On foot' : 'Buggy'}</small>
          <strong>{number.format(speed)} m/s</strong>
          <small>{number.format(distanceFromLander)} m from lander</small>
          {atLimit && <small>Exploration limit</small>}
        </div>
      </div>
      <div className="mission-compass"><small>Heading</small> {headingText}° {compass}</div>
      <div className="mission-reticle" aria-hidden="true">+</div>
      {target && (
        <div className="mission-direction">
          {distance <= (returning ? 5 : 18) ? (returning ? 'Lander reached' : 'Waypoint reached') : (
            <>
              <span aria-hidden="true" style={{ rotate: `${bearing - heading}deg` }}>↑</span>
              <strong>{targetDistance}</strong> {returning ? 'to lander' : 'to waypoint'}
              <small className="block">Bearing {bearingText}°</small>
            </>
          )}
        </div>
      )}
      {mode === 'buggy' && <div className="mission-dash" aria-hidden="true" />}
    </div>
  )
}

function MissionRun({ world, bounds, image, detail, regional, terrain, landing, initialTarget, playIntro, onRestart, scienceFeatures, landmarks, radiation, weather }) {
  const canvasRef = useRef(null)
  const shellRef = useRef(null)
  const sceneRef = useRef(null)
  const pickRef = useRef(null)
  const journeyRef = useRef(null)
  const [phase, setPhase] = useState('loading')
  const [error, setError] = useState('')
  const [telemetry, setTelemetry] = useState(null)
  const [mode, setMode] = useState('walk')
  const [target, setTarget] = useState(initialTarget)
  const [planning, setPlanning] = useState(false)
  const [start, setStart] = useState(null)
  const [finish, setFinish] = useState(null)
  const [picking, setPicking] = useState('start')
  const [option, setOption] = useState(0)
  const [journey, setJourney] = useState(null)
  const [notice, setNotice] = useState('')
  const [showMarkers, setShowMarkers] = useState(true)
  const [modelEnabled, setModelEnabled] = useState(false)
  const model = useSolarUvModel(modelEnabled, radiation?.sample?.utc)
  const exploring = phase === 'eva' && !error

  const request = useMemo(() => {
    if (!planning || !start || !finish) return null
    const { play } = world
    const northwest = world.coordinates(play.xMin, play.zMin)
    const southeast = world.coordinates(play.xMax, play.zMax)
    const coverage = { west: northwest.longitude, north: northwest.latitude, east: southeast.longitude, south: southeast.latitude }
    return prepareRoute(terrain, regional, world.coordinates(start.x, start.z), world.coordinates(finish.x, finish.z), coverage)
  }, [planning, terrain, regional, world, start, finish])
  const { routes, busy, error: routeError } = useMissionRouteSearch(request)
  const candidate = routes?.[option]
  const candidatePoints = useMemo(() => candidate
    ? candidate.cells.map(cell => {
      const point = routeCoordinates(request.grid, cell)
      return pointAtCoordinates(world, bounds, point.latitude, point.longitude)
    })
    : null, [candidate, request, world, bounds])

  useEffect(() => {
    if (!exploring) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [exploring])

  useEffect(() => {
    let canceled = false
    let texture
    async function begin() {
      texture = await loadMissionTexture(image, bounds, detail).catch(() => null)
      if (canceled) {
        texture?.dispose()
        return
      }
      sceneRef.current = startMissionScene({
        canvas: canvasRef.current, world, texture, landing, bounds, scienceFeatures, landmarks,
        onPhase: setPhase, onMapPick: point => pickRef.current?.(point), onError: setError,
        onTelemetry: data => {
          setTelemetry(data)
          const active = journeyRef.current
          if (!active || Math.hypot(active.goal.x - data.x, active.goal.z - data.z) > 12) return
          journeyRef.current = null
          setJourney(null)
          setTarget(null)
          setNotice('Destination reached')
          sceneRef.current?.setRoute(null)
          sceneRef.current?.setDestination(null)
        },
      })
      sceneRef.current.setDestination(initialTarget)
      if (!playIntro) sceneRef.current.skip()
    }
    begin().catch(reason => {
      if (!canceled) setError(reason.message || 'Could not start the mission.')
    })
    return () => {
      canceled = true
      sceneRef.current?.dispose()
      sceneRef.current = null
      texture?.dispose()
    }
  }, [world, bounds, image, detail, landing, initialTarget, playIntro, scienceFeatures, landmarks])

  useEffect(() => {
    pickRef.current = (point) => {
      const source = world.telemetry(point.x, point.z).source
      if (source !== 'ctx' && source !== 'regional') {
        setNotice('Pick a point inside the CTX survey.')
        return
      }
      setNotice('')
      setOption(0)
      if (picking === 'start') {
        setStart(point)
        setPicking('finish')
      } else setFinish(point)
    }
  }, [picking, world])

  useEffect(() => {
    sceneRef.current?.setPlanningPoints(planning ? start : null, planning ? finish : null)
    sceneRef.current?.setRoute(planning ? candidatePoints : journey?.points)
    sceneRef.current?.setDestination(planning ? null : target)
  }, [planning, start, finish, candidatePoints, journey, target])

  function closePlanner() {
    setPlanning(false)
    setNotice('')
    sceneRef.current?.setPlanning(false)
  }

  function openPlanner() {
    if (planning) {
      closePlanner()
      return
    }
    setStart(null)
    setFinish(null)
    setOption(0)
    setPicking('start')
    setNotice('')
    setPlanning(true)
    sceneRef.current?.setPlanning(true)
  }

  function followRoute() {
    if (!candidatePoints?.length) return
    const goal = candidatePoints.at(-1)
    const next = { points: candidatePoints, goal }
    journeyRef.current = next
    setJourney(next)
    setTarget(goal)
    closePlanner()
  }

  function cancelJourney(message = 'Journey canceled') {
    journeyRef.current = null
    setJourney(null)
    setTarget(null)
    setNotice(message)
    canvasRef.current?.focus({ preventScroll: true })
  }

  function exitMission() {
    if (document.fullscreenElement === shellRef.current) document.exitFullscreen().catch(() => {})
    onRestart()
  }

  function toggleFullscreen() {
    if (document.fullscreenElement === shellRef.current) document.exitFullscreen().catch(() => {})
    else shellRef.current?.requestFullscreen?.().catch(() => setNotice('Browser fullscreen is unavailable.'))
  }

  function useCurrentPosition() {
    if (!telemetry) return
    if (telemetry.source !== 'ctx' && telemetry.source !== 'regional') {
      setNotice('Current position is outside the CTX survey.')
      return
    }
    setNotice('')
    setStart({ x: telemetry.x, z: telemetry.z })
    setOption(0)
    setPicking('finish')
  }

  const remaining = journey && telemetry ? distanceAlong(journey.points, telemetry) : null
  return (
    <div ref={shellRef} className={exploring ? 'mission-surface' : ''} onKeyDown={event => {
      if (event.key === 'Escape' && planning) closePlanner()
    }}>
      <div className="mission-viewport">
        <canvas
          ref={canvasRef}
          tabIndex={exploring ? 0 : -1}
          className={`mission-canvas${exploring ? ' is-eva' : ''}${planning ? ' is-planning' : ''}`}
          aria-label={planning ? 'Overhead terrain. Click the surface to place a route endpoint.' : 'Astronaut visor. Move with W A S D and look using arrow keys or by dragging.'}
        />
        {exploring && !planning && <Visor telemetry={telemetry} mode={mode} target={target} returning={target === landing} />}
        {phase !== 'eva' && !error && (
          <div className="mission-cinematic">
            <strong role="status">{phaseLabel[phase]}</strong>
            {phase !== 'loading' && <button type="button" className="mission-button" onClick={() => sceneRef.current?.skip()}>Skip to visor</button>}
          </div>
        )}
      </div>
      {exploring ? (
        <>
          {planning && (
            <aside className="mission-glass mission-route-planner" aria-label="Plan a traverse">
              <h3>Plan a traverse</h3>
              <p>Click the terrain to set {picking === 'start' ? 'your start' : 'the destination'}.</p>
              <div className="mission-plan-actions">
                <button type="button" className="mission-button" aria-pressed={picking === 'start'} onClick={() => setPicking('start')}>{start ? 'Change start' : 'Pick start'}</button>
                <button type="button" className="mission-button" aria-pressed={picking === 'finish'} onClick={() => setPicking('finish')}>{finish ? 'Change destination' : 'Pick destination'}</button>
                <button type="button" className="mission-button" onClick={useCurrentPosition}>Use my position</button>
              </div>
              <dl className="mission-readings mission-endpoints">
                <div><dt className="mission-start-label">Start</dt><dd>{start ? coordinatesText(world, start) : 'Select on terrain'}</dd></div>
                <div><dt className="mission-destination-label">Destination</dt><dd>{finish ? coordinatesText(world, finish) : 'Select on terrain'}</dd></div>
              </dl>
              {busy && <p role="status">Calculating route alternatives…</p>}
              {routeError && <p role="status">{routeError}</p>}
              <RouteOptions routes={routes} selected={option} onSelect={setOption} onConfirm={followRoute} />
            </aside>
          )}
          <aside className="mission-side-stack">
            <EnvironmentPanel layer={radiation} weather={weather} world={world} player={telemetry}
              route={planning ? candidatePoints : journey?.points} model={model}
              modelEnabled={modelEnabled} onToggleModel={setModelEnabled} />
            <details className="mission-glass mission-map-layers">
              <summary>Map labels &amp; water evidence</summary>
              <label className="mission-layer-toggle">
                <input type="checkbox" checked={showMarkers} onChange={event => {
                  setShowMarkers(event.target.checked)
                  sceneRef.current?.setScienceVisibility(event.target.checked)
                }} /> Show markers on terrain
              </label>
              <p className="mission-reference">≈ Ancient water features · ◆ Minerals</p>
              <ul>
                {[...landmarks, ...scienceFeatures].map(feature => (
                  <li key={feature.id}>
                    <button type="button" className="mission-map-feature" onClick={() => {
                      const point = pointAtCoordinates(world, bounds, feature.latitude, feature.longitude)
                      if (planning) pickRef.current?.(point)
                      else setNotice(feature.keyPoint || feature.type)
                    }}>{feature.kind === 'water' ? '≈ ' : feature.kind ? '◆ ' : ''}{feature.name ?? feature.title}</button>
                  </li>
                ))}
              </ul>
            </details>
          </aside>
          {notice && <p className="mission-journey-status mission-glass" role="status">{notice}</p>}
          <div className="mission-dock mission-glass" aria-label="Surface navigation controls">
            <button type="button" className="mission-button mission-primary" aria-pressed={planning} onClick={openPlanner}>{planning ? 'Return to visor' : 'Navigation system'}</button>
            {remaining !== null && <strong className="mission-distance">{formatDistance(remaining)} remaining on route</strong>}
            {!planning && (
              <>
                <button type="button" className="mission-button" aria-pressed={mode === 'walk'} onClick={() => { setMode('walk'); sceneRef.current?.setMode('walk') }}>Walk</button>
                <button type="button" className="mission-button" aria-pressed={mode === 'buggy'} onClick={() => { setMode('buggy'); sceneRef.current?.setMode('buggy') }}>Drive buggy</button>
                {(journey || target) && <button type="button" className="mission-button" onClick={() => cancelJourney()}>Cancel journey</button>}
              </>
            )}
            <button type="button" className="mission-button" onClick={toggleFullscreen}>Toggle fullscreen</button>
            <button type="button" className="mission-button" onClick={exitMission}>Exit mission</button>
            {!planning && (
              <div className="mission-surface-movement" aria-label="On-screen movement">
                {movement.map(([key, character, label]) => (
                  <button key={key} type="button" className="mission-button"
                    aria-label={mode === 'buggy' && (key === 'left' || key === 'right') ? `Steer ${key}` : label}
                    onPointerDown={event => {
                      event.currentTarget.setPointerCapture(event.pointerId)
                      sceneRef.current?.setControl(key, true)
                    }}
                    onPointerUp={() => sceneRef.current?.setControl(key, false)}
                    onPointerCancel={() => sceneRef.current?.setControl(key, false)}
                    onLostPointerCapture={() => sceneRef.current?.setControl(key, false)}
                    onKeyDown={event => {
                      if (event.key === ' ' || event.key === 'Enter') {
                        event.preventDefault()
                        sceneRef.current?.setControl(key, true)
                      }
                    }}
                    onKeyUp={() => sceneRef.current?.setControl(key, false)}
                    onBlur={() => sceneRef.current?.setControl(key, false)}
                  >{character}</button>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="mission-console">
          {error && <p role="alert" className="mission-message">{error}</p>}
          <button type="button" className="mission-button" onClick={exitMission}>Back to landing map</button>
        </div>
      )}
    </div>
  )
}

export default function MissionView({ terrain, loadError, bounds, image, detail, regionalUrl, weatherPoint, onWeatherPoint, renderWeatherPanel, geology, radiation, weather }) {
  const scienceFeatures = geology?.features ?? NO_SCIENCE_FEATURES
  const landmarks = geology?.landmarks ?? NO_SCIENCE_FEATURES
  const [site, setSite] = useState(null)
  const [landing, setLanding] = useState(null)
  const [message, setMessage] = useState('')
  const [example, setExample] = useState(null)
  const [regional, setRegional] = useState(undefined)
  const [playIntro, setPlayIntro] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    async function loadRegional() {
      const response = await fetch(regionalUrl, { signal })
      if (!response.ok) throw new Error('Could not prepare the regional terrain.')
      const grid = await response.json()
      const elevations = await loadCraterElevations(grid, regionalUrl, signal)
      if (!signal.aborted) setRegional({ grid, elevations, image: new URL(grid.image, regionalUrl).href })
    }
    loadRegional().catch(() => {
      if (!signal.aborted) setRegional(null)
    })
    return () => controller.abort()
  }, [regionalUrl])

  const { world, failure } = useMemo(() => {
    if (!terrain || regional === undefined) return {}
    try {
      return { world: createMissionWorld(terrain, bounds, regional) }
    } catch (error) {
      return { failure: error.message }
    }
  }, [terrain, bounds, regional])

  useEffect(() => () => {
    world?.realGeometry.dispose()
    world?.exterior.dispose()
  }, [world])

  function chooseSite(point) {
    onWeatherPoint(world.coordinates(point.x, point.z))
    if (world.telemetry(point.x, point.z).source !== 'ctx') {
      setMessage('Choose a site inside the CTX boundary with elevation coverage.')
      return
    }
    setMessage('')
    setSite(point)
    setExample(null)
  }

  function chooseExample() {
    const site = pointAtCoordinates(world, bounds, 18.4446, 77.4509)
    const observation = pointAtCoordinates(world, bounds, 18.473, 77.415)
    chooseSite(site)
    if (world.telemetry(site.x, site.z).source === 'ctx' && world.heightAt(observation.x, observation.z) !== null) setExample(observation)
  }

  function beginMission() {
    onWeatherPoint(world.coordinates(site.x, site.z))
    setLanding(site)
  }

  const siteData = site && world?.telemetry(site.x, site.z)
  const weatherPanel = world && renderWeatherPanel(weatherPoint, regional)
  return (
    <section className="mission" aria-labelledby="mission-heading">
      <header className="mission-header">
        <div>
          <p className="console-label text-cyan-200">Mars surface simulation</p>
          <h2 id="mission-heading">Astronaut mission</h2>
        </div>
      </header>
      {loadError || failure ? (
        <p role="alert" className="mission-console">{loadError || failure}</p>
      ) : world ? landing ? (
        <MissionRun world={world} bounds={bounds} image={image} detail={detail} regional={regional} terrain={terrain} scienceFeatures={scienceFeatures} landmarks={landmarks}
          landing={landing} initialTarget={example} playIntro={playIntro} onRestart={() => setLanding(null)}
          radiation={radiation} weather={weather} />
      ) : (
        <div className="mission-briefing">
          <div>
            <MissionPlot world={world} bounds={bounds} image={image} landing={site} destination={example} planning onSelect={chooseSite} weatherPoint={weatherPoint} scienceFeatures={scienceFeatures} landmarks={landmarks} />
            <div className="mt-3">{weatherPanel}</div>
          </div>
          <aside className="console-panel p-4">
            <h3>Choose a landing site</h3>
            <p>Pick a touchdown point on the orbital image to inspect its terrain and compare it with rover weather. After egress, explore on foot or drive a buggy.</p>
            <button type="button" className="mission-button mission-example" onClick={chooseExample}>Load western delta survey</button>
            {example && <p>Start near Perseverance’s landing site and navigate to a simulated viewpoint at the edge of the ancient delta.</p>}
            {siteData && (
              <dl className="mission-site-info" aria-live="polite">
                <dt>Coordinates</dt><dd>{coordinatesText(world, site)}</dd>
                <dt>Elevation</dt><dd>{number.format(siteData.elevation)} m</dd>
                <dt>Terrain difficulty</dt><dd>{difficulty(siteData.grade)}</dd>
              </dl>
            )}
            <label className="mission-motion">
              <input type="checkbox" checked={playIntro} onChange={event => setPlayIntro(event.target.checked)} />
              Play landing and egress animation
            </label>
            <button type="button" className="mission-button mission-primary" disabled={!site} onClick={beginMission}>
              {playIntro ? 'Begin descent' : 'Start surface mission'}
            </button>
            {message && <p className="mission-message" role="status">{message}</p>}
          </aside>
        </div>
      ) : (
        <p role="status" className="mission-console">Preparing CTX terrain…</p>
      )}
      <footer className="mission-console">
        Mission rehearsal. Terrain uses MRO CTX elevations with HiRISE detail over the western delta. Grade is estimated on the display mesh. Travel speeds, scenic rocks, and terrain outside CTX coverage are simulated.
      </footer>
    </section>
  )
}
