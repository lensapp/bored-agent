import { Transform, TransformCallback } from "stream";
import { HTTPParser, HTTPParserJS } from "http-parser-js";
import { chunk } from "lodash";
import * as jwt from "jsonwebtoken";
import logger, { logLevel } from "./logger";
import { removeBytesFromBuffersHead } from "./stream-utils";

type TokenPayload = {
  exp: number;
  aud: string;
  sub: string;
  groups: string[];
};

type Headers = Array<Array<string>>;

type GetSaToken = () => string;

const endOfHeadersMarker = `\r\n\r\n`;

export class StreamImpersonator extends Transform {
  public boredServer = "";
  public publicKey = "";

  private headersReceived = false;
  private chunks: Buffer[] = [];
  private httpParser: HTTPParserJS;
  private upgrade = false;
  private getSaToken: GetSaToken;

  // If the a chunk can't be parsed fully, unparsed bytes are saved to be passed
  // when we receive the next chunk
  private partialMessage: Buffer[] = [];

  constructor(getSaToken: GetSaToken) {
    super();

    this.getSaToken = getSaToken;

    this.httpParser = new HTTPParser("REQUEST");

    this.httpParser.onHeadersComplete = (info) => {
      if (this.upgrade) {
        this.flushChunks();

        return 0;
      }

      this.push(`${info.method} ${info.url} HTTP/${info.versionMajor}.${info.versionMinor}\r\n`);
      logger.trace(`onHeadersComplete: ${info.method} ${info.url} HTTP/${info.versionMajor}.${info.versionMinor}\r\n`);

      const headers = chunk(info.headers as unknown as string[], 2).map((val) => [val[0].trim().toLowerCase(), val[1]]) as Headers;

      this.validateRequestHeaders(headers);

      let token: string | null = null;
      const authIndex = headers.findIndex((h) => h[0] === "authorization");

      if (authIndex !== -1) {
        token = headers[authIndex][1].trim().replace("Bearer ", "");

        if (token && token !== "") {
          const tokenData = this.impersonateJwtToken(headers, token, authIndex);

          if (tokenData) {
            logger.info(`[AUDIT] impersonating user ${tokenData.sub} (groups: ${tokenData.groups}) : ${info.method} ${info.url}`);
          }

          this.push(headers.map((h) => `${h[0]}: ${h[1]}`).join("\r\n"));
          this.push("\r\n\r\n");
          this.chunks = [];
        } else {
          this.flushChunks();
        }
      } else {
        this.flushChunks();
      }

      this.upgrade = info.upgrade || !!headers.find((h) => h[0] === "connection" && h[1].toLowerCase() === "upgrade");

      if (this.upgrade) {
        logger.trace("upgrade in onHeadersComplete");
      }

      return 0;
    };

    this.httpParser.onMessageComplete = () => {
      logger.trace("onMessageComplete");
      this.flushChunks();
      this.headersReceived = false;
    };
  }

  private flushChunks() {
    logger.trace("flushChunks");

    if (this.chunks.length > 0) {
      this.push(Buffer.concat(this.chunks));
      this.chunks = [];
    }
  }

  _final(callback: TransformCallback): void {
    this.flushChunks();
    callback();
  }

  private handleError(error: Error) {
    this.headersReceived = false;
    this.partialMessage = [];
    this.chunks = [];
    logger.error("[IMPERSONATOR] Error parsing HTTP data: %s", String(error));

    throw error;
  };

  private executeParser(bufferToParse: Buffer) {
    try {
      const bytesParsed = this.httpParser.execute(bufferToParse);

      if (bytesParsed instanceof Error) {
        return this.handleError(bytesParsed);
      }

      // Remove parsed bytes from the partialMessage buffers
      this.partialMessage = removeBytesFromBuffersHead(this.partialMessage, bytesParsed);
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    if (logLevel === "trace") {
      console.log(chunk.toString("utf8"));
    }

    if (this.upgrade) {
      this.push(chunk);

      return callback();
    }

    this.chunks.push(chunk);
    this.partialMessage.push(chunk);

    const receivedSoFar = Buffer.concat(this.partialMessage);
    const headerEndIndex = receivedSoFar.indexOf(endOfHeadersMarker);

    // Wait for more data if headers are incomplete and not received yet
    if (headerEndIndex === -1 && !this.headersReceived) {
      return callback();
    }

    // Parse headers if not parsed yet
    if (headerEndIndex !== -1 && !this.headersReceived) {
      this.headersReceived = true;

      // Extract headers
      // +endOfHeadersMarker.length to include the \r\n\r\n in the header
      const bufferToParse = Buffer.concat(this.partialMessage).subarray(0, headerEndIndex + endOfHeadersMarker.length);

      this.executeParser(bufferToParse);

      // onHeadersComplete sets this.chunks to [], we set the rest of the bytes after the header back
      this.chunks = [Buffer.concat(this.partialMessage)];
    }

    const bufferToParse = Buffer.concat(this.partialMessage);
  
    this.executeParser(bufferToParse);

    callback();
  }

  validateRequestHeaders(headers: Headers) {
    for (const [key] of headers) {
      if (key.startsWith("impersonate-")) {
        throw new Error(`impersonate headers are not accepted`);
      }
    }

    if (headers.filter((h) => h[0] === "authorization").length > 1) {
      throw new Error(`multiple authorization headers detected`);
    }
  }

  impersonateJwtToken(headers: Headers, token: string, authIndex: number) {
    try {
      const tokenData = jwt.verify(token, this.publicKey, {
        algorithms: ["RS256", "RS384", "RS512"],
        audience: [this.boredServer]
      }) as TokenPayload;

      // remove existing authorization header
      headers.splice(authIndex, 1);

      headers.push(["authorization", `Bearer ${this.getSaToken()}`]);
      headers.push(["impersonate-user", tokenData.sub]);

      tokenData?.groups?.forEach((group) => {
        headers.push(["impersonate-group", group]);
      });

      return tokenData;
    } catch(err) {
      logger.error("[IMPERSONATOR] jwt parsing failed: %s", String(err));
    }
  }
}
