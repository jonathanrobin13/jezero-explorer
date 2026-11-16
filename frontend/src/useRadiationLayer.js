import { useEffect, useState } from 'react'

const url = `${import.meta.env.BASE_URL}data/map/MEDA/jezero-uv.json`

export function useRadiationLayer(enabled) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState(null)

  useEffect(() => {
    if (!enabled || data) return
    const controller = new AbortController()

    async function load() {
      setError('')
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error('Could not load the solar UV observations.')
      const dataset = await response.json()
      if (!dataset.samples.length) throw new Error('No solar UV observations were found.')
      if (!controller.signal.aborted) setData(dataset)
    }

    load().catch(() => {
      if (!controller.signal.aborted) setError('Could not load the solar UV observations.')
    })
    return () => controller.abort()
  }, [enabled, data])

  const samples = data?.samples ?? []
  const highest = samples.reduce((peak, point) => (
    !peak || point.wattsPerSquareMeter > peak.wattsPerSquareMeter ? point : peak
  ), null)
  const max = highest ? Math.ceil(highest.wattsPerSquareMeter * 20) / 20 : 1
  return { data, sample: selection ?? highest, samples, max, setSelection, error }
}
