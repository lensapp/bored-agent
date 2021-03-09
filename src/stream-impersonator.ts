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

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
    if (this.httpHeadersEnded) {
      if (!this.writableEnded) this.push(chunk);

      return callback();
    }

    const jwtToken = this.parseTokenFromHttpHeaders(chunk.toString());

    if (jwtToken !== "") {
      if (!this.writableEnded) this.push(this.impersonateJwtToken(chunk, jwtToken));

      return callback();
    }

    if (chunk.includes("\r\n\r\n")) {
      this.httpHeadersEnded = true;
    }

    return callback();
  }

  parseTokenFromHttpHeaders(chunk: string) {
    const line = chunk.split("\r\n").find((line) => {
      return line.startsWith("Authorization: Bearer ");
    });

    if (line) {
      return line.split("Authorization: Bearer ")[1];
    }

    return "";
  }

  impersonateJwtToken(chunk: Buffer, token: string) {
    try {
      const tokenData = jwt.verify(token, this.publicKey) as TokenPayload;

      const impersonatedHeaders: string[] = [this.saToken];

      impersonatedHeaders.push(`Impersonate-User: ${tokenData.sub}`);
      tokenData?.roles?.forEach((role) => {
        impersonatedHeaders.push(`Impersonate-Group: ${role}`);
      });

      return Buffer.from(chunk.toString().replace(token, impersonatedHeaders.join("\r\n")));
    } catch(err) {
      return chunk;
    }
  }
}
