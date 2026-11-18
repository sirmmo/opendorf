// Plays greedy games and prints how long they last and what gets built.
import { newGame, place, discard, preview, legalSpots } from '../js/rules.js';
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['1', '2', '3', '4', '5', '6'];
for (const seed of seeds) {
  const s = newGame(seed);
  const built = {};
  while (!s.over) {
    const spots = legalSpots(s, s.queue[0]);
    if (!spots.length) { discard(s); continue; }
    let best = null;
    for (const c of spots.slice(0, 10)) for (const rot of c.rots) {
      const p = preview(s, c.q, c.r, rot);
      if (!best || p.pts > best.pts) best = { ...c, rot, pts: p.pts };
    }
    for (const e of place(s, best.q, best.r, best.rot)) if (e.type === 'build') built[e.building] = (built[e.building] || 0) + 1;
  }
  console.log(`seed ${seed}: turns ${s.turn} score ${s.score} discards ${s.stats.discarded} charters ${s.stats.charters}`, JSON.stringify(built));
}
