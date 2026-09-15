// reifyui/collab — one live-document core for any collaborative surface.
//
// A separate entry because it pulls in yjs and the Hocuspocus provider: importing a Button
// from the root never costs a CRDT. Presence colors and the worker-clock keep-alive ride along
// (they have no dependencies) so a host wires collaboration from one import.
export { useLiveDoc } from './useLiveDoc.js';
export { keepPresenceAlive } from './keepAlive.js';
export { PEER_PALETTE, peerColor, withAlpha } from './colors.js';
