/**
 * Layout-independent position model for reflow books.
 * sectionFraction is character-weighted: (chars before position within section) / (section chars),
 * so it survives re-pagination (font/size/layout changes).
 */
export interface ChunkMeta { section: number; textStart: number; textLen: number }

export function sectionTextLen(chunks: ChunkMeta[], chunkIdxs: number[]): number {
  if (!chunkIdxs.length) return 0;
  const last = chunks[chunkIdxs[chunkIdxs.length - 1]];
  return last.textStart + last.textLen;
}

/** chunk + fraction inside chunk (0..1) -> section fraction */
export function toSectionFraction(chunks: ChunkMeta[], sectionChunks: number[], chunk: number, fracInChunk: number): number {
  const total = sectionTextLen(chunks, sectionChunks);
  if (total <= 0) return 0;
  const c = chunks[chunk];
  return Math.min(1, Math.max(0, (c.textStart + fracInChunk * c.textLen) / total));
}

/** section fraction -> chunk (global index) and fraction inside it */
export function fromSectionFraction(chunks: ChunkMeta[], sectionChunks: number[], f: number): { chunk: number; frac: number } {
  const total = sectionTextLen(chunks, sectionChunks);
  const pos = Math.min(1, Math.max(0, f)) * total;
  for (const ci of sectionChunks) {
    const c = chunks[ci];
    if (pos < c.textStart + c.textLen || ci === sectionChunks[sectionChunks.length - 1]) {
      const frac = c.textLen > 0 ? (pos - c.textStart) / c.textLen : 0;
      return { chunk: ci, frac: Math.min(1, Math.max(0, frac)) };
    }
  }
  return { chunk: sectionChunks[0] ?? 0, frac: 0 };
}

/** Whole-book fraction (0..1), character weighted. */
export function overallFraction(chunks: ChunkMeta[], chunk: number, fracInChunk: number): number {
  if (!chunks.length) return 0;
  let total = 0, before = 0;
  chunks.forEach((c, i) => { if (i < chunk) before += c.textLen; total += c.textLen; });
  if (total <= 0) return chunks.length > 1 ? chunk / (chunks.length - 1) : 0;
  return Math.min(1, (before + fracInChunk * chunks[chunk].textLen) / total);
}

/** Pick first chunk with section >= wanted (sections with no content have no chunks). */
export function chunkForSection(sectionChunks: number[][], section: number): number | undefined {
  for (let s = Math.max(0, section); s < sectionChunks.length; s++) if (sectionChunks[s].length) return sectionChunks[s][0];
  for (let s = Math.min(section, sectionChunks.length - 1); s >= 0; s--) if (sectionChunks[s].length) return sectionChunks[s][0];
  return undefined;
}
