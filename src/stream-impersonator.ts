import { Transform, TransformCallback } from "stream";
import * as jwt from "jsonwebtoken";
import logger from "./logger";
import { bodySeparatorBuffer, newlineBuffer, parseHeader, parseTokenFromHttpHeaders } from "./parse-header";

type TokenPayload = {
  exp: number;
  aud: string;
  sub: string;
  groups: string[];
};

export class StreamImpersonator extends Transform {
  static requestRegex = /^([A-Z-]+) ([^ ]+) HTTP\/(\d)\.(\d)$/m;
  static connectionUpgradeBuffer = Buffer.from("\r\nConnection: Upgrade\r\n");
  static maxHeaderSize = 80 * 1024;
  static pipelineableVerbs = ["GET", "OPTIONS", "HEAD"];
  static verbs = [...StreamImpersonator.pipelineableVerbs, "POST", "PUT", "PATCH", "DELETE"];

  public boredServer = "";
  public publicKey = "";
  public saToken = "";
  private httpHeadersStarted = false;
  private httpHeadersEnded = false;
  private headerChunks: Buffer[] = [];
  private connectionUpgrade = false;
  private pipelineable = false;

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
    if (!this.httpHeadersStarted && !this.connectionUpgrade) {
      const match = StreamImpersonator.requestRegex.exec(chunk.toString());

      if (!match) {
        throw new Error("Invalid request");
      }

      if (!StreamImpersonator.verbs.includes(match[1])) {
        throw new Error("Invalid request method");
      }

      if (StreamImpersonator.pipelineableVerbs.includes(match[1])) {
        this.pipelineable = true;
      }

      this.httpHeadersStarted = true;
      this.httpHeadersEnded = false;
    }

    if (this.httpHeadersEnded || this.connectionUpgrade) {
      if (!this.writableEnded) {
        if (this.headerChunks.length > 0) {
          this.push(Buffer.concat(this.headerChunks));
          this.headerChunks = [];
        }

        this.push(chunk);
      }

      return callback();
    }

    this.headerChunks.push(chunk);

    const headerBuffer = Buffer.concat(this.headerChunks);

    if (!this.httpHeadersEnded) {
      if (headerBuffer.byteLength > StreamImpersonator.maxHeaderSize) {
        throw new Error("Too many header bytes seen; overflow detected");
      }

      if (headerBuffer.indexOf(bodySeparatorBuffer) === -1) {
        return callback();
      } else {
        this.httpHeadersStarted = !this.pipelineable;
        this.httpHeadersEnded = true;
      }
    }

    if (headerBuffer.indexOf(StreamImpersonator.connectionUpgradeBuffer) !== -1) {
      this.connectionUpgrade = true;
    }

    if (this.writableEnded) {
      return callback();
    }

    const jwtToken = parseTokenFromHttpHeaders(headerBuffer);

    this.headerChunks = [];

    if (jwtToken) {
      this.validateRequestHeaders(headerBuffer);

      const modifiedBuffer = this.impersonateJwtToken(headerBuffer, jwtToken);
      const newlineIndex = modifiedBuffer.lastIndexOf(newlineBuffer);

      this.push(modifiedBuffer.slice(0, newlineIndex + 4));
      this.headerChunks.push(modifiedBuffer.slice(newlineIndex + 4));
    } else {
      this.push(headerBuffer);
    }

    return callback();
  }

  validateRequestHeaders(chunk: Buffer) {
    const headerBuffer = chunk.slice(0, chunk.indexOf(bodySeparatorBuffer));
    const headerLines = headerBuffer.toString().split(newlineBuffer.toString());

    for (const line of headerLines) {
      const [key] = parseHeader(line);

      if (key && key.trim().toLowerCase().startsWith("impersonate-")) {
        throw new Error(`impersonate headers are not accepted`);
      }
    }
  }

  impersonateJwtToken(chunk: Buffer, token: string) {
    try {
      const tokenData = jwt.verify(token, this.publicKey, {
        algorithms: ["RS256", "RS384", "RS512"],
        audience: [this.boredServer]
      }) as TokenPayload;
      const impersonatedHeaders: Buffer[] = [Buffer.from(this.saToken), newlineBuffer];

      logger.info(`[IMPERSONATOR] impersonating user ${tokenData.sub}`);
      impersonatedHeaders.push(Buffer.from(`Impersonate-User: ${tokenData.sub}`));
      tokenData?.groups?.forEach((group) => {
        impersonatedHeaders.push(newlineBuffer);
        impersonatedHeaders.push(Buffer.from(`Impersonate-Group: ${group}`));
      });

      const index = chunk.indexOf(token);
      const beforeToken = chunk.slice(0, index);
      const afterToken = chunk.slice(index + token.length);
      const replaceToken = Buffer.concat(impersonatedHeaders);
      const impersonatedChunk = Buffer.concat([beforeToken, replaceToken, afterToken]);

      return impersonatedChunk;
    } catch(err) {
      logger.error("[IMPERSONATOR] jwt parsing failed: %s", String(err));

      return chunk;
    }
  }
}
