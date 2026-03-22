import numpy as np
from scipy.interpolate import griddata
from typing import List, Tuple, Optional


def idw_interpolate(
    points: List[Tuple[float, float]],
    values: List[float],
    grid_lats: np.ndarray,
    grid_lngs: np.ndarray,
    power: float = 2.0,
) -> np.ndarray:
    """
    Inverse Distance Weighting interpolation
    Z(x) = Σ(Zi/di^p) / Σ(1/di^p)
    """
    pts = np.array(points)   # (N, 2) = (lat, lng)
    vals = np.array(values)  # (N,)

    grid_points = np.column_stack([grid_lats.ravel(), grid_lngs.ravel()])
    result = np.zeros(len(grid_points))

    for i, gp in enumerate(grid_points):
        distances = np.sqrt(np.sum((pts - gp) ** 2, axis=1))

        # If we're exactly on a known point
        zero_dist = distances == 0
        if np.any(zero_dist):
            result[i] = vals[zero_dist][0]
            continue

        weights = 1.0 / (distances ** power)
        result[i] = np.sum(weights * vals) / np.sum(weights)

    return result.reshape(grid_lats.shape)


def kriging_interpolate(
    points: List[Tuple[float, float]],
    values: List[float],
    grid_lats: np.ndarray,
    grid_lngs: np.ndarray,
) -> np.ndarray:
    """Ordinary Kriging via pykrige"""
    try:
        from pykrige.ok import OrdinaryKriging
        pts = np.array(points)
        ok = OrdinaryKriging(
            pts[:, 1], pts[:, 0], np.array(values),
            variogram_model="linear",
            verbose=False,
            enable_plotting=False,
        )
        z, _ = ok.execute("grid", np.unique(grid_lngs), np.unique(grid_lats))
        return np.array(z)
    except Exception:
        # Fallback to IDW if kriging fails
        return idw_interpolate(points, values, grid_lats, grid_lngs)


def grid_to_geojson(
    grid_lats: np.ndarray,
    grid_lngs: np.ndarray,
    values: np.ndarray,
    bbox: Optional[dict] = None,
) -> dict:
    """
    Convert interpolated grid to GeoJSON FeatureCollection of polygons (choropleth cells).
    Each cell is a small rectangle colored by AQI value.
    """
    features = []
    rows, cols = grid_lats.shape

    # Cell size (half step)
    dlat = (grid_lats.max() - grid_lats.min()) / (rows * 2) if rows > 1 else 0.001
    dlng = (grid_lngs.max() - grid_lngs.min()) / (cols * 2) if cols > 1 else 0.001

    for i in range(rows):
        for j in range(cols):
            lat = float(grid_lats[i, j])
            lng = float(grid_lngs[i, j])
            val = float(values[i, j])
            val = max(0, min(500, val))

            # Rectangle corners
            coords = [[
                [lng - dlng, lat - dlat],
                [lng + dlng, lat - dlat],
                [lng + dlng, lat + dlat],
                [lng - dlng, lat + dlat],
                [lng - dlng, lat - dlat],
            ]]

            features.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": coords},
                "properties": {
                    "aqi": round(val),
                    "lat": lat,
                    "lng": lng,
                },
            })

    return {"type": "FeatureCollection", "features": features}


def heatmap_points(
    grid_lats: np.ndarray,
    grid_lngs: np.ndarray,
    values: np.ndarray,
) -> List[List[float]]:
    """Return [lat, lng, intensity] for Leaflet.heat plugin"""
    pts = []
    max_val = values.max() if values.max() > 0 else 1
    for i in range(grid_lats.shape[0]):
        for j in range(grid_lats.shape[1]):
            intensity = float(values[i, j]) / max_val
            pts.append([float(grid_lats[i, j]), float(grid_lngs[i, j]), round(intensity, 3)])
    return pts
