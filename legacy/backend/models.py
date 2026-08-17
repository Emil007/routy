import json, hashlib
from typing import Optional, List, Dict, Tuple, Set
from .db import get_conn
from common.geo import haversine_m

def geom_sha1(coords):
    s = ';'.join(f'{lon:.6f},{lat:.6f}' for lon,lat in coords)
    return hashlib.sha1(s.encode('utf-8')).hexdigest()

def _find_nearest_node(lat: float, lon: float, within_m: float, prefer_name: Optional[str]) -> Optional[int]:
    conn = get_conn(); cur = conn.cursor(dictionary=True)
    cur.execute("SELECT id, name, latitude, longitude FROM nodes")
    rows = cur.fetchall()
    conn.close()

    best = (None, 1e12)
    best_named = (None, 1e12)

    for r in rows:
        d = haversine_m(lat, lon, r["latitude"], r["longitude"])
        if d <= within_m and d < best[1]:
            best = (r["id"], d)
        if prefer_name and r["name"] == prefer_name and d < best_named[1]:
            best_named = (r["id"], d)

    if best_named[0] is not None and best_named[1] <= within_m:
        return best_named[0]
    return best[0]

def get_or_create_node(lat: float, lon: float, name: Optional[str], merge_threshold_m: float) -> int:
    found = _find_nearest_node(lat, lon, merge_threshold_m, name)
    if found:
        return found
    conn = get_conn(); cur = conn.cursor()
    cur.execute("INSERT INTO nodes(name, latitude, longitude) VALUES(%s,%s,%s)", (name, lat, lon))
    nid = cur.lastrowid
    conn.commit(); conn.close()
    return nid

def set_node_name(nid: int, name: str):
    if not name: return
    conn = get_conn(); cur = conn.cursor()
    cur.execute("UPDATE nodes SET name=IF(name IS NULL OR name='', %s, name) WHERE id=%s", (name, nid))
    conn.commit(); conn.close()

def _ensure_reverse_segment(forward_seg_id: int, start_id: int, end_id: int, length_m: int, duration_min: int, coords) -> None:
    """Lege für (start->end) auch (end->start) an, falls nicht vorhanden.
    Nutzt gepufferte Cursor und getrennte Cursor je Statement, um 'Unread result found' zu vermeiden.
    """
    r_coords = list(reversed(coords))
    r_hash = geom_sha1(r_coords)

    conn = get_conn()
    try:
        # 1) Gibt es das Reverse-Segment schon?
        with conn.cursor(buffered=True) as cur:
            cur.execute(
                "SELECT id FROM segments WHERE start_node_id=%s AND end_node_id=%s AND geom_hash=%s LIMIT 1",
                (end_id, start_id, r_hash)
            )
            row = cur.fetchone()
        if row:
            return

        # 2) Namen des Forward-Segments holen (eigener Cursor)
        fwd_name = None
        with conn.cursor(buffered=True) as cur2:
            cur2.execute("SELECT name FROM segments WHERE id=%s", (forward_seg_id,))
            r = cur2.fetchone()
            if r:
                fwd_name = r[0]

        rev_name = None
        if fwd_name and " - " in fwd_name:
            a, b = fwd_name.split(" - ", 1)
            rev_name = f"{b} - {a}"
        elif fwd_name:
            rev_name = f"{fwd_name} (rev)"

        # 3) Reverse-Segment anlegen (eigener Cursor)
        import json as _json
        with conn.cursor(buffered=True) as cur3:
            cur3.execute(
                'INSERT INTO segments(name,start_node_id,end_node_id,length_m,duration_min,geom_json,geom_hash) '
                'VALUES(%s,%s,%s,%s,%s,%s,%s)',
                (rev_name, end_id, start_id, int(length_m), int(duration_min), _json.dumps(r_coords), r_hash)
            )
            new_id = cur3.lastrowid
            # usage_count absichern
            try:
                cur3.execute('INSERT INTO segment_usage(segment_id, usage_count) VALUES(%s,0)', (new_id,))
            except Exception:
                pass
        conn.commit()
    finally:
        conn.close()

def insert_or_update_segment(seg_name: str, start_id: int, end_id: int, length_m: int, duration_min: int, coords) -> int:
    ghash = geom_sha1(coords)
    import json as _json
    gj = _json.dumps(coords)
    conn = get_conn()
    try:
        with conn.cursor(buffered=True) as cur:
            try:
                cur.execute(
                    'INSERT INTO segments(name,start_node_id,end_node_id,length_m,duration_min,geom_json,geom_hash) '
                    'VALUES(%s,%s,%s,%s,%s,%s,%s)',
                    (seg_name, start_id, end_id, int(length_m), int(duration_min), gj, ghash)
                )
                seg_id = cur.lastrowid
            except Exception:
                # exists -> lookup id, then update
                cur.execute('SELECT id FROM segments WHERE start_node_id=%s AND end_node_id=%s AND geom_hash=%s LIMIT 1',
                            (start_id, end_id, ghash))
                row = cur.fetchone()
                if not row:
                    raise
                seg_id = row[0]
                cur.execute('UPDATE segments SET name=%s, length_m=%s, duration_min=%s, geom_json=%s WHERE id=%s',
                            (seg_name, int(length_m), int(duration_min), gj, seg_id))
            # usage_count absichern
            try:
                cur.execute('INSERT INTO segment_usage(segment_id, usage_count) VALUES(%s,0)', (seg_id,))
            except Exception:
                pass
        conn.commit()
    finally:
        conn.close()

    # Reverse-Segment unabhängig anlegen (eigene Connection)
    _ensure_reverse_segment(seg_id, start_id, end_id, length_m, duration_min, coords)
    return seg_id

def put_route_idchain(node_chain: List[int], segment_ids: List[int], length_m: int, duration_min: int):
    chain_sig = "-".join(str(i) for i in node_chain)
    conn = get_conn(); cur = conn.cursor()
    cur.execute(
        'INSERT IGNORE INTO routes_precalc(chain_sig,node_chain_json,segment_ids_json,length_m,duration_min) '
        'VALUES(%s,%s,%s,%s,%s)',
        (chain_sig, json.dumps(node_chain), json.dumps(segment_ids), int(length_m), int(duration_min))
    )
    conn.commit(); conn.close()

def clear_routes():
    conn = get_conn(); cur = conn.cursor()
    cur.execute("TRUNCATE routes_precalc")
    conn.commit(); conn.close()

def get_nodes_dict() -> Dict[int, Dict]:
    conn = get_conn(); cur = conn.cursor(dictionary=True)
    cur.execute("SELECT id, name, latitude, longitude FROM nodes")
    rows = cur.fetchall()
    conn.close()
    return {r["id"]: r for r in rows}

def get_segments():
    conn = get_conn(); cur = conn.cursor(dictionary=True)
    cur.execute("SELECT * FROM segments")
    rows = cur.fetchall()
    conn.close()
    return rows

def find_home_node_id(home_name: str):
    conn = get_conn(); cur = conn.cursor()
    cur.execute("SELECT id FROM nodes WHERE name=%s ORDER BY id ASC", (home_name,))
    rows = cur.fetchall()
    conn.close()
    if not rows:
        return None
    # Falls mehrere "Home" existieren, nimm den mit kleinster ID (empfohlen: vorher mergen)
    return rows[0][0]
