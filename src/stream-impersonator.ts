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

export class StreamImpersonator extends Transform {
  public boredServer = "";
  public publicKey = "";
  public saToken = "";
  private chunks: Buffer[] = [];
  private httpParser: HTTPParserJS;
  private upgrade = false;

  constructor() {
    super();

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
          this.impersonateJwtToken(headers, token, authIndex);
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

    this.httpParser.onBody = () => {
      this.flushChunks();
    };

    this.httpParser.onMessageComplete = () => {
      this.flushChunks();
    };
  }

  private flushChunks() {
    this.push(Buffer.concat(this.chunks));
    this.chunks = [];
  }

  _final(callback: TransformCallback): void {
    this.flushChunks();
    callback();
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
    if (this.upgrade) {
      this.push(chunk);
    } else {
      this.chunks.push(chunk);
      this.httpParser.execute(chunk);
    }

    return callback();
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

      logger.info(`[IMPERSONATOR] impersonating user ${tokenData.sub}`);

      headers.splice(authIndex, 1); // remove existing authorization header

      headers.push(["authorization", `Bearer ${this.saToken}`]);
      headers.push(["impersonate-user", tokenData.sub]);

      tokenData?.groups?.forEach((group) => {
        headers.push(["impersonate-group", group]);
      });
    } catch(err) {
      logger.error("[IMPERSONATOR] jwt parsing failed: %s", String(err));
    }
  }
}
