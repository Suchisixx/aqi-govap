import zipfile
from fastkml import kml
from shapely.ops import unary_union

def extract_kml_from_kmz(kmz_path):
    with zipfile.ZipFile(kmz_path, "r") as z:
        for name in z.namelist():
            if name.lower().endswith(".kml"):
                return z.read(name)
    raise Exception(f"No KML found in {kmz_path}")

def collect_geometries(features):
    geoms = []

    for f in features:
        geom = getattr(f, "geometry", None)
        if geom is not None:
            geoms.append(geom)

        child_features = getattr(f, "features", None)
        if child_features:
            geoms.extend(collect_geometries(list(child_features)))

    return geoms

def read_kmz_geometry(kmz_path):
    kml_bytes = extract_kml_from_kmz(kmz_path)

    k = kml.KML()
    k.from_string(kml_bytes)

    root_features = list(k.features)
    geoms = collect_geometries(root_features)

    if not geoms:
        raise Exception(f"No geometry found in {kmz_path}")

    merged = unary_union(geoms)
    return merged