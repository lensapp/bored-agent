import { Transform, TransformCallback } from "stream";
import { privateDecrypt } from "crypto";

export class StreamParser extends Transform {
  public privateKey = "";
  public bodyParser?: (key: Buffer, iv: Buffer) => void;

  private envelopeHeaderSeen = false;
  private readonly headerPrefix = "BoreD-Enc-Key: ";

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
    if (!this.privateKey) {
      throw new Error("privateKey is empty");
    }

    if (this.envelopeHeaderSeen) {
      if (!this.writableEnded) this.push(chunk);

      return callback();
    }

    const header = chunk.toString();

    if (!header.startsWith(this.headerPrefix) || !header.includes("\r\n")) {
      // header info is incomplete wait for more data
      return callback();
    }

    this.envelopeHeaderSeen = true;

    try {
      const decryptedHeader = this.decryptHeader(header);

      this.bodyParser?.(decryptedHeader.key, Buffer.from(decryptedHeader.iv, "base64"));

      return callback();
    } catch(error) {
      return callback(error);
    }
  }

  decryptHeader(header: string) {
    const encryptedKeys = header.split(this.headerPrefix)[1].split("\r\n")[0].split("-");
    const encryptedKey = encryptedKeys[0];
    const iv = encryptedKeys[1];
    const key = privateDecrypt(this.privateKey, Buffer.from(encryptedKey, "base64"));

    return {
      key,
      iv
    };
  }
}
