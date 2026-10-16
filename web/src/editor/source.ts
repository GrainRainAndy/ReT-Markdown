import type { EOL, Patch, Source } from '../protocol';

const high = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const low = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** TextEncoder replaces lone surrogates; reject them before any encoding. */
function validateText(text: string, eols: readonly EOL[]): void {
  if (typeof text !== 'string' || !Array.isArray(eols)) throw new Error('Invalid source text or EOL array');
  let lines = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit === 13) throw new Error('Text must be LF-normalized');
    if (unit === 10) lines++;
    if (high(unit)) {
      if (!low(text.charCodeAt(++i))) throw new Error('Unpaired high surrogate');
    } else if (low(unit)) throw new Error('Unpaired low surrogate');
  }
  if (eols.length !== lines) throw new Error('EOL cardinality does not match text');
  for (const eol of eols) {
    if (eol !== '\n' && eol !== '\r\n' && eol !== '\r') throw new Error('Invalid EOL');
  }
}

function validateSource(source: Source): void {
  if (!source || typeof source.bom !== 'boolean') throw new Error('Invalid source BOM');
  validateText(source.text, source.eols);
}

export function decodeSource(bytes: Uint8Array): Source {
  // ignoreBOM:true keeps U+FEFF in the decoded string so exactly one is removed here.
  const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const bom = decoded.startsWith('\ufeff');
  const eols: EOL[] = [];
  const text = decoded.slice(bom ? 1 : 0).replace(/\r\n|\r|\n/g, eol => {
    eols.push(eol as EOL);
    return '\n';
  });
  return { text, eols, bom };
}

export function encodeSource(source: Source): Uint8Array {
  validateSource(source);
  let line = 0;
  const text = source.text.replace(/\n/g, () => source.eols[line++]);
  return new TextEncoder().encode((source.bom ? '\ufeff' : '') + text);
}

export function applyPatches(source: Source, patches: readonly Patch[]): Source {
  validateSource(source);
  if (!Array.isArray(patches)) throw new Error('Invalid patches');
  const boundary = (offset: number) => Number.isSafeInteger(offset) && offset >= 0 && offset <= source.text.length &&
    !(high(source.text.charCodeAt(offset - 1)) && low(source.text.charCodeAt(offset)));
  let previousEnd = 0;
  for (const patch of patches) {
    if (!patch || !boundary(patch.from) || !boundary(patch.to) || patch.from < previousEnd || patch.to < patch.from) {
      throw new Error('Invalid, overlapping or unsorted UTF-16 patch range');
    }
    validateText(patch.insert, patch.eols);
    previousEnd = patch.to;
  }

  const pieces: string[] = [];
  const eols: EOL[] = [];
  let cursor = 0;
  let line = 0;
  // Walk original text once; patch coordinates always refer to this original text.
  const consume = (end: number, keep: boolean) => {
    if (keep) pieces.push(source.text.slice(cursor, end));
    for (; cursor < end; cursor++) {
      if (source.text.charCodeAt(cursor) === 10) {
        if (keep) eols.push(source.eols[line]);
        line++;
      }
    }
  };
  for (const patch of patches) {
    consume(patch.from, true);
    consume(patch.to, false);
    pieces.push(patch.insert);
    for (const eol of patch.eols) eols.push(eol);
  }
  consume(source.text.length, true);
  return { text: pieces.join(''), eols, bom: source.bom };
}
