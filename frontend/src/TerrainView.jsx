import { useEffect, useRef, useState } from 'react'
import {
  AmbientLight,
  DirectionalLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createTerrainMesh, MESH_STEP, SOURCE_CELL_METERS } from './map_calculations/terrainMesh.js'

const DEFAULT_EXAGGERATION = 3
const ZOOM_STEP = 0.8
const BUTTON_STYLE = 'rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700'
const DEM_SOURCE = 'https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic'
const HOME_DIRECTION = new Vector3(-0.3, 0.8, 1).normalize()

function connectViewer(canvas, terrainModel, texture) {
  let renderer
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true })
  } catch {
    throw new Error('3D terrain requires WebGL 2. You can explore the area in the 2D map.')
  }

  const { geometry, horizontalRadius } = terrainModel
  renderer.setClearColor('#0f172a')
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())

  const scene = new Scene()
  const light = new DirectionalLight('#fff5e6', 2.5)
  light.position.set(-10, 7, -8)
  scene.add(new AmbientLight('#ffffff', 1.4), light)
  const material = new MeshLambertMaterial({ map: texture })
  const mesh = new Mesh(geometry, material)
  scene.add(mesh)

  const camera = new PerspectiveCamera(42, 1, 0.1, 600)
  const controls = new OrbitControls(camera, canvas)
  controls.enablePan = false
  controls.minDistance = horizontalRadius * 0.45
  controls.maxPolarAngle = Math.PI * 0.47

  function render() {
    renderer.render(scene, camera)
  }

  function resetCamera() {
    const halfVerticalFov = camera.fov * Math.PI / 360
    const halfHorizontalFov = Math.atan(Math.tan(halfVerticalFov) * camera.aspect)
    const halfFov = Math.min(halfVerticalFov, halfHorizontalFov)
    const distance = horizontalRadius * 1.08 / Math.sin(halfFov)
    controls.maxDistance = distance * 1.45
    camera.position.copy(HOME_DIRECTION).multiplyScalar(distance)
    controls.update()
    render()
  }

  function resize() {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    render()
  }

  controls.addEventListener('change', render)
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()
  resetCamera()

  return {
    controls,
    resetCamera,
    setExaggeration(exaggeration) {
      mesh.scale.y = exaggeration
      render()
    },
    dispose() {
      observer.disconnect()
      controls.removeEventListener('change', render)
      controls.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}

export default function TerrainView({ terrain, loadError, bounds, image, imagerySource }) {
  const canvasRef = useRef(null)
  const viewerRef = useRef(null)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [exaggeration, setExaggeration] = useState(DEFAULT_EXAGGERATION)

  useEffect(() => {
    if (!terrain) return
    let disposed = false
    let model
    let texture
    const canvas = canvasRef.current

    function handleContextLoss(event) {
      event.preventDefault()
      setError('The 3D display was interrupted. Switch to the 2D map, then reopen 3D terrain to retry.')
    }

    async function load() {
      texture = await new TextureLoader().loadAsync(image)
      if (disposed) {
        texture.dispose()
        return
      }

      model = createTerrainMesh(terrain, bounds)
      viewerRef.current = connectViewer(canvas, model, texture)
      viewerRef.current.setExaggeration(DEFAULT_EXAGGERATION)
      setStatus({ min: model.minElevation, max: model.maxElevation, hasGaps: model.hasGaps })
    }

    canvas.addEventListener('webglcontextlost', handleContextLoss)
    load().catch((error) => {
      if (!disposed) setError(error.message || 'Could not load the CTX imagery for 3D terrain.')
    })

    return () => {
      disposed = true
      canvas.removeEventListener('webglcontextlost', handleContextLoss)
      viewerRef.current?.dispose()
      viewerRef.current = null
      model?.geometry.dispose()
      texture?.dispose()
    }
  }, [terrain, bounds, image])

  const message = loadError || error
  const ready = status && !message

  function changeExaggeration(event) {
    const scale = Number(event.target.value)
    setExaggeration(scale)
    viewerRef.current?.setExaggeration(scale)
  }

  return (
    <section aria-labelledby="terrain-heading" className="space-y-3">
      <div>
        <h2 id="terrain-heading" className="text-xl font-semibold">Western Jezero Crater in 3D</h2>
        <p className="mt-1 text-sm text-slate-300">
          Drag to orbit. Scroll or pinch over the terrain to zoom.
        </p>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="3D surface of western Jezero Crater, textured with CTX orbital imagery"
          className="block h-[clamp(19rem,55vw,36rem)] w-full touch-none cursor-grab active:cursor-grabbing"
          aria-hidden={!ready}
        />
        {!ready && (
          <p
            role={message ? 'alert' : 'status'}
            className="absolute inset-0 grid place-content-center px-5 text-center text-slate-200"
          >
            {message || 'Loading CTX terrain…'}
          </p>
        )}
      </div>

      {ready && (
        <>
          <div role="group" aria-label="3D terrain controls" className="flex flex-wrap items-center gap-2">
            <button type="button" className={BUTTON_STYLE} onClick={() => viewerRef.current?.controls.rotateLeft(Math.PI / 12)}>
              Rotate left
            </button>
            <button type="button" className={BUTTON_STYLE} onClick={() => viewerRef.current?.controls.rotateLeft(-Math.PI / 12)}>
              Rotate right
            </button>
            <button type="button" className={BUTTON_STYLE} onClick={() => viewerRef.current?.controls.dollyIn(ZOOM_STEP)}>
              Zoom in
            </button>
            <button type="button" className={BUTTON_STYLE} onClick={() => viewerRef.current?.controls.dollyOut(ZOOM_STEP)}>
              Zoom out
            </button>
            <button type="button" className={BUTTON_STYLE} onClick={() => viewerRef.current?.resetCamera()}>
              Reset camera
            </button>
            <label className="flex items-center gap-2 text-sm">
              Vertical scale
              <select className={BUTTON_STYLE} value={exaggeration} onChange={changeExaggeration}>
                <option value={1}>1×</option>
                <option value={DEFAULT_EXAGGERATION}>{DEFAULT_EXAGGERATION}×</option>
              </select>
            </label>
          </div>
          <p className="text-sm text-slate-300">
            Sampled elevation {Math.round(status.min).toLocaleString()} to {Math.round(status.max).toLocaleString()} m.
            {' '}Terrain mesh samples the {SOURCE_CELL_METERS} m DEM at up to {SOURCE_CELL_METERS * MESH_STEP} m spacing.
            {status.hasGaps && ' Gaps in the surface mark areas without complete elevation coverage.'}
          </p>
        </>
      )}

      <p className="text-sm text-slate-300">
        Mars Reconnaissance Orbiter · Context Camera · USGS Astrogeology ·{' '}
        <a className="underline" href={DEM_SOURCE}>DEM source</a> ·{' '}
        <a className="underline" href={imagerySource}>Imagery source</a>
      </p>
    </section>
  )
}
