"use client";

import { type ReactNode, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Circle, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Locale } from "@/lib/i18n";

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

const TRAILS_OVERLAY = {
  url: "https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png",
  attribution: 'Wanderwege: &copy; <a href="https://waymarkedtrails.org">Waymarked Trails</a>',
};

export type BaseLayerId = (typeof TILE_LAYERS)[number]["id"];

export interface MapMarker {
  id: number | string;
  lat: number;
  lng: number;
  label?: string;
  color?: string;
  draggable?: boolean;
  popup?: ReactNode;
}

export interface MapLine {
  id: number | string;
  points: [number, number][];
  color?: string;
  weight?: number;
  dashed?: boolean;
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

export interface MapViewState {
  center: [number, number];
  zoom: number;
}

function ViewTracker({ onViewChange }: { onViewChange: (view: MapViewState) => void }) {
  const map = useMapEvents({
    moveend: () => onViewChange({ center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom() }),
    zoomend: () => onViewChange({ center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom() }),
  });
  return null;
}

export function MapView({
  markers = [],
  lines = [],
  circles = [],
  height = 360,
  locale: _locale = "de",
  onMarkerClick,
  onMarkerDragEnd,
  onMapClick,
  onLineClick,
  autoFit = true,
  fitKey,
  initialView,
  onViewChange,
  className,
  baseLayerId = "streets",
  showTrails = false,
}: {
  markers?: MapMarker[];
  lines?: MapLine[];
  circles?: MapCircle[];
  height?: number;
  /** Kept for host API compatibility; layer labels live in options menus. */
  locale?: Locale;
  onMarkerClick?: (id: number | string) => void;
  onMarkerDragEnd?: (id: number | string, lat: number, lng: number) => void;
  onMapClick?: (lat: number, lng: number) => void;
  onLineClick?: (id: number | string, lat: number, lng: number) => void;
  autoFit?: boolean;
  fitKey?: string | number;
  initialView?: MapViewState;
  onViewChange?: (view: MapViewState) => void;
  className?: string;
  baseLayerId?: BaseLayerId | string;
  showTrails?: boolean;
}) {
  const defaultCenter = useMemo<[number, number]>(() => {
    if (initialView) return initialView.center;
    if (markers[0]) return [markers[0].lat, markers[0].lng];
    if (lines[0]?.points[0]) return lines[0].points[0];
    return [51.1657, 10.4515];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const baseLayer = TILE_LAYERS.find((l) => l.id === baseLayerId) ?? TILE_LAYERS[0];

  return (
    <div className={`map-box ${className ?? ""}`} style={{ height, position: "relative" }}>
      <MapContainer
        center={defaultCenter}
        zoom={initialView?.zoom ?? 14}
        style={{ width: "100%", height: "100%" }}
        scrollWheelZoom
        closePopupOnClick={false}
      >
        {onViewChange && <ViewTracker onViewChange={onViewChange} />}
        <TileLayer key={baseLayer.id} attribution={baseLayer.attribution} url={baseLayer.url} />
        {showTrails && (
          <TileLayer attribution={TRAILS_OVERLAY.attribution} url={TRAILS_OVERLAY.url} opacity={0.85} />
        )}
        {lines.map((line) => (
          <Polyline
            key={line.id}
            positions={line.points}
            color={line.color ?? "#2e6b49"}
            weight={line.weight ?? 4}
            dashArray={line.dashed ? "8 8" : undefined}
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
        {autoFit && !initialView && <FitBounds markers={markers} lines={lines} fitKey={fitKey} />}
        {onMapClick && <ClickHandler onMapClick={onMapClick} />}
      </MapContainer>
    </div>
  );
}
