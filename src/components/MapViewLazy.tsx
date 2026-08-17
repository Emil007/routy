"use client";

import dynamic from "next/dynamic";

export const MapViewLazy = dynamic(() => import("./MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="map-box" />,
});
