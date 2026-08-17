
import discord
from discord import app_commands
import json, uuid

from backend.db import load_config, get_conn

intents = discord.Intents.default()
bot = discord.Client(intents=intents)
tree = app_commands.CommandTree(bot)

# Session-Cache: token -> {mode, target, candidates, idx, seen_sets, seen_union, widen_steps}
ROUTE_CACHE = {}

def cfg():
    return load_config()

def ensure_accept_log_table():
    """Erzeugt route_accept_log bei Bedarf (für Tages-Diversität)."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
CREATE TABLE IF NOT EXISTS route_accept_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  segment_id INT NOT NULL,
  accepted_at DATETIME NOT NULL DEFAULT NOW(),
  KEY (segment_id),
  CONSTRAINT fk_accept_seg FOREIGN KEY (segment_id)
    REFERENCES segments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
""")
        conn.commit()
    finally:
        conn.close()

def daily_penalty(seg_ids, weight: float = 1.0) -> float:
    """Penalty pro Segment, das heute (Server-Zeitzone) bereits akzeptiert wurde."""
    if not seg_ids or weight <= 0:
        return 0.0
    ensure_accept_log_table()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            fmt = ','.join(['%s'] * len(seg_ids))
            query = (
                f"SELECT segment_id, COUNT(*) "
                f"FROM route_accept_log "
                f"WHERE DATE(accepted_at) = CURDATE() AND segment_id IN ({fmt}) "
                f"GROUP BY segment_id"
            )
            cur.execute(query, tuple(seg_ids))
            total = 0
            for seg_id, cnt in cur.fetchall():
                total += int(cnt)
            return float(total) * float(weight)
    finally:
        conn.close()

def overlap_score(a_ids, b_ids) -> float:
    """Jaccard-Overlap zweier Segmentmengen (0 = nichts gemeinsam, 1 = identisch)."""
    a, b = set(a_ids), set(b_ids)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)

def fetch_node_names(chain_ids):
    """Hole Anzeigenamen für Node-IDs in gegebener Reihenfolge."""
    if not chain_ids:
        return []
    conn = get_conn()
    try:
        with conn.cursor(dictionary=True) as cur:
            idlist = ",".join(str(i) for i in set(chain_ids))
            cur.execute(f"SELECT id, name FROM nodes WHERE id IN ({idlist})")
            mp = {r["id"]: (r["name"] or f"N{r['id']}") for r in cur.fetchall()}
        return [mp.get(i, f"N{i}") for i in chain_ids]
    finally:
        conn.close()

def shorten_chain(names, max_nodes=20, max_chars=3800):
    """Knotenliste für Embed kürzen."""
    if not names:
        return ""
    out = names
    if len(names) > max_nodes:
        head = max_nodes // 2
        tail = max_nodes - head
        out = names[:head] + ["…"] + names[-tail:]
    s = " › ".join(out)
    if len(s) > max_chars:
        s = s[:max_chars-20].rstrip() + " …"
    return s

def build_embed(chain_sig, nice_chain, length_m, duration_min):
    em = discord.Embed(title=f"Route {chain_sig}")
    em.add_field(name="Länge", value=f"{length_m/1000:.2f} km", inline=True)
    em.add_field(name="Dauer", value=f"{duration_min} min", inline=True)
    if nice_chain:
        desc = nice_chain
        if len(desc) > 3800:
            desc = desc[:3790].rstrip() + " …"
        em.description = desc
    return em

def get_widen_params(c):
    """Liest Basis-Toleranz, Schrittweite und Maximal-Extra aus der Config."""
    base = c['routes'].getfloat('tolerance_percent', 10.0)
    step = c['routes'].getfloat('widen_step_percent', 5.0)
    max_extra = c['routes'].getfloat('widen_max_percent', 30.0)
    if step < 0: step = 0.0
    if max_extra < 0: max_extra = 0.0
    return base, step, max_extra

def get_candidates(mode, value, c, limit=500, tol_override=None):
    """Hole Kandidatenrouten innerhalb Toleranz, sortiert nach Nähe zum Ziel."""
    tol = float(tol_override) if tol_override is not None else c['routes'].getfloat('tolerance_percent', 10.0)
    conn = get_conn()
    try:
        with conn.cursor(dictionary=True) as cur:
            if mode == 'km':
                target_m = int(round(value*1000))
                lo = int(target_m * (1.0 - tol/100.0))
                hi = int(target_m * (1.0 + tol/100.0))
                cur.execute(
                    "SELECT * FROM routes_precalc WHERE length_m BETWEEN %s AND %s "
                    "ORDER BY ABS(length_m-%s) ASC LIMIT %s",
                    (lo, hi, target_m, limit)
                )
            else:
                target_min = int(round(value))
                lo = int(target_min * (1.0 - tol/100.0))
                hi = int(target_min * (1.0 + tol/100.0))
                cur.execute(
                    "SELECT * FROM routes_precalc WHERE duration_min BETWEEN %s AND %s "
                    "ORDER BY ABS(duration_min-%s) ASC LIMIT %s",
                    (lo, hi, target_min, limit)
                )
            return cur.fetchall()
    finally:
        conn.close()

def score_route_by_usage(seg_ids):
    """Summe usage_count über Segmente einer Route."""
    if not seg_ids:
        return 0
    conn = get_conn()
    try:
        with conn.cursor(dictionary=True) as cur:
            fmt = ','.join(['%s']*len(seg_ids))
            cur.execute(f"SELECT segment_id, usage_count FROM segment_usage WHERE segment_id IN ({fmt})", tuple(seg_ids))
            usage = {r['segment_id']: r['usage_count'] for r in cur.fetchall()}
        return sum(usage.get(i, 0) for i in seg_ids)
    finally:
        conn.close()

def pick_best_candidate(candidates):
    """Erste Auswahl: minimale usage_sum, Tie-Breaker: kürzere Länge."""
    best_idx, best_key = None, None
    for i, r in enumerate(candidates):
        seg_ids = json.loads(r['segment_ids_json'])
        key = (score_route_by_usage(seg_ids), int(r['length_m']))
        if best_idx is None or key < best_key:
            best_idx, best_key = i, key
    return best_idx if best_idx is not None else 0

class RouteView(discord.ui.View):
    def __init__(self, token: str, timeout: float = 180):
        super().__init__(timeout=timeout)
        self.token = token

    @staticmethod
    def build_disabled_view():
        v = discord.ui.View(timeout=None)
        return v

    @discord.ui.button(label="Neue Route", style=discord.ButtonStyle.secondary, custom_id="routy:new")
    async def new_route(self, interaction: discord.Interaction, button: discord.ui.Button):
        data = ROUTE_CACHE.get(self.token)
        if not data:
            await interaction.response.send_message("Session abgelaufen – bitte /route neu aufrufen.", ephemeral=True)
            return
        c = cfg()
        base, step, max_extra = get_widen_params(c)
        # Toleranz schrittweise erweitern
        data['widen_steps'] = int(data.get('widen_steps', 0)) + 1
        eff_tol = base + data['widen_steps'] * step
        if eff_tol > base + max_extra:
            eff_tol = base + max_extra

        # Kandidaten neu mit erweiterter Toleranz laden
        candidates = get_candidates(data['mode'], data['target'], c, limit=500, tol_override=eff_tol)
        if not candidates:
            await interaction.response.send_message("Keine Alternative gefunden (trotz erweiterter Toleranz).", ephemeral=True)
            return

        seen_sets = set(data.get('seen_sets', set()))
        seen_union = set(data.get('seen_union', set()))
        daily_weight = c['routes'].getfloat('daily_diversity_weight', 1.0)

        # Scoring: (usage_sum + daily_penalty, overlap, delta)
        scored = []
        for i, r in enumerate(candidates):
            seg_ids = json.loads(r['segment_ids_json'])
            keyset = frozenset(seg_ids)
            if keyset in seen_sets:
                continue
            usage = score_route_by_usage(seg_ids)
            penalty = daily_penalty(seg_ids, daily_weight)
            ov = overlap_score(seg_ids, list(seen_union)) if seen_union else 0.0
            if data['mode'] == 'km':
                delta = abs(int(r['length_m']) - int(data['target']*1000))
            else:
                delta = abs(int(r['duration_min']) - int(round(data['target'])))
            scored.append((usage + penalty, ov, delta, i, keyset, set(seg_ids)))

        if not scored:
            await interaction.response.send_message("Keine weitere Alternative (divers) gefunden.", ephemeral=True)
            return

        scored.sort()
        _, _, _, next_idx, keyset, segset = scored[0]
        # Session aktualisieren
        data['candidates'] = candidates
        data['idx'] = next_idx
        seen_sets.add(keyset)
        data['seen_sets'] = seen_sets
        data['seen_union'] = set(seen_union) | set(segset)

        await update_route_message(interaction, data)

    @discord.ui.button(label="Diese nehmen", style=discord.ButtonStyle.success, custom_id="routy:accept")
    async def accept_route(self, interaction: discord.Interaction, button: discord.ui.Button):
        data = ROUTE_CACHE.get(self.token)
        if not data:
            await interaction.response.send_message("Session abgelaufen – bitte /route neu aufrufen.", ephemeral=True)
            return
        r = data['candidates'][data['idx']]
        seg_ids = json.loads(r['segment_ids_json'])

        # usage_count + akzeptanz protokollieren
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                if seg_ids:
                    fmt = ','.join(['%s']*len(seg_ids))
                    cur.execute(f"UPDATE segment_usage SET usage_count = usage_count + 1 WHERE segment_id IN ({fmt})", tuple(seg_ids))
                    ensure_accept_log_table()
                    vals = [(sid,) for sid in seg_ids]
                    cur.executemany("INSERT INTO route_accept_log(segment_id, accepted_at) VALUES(%s, NOW())", vals)
            conn.commit()
        finally:
            conn.close()

        # Nachricht finalisieren (Buttons deaktivieren, Haken in Titel)
        names = fetch_node_names(json.loads(r['node_chain_json']))
        nice_chain = shorten_chain(names)
        embed = build_embed(r['chain_sig'] + " ✅", nice_chain, r['length_m'], r['duration_min'])
        try:
            await interaction.response.edit_message(embed=embed, view=RouteView.build_disabled_view())
        except discord.InteractionResponded:
            await interaction.edit_original_response(embed=embed, view=RouteView.build_disabled_view())
        ROUTE_CACHE.pop(self.token, None)
        await interaction.followup.send("✅ Route übernommen – viel Spaß!", ephemeral=True)

    @discord.ui.button(label="Abbrechen", style=discord.ButtonStyle.danger, custom_id="routy:cancel")
    async def cancel_route(self, interaction: discord.Interaction, button: discord.ui.Button):
        data = ROUTE_CACHE.get(self.token)
        if not data:
            await interaction.response.send_message("Session abgelaufen – bitte /route neu aufrufen.", ephemeral=True)
            return
        r = data['candidates'][data['idx']]
        names = fetch_node_names(json.loads(r['node_chain_json']))
        nice_chain = shorten_chain(names)
        embed = build_embed(r['chain_sig'] + " ❌", nice_chain, r['length_m'], r['duration_min'])
        try:
            await interaction.response.edit_message(embed=embed, view=RouteView.build_disabled_view())
        except discord.InteractionResponded:
            await interaction.edit_original_response(embed=embed, view=RouteView.build_disabled_view())
        ROUTE_CACHE.pop(self.token, None)
        await interaction.followup.send("❌ Abgebrochen.", ephemeral=True)

async def update_route_message(interaction: discord.Interaction, data):
    r = data['candidates'][data['idx']]
    node_chain = json.loads(r['node_chain_json'])
    names = fetch_node_names(node_chain)
    nice_chain = shorten_chain(names)
    embed = build_embed(r['chain_sig'], nice_chain, r['length_m'], r['duration_min'])
    view = RouteView(data['token'])
    try:
        await interaction.response.edit_message(embed=embed, view=view)
    except discord.InteractionResponded:
        await interaction.edit_original_response(embed=embed, view=view)

async def send_route(interaction: discord.Interaction, mode: str, value: float):
    c = cfg()
    candidates = get_candidates(mode, value, c, limit=500)
    if not candidates:
        await interaction.response.send_message("Keine vorkalkulierte Route in Toleranz gefunden.", ephemeral=True)
        return

    idx = pick_best_candidate(candidates)
    token = uuid.uuid4().hex
    first_seg = json.loads(candidates[idx]['segment_ids_json'])
    ROUTE_CACHE[token] = {
        'mode': mode,
        'target': value,
        'candidates': candidates,
        'idx': idx,
        'token': token,
        'seen_sets': {frozenset(first_seg)},
        'seen_union': set(first_seg),
        'widen_steps': 0
    }

    r = candidates[idx]
    node_chain = json.loads(r['node_chain_json'])
    names = fetch_node_names(node_chain)
    nice_chain = shorten_chain(names)
    embed = build_embed(r['chain_sig'], nice_chain, r['length_m'], r['duration_min'])
    view = RouteView(token)
    await interaction.response.send_message(embed=embed, view=view)

@tree.command(name="route", description="Finde eine passende Route nach km oder Minuten.")
@app_commands.describe(ziel="Beispiel: 2km oder 30min")
async def route_cmd(interaction: discord.Interaction, ziel: str):
    ziel = ziel.strip().lower().replace(',', '.')
    if ziel.endswith('km'):
        try:
            val = float(ziel[:-2])
        except ValueError:
            await interaction.response.send_message("Ungültiger km-Wert.", ephemeral=True)
            return
        await send_route(interaction, 'km', val)
    elif ziel.endswith('min'):
        try:
            val = float(ziel[:-3])
        except ValueError:
            await interaction.response.send_message("Ungültiger Minuten-Wert.", ephemeral=True)
            return
        await send_route(interaction, 'min', val)
    else:
        await interaction.response.send_message("Bitte als `2km` oder `30min` angeben.", ephemeral=True)

@bot.event
async def on_ready():
    print(f"Bot {cfg()['bot'].get('name','Routy')} ist eingeloggt als {bot.user}. Synchronisiere Commands…")
    guild_id = cfg()['bot'].get('guild_id', '').strip()
    if guild_id:
        guild = discord.Object(id=int(guild_id))
        await tree.sync(guild=guild)
    else:
        await tree.sync()
    print("Slash-Commands synchronisiert.")

def main():
    token = cfg()['bot'].get('token')
    if not token or token == 'YOUR_DISCORD_BOT_TOKEN_HERE':
        raise SystemExit("Bitte Discord Bot-Token in config.ini setzen.")
    bot.run(token)

if __name__ == '__main__':
    main()
