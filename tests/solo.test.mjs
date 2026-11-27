// Solo OpenDorf must play exactly as it did before playing together came in: the same seeds
// deal the same tiles, the same moves score the same, and old saves go on as they would have.
// tests/fixtures/solo-before-multiplayer.json was recorded with the rules as they were then.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newGame } from '../js/rules.js';
import { firstMove, greedyMove, playSolo, hashJSON } from './play.mjs';

const before = JSON.parse(readFileSync(new URL('./fixtures/solo-before-multiplayer.json', import.meta.url)));
const players = { first: firstMove, greedy: greedyMove };

for (const g of before.games) {
  test(`solo realm "${g.seed}" deals, plays and scores as before`, () => {
    const s = newGame(g.seed);
    assert.equal(hashJSON(s), g.dealt, 'the same deal');
    const moves = playSolo(s, players[g.player]);
    assert.equal(moves.length, g.moves);
    assert.equal(s.score, g.score);
    assert.equal(s.turn, g.turn);
    assert.equal(s.supply, g.supply);
    assert.deepEqual(s.stats, g.stats);
    assert.equal(hashJSON(s), g.final, 'the same realm, to the last field');
    for (const k of ['players', 'play', 'current', 'moved']) assert.ok(!(k in s), `no ${k} in a solo realm`);
    for (const t of Object.values(s.tiles)) assert.ok(!('by' in t), 'no banners in a solo realm');
  });
}

test('a solo save from before goes on to the same end', () => {
  const s = structuredClone(before.save.state);
  playSolo(s, players[before.save.player]);
  assert.equal(s.score, before.save.score);
  assert.equal(hashJSON(s), before.save.final);
});
