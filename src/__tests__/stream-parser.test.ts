import { StreamParser } from "../stream-parser";
import { PassThrough } from "stream";
import { KeyPairManager } from "../keypair-manager";
import { publicEncrypt, randomBytes } from "crypto";

describe("StreamParser", () => {
  it ("parses bored header", async () => {
    const keyPairManager = new KeyPairManager("default", {} as any);
    const stream = new PassThrough();
    const parser = new StreamParser();
    const keys = await keyPairManager.generateKeys();
    const secretKey = randomBytes(32);
    const iv = randomBytes(16);
    const encryptedSecretKey = publicEncrypt(keys.public, secretKey).toString("base64");
    const encryptedIv = publicEncrypt(keys.public, iv).toString("base64");
    const header = `BoreD-Enc-Key: ${encryptedSecretKey}-${encryptedIv}\r\n\r\n`;

    parser.privateKey = keys.private;
    let parsedKey = "";

    parser.bodyParser = (key) => {
      parsedKey = key.toString();
    };

    stream.pipe(parser);
    stream.write(header);

    expect(parsedKey).toBe(secretKey.toString());
  });

  it ("ignores invalid header value", async () => {
    const keyPairManager = new KeyPairManager("default", {} as any);
    const stream = new PassThrough();
    const parser = new StreamParser();
    const keys = await keyPairManager.generateKeys();

    const header = `BoreD-Enc-Key: foo-bar\r\n\r\n`;

    parser.privateKey = keys.private;
    let parsed = false;

    parser.bodyParser = () => {
      parsed = true;
    };

    stream.pipe(parser);
    stream.cork();
    expect(async () => {
      stream.write(header);

      await new Promise((resolve) => {
        parser.on("data", resolve);
      });
    }).rejects.toThrow("decoding error");

    expect(parsed).toBeFalsy();
  });
});
