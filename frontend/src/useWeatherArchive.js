import { useEffect, useState } from 'react'

const weatherUrl = `${import.meta.env.BASE_URL}data/map/MEDA/jezero-weather.json`

export function useWeatherArchive(enabled) {
  const [archive, setArchive] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!enabled || archive) return
    const controller = new AbortController()
    const { signal } = controller

    async function load() {
      const response = await fetch(weatherUrl, { signal })
      if (!response.ok) throw new Error('Weather archive unavailable')
      const data = await response.json()
      if (!signal.aborted) {
        setArchive(data)
        setError(false)
      }
    }

    load().catch(() => {
      if (!signal.aborted) setError(true)
    })
    return () => controller.abort()
  }, [enabled, archive])

  return { archive, error }
}
