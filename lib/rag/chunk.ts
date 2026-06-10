export interface Chunk {
  index: number;
  content: string;
}

export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

/**
 * Character-based sliding-window splitter. ~1000 chars (≈250 tokens) with
 * 200-char overlap by default. Prefers to break on the nearest newline or
 * space before the hard limit so chunks land on natural boundaries.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const chunkSize = opts.chunkSize ?? 1000;
  const overlap = opts.overlap ?? 200;
  if (overlap >= chunkSize) {
    throw new Error("chunkText: overlap must be less than chunkSize");
  }
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= chunkSize) return [{ index: 0, content: normalized }];

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;
  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);
    // Try to break on a boundary if we are not at the very end.
    if (end < normalized.length) {
      const slice = normalized.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
      if (lastBreak > chunkSize - overlap) {
        end = start + lastBreak + 1;
      }
    }
    chunks.push({ index, content: normalized.slice(start, end).trim() });
    index += 1;
    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter((c) => c.content.length > 0);
}
