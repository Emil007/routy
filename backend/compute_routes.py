from typing import Dict, List, Tuple, Set
from .models import get_nodes_dict, get_segments, put_route_idchain, clear_routes, find_home_node_id
from .db import load_config

def make_chain_sig(ids: List[int]) -> str:
    return "-".join(str(i) for i in ids)

def build_graph(segments):
    g = {}
    seg_by_edge = {}
    for s in segments:
        a, b = s['start_node_id'], s['end_node_id']
        g.setdefault(a, []).append(b)
        seg_by_edge[(a,b)] = s
    return g, seg_by_edge

def enumerate_routes_km(min_km: float, max_km: float, home_id: int):
    segments = get_segments()
    graph, seg_by_edge = build_graph(segments)
    min_m = int(min_km*1000); max_m = int(max_km*1000)

    routes = []

    def dfs(curr: int, last: int, used_edges: Set[Tuple[int,int]], chain_nodes: List[int], chain_segs: List[int], dist_m: int, dur_min: int):
        if curr == home_id and len(chain_nodes) > 1 and min_m <= dist_m <= max_m:
            routes.append((chain_nodes.copy(), chain_segs.copy(), dist_m, dur_min))
            return
        if dist_m > max_m:
            return
        for nxt in graph.get(curr, []):
            if last is not None and nxt == last:
                continue  # unmittelbares Retour-Verbot
            edge = (curr, nxt)
            if edge in used_edges:
                continue  # gleiche Richtung nicht zweimal
            seg = seg_by_edge[edge]
            ndist = dist_m + int(seg['length_m'])
            ndur = dur_min + int(seg['duration_min'])
            used_edges.add(edge)
            chain_nodes.append(nxt)
            chain_segs.append(seg['id'])
            dfs(nxt, curr, used_edges, chain_nodes, chain_segs, ndist, ndur)
            chain_segs.pop()
            chain_nodes.pop()
            used_edges.remove(edge)

    dfs(home_id, None, set(), [home_id], [], 0, 0)
    return routes

def main():
    cfg = load_config()
    min_km = cfg['routes'].getfloat('precalc_min_km', 1.0)
    max_km = cfg['routes'].getfloat('precalc_max_km', 12.0)
    home_name = cfg['home'].get('home_name', 'Home')
    home_id = find_home_node_id(home_name)
    if not home_id:
        raise SystemExit(f"Home-Knoten '{home_name}' nicht gefunden. Bitte Nodes mergen oder Import prüfen.")

    clear_routes()
    routes = enumerate_routes_km(min_km, max_km, home_id)
    for node_chain, seg_ids, lm, dm in routes:
        put_route_idchain(node_chain, seg_ids, int(lm), int(dm))
    print(f"Vorkalkulierte Routen: {len(routes)} gespeichert.")

if __name__ == '__main__':
    main()
