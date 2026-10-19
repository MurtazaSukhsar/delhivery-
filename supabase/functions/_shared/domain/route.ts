import type { LatLng } from './types.ts';

const R = 6371; // km

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Internal road-distance estimate: straight line × road factor. */
export function roadKm(a: LatLng, b: LatLng, roadFactor: number): number {
  return haversineKm(a, b) * roadFactor;
}

/** Length of a round trip: start → stops in order → start. */
export function tourKm(start: LatLng, stops: LatLng[], roadFactor: number): number {
  if (!stops.length) return 0;
  let d = roadKm(start, stops[0], roadFactor);
  for (let i = 1; i < stops.length; i++) d += roadKm(stops[i - 1], stops[i], roadFactor);
  d += roadKm(stops[stops.length - 1], start, roadFactor);
  return d;
}

function permutations(n: number): number[][] {
  const out: number[][] = [];
  const idx = Array.from({ length: n }, (_, i) => i);
  const rec = (k: number) => {
    if (k === n) {
      out.push(idx.slice());
      return;
    }
    for (let i = k; i < n; i++) {
      [idx[k], idx[i]] = [idx[i], idx[k]];
      rec(k + 1);
      [idx[k], idx[i]] = [idx[i], idx[k]];
    }
  };
  rec(0);
  return out;
}

export interface OptimiseResult {
  /** indices into the input stops, in driving order */
  order: number[];
  distanceKm: number;
  naiveOrder: number[];
  naiveDistanceKm: number;
  method: 'exact' | 'heuristic';
  evaluated: number;
}

/**
 * Best stop order for one vehicle that starts and ends at `start`.
 * Exact for up to 8 stops (8! = 40,320 orders); nearest neighbour + 2-opt beyond.
 * "Naive" is what people usually do: nearest to the warehouse first.
 */
export function optimiseStops(
  start: LatLng,
  stops: LatLng[],
  roadFactor: number,
  urgentFirst: boolean[] = [],
): OptimiseResult {
  const n = stops.length;
  const naiveOrder = stops
    .map((s, i) => ({ i, d: haversineKm(start, s) }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.i);
  const naiveDistanceKm = tourKm(start, naiveOrder.map((i) => stops[i]), roadFactor);

  if (n <= 1) {
    return { order: naiveOrder, distanceKm: naiveDistanceKm, naiveOrder, naiveDistanceKm, method: 'exact', evaluated: 1 };
  }

  // Urgent stops must come before non-urgent ones.
  const urgentRank = (order: number[]) => {
    let seenNormal = false;
    for (const i of order) {
      if (!urgentFirst[i]) seenNormal = true;
      else if (seenNormal) return false;
    }
    return true;
  };

  const len = (order: number[]) => tourKm(start, order.map((i) => stops[i]), roadFactor);

  if (n <= 8) {
    let best: number[] = naiveOrder;
    let bestD = Infinity;
    const perms = permutations(n);
    for (const p of perms) {
      if (!urgentRank(p)) continue;
      const d = len(p);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return { order: best, distanceKm: bestD, naiveOrder, naiveDistanceKm, method: 'exact', evaluated: perms.length };
  }

  // Nearest neighbour inside urgency groups, then 2-opt within groups.
  const groups = [stops.map((_, i) => i).filter((i) => urgentFirst[i]), stops.map((_, i) => i).filter((i) => !urgentFirst[i])];
  let order: number[] = [];
  let cur: LatLng = start;
  for (const g of groups) {
    const left = new Set(g);
    while (left.size) {
      let pick = -1;
      let pd = Infinity;
      for (const i of left) {
        const d = haversineKm(cur, stops[i]);
        if (d < pd) {
          pd = d;
          pick = i;
        }
      }
      order.push(pick);
      left.delete(pick);
      cur = stops[pick];
    }
  }
  let improved = true;
  let evaluated = 0;
  while (improved) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const cand = order.slice(0, i).concat(order.slice(i, k + 1).reverse(), order.slice(k + 1));
        evaluated++;
        if (urgentRank(cand) && len(cand) + 1e-9 < len(order)) {
          order = cand;
          improved = true;
        }
      }
    }
  }
  return { order, distanceKm: len(order), naiveOrder, naiveDistanceKm, method: 'heuristic', evaluated };
}

/** Deep links — navigation costs nothing and uses the driver's own app. */
export function googleMapsLink(dest: LatLng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&travelmode=driving`;
}

export function wazeLink(dest: LatLng) {
  return `https://waze.com/ul?ll=${dest.lat},${dest.lng}&navigate=yes`;
}
