import { Buffer } from 'node:buffer';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const resourceDirectory = new URL('../build-resources/', import.meta.url);
const source = await readFile(new URL('dev-container-icon.svg', resourceDirectory));
const sizes = [
  16,
  24,
  32,
  48,
  64,
  128,
  256,
];
const images = await Promise.all(
  sizes.map((size) => sharp(source).resize(size, size).png().toBuffer()),
);

// ICO directory entries reference PNG frames; Windows selects the frame for the current DPI.
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  directory.writeUInt8(size === 256 ? 0 : size, entry);
  directory.writeUInt8(size === 256 ? 0 : size, entry + 1);
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(images[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}

await Promise.all([
  writeFile(
    new URL('dev-container-icon.png', resourceDirectory),
    await sharp(source).png().toBuffer(),
  ),
  writeFile(
    new URL('dev-container-icon.ico', resourceDirectory),
    Buffer.concat([directory, ...images]),
  ),
]);
console.log(
  `Generated PNG and ${sizes.join('/')}px ICO from ${fileURLToPath(new URL('dev-container-icon.svg', resourceDirectory))}`,
);
