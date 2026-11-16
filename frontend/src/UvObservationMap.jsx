import { useEffect, useState } from 'react'
import { loadCraterElevations } from './map_calculations/craterTerrain.js'
import { highestTerrainElevation } from './map_calculations/solarUv.js'
import { REFERENCE_UV_OPTICAL_DEPTH, simulatedUvIndex } from './map_calculations/uvIndex.js'
import { uvAtPoint, UV_SEARCH_RADIUS_METERS } from './map_calculations/uvSiteEstimate.js'

const dataUrl = `${import.meta.env.BASE_URL}data/map/`
const searchRadiusKm = UV_SEARCH_RADIUS_METERS / 1000

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Could not load ${url.pathname.split('/').at(-1)}.`)
  return response.json()
}

function pointStyle(point, bounds) {
  return {
    left: `${100 * (point.longitude - bounds.west) / (bounds.east - bounds.west)}%`,
    top: `${100 * (bounds.north - point.latitude) / (bounds.north - bounds.south)}%`,
  }
}

function formatDistance(distance) {
  if (distance < 1000) return `${Math.round(distance)} m`
  return `${(distance / 1000).toFixed(1)} km`
}

function SiteResult({ point, result }) {
  if (!result) return <p>Click the map or a rover stop to see UV at that location.</p>

  return (
    <div className="space-y-2">
      <p className="font-mono text-xs text-telemetry">
        {point.latitude.toFixed(4)}° N, {point.longitude.toFixed(4)}° E
      </p>
      {result.kind === 'insufficient' ? (
        <>
          <p className="font-semibold">Insufficient nearby measurements</p>
          <p className="text-sm text-slate-300">
            An estimate needs two rover stops within {searchRadiusKm} km.
            {result.nearest && ` The closest stop is ${formatDistance(result.nearest.distance)} away.`}
          </p>
        </>
      ) : (
        <>
          <p className="font-semibold">
            {result.kind === 'observed' ? 'Measured average at rover stop' : 'Estimated UV'}
          </p>
      <p className="font-mono text-2xl font-semibold tabular-nums text-cyan-200">
            {result.wattsPerSquareMeter.toPrecision(3)} W/m²
          </p>
          <ul className="space-y-1 text-sm text-slate-300">
            {result.sites.map((site) => (
              <li key={site.id} className="rounded-sm border border-line bg-basalt p-2">
                {site.latitude.toFixed(4)}° N, {site.longitude.toFixed(4)}° E · {formatDistance(site.distance)}
                {' · '}{site.meanWm2.toPrecision(3)} W/m² ({site.count.toLocaleString()} readings)
                <span className="mt-1 block font-mono text-xs text-telemetry">
                  {site.utcStart.slice(0, 10)} · {site.utcStart.slice(11, 16)} UTC through {site.utcEnd.slice(0, 10)} · {site.utcEnd.slice(11, 16)} UTC (approx.)
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function UvIndexResult({ point, terrain, error, grid }) {
  const index = terrain ? simulatedUvIndex(point, grid, terrain.elevations, terrain.highest) : null

  return (
    <div className="border-t border-slate-700 pt-3">
      <h3 className="font-semibold">Simulated UV Index</h3>
      {error ? <p className="text-sm text-slate-300">{error}</p>
        : !terrain ? <p className="text-sm text-slate-300">Loading terrain for the simulation…</p>
          : index === null ? <p className="text-sm text-slate-300">Insufficient terrain data at this spot.</p>
            : <p className="text-3xl font-semibold tabular-nums text-amber-200">{index.toFixed(1)}</p>}
      <p className="mt-1 text-sm text-slate-300">
        Direct sunlight on level ground at about 08:15 Mars solar time. The model uses an assumed
        UV optical depth of {REFERENCE_UV_OPTICAL_DEPTH} and excludes UV scattered into shadows.
      </p>
    </div>
  )
}

export default function UvObservationMap({ selected, setSelected, renderWeatherPanel }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [terrain, setTerrain] = useState(null)
  const [terrainError, setTerrainError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    const base = new URL(dataUrl, document.baseURI)
    const terrainUrl = new URL('CTX/jezero-crater.json', base)
    Promise.all([
      fetchJson(terrainUrl, controller.signal),
      fetchJson(new URL('MEDA/jezero-uv-sites.json', base), controller.signal),
    ]).then(([grid, observations]) => {
      if (!controller.signal.aborted) {
        setData({ grid, observations, terrainUrl, image: new URL(grid.image, terrainUrl).href })
      }
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(failure.message)
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!data) return
    const controller = new AbortController()
    loadCraterElevations(data.grid, data.terrainUrl, controller.signal)
      .then((elevations) => {
        if (!controller.signal.aborted) setTerrain({ elevations, highest: highestTerrainElevation(elevations) })
      })
      .catch(() => {
        if (!controller.signal.aborted) setTerrainError('Could not load terrain for the UV Index.')
      })
    return () => controller.abort()
  }, [data])

  if (error) return <p role="alert">{error}</p>
  if (!data) return <p role="status">Loading Jezero UV observations…</p>

  const { grid, observations, image } = data
  const { bounds } = grid
  const result = selected && uvAtPoint(selected, observations.sites)

  function selectPoint(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    setSelected({
      longitude: bounds.west + x * (bounds.east - bounds.west),
      latitude: bounds.north - y * (bounds.north - bounds.south),
    })
  }

  return (
    <section aria-labelledby="uv-heading" className="console-layout">
      <figure className="console-panel overflow-hidden">
        <figcaption className="border-b border-line px-4 py-3 sm:px-5">
          <p className="console-label text-cyan-200">Perseverance MEDA</p>
          <h2 id="uv-heading" className="mt-1 text-xl font-semibold tracking-tight">Crater UV survey</h2>
        </figcaption>
        <div
          className="survey-map cursor-crosshair"
          style={{ aspectRatio: `${grid.width} / ${grid.height}` }}
          onClick={selectPoint}
        >
          <img src={image} alt="CTX shaded relief of Jezero Crater and its surroundings" className="pointer-events-none h-full w-full" />
          {observations.sites.map((site) => (
            <button
              key={site.id}
              type="button"
              aria-label={`Rover stop at ${site.latitude.toFixed(4)}° N, ${site.longitude.toFixed(4)}° E`}
              className="absolute size-5 -translate-1/2 rounded-full border-4 border-transparent bg-cyan-200 bg-clip-content shadow-[inset_0_0_0_1px_#112028] hover:z-20 focus-visible:z-20"
              style={pointStyle(site, bounds)}
              onClick={(event) => {
                event.stopPropagation()
                setSelected(site)
              }}
            />
          ))}
          {selected && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_#0f172a]"
              style={pointStyle(selected, bounds)}
            />
          )}
        </div>
        <p className="border-t border-line px-4 py-3 text-xs text-telemetry sm:px-5">
          <span aria-hidden="true" className="mr-1 inline-block size-2 rounded-full bg-cyan-300" />
          {observations.sites.length} Perseverance measurement sites
        </p>
      </figure>
      <div className="space-y-4">
        <details open className="console-panel disclosure-panel">
          <summary className="console-summary">Solar UV at a location</summary>
          <div className="space-y-4 border-t border-line p-4 text-sm" aria-live="polite">
            <div>
              <h3 className="mb-2 font-semibold">Historical rover UV</h3>
              <SiteResult point={selected} result={result} />
            </div>
            {selected && <UvIndexResult point={selected} terrain={terrain} error={terrainError} grid={grid} />}
            <p className="text-telemetry">
              Estimates average up to three rover stops within {searchRadiusKm} km, with more weight given
              to closer stops. The site averages use MEDA detector readings from 250–400 nm at similar Sun angles.
              Dust and other conditions can vary between measurements.
            </p>
            <a href={observations.source.url} target="_blank" rel="noreferrer" className="console-link text-cyan-200">
              NASA PDS · Perseverance MEDA ↗
            </a>
          </div>
        </details>
        {renderWeatherPanel(selected, terrain && { grid, elevations: terrain.elevations }, !terrain && !terrainError)}
      </div>
    </section>
  )
}
