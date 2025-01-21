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

export class StreamImpersonator extends Transform {
  public boredServer = "";
  public publicKey = "";

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

    this.httpParser.onBody = (
      bodyChunk: Buffer,
      start: number,
      len: number,
    ) => {
      logger.trace("onBody");
      this.chunks.push(bodyChunk.subarray(start, start + len));
    };

    this.httpParser.onMessageComplete = () => {
      logger.trace("onMessageComplete");
      this.flushChunks();
    };
  }

  private flushChunks() {
    logger.trace("flushChunks");

    if (this.chunks.length > 0) {
      logger.trace("flushChunks -> writing chunks");
      this.push(Buffer.concat(this.chunks));
      this.chunks = [];
    }
  }

  _final(callback: TransformCallback): void {
    this.flushChunks();
    callback();
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
      logger.trace("upgrade in _transform");
      this.push(chunk);

      return callback();
    }

    this.partialMessage.push(chunk);

    const handleError = (err: Error) => {
      this.partialMessage = [];
      logger.error("[IMPERSONATOR] Error parsing HTTP data: %s", String(err));
      throw err;
    };

    try {
      const bufferToParse = Buffer.concat(this.partialMessage);
      const bytesParsed = this.httpParser.execute(bufferToParse);

      if (bytesParsed instanceof Error) {
        return handleError(bytesParsed);
      }

      this.partialMessage = removeBytesFromBuffersHead(this.partialMessage, bytesParsed);
    } catch (err) {
      return handleError(err as Error);
    }

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
