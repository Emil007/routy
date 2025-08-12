# Routy v2 — Discord-Routenbot (IDs statt langer Namen)

**Neu in v2**
- Node-Merge per Radius (`[ingest] merge_radius_m`, Default 50 m)
- Warnung bei gleichnamigen Punkten, die *weit* auseinander liegen (`name_far_warn_m`, Default 300 m)
- Auto-Reverse-Segmente (für jede Kante A→B wird B→A angelegt, deine "kein sofort retour" Regel bleibt erhalten)
- Routen speichern **ID-Ketten** (z. B. `1-2-5-1`) statt langer Namen → kompakt & robust
- `gpx_sources` mit Hash-Primärschlüssel (keine Key-Length-Probleme)

**Slash-Commands**
- `/route 2km` oder `/route 30min` → passende Route plus StaticMap
- `/debug_map` → zeigt die verwendete StaticMap-URL

## Schnellstart
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp config.example.ini config.ini
# config.ini anpassen (DB, Bot-Token, StaticMap-URL, ingest.merge_radius_m usw.)

# GPX in gpx/ legen
python bootstrap.py
python -m backend.compute_routes
python -m bot.bot
```

## Einmalige Bereinigung (falls du schon doppelte Nodes hast)
```bash
python -m tools.merge_close_nodes
```
Dieser Schritt hängt Segmente auf Repräsentanten um, löscht Duplikate und räumt die Tabelle `segments` auf.

> Hinweis: `routes_precalc` speichert `chain_sig` (z. B. `21-33-21`) und eine `node_chain_json`-Liste mit IDs. 
> Die Anzeige-Namen baut der Bot zur Laufzeit aus der `nodes`-Tabelle.
