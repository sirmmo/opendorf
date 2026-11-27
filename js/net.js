// Online play through the Lilienstern game server (lilienstern-server): one WebSocket to it,
// which comes back by itself when the line drops. The same protocol as Lilienstern's own
// browser games (web/marches/net.js).
//
// The server never runs the game: every browser does, with the same rules. The server keeps
// each room's moves in one order (the log), sends each to everyone, and ends a "day" (`step`)
// when every seated player has ended it or the pace's clock runs out. In OpenDorf a day is a
// turn. A browser that falls behind, or comes back after a reload, gets the moves it misses.

export const SERVER = 'wss://lilienstern.fantasymaps.org/ws';
export const GAME_ID = 'opendorf';

// How long a turn may take: no limit, or at most 30 s, 1 or 2 minutes (the server's paces).
export const PACES = [
  ['wait', 'No time limit'],
  ['limit-30', '30 seconds a turn'],
  ['limit-60', '1 minute a turn'],
  ['limit-120', '2 minutes a turn'],
];
export const paceName = (p) => (PACES.find(([v]) => v === p) || PACES[0])[1];

export function cleanCode(text) {
  return (text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

// The server to use: `?server=` on the page's address (for tests), or Lilienstern's.
export function serverUrl() {
  return new URLSearchParams(location.search).get('server') || SERVER;
}

// Opens a connection; resolves once it is open, fails if the server cannot be reached.
// `onMessage(msg)` gets every message; `onState('lost' | 'back')` hears when the line drops and
// when it is back (then the page says hello again: the server remembers players, not lines).
export function connect(onMessage, onState) {
  const url = serverUrl();
  let ws = null;
  let tries = 0;
  let closed = false;
  const conn = {
    // Sends a message; false if the line is down (it will be back).
    send(msg) {
      if (!ws || ws.readyState !== 1) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    get open() { return !!ws && ws.readyState === 1; },
    close() { closed = true; if (ws) ws.close(); },
  };
  return new Promise((ok, fail) => {
    let first = true;
    const open = () => {
      try {
        ws = new WebSocket(url);
      } catch (e) {
        if (first) { first = false; fail(e); }
        return;
      }
      const timer = setTimeout(() => { if (ws.readyState === 0) ws.close(); }, 10000);
      ws.onopen = () => {
        clearTimeout(timer);
        tries = 0;
        if (first) { first = false; ok(conn); } else onState('back');
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        onMessage(msg);
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (closed) return;
        if (first) { first = false; fail(new Error('unreachable')); return; }
        if (tries === 0) onState('lost');
        setTimeout(open, Math.min(10000, 500 * 2 ** tries++));
      };
    };
    open();
  });
}

// Who this browser tab is, so a player gets their seat back after a reload or a dropped line.
// Kept for the tab only: another tab (or another person on this computer) is someone else.
let mine = null;
export function token() {
  if (mine) return mine;
  const fresh = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    mine = sessionStorage.getItem('opendorf.token');
    if (!mine) {
      mine = fresh();
      sessionStorage.setItem('opendorf.token', mine);
    }
  } catch {
    mine = fresh();
  }
  return mine;
}

// A fingerprint of the rules' files, so everyone in a room is sure to play the same game.
export async function rulesVersion() {
  let h = 0x811c9dc5;
  for (const f of ['js/rules.js', 'js/tiles.js']) {
    const text = await (await fetch(f)).text();
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h.toString(16);
}
