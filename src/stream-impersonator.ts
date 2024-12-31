import { Transform, TransformCallback } from "stream";
import { HTTPParser, HTTPParserJS } from "http-parser-js";
import { chunk } from "lodash";
import * as jwt from "jsonwebtoken";
import logger from "./logger";

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
  private partialMessage: string = "";

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

      return 0;
    };

    this.httpParser.onBody = (
      bodyChunk: Buffer,
      start: number,
      len: number,
    ) => {
      this.chunks.push(bodyChunk.subarray(start, start + len));
    };

    this.httpParser.onMessageComplete = () => {
      this.flushChunks();
    };
  }

  private flushChunks() {
    if (this.chunks.length > 0) {
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
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    const chunkStr = chunk.toString();

    if (this.upgrade) {
      this.push(chunk);

      return callback();
    }

    this.partialMessage += chunkStr;

    const handleError = (err: Error) => {
      this.partialMessage = "";
      logger.error("[IMPERSONATOR] Error parsing HTTP data: %s", String(err));
      throw err;
    };

    try {
      const bytesParsed = this.httpParser.execute(
        Buffer.from(this.partialMessage),
      );

      if (bytesParsed instanceof Error) {
        return handleError(bytesParsed);
      }

      this.partialMessage = this.partialMessage.slice(bytesParsed);
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
