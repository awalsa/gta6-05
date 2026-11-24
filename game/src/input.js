// ISLA BRASA 3D — keyboard and mouse input. One shared `input` object: modules
// read input.keys (a Set of event.code strings) and input.mouse each frame.
// initInput() wires the window listeners once; main.js calls it at boot.

export const input = {
  keys: new Set(),
  mouse: { x: 0, y: 0, down: false },
};

let attached = false;

export function initInput() {
  if (attached) return;
  attached = true;

  window.addEventListener('keydown', (event) => {
    // Ignore key repeats for the Set (a repeat is already present) and keep
    // typing in overlay inputs from leaking into the game: overlays stop
    // propagation on their own fields, so here we just record the key.
    input.keys.add(event.code);
    // Keep the page from scrolling on game keys.
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.code)) {
      event.preventDefault();
    }
  });

  window.addEventListener('keyup', (event) => {
    input.keys.delete(event.code);
  });

  window.addEventListener('blur', () => {
    // Losing the window must not leave the player running or driving forever.
    input.keys.clear();
    input.mouse.down = false;
  });

  window.addEventListener('mousemove', (event) => {
    input.mouse.x = event.clientX;
    input.mouse.y = event.clientY;
  });

  window.addEventListener('mousedown', (event) => {
    if (event.button === 0) input.mouse.down = true;
  });

  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) input.mouse.down = false;
  });
}

// Convenience check used by gameplay modules: is this physical key held now?
export function isDown(code) {
  return input.keys.has(code);
}

export default input;
