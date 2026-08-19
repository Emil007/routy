/** Tiny SVG preview of a walk's node chain for stats lists. */
export function WalkPathThumbnail({
  nodeChain,
  coords,
}: {
  nodeChain: number[];
  coords: Map<number, { lat: number; lng: number }>;
}) {
  const points = nodeChain
    .map((id) => coords.get(id))
    .filter((p): p is { lat: number; lng: number } => p != null);
  if (points.length < 2) return null;

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const pad = 0.00001;
  const latSpan = Math.max(maxLat - minLat, pad);
  const lngSpan = Math.max(maxLng - minLng, pad);

  const mapped = points.map((p) => {
    const x = ((p.lng - minLng) / lngSpan) * 88 + 6;
    const y = 38 - ((p.lat - minLat) / latSpan) * 28 + 6;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg width={48} height={44} viewBox="0 0 100 44" aria-hidden style={{ flexShrink: 0 }}>
      <polyline
        points={mapped.join(" ")}
        fill="none"
        stroke="var(--brand, #2e6b49)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
