import { Transform, TransformCallback } from "stream";
import * as jwt from "jsonwebtoken";
import logger from "./logger";

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
  static verbs = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

  public publicKey = "";
  public saToken = "";
  private httpHeadersEnded = false;
  private headerChunks: Buffer[] = [];
  private httpHeadersStarted = false;

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
    if (!this.httpHeadersStarted && StreamImpersonator.verbs.includes(chunk.slice(0, chunk.indexOf(" ")).toString())) {
      this.httpHeadersStarted = true;
      this.httpHeadersEnded = false;
    }

    if (this.httpHeadersEnded) {
      if (!this.writableEnded) {
        this.push(Buffer.concat(this.headerChunks));
        this.push(chunk);
      }

      return callback();
    }

    this.headerChunks.push(chunk);

    const headerBuffer = Buffer.concat(this.headerChunks);

    if (this.httpHeadersStarted && headerBuffer.byteLength > StreamImpersonator.maxHeaderSize) {
      throw new Error("Too many header bytes seen; overflow detected");
    }

    if (this.httpHeadersStarted && headerBuffer.indexOf(StreamImpersonator.bodySeparatorBuffer) === -1) {
      return callback();
    }

    this.httpHeadersEnded = true;
    this.httpHeadersStarted = false;

    const jwtToken = this.parseTokenFromHttpHeaders(headerBuffer);

    if (!this.writableEnded) {
      if (jwtToken !== "") {
        this.headerChunks = [];
        const modifiedBuffer = this.impersonateJwtToken(headerBuffer, jwtToken);
        const newlineIndex = modifiedBuffer.lastIndexOf(StreamImpersonator.newlineBuffer);

        this.push(modifiedBuffer.slice(0, newlineIndex + 4));
        this.headerChunks.push(modifiedBuffer.slice(newlineIndex + 4));
      } else {
        this.push(chunk);
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

      logger.info(`[IMPERSONATOR] impersonating user ${tokenData.sub}`);
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
      logger.error("[IMPERSONATOR] jwt parsing failed: ", String(err));

      return chunk;
    }
  }
}
