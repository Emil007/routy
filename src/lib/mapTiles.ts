/** Karten-Kachel-Layer — reine Daten, KEIN leaflet-Import (sonst bricht SSR: window-Referenz). */
export const TILE_LAYERS = [
  {
    id: "streets",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  {
    id: "hiking",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution:
      'Kartendaten: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | Darstellung: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
  },
  {
    id: "satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
  },
] as const;

export type BaseLayerId = (typeof TILE_LAYERS)[number]["id"];

export const TRAILS_OVERLAY = {
  url: "https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png",
  attribution: 'Wanderwege: &copy; <a href="https://waymarkedtrails.org">Waymarked Trails</a>',
};
