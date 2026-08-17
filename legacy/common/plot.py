import urllib.parse
from typing import List, Tuple
from .geo import approx_center

def build_staticmap_url(base: str, coords: List[Tuple[float, float]], width: int, height: int, zoom: int):
    # center=lon,lat&zoom=&width=&height=&path=lon1,lat1;lon2,lat2;...
    if not coords:
        return base
    center_lon, center_lat = approx_center(coords)
    path = ";".join([f"{lon:.6f},{lat:.6f}" for (lon, lat) in coords])
    params = {
        "center": f"{center_lon:.6f},{center_lat:.6f}",
        "zoom": str(zoom),
        "width": str(width),
        "height": str(height),
        "path": path,
    }
    sep = "&" if "?" in base else "?"
    return base + sep + urllib.parse.urlencode(params)


def build_tileservercache_url(root: str, map_type: str, template: str, coords, width: int, height: int, zoom: int, api_key: str=None):
    # Builds: {root}/{map_type}/poracle-{template}?path=...&width=&height=&zoom=...
    if not coords:
        base = root.rstrip('/') + f'/{map_type}/poracle-{template}'
        return base
    center_lon, center_lat = approx_center(coords)
    path = ";".join([f"{lon:.6f},{lat:.6f}" for (lon, lat) in coords])
    base = root.rstrip('/') + f'/{map_type}/poracle-{template}'
    params = {
        "center": f"{center_lon:.6f},{center_lat:.6f}",
        "zoom": str(zoom),
        "width": str(width),
        "height": str(height),
        "path": path,
    }
    if api_key:
        params["key"] = api_key
    sep = "&" if "?" in base else "?"
    return base + sep + urllib.parse.urlencode(params)
