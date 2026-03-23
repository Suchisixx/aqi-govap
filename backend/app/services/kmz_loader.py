import zipfile
from fastkml import kml
from shapely.ops import unary_union

def extract_kml_from_kmz(kmz_path):
    with zipfile.ZipFile(kmz_path, 'r') as z:
        for name in z.namelist():
            if name.endswith('.kml'):
                return z.read(name)
    raise Exception("No KML found")

def collect_geometries(features):
    geoms = []
    for f in features:
        if hasattr(f, "geometry") and f.geometry:
            geoms.append(f.geometry)
        if hasattr(f, "features"):
            geoms.extend(collect_geometries(list(f.features())))
    return geoms

def read_kmz_geometry(kmz_path):
    kml_bytes = extract_kml_from_kmz(kmz_path)

    k = kml.KML()
    k.from_string(kml_bytes)

    features = list(k.features())
    geoms = collect_geometries(features)

    if not geoms:
        raise Exception("No geometry in KMZ")

    merged = unary_union(geoms)
    return merged