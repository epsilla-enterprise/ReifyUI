// Files, on their way into a turn.
//
// One mechanism for every place a file gets attached — the person's own attachment in the chat
// panel, and an upstream computed cell's artifact handed to the next one. Both become an
// `input_file` block on the turn, which the gateway writes into the working directory before the
// agent starts.
//
// This lives with the transport because `input_file` is that transport's block shape, not a
// general idea about files.
//
// Deliberately NOT a workspace PUT: that needs a session which a brand-new document does not have
// yet, it is refused 409 while a turn is running, and it cannot carry bytes that are not text —
// one kit shipped `await file.text()` here and corrupted every PDF and image it was given.

/** Per-file cap the API enforces. Refuse a bigger file by name rather than truncating it. */
export const FILE_MAX = 25 * 1024 * 1024;

const MIME = {
  md: 'text/markdown', txt: 'text/plain', json: 'application/json', csv: 'text/csv',
  tsv: 'text/tab-separated-values', html: 'text/html', py: 'text/x-python', js: 'text/javascript',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export const mimeOf = (name, fallback = 'application/octet-stream') =>
  MIME[String(name).split('.').pop().toLowerCase()] || fallback;

/** ArrayBuffer -> data: URL, chunked because a single fromCharCode over a large file overflows
 *  the argument stack. */
export function bufferToDataUrl(buf, filename, type) {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return `data:${type || mimeOf(filename)};base64,${btoa(bin)}`;
}

/** A picked File -> the staged entry a chat panel hands back to its runTurn.
 *
 *  The return shape is ChatPanel's StagedFile ({name, size, payload}) on purpose, so a kit's
 *  whole attachment story is `attachments={{ prepare: fileToInputBlock }}` and the panel never
 *  learns what a block is. `payload` is the `input_file` block; the caller puts it in `input`.
 *
 *  Throws with the file's OWN name if it is too large — the message reaches the person, so it
 *  names the file they picked rather than reporting a limit in the abstract. */
export async function fileToInputBlock(file, { maxBytes = FILE_MAX } = {}) {
  if (file.size > maxBytes) {
    throw new Error(`${file.name} is ${Math.round(file.size / 1048576)} MB`
      + ` — the limit is ${Math.round(maxBytes / 1048576)} MB.`);
  }
  const buf = await file.arrayBuffer();
  return {
    name: file.name,
    size: file.size,
    payload: {
      type: 'input_file',
      filename: file.name,
      file_data: bufferToDataUrl(buf, file.name, file.type),
    },
  };
}
