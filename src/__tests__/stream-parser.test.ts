import { StreamParser } from "../stream-parser";
import { PassThrough } from "stream";
import { KeyPairManager } from "../keypair-manager";
import { publicEncrypt, randomBytes } from "crypto";

describe("StreamParser", () => {
  it ("parses bored header", async () => {
    const keyPairManager = new KeyPairManager("default");
    const stream = new PassThrough();
    const parser = new StreamParser();
    const keys = await keyPairManager.generateKeys();
    const secretKey = randomBytes(32);
    const iv = randomBytes(16);
    const header = `BoreD-Enc-Key: ${publicEncrypt(keys.public, secretKey).toString("base64")}-${iv.toString("base64")}\r\n`;

    parser.privateKey = keys.private;
    let parsedKey = "";

    parser.bodyParser = (key) => {
      parsedKey = key.toString();
    };

    stream.pipe(parser);
    stream.write(header);

    expect(parsedKey).toBe(secretKey.toString());
  });
});
