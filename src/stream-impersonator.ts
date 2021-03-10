import { Transform, TransformCallback } from "stream";
import * as jwt from "jsonwebtoken";

type TokenPayload = {
  exp: number;
  aud: string;
  sub: string;
  roles: string[];
};

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

    if (chunk.includes("\r\n\r\n")) {
      this.httpHeadersEnded = true;
    }

    if (!this.httpHeadersEnded) {
      return callback(); // wait for more data
    }

    const headerBuffer = Buffer.concat(this.headerChunks);
    const jwtToken = this.parseTokenFromHttpHeaders(headerBuffer);

    if (jwtToken !== "" && !this.writableEnded) {
      this.push(this.impersonateJwtToken(headerBuffer, jwtToken));
    }

    return callback();
  }

  parseTokenFromHttpHeaders(chunk: Buffer) {
    const search = "Authorization: Bearer ";
    const index = chunk.indexOf(search);

    if (index === -1) {
      return "";
    }

    const tokenBuffer = chunk.slice(index);
    const newLineIndex = tokenBuffer.indexOf("\r\n");

    if (newLineIndex === -1) {
      return "";
    }

    return tokenBuffer.slice(search.length, newLineIndex).toString("utf-8");
  }

  impersonateJwtToken(chunk: Buffer, token: string) {
    try {
      const tokenData = jwt.verify(token, this.publicKey) as TokenPayload;
      const newlineBuffer = Buffer.from("\r\n", "utf-8");
      const impersonatedHeaders: Buffer[] = [Buffer.from(this.saToken, "utf-8"), newlineBuffer];

      impersonatedHeaders.push(Buffer.from(`Impersonate-User: ${tokenData.sub}`, "utf-8"));

      tokenData?.roles?.forEach((role) => {
        impersonatedHeaders.push(newlineBuffer);
        impersonatedHeaders.push(Buffer.from(`Impersonate-Group: ${role}`, "utf-8"));
      });

      const index = chunk.indexOf(token);
      const beforeToken = chunk.slice(0, index);
      const afterToken = chunk.slice(index + token.length);
      const replaceToken = Buffer.concat(impersonatedHeaders);
      const impersonatedChunk = Buffer.concat([beforeToken, replaceToken, afterToken]);

      return impersonatedChunk;
    } catch(err) {
      console.error(err);

      return chunk;
    }
  }
}
