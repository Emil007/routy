"use client";

import { type ReactNode, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, LayersControl, Marker, Polyline, Circle, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/** Extensible base-layer list — add an entry here to offer another tile view everywhere maps are shown.
 * Kept to free, keyless tile services only (no API key/signup) — several other options from
 * openstreetmap.org's own layer picker (Tracestrack Topo, MapTiler OMT, …) need a registered key
 * and aren't usable this way. */
const TILE_LAYERS = [
  {
    id: "streets",
    name: "Straßenkarte",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  {
    id: "hiking",
    name: "Wanderkarte",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution:
      'Kartendaten: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | Darstellung: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
  },
  {
    id: "satellite",
    name: "Satellit",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  },
];

/** Optional overlays drawn on top of the chosen base layer — checkboxes, combinable with any of them. */
const TILE_OVERLAYS = [
  {
    id: "hiking-trails",
    name: "Wanderwege (markiert)",
    url: "https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png",
    attribution: 'Wanderwege: &copy; <a href="https://waymarkedtrails.org">Waymarked Trails</a>',
  },
];

export interface MapMarker {
  id: number | string;
  lat: number;
  lng: number;
  label?: string;
  color?: string;
  draggable?: boolean;
  /** Rendered inside a real Leaflet Popup anchored to this marker — info and/or owner-gated actions. */
  popup?: ReactNode;
}

export interface MapLine {
  id: number | string;
  points: [number, number][];
  color?: string;
  weight?: number;
  /** Rendered inside a real Leaflet Popup opened at the click position along this line. */
  popup?: ReactNode;
}

export interface MapCircle {
  id: number | string;
  lat: number;
  lng: number;
  radiusM: number;
  color?: string;
}

function dotIcon(color: string) {
  return L.divIcon({
    className: "routy-marker",
    html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.35)"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

/**
 * Fits the view to the given markers/lines once per `fitKey` value (default: once on
 * mount, since an unset key never changes). Deliberately NOT keyed to the marker/line
 * content itself — refitting on every content change means a single node move (which
 * legitimately changes that node's lat/lng) zooms the whole map back out, discarding
 * whatever the user was looking at. Callers that show a genuinely new dataset (e.g. a
 * freshly generated route) should bump `fitKey` to opt back into a refit.
 */
function FitBounds({ markers, lines, fitKey }: { markers: MapMarker[]; lines: MapLine[]; fitKey?: string | number }) {
  const map = useMap();
  useEffect(() => {
    const points: [number, number][] = [
      ...markers.map((m): [number, number] => [m.lat, m.lng]),
      ...lines.flatMap((l) => l.points),
    ];
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 16);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

function ClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => onMapClick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

export function MapView({
  markers = [],
  lines = [],
  circles = [],
  height = 360,
  onMarkerClick,
  onMarkerDragEnd,
  onMapClick,
  onLineClick,
  autoFit = true,
  fitKey,
  className,
}: {
  markers?: MapMarker[];
  lines?: MapLine[];
  circles?: MapCircle[];
  height?: number;
  onMarkerClick?: (id: number | string) => void;
  /** Fired after a marker with `draggable: true` is released at a new position. */
  onMarkerDragEnd?: (id: number | string, lat: number, lng: number) => void;
  onMapClick?: (lat: number, lng: number) => void;
  /** Fired when a line is clicked, with the lat/lng of the click along it. */
  onLineClick?: (id: number | string, lat: number, lng: number) => void;
  /** Re-fit the view once per distinct `fitKey` (default: once on mount). Disable entirely
   * for interactive drawing, where re-centering on every click would fight the user's own
   * panning/zoom. */
  autoFit?: boolean;
  /** Bump this (e.g. to a route token) when a genuinely new dataset should trigger a refit. */
  fitKey?: string | number;
  className?: string;
}) {
  const defaultCenter = useMemo<[number, number]>(() => {
    if (markers[0]) return [markers[0].lat, markers[0].lng];
    if (lines[0]?.points[0]) return lines[0].points[0];
    return [51.1657, 10.4515]; // Germany, fallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`map-box ${className ?? ""}`} style={{ height }}>
      <MapContainer center={defaultCenter} zoom={14} style={{ width: "100%", height: "100%" }} scrollWheelZoom>
        <LayersControl position="topright">
          {TILE_LAYERS.map((layer, idx) => (
            <LayersControl.BaseLayer key={layer.id} name={layer.name} checked={idx === 0}>
              <TileLayer attribution={layer.attribution} url={layer.url} />
            </LayersControl.BaseLayer>
          ))}
          {TILE_OVERLAYS.map((overlay) => (
            <LayersControl.Overlay key={overlay.id} name={overlay.name}>
              <TileLayer attribution={overlay.attribution} url={overlay.url} />
            </LayersControl.Overlay>
          ))}
        </LayersControl>
        {lines.map((line) => (
          <Polyline
            key={line.id}
            positions={line.points}
            color={line.color ?? "#2e6b49"}
            weight={line.weight ?? 4}
            eventHandlers={onLineClick ? { click: (e) => onLineClick(line.id, e.latlng.lat, e.latlng.lng) } : undefined}
          >
            {line.popup && <Popup>{line.popup}</Popup>}
          </Polyline>
        ))}
        {circles.map((c) => (
          <Circle
            key={c.id}
            center={[c.lat, c.lng]}
            radius={c.radiusM}
            pathOptions={{ color: c.color ?? "#a5711c", weight: 1, dashArray: "4 4", fillOpacity: 0.05 }}
          />
        ))}
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            position={[marker.lat, marker.lng]}
            icon={dotIcon(marker.color ?? "#2e6b49")}
            draggable={marker.draggable ?? false}
            eventHandlers={{
              ...(onMarkerClick ? { click: () => onMarkerClick(marker.id) } : {}),
              ...(marker.draggable && onMarkerDragEnd
                ? {
                    dragend: (e: L.DragEndEvent) => {
                      const pos = (e.target as L.Marker).getLatLng();
                      onMarkerDragEnd(marker.id, pos.lat, pos.lng);
                    },
                  }
                : {}),
            }}
          >
            {marker.label && !marker.popup && <Tooltip direction="top">{marker.label}</Tooltip>}
            {marker.popup && <Popup>{marker.popup}</Popup>}
          </Marker>
        ))}
        {autoFit && <FitBounds markers={markers} lines={lines} fitKey={fitKey} />}
        {onMapClick && <ClickHandler onMapClick={onMapClick} />}
      </MapContainer>
    </div>
  );
}
