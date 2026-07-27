import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import { extractMuseScoreXml, listZipEntries } from "../src/zip.js";

function writeUint16(buffer, offset, value) {
  buffer.writeUInt16LE(value, offset);
}

function writeUint32(buffer, offset, value) {
  buffer.writeUInt32LE(value, offset);
}

function makeZip(fileName, content, compressed = true) {
  const name = Buffer.from(fileName);
  const raw = Buffer.from(content);
  const data = compressed ? deflateRawSync(raw) : raw;
  const method = compressed ? 8 : 0;
  const local = Buffer.alloc(30 + name.length + data.length);
  writeUint32(local, 0, 0x04034b50);
  writeUint16(local, 4, 20);
  writeUint16(local, 8, method);
  writeUint32(local, 18, data.length);
  writeUint32(local, 22, raw.length);
  writeUint16(local, 26, name.length);
  name.copy(local, 30);
  data.copy(local, 30 + name.length);

  const central = Buffer.alloc(46 + name.length);
  writeUint32(central, 0, 0x02014b50);
  writeUint16(central, 4, 20);
  writeUint16(central, 6, 20);
  writeUint16(central, 10, method);
  writeUint32(central, 20, data.length);
  writeUint32(central, 24, raw.length);
  writeUint16(central, 28, name.length);
  writeUint32(central, 42, 0);
  name.copy(central, 46);

  const eocd = Buffer.alloc(22);
  writeUint32(eocd, 0, 0x06054b50);
  writeUint16(eocd, 8, 1);
  writeUint16(eocd, 10, 1);
  writeUint32(eocd, 12, central.length);
  writeUint32(eocd, 16, local.length);

  const archive = Buffer.concat([local, central, eocd]);
  return archive.buffer.slice(
    archive.byteOffset,
    archive.byteOffset + archive.byteLength,
  );
}

const sample = '<?xml version="1.0"?><museScore><Score /></museScore>';

test("lists MuseScore files in a ZIP archive", () => {
  const archive = makeZip("score.mscx", sample, false);
  const entries = listZipEntries(archive);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "score.mscx");
});

test("extracts a stored MSCX document", async () => {
  const archive = makeZip("score.mscx", sample, false);
  assert.equal(await extractMuseScoreXml(archive), sample);
});

test("extracts a deflate-compressed MSCX document", async () => {
  const archive = makeZip("Scores/main.mscx", sample, true);
  assert.equal(await extractMuseScoreXml(archive), sample);
});
