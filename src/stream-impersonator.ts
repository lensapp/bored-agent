import { Transform, TransformCallback } from "stream";
import * as jwt from "jsonwebtoken";

type TokenPayload = {
  exp: number;
  aud: string;
  sub: string;
  roles: string[];
};

const newlineBuffer = Buffer.from("\r\n");
const bodySeparatorBuffer = Buffer.from("\r\n\r\n");
const authorizationSearch = "Authorization: Bearer ";

export class StreamImpersonator extends Transform {
  public publicKey = "";
  public saToken = "";
  private httpHeadersEnded = false;
  private headerChunks: Buffer[] = [];

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
    if (this.httpHeadersEnded) {
      if (!this.writableEnded) this.push(chunk);

      return callback();
    }
    this.headerChunks.push(chunk);

    const headerBuffer = Buffer.concat(this.headerChunks);

    if (headerBuffer.includes(bodySeparatorBuffer)) {
      this.httpHeadersEnded = true;
    }

    if (!this.httpHeadersEnded) {
      return callback(); // wait for more data
    }
    this.headerChunks = [];

    const jwtToken = this.parseTokenFromHttpHeaders(headerBuffer);

    if (!this.writableEnded) {
      if (jwtToken !== "") {
        this.push(this.impersonateJwtToken(headerBuffer, jwtToken));
      } else {
        this.push(headerBuffer);
      }
    }

    return callback();
  }

  parseTokenFromHttpHeaders(chunk: Buffer) {
    const search = authorizationSearch;
    const index = chunk.indexOf(search);

    if (index === -1) {
      return "";
    }

    const tokenBuffer = chunk.slice(index);
    const newLineIndex = tokenBuffer.indexOf(newlineBuffer);

    if (newLineIndex === -1) {
      return "";
    }

    return tokenBuffer.slice(search.length, newLineIndex).toString();
  }

  impersonateJwtToken(chunk: Buffer, token: string) {
    try {
      const tokenData = jwt.verify(token, this.publicKey, {
        algorithms: ["RS256", "RS384", "RS512"]
      }) as TokenPayload;
      const impersonatedHeaders: Buffer[] = [Buffer.from(this.saToken), newlineBuffer];

      impersonatedHeaders.push(Buffer.from(`Impersonate-User: ${tokenData.sub}`));
      tokenData?.roles?.forEach((role) => {
        impersonatedHeaders.push(newlineBuffer);
        impersonatedHeaders.push(Buffer.from(`Impersonate-Group: ${role}`));
      });

      const index = chunk.indexOf(token);
      const beforeToken = chunk.slice(0, index);
      const afterToken = chunk.slice(index + token.length);
      const replaceToken = Buffer.concat(impersonatedHeaders);
      const impersonatedChunk = Buffer.concat([beforeToken, replaceToken, afterToken]);

      return impersonatedChunk;
    } catch(err) {
      console.error("jwt parsing failed: ", String(err));

      return chunk;
    }
  }
}
