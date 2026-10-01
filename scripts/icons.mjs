import { mkdir, writeFile } from "node:fs/promises";
import { zlibSync } from "fflate";
const table = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = table[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const name = Buffer.from(type),
    out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  name.copy(out, 4);
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, -4)), out.length - 4);
  return out;
}
function rounded(x, y, l, t, r, b, radius) {
  const cx = Math.max(l + radius, Math.min(x, r - radius)),
    cy = Math.max(t + radius, Math.min(y, b - radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}
function pixel(x, y) {
  if (!rounded(x, y, 0, 0, 128, 128, 29)) return [0, 0, 0, 0];
  const red = [232, 53, 66, 255];
  if (rounded(x, y, 31, 25, 97, 31, 3)) return [244, 154, 160, 255];
  if (rounded(x, y, 25, 34, 103, 40, 3)) return [249, 205, 208, 255];
  if (rounded(x, y, 19, 44, 109, 104, 15)) {
    if (x >= 54 && x <= 81 && Math.abs(y - 74) <= ((81 - x) * 16) / 27)
      return red;
    return [255, 255, 255, 255];
  }
  return red;
}
export async function writeIcons() {
  await mkdir("dist/icons", { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    const raw = new Uint8Array(size * (1 + size * 4));
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const sum = [0, 0, 0, 0];
        for (let a = 0; a < 4; a++)
          for (let b = 0; b < 4; b++)
            pixel(
              ((x + (a + 0.5) / 4) * 128) / size,
              ((y + (b + 0.5) / 4) * 128) / size,
            ).forEach((v, i) => (sum[i] += v));
        raw.set(
          sum.map((v) => Math.round(v / 16)),
          y * (size * 4 + 1) + 1 + x * 4,
        );
      }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    await writeFile(
      `dist/icons/${size}.png`,
      Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", ihdr),
        chunk("IDAT", zlibSync(raw)),
        chunk("IEND", new Uint8Array()),
      ]),
    );
  }
}
