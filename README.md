# Jezero Explorer

Jezero Explorer is a NASA Space Apps Challenge project to help visitors explore evidence of ancient water in Jezero Crater and plan a prototype terrain-aware Marswalk to a science destination.

Project planning and challenge requirements are in `resources/`. The `data/` directory holds dataset metadata. Downloaded raster payloads are kept outside Git history.

## 3D terrain

Select **3D terrain** above the interactive map to orbit the terrain around the western delta. Both views use the same western Jezero study area, roughly 23.5 km by 16.4 km, between 77.183° and 77.601° E and 18.388° and 18.666° N. The route planner uses the source DEM at 20 m spacing. The 3D view uses the same elevations at up to 80 m vertex spacing and defaults to 3× vertical exaggeration to make relief visible. Select 1× to see the sampled surface at equal horizontal and vertical scale. The 3D mesh can miss smaller landforms and hazards.

| Layer | Mars Reconnaissance Orbiter instrument | USGS Astrogeology product | Source spacing and rendered coverage |
| --- | --- | --- | --- |
| Elevation | Context Camera (CTX) | [M20_JezeroCrater_CTXDEM_20m.tif](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic), local source `Jezero_Crater_CTX_DEM.tif` | 20 m/pixel. All 967,025 cells in the western study area export contain elevations. |
| Orbital imagery | Context Camera (CTX) | [JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0](https://doi.org/10.5066/P9GV1ND3) | 6 m/pixel in the source projection. The rendered crop is 1,800 × 1,196 pixels. |

The rasters use different equirectangular standard parallels. The 3D mesh uses the DEM's projected meter spacing for shape and its planetocentric latitude and east longitude for texture alignment. The imagery is aligned at the DEM sample centers inside the shared extent. A mesh tile is omitted if any of its source cells lacks elevation.

## Astronaut mission

Select **Astronaut mission**, choose a touchdown point on the CTX image and begin descent. After the rocket lands and the astronaut exits, drag the visor or use the arrow keys to look around. Use **WASD** to walk. In the buggy, **W/S** drives and **A/D** steers. The on-screen controls also work with touch. Open **Navigation map** to set a waypoint and follow its bearing and distance in the visor.

The mission uses the same CTX mesh at 1× vertical scale and aligns the camera to the rendered terrain triangles. The cyan line and posts mark the CTX boundary. Beyond it, the scene blends into generated land, expanding the playable area to about 30.7 km × 23.6 km. The visor reports CTX mesh elevation and estimated grade inside coverage and withholds both readings over generated land. Difficulty thresholds of 8% and 18%, accelerated travel speeds, scenic rocks, and the landing and egress are gameplay choices.
