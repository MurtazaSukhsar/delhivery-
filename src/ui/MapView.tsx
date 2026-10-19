import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { LatLng } from '../lib/domain';

export interface MapMarker extends LatLng {
  id: string;
  label: string;
  kind: 'warehouse' | 'stop' | 'done' | 'problem' | 'pin';
  text?: string; // short text inside the marker, e.g. stop number
}

export interface MapLine {
  id: string;
  points: LatLng[];
  color?: string;
  dashed?: boolean;
}

const COLORS: Record<MapMarker['kind'], string> = {
  warehouse: '#17232b',
  stop: '#1d5fa8',
  done: '#1e7a46',
  problem: '#b42318',
  pin: '#b42318',
};

function icon(m: MapMarker) {
  const bg = COLORS[m.kind];
  const shape = m.kind === 'warehouse' ? 'border-radius:4px' : 'border-radius:50%';
  const txt = m.text ?? (m.kind === 'warehouse' ? 'W' : '');
  return L.divIcon({
    className: '',
    html: `<div style="width:26px;height:26px;${shape};background:${bg};color:#fff;font:600 12px 'Inter Variable',sans-serif;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)">${txt}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

/**
 * Leaflet map with OpenStreetMap tiles. Everything it shows is also listed in
 * text next to it; the map itself is a labelled region you can pan with arrow keys.
 */
export function MapView({ markers, lines = [], onPick, height = 320, label }: { markers: MapMarker[]; lines?: MapLine[]; onPick?: (p: LatLng) => void; height?: number; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([23.59, 58.38], 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => pickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    for (const ln of lines) {
      if (ln.points.length < 2) continue;
      L.polyline(
        ln.points.map((p) => [p.lat, p.lng] as L.LatLngTuple),
        { color: ln.color ?? '#1d5fa8', weight: 4, opacity: 0.8, dashArray: ln.dashed ? '6 8' : undefined },
      ).addTo(g);
    }
    for (const mk of markers) {
      L.marker([mk.lat, mk.lng], { icon: icon(mk), title: mk.label, keyboard: false }).bindTooltip(mk.label).addTo(g);
      bounds.push([mk.lat, mk.lng]);
    }
    if (bounds.length > 1) m.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 14 });
    else if (bounds.length === 1) m.setView(bounds[0], 13);
  }, [markers, lines]);

  return (
    <div className="relative overflow-hidden rounded-lg border border-line">
      <div ref={el} style={{ height }} role="region" aria-label={label} className="z-0 bg-canvas" />
    </div>
  );
}
