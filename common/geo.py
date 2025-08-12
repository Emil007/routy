import math
from typing import List, Tuple

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    c = 2*math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R*c

def path_length_m(coords: List[Tuple[float, float]]) -> float:
    total = 0.0
    for i in range(1, len(coords)):
        lon1, lat1 = coords[i-1]
        lon2, lat2 = coords[i]
        total += haversine_m(lat1, lon1, lat2, lon2)
    return total

def estimate_minutes_by_speed(length_m: float, walk_speed_kmh: float=5.0) -> int:
    if walk_speed_kmh <= 0:
        walk_speed_kmh = 5.0
    hours = (length_m/1000.0) / walk_speed_kmh
    return int(round(hours*60))

def approx_center(coords):
    if not coords:
        return (0.0, 0.0)
    lon = sum(c[0] for c in coords)/len(coords)
    lat = sum(c[1] for c in coords)/len(coords)
    return (lon, lat)
