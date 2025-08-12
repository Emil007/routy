import os, re, hashlib
import gpxpy
from .models import get_or_create_node, set_node_name, insert_or_update_segment, geom_sha1
from .db import load_config, get_conn
from common.geo import path_length_m, estimate_minutes_by_speed, haversine_m

NAME_SPLIT = re.compile(r'\s*[-→–>]+\s*')

def sha1(s: str) -> str:
    return hashlib.sha1(s.encode('utf-8')).hexdigest()

def ingest_file(path: str):
    cfg = load_config()
    merge_threshold_m = cfg.getfloat('ingest', 'merge_radius_m', fallback=50.0)
    name_far_warn_m   = cfg.getfloat('ingest', 'name_far_warn_m', fallback=300.0)

    file_mtime = int(os.path.getmtime(path))
    fname_full = os.path.basename(path)
    fname_hash = sha1(fname_full)

    conn = get_conn(); cur = conn.cursor(dictionary=True)
    cur.execute('SELECT track_hash, mtime, geom_hash FROM gpx_sources WHERE filename_hash=%s', (fname_hash,))
    known = {r['track_hash']: (r['mtime'], r['geom_hash']) for r in cur.fetchall()}
    conn.close()

    imported = 0; skipped = 0

    with open(path, 'r', encoding='utf-8') as f:
        gpx = gpxpy.parse(f)

    for ti, track in enumerate(gpx.tracks):
        track_name_full = (track.name or f'{fname_full}#t{ti}')
        track_hash = sha1(track_name_full)

        if not track.segments:
            continue
        pts = track.segments[0].points
        coords = [(p.longitude, p.latitude) for p in pts]
        if len(coords) < 2:
            continue

        ghash = geom_sha1(coords)
        if track_hash in known and known[track_hash][0] >= file_mtime and known[track_hash][1] == ghash:
            skipped += 1
            continue

        length_m = int(round(path_length_m(coords)))
        if pts[0].time and pts[-1].time:
            duration_min = int(round((pts[-1].time - pts[0].time).total_seconds()/60))
        else:
            duration_min = estimate_minutes_by_speed(length_m, 5.0)

        s_lat, s_lon = pts[0].latitude, pts[0].longitude
        e_lat, e_lon = pts[-1].latitude, pts[-1].longitude

        parts = NAME_SPLIT.split(track_name_full)
        s_name = parts[0].strip() if len(parts)>=1 else None
        e_name = parts[1].strip() if len(parts)>=2 else None

        start_id = get_or_create_node(s_lat, s_lon, s_name, merge_threshold_m)
        end_id   = get_or_create_node(e_lat, e_lon, e_name, merge_threshold_m)

        # Warnung bei "gleichnamig aber weit entfernt"
        if s_name:
            conn = get_conn(); c2 = conn.cursor(dictionary=True)
            c2.execute("SELECT latitude, longitude FROM nodes WHERE id=%s", (start_id,))
            ss = c2.fetchone(); conn.close()
            dist = haversine_m(s_lat, s_lon, ss["latitude"], ss["longitude"])
            if dist > name_far_warn_m:
                print(f"[WARN] Punktname '{s_name}' weit entfernt vom zugeordneten Node: ~{int(dist)} m")

        if s_name: set_node_name(start_id, s_name)
        if e_name: set_node_name(end_id, e_name)

        seg_id = insert_or_update_segment(track_name_full, start_id, end_id, length_m, duration_min, coords)

        conn = get_conn(); cur = conn.cursor()
        cur.execute(
            'REPLACE INTO gpx_sources(filename, track_name, filename_hash, track_hash, mtime, geom_hash, segment_id) '
            'VALUES(%s,%s,%s,%s,%s,%s,%s)',
            (fname_full, track_name_full, fname_hash, track_hash, file_mtime, ghash, seg_id),
        )
        conn.commit(); conn.close()

        imported += 1

    print(f"{os.path.basename(path)}: importiert={imported}, übersprungen={skipped}")
