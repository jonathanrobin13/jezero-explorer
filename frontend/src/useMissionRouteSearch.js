import { useEffect, useState } from 'react'

export function useMissionRouteSearch(request) {
  const [result, setResult] = useState(null)
  useEffect(() => {
    if (!request || request.error) return
    const worker = new Worker(new URL('./map_calculations/pathfinding.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => setResult({ request, ...data })
    worker.onerror = () => setResult({ request, error: 'Route calculation failed.' })
    worker.postMessage({ ...request, id: 1 })
    return () => worker.terminate()
  }, [request])

  if (!request) return {}
  if (request.error) return { error: request.error }
  if (result?.request !== request) return { busy: true }
  return {
    routes: result.routes,
    error: result.error || (!result.routes?.length ? 'No route through the available elevation cells.' : ''),
  }
}
