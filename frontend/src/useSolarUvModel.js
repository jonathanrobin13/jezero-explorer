import { useEffect, useState } from 'react'
import { loadCraterElevations } from './map_calculations/craterTerrain.js'

const terrainUrl = `${import.meta.env.BASE_URL}data/map/CTX/jezero-crater.json`

async function fetchTerrainFile(url, signal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('Could not load the CTX crater terrain.')
  return response
}

export function useSolarUvModel(enabled, utc) {
  const [terrain, setTerrain] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!enabled || terrain) return
    const controller = new AbortController()
    const url = new URL(terrainUrl, document.baseURI)

    async function loadTerrain() {
      setLoadError(null)
      const grid = await (await fetchTerrainFile(url, controller.signal)).json()
      const samples = await loadCraterElevations(grid, url, controller.signal)
      if (!controller.signal.aborted) setTerrain({ grid, samples })
    }

    loadTerrain().catch((error) => {
      if (!controller.signal.aborted) setLoadError(error.message)
    })
    return () => controller.abort()
  }, [enabled, terrain])

  useEffect(() => {
    if (!enabled || !terrain || !utc) return
    let worker
    function showWorkerError() {
      setResult({ utc, error: 'The UV model could not finish.' })
    }
    try {
      worker = new Worker(new URL('./map_calculations/solarUvWorker.js', import.meta.url), { type: 'module' })
      worker.onmessage = ({ data }) => setResult({ ...data, utc })
      worker.onerror = showWorkerError
      worker.postMessage({ grid: terrain.grid, samples: terrain.samples, utc })
    } catch {
      showWorkerError()
    }
    return () => {
      if (!worker) return
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }
  }, [enabled, terrain, utc])

  const observation = result?.utc === utc ? result : null
  return {
    grid: terrain?.grid,
    exposure: observation?.exposure,
    error: loadError ?? observation?.error,
  }
}
