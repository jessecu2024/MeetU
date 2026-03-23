// ============================================================
// Generate PNG and ICO icons from logo.svg
// Usage: node scripts/generate-icons.cjs
// ============================================================

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SVG_PATH = path.join(__dirname, '..', 'resources', 'icons', 'logo.svg');
const OUT_DIR = path.join(__dirname, '..', 'resources', 'icons');

async function generateIco(pngBuffer) {
  // ICO file format: header + directory entries + image data (embedded PNGs)
  const sizes = [256, 48, 32, 16];
  const images = [];

  for (const size of sizes) {
    const buf = await sharp(pngBuffer).resize(size, size).png().toBuffer();
    images.push({ size, data: buf });
  }

  // ICO header: 6 bytes
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * images.length;
  let dataOffset = headerSize + dirSize;

  const totalSize = dataOffset + images.reduce((sum, img) => sum + img.data.length, 0);
  const ico = Buffer.alloc(totalSize);

  // Header
  ico.writeUInt16LE(0, 0);          // reserved
  ico.writeUInt16LE(1, 2);          // type: 1 = ICO
  ico.writeUInt16LE(images.length, 4); // count

  // Directory entries + data
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const entryOffset = headerSize + i * dirEntrySize;

    ico.writeUInt8(img.size < 256 ? img.size : 0, entryOffset);     // width
    ico.writeUInt8(img.size < 256 ? img.size : 0, entryOffset + 1); // height
    ico.writeUInt8(0, entryOffset + 2);   // color palette
    ico.writeUInt8(0, entryOffset + 3);   // reserved
    ico.writeUInt16LE(1, entryOffset + 4);  // color planes
    ico.writeUInt16LE(32, entryOffset + 6); // bits per pixel
    ico.writeUInt32LE(img.data.length, entryOffset + 8);  // data size
    ico.writeUInt32LE(dataOffset, entryOffset + 12);      // data offset

    img.data.copy(ico, dataOffset);
    dataOffset += img.data.length;
  }

  return ico;
}

async function main() {
  console.log('Generating icons from', SVG_PATH);

  const svgBuffer = fs.readFileSync(SVG_PATH);

  // Generate 256x256 PNG
  const png256 = await sharp(svgBuffer).resize(256, 256).png().toBuffer();
  const pngPath = path.join(OUT_DIR, 'icon.png');
  fs.writeFileSync(pngPath, png256);
  console.log('  ✓ icon.png (256x256)');

  // Generate 512x512 PNG for high-DPI
  const png512 = await sharp(svgBuffer).resize(512, 512).png().toBuffer();
  fs.writeFileSync(path.join(OUT_DIR, 'icon-512.png'), png512);
  console.log('  ✓ icon-512.png (512x512)');

  // Generate ICO (multi-size: 256, 48, 32, 16)
  const icoBuffer = await generateIco(svgBuffer);
  const icoPath = path.join(OUT_DIR, 'icon.ico');
  fs.writeFileSync(icoPath, icoBuffer);
  console.log('  ✓ icon.ico (256/48/32/16)');

  console.log('Done! Icons saved to', OUT_DIR);
}

main().catch(err => {
  console.error('Failed to generate icons:', err);
  process.exit(1);
});
