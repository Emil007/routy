# tools/merge_close_nodes.py
import mysql.connector
from backend.db import get_conn, load_config
from common.geo import haversine_m

def main():
    cfg = load_config()
    radius = cfg.getfloat('ingest', 'merge_radius_m', fallback=50.0)

    conn = get_conn(); cur = conn.cursor(dictionary=True)
    cur.execute("SELECT id, name, latitude, longitude FROM nodes ORDER BY id")
    nodes = cur.fetchall()

    # Union-Find-ähnliche Clustering nach Distanz (O(n^2) reicht hier)
    parent = {n["id"]: n["id"] for n in nodes}
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    def union(a,b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    # Merge alle Nodes, die innerhalb radius sind (unabhängig vom Namen)
    for i in range(len(nodes)):
        for j in range(i+1, len(nodes)):
            a, b = nodes[i], nodes[j]
            if haversine_m(a["latitude"], a["longitude"], b["latitude"], b["longitude"]) <= radius:
                union(a["id"], b["id"])

    # Cluster aufbauen
    clusters = {}
    for n in nodes:
        r = find(n["id"])
        clusters.setdefault(r, []).append(n)

    # Repräsentant wählen: bevorzugt einer mit Namen, sonst kleinste ID
    rep_for = {}
    for root, group in clusters.items():
        group_sorted = sorted(group, key=lambda x: (0 if x["name"] else 1, x["id"]))
        rep = group_sorted[0]
        for m in group:
            rep_for[m["id"]] = rep["id"]

    # Segmente umhängen
    c2 = conn.cursor()
    # Start-Seite
    c2.execute("SELECT id, start_node_id, end_node_id, geom_hash FROM segments")
    segs = c2.fetchall()
    for sid, s, e, gh in segs:
        rs, re = rep_for[s], rep_for[e]
        if rs == s and re == e:
            continue
        try:
            c2.execute("UPDATE segments SET start_node_id=%s, end_node_id=%s WHERE id=%s", (rs, re, sid))
        except mysql.connector.Error as ex:
            # Duplicate (uniq_segment) -> lösche das Duplikat
            if ex.errno == 1062:
                c2.execute("DELETE FROM segments WHERE id=%s", (sid,))
            else:
                raise
    conn.commit()

    # Überflüssige Nodes löschen (die nicht Repräsentant sind und nicht referenziert)
    all_rep = set(rep_for.values())
    to_delete = [nid for nid in rep_for.keys() if nid not in all_rep]
    for nid in to_delete:
        # Prüfen, ob noch referenziert
        c2.execute("SELECT 1 FROM segments WHERE start_node_id=%s OR end_node_id=%s LIMIT 1", (nid, nid))
        if not c2.fetchone():
            c2.execute("DELETE FROM nodes WHERE id=%s", (nid,))
    conn.commit()

    print(f"Merging abgeschlossen. Cluster: {len(clusters)}")
    conn.close()

if __name__ == '__main__':
    main()
