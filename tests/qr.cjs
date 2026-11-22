const assert = require('node:assert/strict');
const crypto = require('node:crypto');
global.window = {};
require('../assets/qr.js');
const decode = require('../assets/jsQR.js');
for (let item = 0; item < 10; item++) {
  const id = 'TD-' + crypto.randomBytes(12).toString('hex').toUpperCase();
  const grid = window.TechQR(id);
  const scale = 6, quiet = 4, size = (grid.length + 2 * quiet) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid[Math.floor(y / scale) - quiet]?.[Math.floor(x / scale) - quiet]) {
        const at = (y * size + x) * 4;
        pixels.fill(0, at, at + 3);
      }
    }
  }
  assert.equal(decode(pixels, size, size).data, id);
}
console.log('Ten unique passes decoded successfully.');
