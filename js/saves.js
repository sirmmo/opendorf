// Where realms are saved. The normal game, the sandbox and a game together on this device each
// keep their own slot, so one never overwrites another. An online game is not saved here: the
// game server keeps its moves, and the page rebuilds it from them.
//
// `store` is anything with get(key) and set(key, value), such as a wrapper round localStorage.

import { isMulti, isSandbox } from './rules.js';

export const SLOTS = {
  normal: { game: 'opendorf.save', undo: 'opendorf.undo' },
  sandbox: { game: 'opendorf.sandbox', undo: 'opendorf.sandbox.undo' },
  // Several players take turns, so there is no undo.
  together: { game: 'opendorf.together', undo: null },
};

export function slotOf(state) {
  if (isMulti(state)) return 'together';
  return isSandbox(state) ? 'sandbox' : 'normal';
}

// The realm saved in `slot` and its undo, or null if there is none to go on with.
export function loadSaved(store, slot) {
  let saved = null;
  try { saved = JSON.parse(store.get(SLOTS[slot].game) || 'null'); } catch { saved = null; }
  if (!saved || typeof saved !== 'object' || saved.version !== 1 || saved.over) return null;
  if (slotOf(saved) !== slot) return null;
  const undo = SLOTS[slot].undo ? store.get(SLOTS[slot].undo) : null;
  return { saved, undo: undo || null };
}

export function saveGame(store, state, undo) {
  const keys = SLOTS[slotOf(state)];
  store.set(keys.game, JSON.stringify(state));
  if (keys.undo) store.set(keys.undo, undo || '');
}
