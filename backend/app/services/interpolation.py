import numpy as np
from scipy.interpolate import griddata
from typing import List, Tuple, Optional
from shapely.geometry import shape, Point


def build_polygon_mask(
    grid_lats: np.ndarray,
    grid_lngs: np.ndarray,
    mask_geojson: Optional[dict] = None,
) -> Optional[np.ndarray]:
    if not mask_geojson:
        return None

    polygon = shape(mask_geojson)
    mask = np.zeros(grid_lats.shape, dtype=bool)

    rows, cols = grid_lats.shape
    for i in range(rows):
        for j in range(cols):
            pt = Point(float(grid_lngs[i, j]), float(grid_lats[i, j]))
            mask[i, j] = polygon.contains(pt) or polygon.touches(pt)

    return mask


def idw_interpolate(
    points: List[Tuple[float, float]],
    values: List[float],
    grid_lats: np.ndarray,
    grid_lngs: np.ndarray,
    power: float = 2.0,
    mask: Optional[np.ndarray] = None,
) -> np.ndarray:
    """
    Inverse Distance Weighting interpolation
    Z(x) = Σ(Zi/di^p) / Σ(1/di^p)
    """
    pts = np.array(points)  # (N, 2) = (lat, lng)
    vals = np.array(values)  # (N,)
    grid_points = np.column_stack([grid_lats.ravel(), grid_lngs.ravel()])

    result = np.full(len(grid_points), np.nan)

    rows, cols = grid_lats.shape

    for idx, gp in enumerate(grid_points):
        i = idx // cols
        j = idx % cols

        if mask is not None and not mask[i, j]:
            continue

        distances = np.sqrt(np.sum((pts - gp) ** 2, axis=1))

        zero_dist = distances == 0
        if np.any(zero_dist):
            result[idx] = vals[zero_dist][0]
            continue

        weights = 1.0 / (distances ** power)
        result[idx] = np.sum(weights * vals) / np.sum(weights)

    return result.reshape(grid_lats.shape)


def kriging_interpolate(
    points: List[Tuple[float, float]],
    values: List[float],
    grid_lats: np.ndarray,
    grid_lngs: np.ndarray,
    mask: Optional[np.ndarray] = None,
) -> np.ndarray:
    """Ordinary Kriging via pykrige"""
    try:
        from pykrige.ok import OrdinaryKriging

        pts = np.array(points)
        ok = OrdinaryKriging(
            pts[:, 1],
            pts[:, 0],
            np.array(values),
            variogram_model="linear",
            verbose=False,
            enable_plotting=False,
        )
        z, _ = ok.execute("grid", np.unique(grid_lngs), np.unique(grid_lats))
        z = np.array(z)

        if mask is not None:
            z = np.where(mask, z, np.nan)

        return z
    except Exception:
        return idw_interpolate(points, values, grid_lats, grid_lngs, mask=mask)


def grid_to_geojson(
    grid_lats: np.ndarray,
    grid_lngs: np.ndarray,
    values: np.ndarray,
    bbox: Optional[dict] = None,
) -> dict:
    """
    Convert interpolated grid to GeoJSON FeatureCollection of polygons.
    """
    features = []
    rows, cols = grid_lats.shape

    dlat = (grid_lats.max() - grid_lats.min()) / (rows * 2) if rows > 1 else 0.001
    dlng = (grid_lngs.max() - grid_lngs.min()) / (cols * 2) if cols > 1 else 0.001

    for i in range(rows):
        for j in range(cols):
            val = values[i, j]
            if np.isnan(val):
                continue

            lat = float(grid_lats[i, j])
            lng = float(grid_lngs[i, j])
            val = float(max(0, min(500, val)))

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

    for i in range(grid_lats.shape[0]):
        for j in range(grid_lngs.shape[1]):
            val = values[i, j]
            if np.isnan(val):
                continue

            # Use absolute AQI scale so "good" areas don't look bad just because
            # another ward has a higher local max.
            clamped = float(max(0.0, min(500.0, val)))
            intensity = clamped / 500.0
            pts.append([
                float(grid_lats[i, j]),
                float(grid_lngs[i, j]),
                round(intensity, 3),
            ])

    return pts
