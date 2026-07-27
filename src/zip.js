const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_ARCHIVE_SIZE = 30 * 1024 * 1024;
const MAX_XML_SIZE = 25 * 1024 * 1024;

function asUint8Array(input) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  throw new TypeError("ZIP_DATA_REQUIRED");
}

function findEndOfCentralDirectory(bytes, view) {
  const minimumOffset = Math.max(0, bytes.length - 65557);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  throw new Error("INVALID_MSCZ");
}

export function listZipEntries(input) {
  const bytes = asUint8Array(input);
  if (bytes.byteLength > MAX_ARCHIVE_SIZE) {
    throw new Error("FILE_TOO_LARGE");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(bytes, view);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder();
  const entries = [];
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > bytes.length ||
      view.getUint32(offset, true) !== CENTRAL_SIGNATURE
    ) {
      throw new Error("INVALID_MSCZ");
    }

    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;

    if (nameEnd > bytes.length) {
      throw new Error("INVALID_MSCZ");
    }

    entries.push({
      name: decoder.decode(bytes.subarray(nameStart, nameEnd)),
      flags,
      compression,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

async function decompressRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DECOMPRESSION_UNSUPPORTED");
  }

  let stream;
  try {
    stream = new DecompressionStream("deflate-raw");
  } catch {
    throw new Error("DECOMPRESSION_UNSUPPORTED");
  }

  const decompressed = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(decompressed).arrayBuffer());
}

export async function extractZipEntry(input, entry) {
  const bytes = asUint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (
    entry.localOffset + 30 > bytes.length ||
    view.getUint32(entry.localOffset, true) !== LOCAL_SIGNATURE
  ) {
    throw new Error("INVALID_MSCZ");
  }
  if (entry.flags & 0x1) {
    throw new Error("ENCRYPTED_MSCZ");
  }
  if (entry.uncompressedSize > MAX_XML_SIZE) {
    throw new Error("FILE_TOO_LARGE");
  }

  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;

  if (dataEnd > bytes.length) {
    throw new Error("INVALID_MSCZ");
  }

  const compressed = bytes.subarray(dataStart, dataEnd);
  let result;

  if (entry.compression === 0) {
    result = compressed.slice();
  } else if (entry.compression === 8) {
    result = await decompressRaw(compressed);
  } else {
    throw new Error("UNSUPPORTED_ZIP_COMPRESSION");
  }

  if (result.byteLength > MAX_XML_SIZE) {
    throw new Error("FILE_TOO_LARGE");
  }
  return result;
}

export async function extractMuseScoreXml(input) {
  const entries = listZipEntries(input);
  const scoreEntry = entries
    .filter((entry) => /\.mscx$/i.test(entry.name))
    .sort((left, right) => left.name.length - right.name.length)[0];

  if (!scoreEntry) {
    throw new Error("MSCX_NOT_FOUND");
  }

  const xmlBytes = await extractZipEntry(input, scoreEntry);
  return new TextDecoder().decode(xmlBytes);
}
