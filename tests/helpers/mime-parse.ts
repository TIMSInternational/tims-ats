// Minimal MIME reader for tests: splits a multipart message on its boundaries
// and base64-decodes each leaf part. Not a general-purpose parser.
export type MimeLeaf = { headers: string; contentType: string; body: string };

function boundaryOf(headers: string): string | null {
  return /boundary="([^"]+)"/.exec(headers)?.[1] ?? null;
}

export function splitHeaders(raw: string): { headers: string; body: string } {
  const i = raw.indexOf('\r\n\r\n');
  return { headers: raw.slice(0, i), body: raw.slice(i + 4) };
}

export function parseMime(raw: string): MimeLeaf[] {
  const { headers, body } = splitHeaders(raw);
  const boundary = boundaryOf(headers);
  if (!boundary) {
    const contentType = /Content-Type: ([^\r\n]+)/.exec(headers)?.[1] ?? '';
    const decoded = /Content-Transfer-Encoding: base64/.test(headers)
      ? Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')
      : body;
    return [{ headers, contentType, body: decoded }];
  }
  const end = body.indexOf(`--${boundary}--`);
  if (end < 0) throw new Error('missing closing boundary');
  return body
    .slice(0, end)
    .split(`--${boundary}\r\n`)
    .slice(1)
    .flatMap((chunk) => parseMime(chunk.replace(/\r\n$/, '')));
}
