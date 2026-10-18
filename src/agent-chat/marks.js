// The working mark: each harness's own logo, moving the way that logo suggests.
//
// The package ships the MOTIONS (CSS keyframes in styles/agent-chat.css), never the logos: a
// host passes its official mark as a node and names a motion. motionFor(base) is the house
// choice for the harnesses we know, picked by looking at each mark:
//
//   bloom     the Claude starburst turns a quarter and breathes, like the CLI's ✻ ✽ ✶ spinner
//   sheen     a light passes across the tile (Codex's prompt, Kimi's K, Kilo's grid)
//   glint     brightens and swells, a spark catching light (Gemini)
//   flutter   a quick wing beat, tilt and lift (Hermes, the messenger)
//   glide     a bird's lift and settle (Goose)
//   blink     the tile blinks shut and open, a terminal cursor (OpenCode)
//   flip      a coin turning on its vertical axis (pi, omp)
//   swim      a short wave from nose to tail (DeepSeek's whale)
//   spin      a steady revolution, for round marks (Qwen, Grok, System One, OpenSquilla)
//   wave      hands waving from the wrist (OpenHands)
//   dash      a sprint forward and back (CheetahClaws)
//   scuttle   a sideways skitter (ZeroClaw's crab)
//   equalize  a level meter rising and falling (MiniMax's waveform)
//   bob       a soft hop (robots and app tiles: Cline, Agent Zero, Qoder, nanobot)
//   pulse     the default: scale and opacity breathing
//
// Every motion stops under prefers-reduced-motion; the mark then stands still and the line's
// words alone say the work is going on.

export const MARK_MOTIONS = {
  'claude-code': 'bloom', claude: 'bloom', anthropic: 'bloom',
  codex: 'sheen', openai: 'sheen',
  gemini: 'glint', 'gemini-cli': 'glint',
  hermes: 'flutter',
  goose: 'glide',
  opencode: 'blink',
  pi: 'flip', omp: 'flip',
  dsh: 'swim', deepseek: 'swim',
  qwen: 'spin', grok: 'spin', systemone: 'spin', opensquilla: 'spin',
  openhands: 'wave',
  cheetahclaws: 'dash',
  zeroclaw: 'scuttle',
  minimax: 'equalize',
  cline: 'bob', agentzero: 'bob', qoder: 'bob', nanobot: 'bob',
  kimi: 'sheen', kilo: 'sheen', jcode: 'pulse', mimo: 'pulse', aider: 'pulse',
};

export const MOTIONS = ['bloom', 'sheen', 'glint', 'flutter', 'glide', 'blink', 'flip', 'swim', 'spin', 'wave',
  'dash', 'scuttle', 'equalize', 'bob', 'pulse', 'dots'];

/** The motion for a base harness id, 'pulse' for one we do not know. */
export function motionFor(base) {
  const k = String(base || '').toLowerCase().trim();
  return MARK_MOTIONS[k] || 'pulse';
}
