// Players for the tests: they only use the rules' public functions, so the same player on the
// same seed makes the same moves as long as the rules play the same way.
import { place, discard, preview, legalSpots } from '../js/rules.js';

// The first spot and the first rotation that fit, or a discard: quick, and it lays every kind
// of tile somewhere.
export function firstMove(s) {
  const spots = legalSpots(s, s.queue[0]);
  if (!spots.length) return { op: 'discard' };
  return { op: 'lay', q: spots[0].q, r: spots[0].r, rot: spots[0].rots[0] };
}

// The spot the preview scores best (among the first `look` spots).
export function greedyMove(s, look = 8) {
  const spots = legalSpots(s, s.queue[0]);
  if (!spots.length) return { op: 'discard' };
  let best = null;
  for (const c of spots.slice(0, look)) {
    for (const rot of c.rots) {
      const p = preview(s, c.q, c.r, rot);
      if (!best || p.pts > best.pts) best = { op: 'lay', q: c.q, r: c.r, rot, pts: p.pts };
    }
  }
  return { op: 'lay', q: best.q, r: best.r, rot: best.rot };
}

// Plays a solo game with `player` until it ends (or `limit` moves). Returns the moves made.
export function playSolo(s, player, limit = 400) {
  const moves = [];
  for (let i = 0; i < limit && !s.over; i++) {
    const m = player(s);
    if (m.op === 'discard') discard(s);
    else if (!place(s, m.q, m.r, m.rot)) throw new Error('illegal move ' + JSON.stringify(m));
    moves.push(m);
  }
  return moves;
}

// A short fingerprint of a JSON value (FNV-1a over its JSON text).
export function hashJSON(v) {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(v)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}
