import { useEffect, useMemo, useRef, useState } from 'react'
import { TextureLoader } from 'three'
import { createMissionWorld } from './map_calculations/missionWorld.js'
import { startMissionScene } from './missionSimulation.js'
import './MissionView.css'

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
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

function MissionPlot({ world, image, landing, player, destination, onSelect, planning }) {
  const extent = planning ? world.real : world.play
  const width = extent.xMax - extent.xMin
  const height = extent.zMax - extent.zMin
  const selected = planning ? landing : destination
  const position = (point) => ({
    left: `${100 * (point.x - extent.xMin) / width}%`,
    top: `${100 * (point.z - extent.zMin) / height}%`,
  })
  const northwest = world.groundPosition(0, 0)
  const southeast = world.groundPosition(1, 1)
  const worldImage = {
    ...position(northwest),
    width: `${100 * (southeast.x - northwest.x) / width}%`,
    height: `${100 * (southeast.z - northwest.z) / height}%`,
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
      <img alt="" src={image} className="mission-plot-photo" style={worldImage} draggable={false} />
      <span className="mission-plot-label">↑ N / CTX COVERAGE</span>
      {landing && (
        <>
          <span className="mission-plot-marker is-landing" style={position(landing)} />
          {planning && <span className="mission-marker-label" style={position(landing)}>TOUCHDOWN</span>}
        </>
      )}
      {player && <span className="mission-plot-marker is-player" style={position(player)} />}
      {destination && <span className="mission-plot-marker is-target" style={position(destination)} />}
    </button>
  )
}

function Visor({ telemetry, mode, target }) {
  if (!telemetry) return null
  const { heading, grade, elevation, source, speed, atLimit } = telemetry
  const compass = directions[Math.round(heading / 45) % directions.length]
  const measured = source === 'ctx'
  const dx = target ? target.x - telemetry.x : 0
  const dz = target ? target.z - telemetry.z : 0
  const distance = Math.hypot(dx, dz)
  const bearing = Math.atan2(dx, -dz) * 180 / Math.PI - heading
  const targetDistance = distance < 1000 ? `${number.format(distance)} m` : `${(distance / 1000).toFixed(2)} km`

  return (
    <div className="mission-visor">
      <div className="mission-hud">
        <div className={`mission-panel${measured ? '' : ' is-generated'}`}>
          <small>Surface source</small>
          <strong>{measured ? 'CTX elevation model' : source === 'gap' ? 'CTX data gap' : 'Generated terrain'}</strong>
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
          {atLimit && <small>Exploration limit</small>}
        </div>
      </div>
      <div className="mission-compass">{compass} {String(Math.round(heading) % 360).padStart(3, '0')}°</div>
      <div className="mission-reticle" aria-hidden="true">+</div>
      {target && (
        <div className="mission-direction">
          {distance <= 18 ? 'Waypoint reached' : (
            <><span aria-hidden="true" style={{ rotate: `${bearing}deg` }}>↑</span>{targetDistance} to waypoint</>
          )}
        </div>
      )}
      {mode === 'buggy' && <div className="mission-dash" aria-hidden="true" />}
    </div>
  )
}

function MissionRun({ world, image, landing, onRestart }) {
  const canvasRef = useRef(null)
  const sceneRef = useRef(null)
  const [phase, setPhase] = useState('loading')
  const [error, setError] = useState('')
  const [telemetry, setTelemetry] = useState(null)
  const [mode, setMode] = useState('walk')
  const [target, setTarget] = useState(null)
  const [showNavigator, setShowNavigator] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let canceled = false
    let texture
    async function begin() {
      texture = await new TextureLoader().loadAsync(image).catch(() => null)
      if (canceled) {
        texture?.dispose()
        return
      }
      sceneRef.current = startMissionScene({
        canvas: canvasRef.current, world, texture, landing,
        onPhase: setPhase, onTelemetry: setTelemetry, onError: setError,
      })
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) sceneRef.current.skip()
    }
    begin().catch((reason) => {
      if (!canceled) setError(reason.message || 'Could not start the mission.')
    })
    return () => {
      canceled = true
      sceneRef.current?.dispose()
      sceneRef.current = null
      texture?.dispose()
    }
  }, [world, image, landing])

  function chooseTarget(point) {
    if (point && world.heightAt(point.x, point.z) === null) {
      setMessage('Choose a waypoint outside the data gap.')
      return
    }
    setMessage('')
    setTarget(point)
    sceneRef.current?.setDestination(point)
  }

  function chooseMode(value) {
    setMode(value)
    sceneRef.current?.setMode(value)
  }

  function press(event, control) {
    event.currentTarget.setPointerCapture(event.pointerId)
    sceneRef.current?.setControl(control, true)
  }

  function release(control) {
    sceneRef.current?.setControl(control, false)
  }

  const exploring = phase === 'eva' && !error
  return (
    <>
      <div className="mission-viewport">
        <canvas
          ref={canvasRef}
          tabIndex={exploring ? 0 : -1}
          className={`mission-canvas${exploring ? ' is-eva' : ''}`}
          aria-label="Astronaut visor. Move with W A S D and look using arrow keys or by dragging."
        />
        {exploring && <Visor telemetry={telemetry} mode={mode} target={target} />}
        {phase !== 'eva' && !error && (
          <div className="mission-cinematic">
            <strong role="status">
              {phase === 'loading' ? 'Loading terrain…' : phase === 'landing' ? 'Powered descent' : 'Touchdown · crew egress'}
            </strong>
            {phase !== 'loading' && (
              <button type="button" className="mission-button" onClick={() => sceneRef.current?.skip()}>Skip to visor</button>
            )}
          </div>
        )}
      </div>
      <div className="mission-console">
        {error && <p role="alert" className="mission-message">{error}</p>}
        {exploring ? (
          <>
            <div className="mission-toolbar" role="group" aria-label="Surface mission controls">
              <button type="button" className="mission-button" aria-pressed={mode === 'walk'} onClick={() => chooseMode('walk')}>Walk</button>
              <button type="button" className="mission-button" aria-pressed={mode === 'buggy'} onClick={() => chooseMode('buggy')}>Drive buggy</button>
              <button
                type="button"
                className="mission-button"
                aria-expanded={showNavigator}
                onClick={() => {
                  setShowNavigator(!showNavigator)
                  if (showNavigator) canvasRef.current?.focus({ preventScroll: true })
                }}
              >
                Navigation map
              </button>
              <button type="button" className="mission-button" onClick={onRestart}>New landing</button>
            </div>
            <p>{mode === 'walk' ? 'WASD to walk.' : 'W/S to drive. A/D to steer.'} Drag the visor or use the arrow keys to look. The cyan line marks the edge of CTX coverage.</p>
            <div className="mission-controls" aria-label="On-screen movement" role="group">
              {movement.map(([key, character, label]) => (
                <button
                  key={key}
                  type="button"
                  className="mission-button"
                  aria-label={mode === 'buggy' && (key === 'left' || key === 'right') ? `Steer ${key}` : label}
                  onPointerDown={(event) => press(event, key)}
                  onPointerUp={() => release(key)}
                  onPointerCancel={() => release(key)}
                  onLostPointerCapture={() => release(key)}
                  onKeyDown={(event) => {
                    if (event.key === ' ' || event.key === 'Enter') {
                      event.preventDefault()
                      sceneRef.current?.setControl(key, true)
                    }
                  }}
                  onKeyUp={(event) => {
                    if (event.key === ' ' || event.key === 'Enter') release(key)
                  }}
                  onBlur={() => release(key)}
                >{character}</button>
              ))}
            </div>
            {showNavigator && (
              <div className="mission-navigator">
                <p>Choose a waypoint on the map. Follow the arrow in the visor or look for the cyan beacon.</p>
                <MissionPlot world={world} image={image} landing={landing} player={telemetry} destination={target} onSelect={chooseTarget} />
                <p>{target ? `Waypoint · ${coordinatesText(world, target)}` : 'Solid dot: current position · Gold: landing site · Hatched area: generated terrain'}</p>
                {target && <button type="button" className="mission-button justify-self-start" onClick={() => chooseTarget(null)}>Clear waypoint</button>}
                {message && <p className="mission-message" role="status">{message}</p>}
              </div>
            )}
          </>
        ) : (
          <button type="button" className="mission-button" onClick={onRestart}>Back to landing map</button>
        )}
      </div>
    </>
  )
}

export default function MissionView({ terrain, loadError, bounds, image }) {
  const [site, setSite] = useState(null)
  const [landing, setLanding] = useState(null)
  const [message, setMessage] = useState('')

  const { world, failure } = useMemo(() => {
    if (!terrain) return {}
    try {
      return { world: createMissionWorld(terrain, bounds) }
    } catch (error) {
      return { failure: error.message }
    }
  }, [terrain, bounds])

  useEffect(() => () => {
    world?.realGeometry.dispose()
    world?.exterior.dispose()
  }, [world])

  function chooseSite(point) {
    if (world.telemetry(point.x, point.z).source !== 'ctx') {
      setMessage('Choose a site inside the CTX boundary with elevation coverage.')
      return
    }
    setMessage('')
    setSite(point)
  }

  const siteData = site && world?.telemetry(site.x, site.z)
  return (
    <section className="mission" aria-labelledby="mission-heading">
      <header className="mission-header">
        <div>
          <h2 id="mission-heading">Jezero Astronaut Mission</h2>
          <p>Western Jezero Crater · Mars surface simulation</p>
        </div>
      </header>
      {loadError || failure ? (
        <p role="alert" className="mission-console">{loadError || failure}</p>
      ) : world ? landing ? (
        <MissionRun world={world} image={image} landing={landing} onRestart={() => setLanding(null)} />
      ) : (
        <div className="mission-briefing">
          <MissionPlot world={world} image={image} landing={site} planning onSelect={chooseSite} />
          <aside>
            <h3>Choose a landing site</h3>
            <p>Mark a touchdown point on the CTX image. After egress you can explore on foot or drive a buggy.</p>
            {siteData && (
              <dl className="mission-site-info" aria-live="polite">
                <dt>Coordinates</dt><dd>{coordinatesText(world, site)}</dd>
                <dt>Elevation</dt><dd>{number.format(siteData.elevation)} m</dd>
                <dt>Terrain difficulty</dt><dd>{difficulty(siteData.grade)}</dd>
              </dl>
            )}
            <button type="button" className="mission-button mission-primary" disabled={!site} onClick={() => setLanding(site)}>Begin descent</button>
            {message && <p className="mission-message" role="status">{message}</p>}
          </aside>
        </div>
      ) : (
        <p role="status" className="mission-console">Preparing CTX terrain…</p>
      )}
      <footer className="mission-console">
        CTX terrain from Mars Reconnaissance Orbiter. Grade is estimated on the display mesh. Travel speeds, rocks, and terrain beyond the cyan boundary are simulated.
      </footer>
    </section>
  )
}
