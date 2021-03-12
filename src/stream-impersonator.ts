import { Transform, TransformCallback } from "stream";
import * as jwt from "jsonwebtoken";

type TokenPayload = {
  exp: number;
  aud: string;
  sub: string;
  groups: string[];
};

export class StreamImpersonator extends Transform {
  static newlineBuffer = Buffer.from("\r\n");
  static bodySeparatorBuffer = Buffer.from("\r\n\r\n");
  static authorizationSearch = "Authorization: Bearer ";
  static maxHeaderSize = 80 * 1024;

  public publicKey = "";
  public saToken = "";
  private httpHeadersEnded = false;
  private pipelining = false;
  private headerChunks: Buffer[] = [];

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
    if (this.httpHeadersEnded && !this.pipelining) {
      if (!this.writableEnded) this.push(chunk);

      return callback();
    }

    this.headerChunks.push(chunk);

    const headerBuffer = Buffer.concat(this.headerChunks);

    if (headerBuffer.byteLength > StreamImpersonator.maxHeaderSize) {
      throw new Error("Too many header bytes seen; overflow detected");
    }

    if (headerBuffer.includes(StreamImpersonator.bodySeparatorBuffer)) {
      this.httpHeadersEnded = true;
    }

    if (!this.httpHeadersEnded && !this.pipelining) {
      return callback(); // wait for more data
    }

    const jwtToken = this.parseTokenFromHttpHeaders(headerBuffer);

    if (!this.writableEnded) {
      if (jwtToken !== "") {
        this.headerChunks = [];
        const modifiedBuffer = this.impersonateJwtToken(headerBuffer, jwtToken);



        const protocolLine = headerBuffer.slice(0, headerBuffer.indexOf(StreamImpersonator.newlineBuffer));
        const verb = protocolLine.toString().split(" ")[0];

        if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") {
          this.pipelining = true; // http request pipelining

          const newlineIndex = modifiedBuffer.lastIndexOf(StreamImpersonator.newlineBuffer);

          this.push(modifiedBuffer.slice(0, newlineIndex + 2));
          this.headerChunks.push(modifiedBuffer.slice(newlineIndex + 2));
        } else {
          this.push(modifiedBuffer);
        }
      } else {
        this.push(headerBuffer);
      }
    }

    return callback();
  }

  parseTokenFromHttpHeaders(chunk: Buffer) {
    const search = StreamImpersonator.authorizationSearch;
    const index = chunk.indexOf(search);

    if (index === -1) {
      return "";
    }

    const tokenBuffer = chunk.slice(index);
    const newLineIndex = tokenBuffer.indexOf(StreamImpersonator.newlineBuffer);

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
      const impersonatedHeaders: Buffer[] = [Buffer.from(this.saToken), StreamImpersonator.newlineBuffer];

      impersonatedHeaders.push(Buffer.from(`Impersonate-User: ${tokenData.sub}`));
      tokenData?.groups?.forEach((group) => {
        impersonatedHeaders.push(StreamImpersonator.newlineBuffer);
        impersonatedHeaders.push(Buffer.from(`Impersonate-Group: ${group}`));
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
