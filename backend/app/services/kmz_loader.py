import zipfile
import xml.etree.ElementTree as ET
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union


def extract_kml_from_kmz(kmz_path: str) -> bytes:
    with zipfile.ZipFile(kmz_path, "r") as z:
        for name in z.namelist():
            if name.lower().endswith(".kml"):
                return z.read(name)
    raise Exception(f"No KML found in {kmz_path}")


def parse_coordinates(coord_text: str):
    coords = []
    for item in coord_text.strip().split():
        parts = item.split(",")
        if len(parts) >= 2:
            lng = float(parts[0])
            lat = float(parts[1])
            coords.append((lng, lat))
    return coords


def read_kmz_geometry(kmz_path: str):
    kml_bytes = extract_kml_from_kmz(kmz_path)
    root = ET.fromstring(kml_bytes)

    ns = {
        "kml": "http://www.opengis.net/kml/2.2"
    }

    polygons = []

    # Lấy tất cả Polygon trong file KML
    for poly in root.findall(".//kml:Polygon", ns):
        outer = poly.find(".//kml:outerBoundaryIs/kml:LinearRing/kml:coordinates", ns)
        if outer is None or not outer.text:
            continue

        outer_coords = parse_coordinates(outer.text)
        if len(outer_coords) < 3:
            continue

        holes = []
        for inner in poly.findall(".//kml:innerBoundaryIs/kml:LinearRing/kml:coordinates", ns):
            if inner.text:
                inner_coords = parse_coordinates(inner.text)
                if len(inner_coords) >= 3:
                    holes.append(inner_coords)

        try:
            polygon = Polygon(outer_coords, holes=holes)
            if polygon.is_valid and not polygon.is_empty:
                polygons.append(polygon)
        except Exception:
            continue

    if not polygons:
        raise Exception(f"No geometry found in {kmz_path}")

    merged = unary_union(polygons)

    if merged.geom_type == "Polygon":
        return MultiPolygon([merged])
    elif merged.geom_type == "MultiPolygon":
        return merged
    else:
        raise Exception(f"Unsupported geometry type: {merged.geom_type}")