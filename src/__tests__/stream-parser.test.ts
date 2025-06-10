import { StreamParser } from "../stream-parser";
import { PassThrough } from "stream";
import { KeyPairManager } from "../keypair-manager";
import { publicEncrypt, randomBytes } from "crypto";
import { ServiceAccountTokenProvider } from "../service-account-token";

describe("StreamParser", () => {
  const serviceAccountTokenProviderMock = {
    getSaToken: () => "service-account-token"
  } as ServiceAccountTokenProvider;

  it("parses bored header", async () => {
    const keyPairManager = new KeyPairManager("default", serviceAccountTokenProviderMock);
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

  it("ignores invalid header value", async () => {
    const keyPairManager = new KeyPairManager("default", serviceAccountTokenProviderMock);
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

    const promise = new Promise((resolve, reject) => {
      parser.on("data", resolve);
      parser.on("error", reject);
    });

    // Only write *after* listeners are attached:
    stream.write(header);

    await expect(promise).rejects.toThrow("decoding error");
    expect(parsed).toBeFalsy();
  });
});
