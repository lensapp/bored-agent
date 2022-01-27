const headerRegex = /^([^: \t]+):[ \t]*((?:.*[^ \t])|)/;
const tokenSearch = /^authorization:\s*bearer\s+(.+)$/im;
const crlfWhitespace = "\r\n ";

export const bodySeparatorBuffer = Buffer.from("\r\n\r\n");
export const newlineBuffer = Buffer.from("\r\n");

export function parseHeader(line: string) {
  if (line.indexOf("\r") !== -1) {
    throw new Error("HPE_LF_EXPECTED");
  }

  const lineParts = line.split("\n");
  const match = headerRegex.exec(lineParts.shift() || "");

  if (match !== null && match.length >= 3) {
    return [match[1].trim().toLowerCase(), [match[2], ...lineParts].join("\n")];
  }

  return [];
}

export function parseTokenFromHttpHeaders(chunk: Buffer) {
  const match = tokenSearch.exec(chunk.toString());

  if (!match) {
    return undefined;
  }

  return match[1];
}

export function sanitizeHeaders(headerBuffer: Buffer) {
  const headers = headerBuffer.toString();
  const sanitizedHeaders = headers.replaceAll(crlfWhitespace, " ");

  return Buffer.from(sanitizedHeaders);
}
