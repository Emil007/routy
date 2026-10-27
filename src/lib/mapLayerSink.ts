import type { MapCircle, MapLine, MapMarker } from "@/components/MapView";

/** Contract between an embedded flow component and the atlas shell (§4.5). */
export interface MapLayerSink {
  markers: MapMarker[];
  lines: MapLine[];
  circles?: MapCircle[];
  fitKey?: string | number;
  onMarkerClick?: (id: number | string) => void;
  onMarkerDragEnd?: (id: number | string, lat: number, lng: number) => void;
  onLineClick?: (id: number | string, lat: number, lng: number) => void;
  onMapClick?: (lat: number, lng: number) => void;
}
