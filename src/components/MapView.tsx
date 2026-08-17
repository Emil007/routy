"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Circle, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapMarker {
  id: number | string;
  lat: number;
  lng: number;
  label?: string;
  color?: string;
  draggable?: boolean;
}

export interface MapLine {
  id: number | string;
  points: [number, number][];
  color?: string;
  weight?: number;
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

function FitBounds({ markers, lines }: { markers: MapMarker[]; lines: MapLine[] }) {
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
  }, [JSON.stringify(markers.map((m) => [m.lat, m.lng])), JSON.stringify(lines.map((l) => l.points))]);
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
  /** Re-fit the view whenever markers/lines change. Disable for interactive drawing,
   * where re-centering on every click would fight the user's own panning/zoom. */
  autoFit?: boolean;
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
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {lines.map((line) => (
          <Polyline
            key={line.id}
            positions={line.points}
            color={line.color ?? "#2e6b49"}
            weight={line.weight ?? 4}
            eventHandlers={onLineClick ? { click: (e) => onLineClick(line.id, e.latlng.lat, e.latlng.lng) } : undefined}
          />
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
            {marker.label && <Tooltip direction="top">{marker.label}</Tooltip>}
          </Marker>
        ))}
        {autoFit && <FitBounds markers={markers} lines={lines} />}
        {onMapClick && <ClickHandler onMapClick={onMapClick} />}
      </MapContainer>
    </div>
  );
}
