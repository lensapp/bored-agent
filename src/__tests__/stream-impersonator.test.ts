import { StreamImpersonator } from "../stream-impersonator";
import { PassThrough, Writable, WritableOptions } from "stream";
import * as jwt from "jsonwebtoken";

class DummyWritable extends Writable {
  public buffer: Buffer;

  constructor(opts?: WritableOptions) {
    super(opts);
    this.buffer = Buffer.from("");
  }

  _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    callback();
  }
}

describe("StreamImpersonator", () => {
  const jwtPrivateKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEAnzyis1ZjfNB0bBgKFMSvvkTtwlvBsaJq7S5wA+kzeVOVpVWw
kWdVha4s38XM/pa/yr47av7+z3VTmvDRyAHcaT92whREFpLv9cj5lTeJSibyr/Mr
m/YtjCZVWgaOYIhwrXwKLqPr/11inWsAkfIytvHWTxZYEcXLgAXFuUuaS3uF9gEi
NQwzGTU1v0FqkqTBr4B8nW3HCN47XUu0t8Y0e+lf4s4OxQawWD79J9/5d3Ry0vbV
3Am1FtGJiJvOwRsIfVChDpYStTcHTCMqtvWbV6L11BWkpzGXSW4Hv43qa+GSYOD2
QU68Mb59oSk2OB+BtOLpJofmbGEGgvmwyCI9MwIDAQABAoIBACiARq2wkltjtcjs
kFvZ7w1JAORHbEufEO1Eu27zOIlqbgyAcAl7q+/1bip4Z/x1IVES84/yTaM8p0go
amMhvgry/mS8vNi1BN2SAZEnb/7xSxbflb70bX9RHLJqKnp5GZe2jexw+wyXlwaM
+bclUCrh9e1ltH7IvUrRrQnFJfh+is1fRon9Co9Li0GwoN0x0byrrngU8Ak3Y6D9
D8GjQA4Elm94ST3izJv8iCOLSDBmzsPsXfcCUZfmTfZ5DbUDMbMxRnSo3nQeoKGC
0Lj9FkWcfmLcpGlSXTO+Ww1L7EGq+PT3NtRae1FZPwjddQ1/4V905kyQFLamAA5Y
lSpE2wkCgYEAy1OPLQcZt4NQnQzPz2SBJqQN2P5u3vXl+zNVKP8w4eBv0vWuJJF+
hkGNnSxXQrTkvDOIUddSKOzHHgSg4nY6K02ecyT0PPm/UZvtRpWrnBjcEVtHEJNp
bU9pLD5iZ0J9sbzPU/LxPmuAP2Bs8JmTn6aFRspFrP7W0s1Nmk2jsm0CgYEAyH0X
+jpoqxj4efZfkUrg5GbSEhf+dZglf0tTOA5bVg8IYwtmNk/pniLG/zI7c+GlTc9B
BwfMr59EzBq/eFMI7+LgXaVUsM/sS4Ry+yeK6SJx/otIMWtDfqxsLD8CPMCRvecC
2Pip4uSgrl0MOebl9XKp57GoaUWRWRHqwV4Y6h8CgYAZhI4mh4qZtnhKjY4TKDjx
QYufXSdLAi9v3FxmvchDwOgn4L+PRVdMwDNms2bsL0m5uPn104EzM6w1vzz1zwKz
5pTpPI0OjgWN13Tq8+PKvm/4Ga2MjgOgPWQkslulO/oMcXbPwWC3hcRdr9tcQtn9
Imf9n2spL/6EDFId+Hp/7QKBgAqlWdiXsWckdE1Fn91/NGHsc8syKvjjk1onDcw0
NvVi5vcba9oGdElJX3e9mxqUKMrw7msJJv1MX8LWyMQC5L6YNYHDfbPF1q5L4i8j
8mRex97UVokJQRRA452V2vCO6S5ETgpnad36de3MUxHgCOX3qL382Qx9/THVmbma
3YfRAoGAUxL/Eu5yvMK8SAt/dJK6FedngcM3JEFNplmtLYVLWhkIlNRGDwkg3I5K
y18Ae9n7dHVueyslrb6weq7dTkYDi3iOYRW8HRkIQh06wEdbxt0shTzAJvvCQfrB
jg/3747WSsf/zBTcHihTRBdAv6OmdhV4/dD5YBfLAkLrd+mX7iE=
-----END RSA PRIVATE KEY-----`;

  const jwtPublicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnzyis1ZjfNB0bBgKFMSv
vkTtwlvBsaJq7S5wA+kzeVOVpVWwkWdVha4s38XM/pa/yr47av7+z3VTmvDRyAHc
aT92whREFpLv9cj5lTeJSibyr/Mrm/YtjCZVWgaOYIhwrXwKLqPr/11inWsAkfIy
tvHWTxZYEcXLgAXFuUuaS3uF9gEiNQwzGTU1v0FqkqTBr4B8nW3HCN47XUu0t8Y0
e+lf4s4OxQawWD79J9/5d3Ry0vbV3Am1FtGJiJvOwRsIfVChDpYStTcHTCMqtvWb
V6L11BWkpzGXSW4Hv43qa+GSYOD2QU68Mb59oSk2OB+BtOLpJofmbGEGgvmwyCI9
MwIDAQAB
-----END PUBLIC KEY-----`;

  it ("impersonates on valid jwt token", async () => {
    const stream = new PassThrough();
    const parser = new StreamImpersonator();
    const destination = new DummyWritable();

    parser.saToken = "service-account-token";
    parser.publicKey = jwtPublicKey;

    const token = jwt.sign({
      exp: Math.floor(Date.now() / 1000) + (60 * 60),
      sub: "johndoe"
    }, jwtPrivateKey, { algorithm: "RS256" });

    stream.pipe(parser).pipe(destination);
    stream.write(`GET / HTTP/1.1\r\nAccept: application/json\r\nContent-`);
    stream.write(`Type: application/json\r\nAuthorization: Bearer ${token}\r\n\r\n`);
    expect(destination.buffer.toString()).toMatchSnapshot();
  });

  it ("impersonates groups on valid jwt token", async () => {
    const stream = new PassThrough();
    const parser = new StreamImpersonator();
    const destination = new DummyWritable();

    parser.saToken = "service-account-token";
    parser.publicKey = jwtPublicKey;

    const token = jwt.sign({
      exp: Math.floor(Date.now() / 1000) + (60 * 60),
      sub: "johndoe",
      groups: ["dev", "ops"]
    }, jwtPrivateKey, { algorithm: "RS256" });

    stream.pipe(parser).pipe(destination);
    stream.write(`GET / HTTP/1.1\r\nAccept: application/json\r\nContent-`);
    stream.write(`Type: application/json\r\nAuthorization: Bearer ${token}\r\n\r\n`);
    expect(destination.buffer.toString()).toMatchSnapshot();
  });

  it ("handles newline splitted to separate chunks", async () => {
    const stream = new PassThrough();
    const parser = new StreamImpersonator();
    const destination = new DummyWritable();

    parser.saToken = "service-account-token";
    parser.publicKey = jwtPublicKey;

    const token = jwt.sign({
      exp: Math.floor(Date.now() / 1000) + (60 * 60),
      sub: "johndoe"
    }, jwtPrivateKey, { algorithm: "RS256" });

    stream.pipe(parser).pipe(destination);
    stream.write(`GET / HTTP/1.1\r\nAccept: application/json\r`);
    stream.write(`\nContent-Type: application/json\r\nAuthorization: Bearer ${token}\r\n\r\n`);
    expect(destination.buffer.toString()).toMatchSnapshot();
  });

  it ("handles http request pipelining", async () => {
    const stream = new PassThrough();
    const parser = new StreamImpersonator();
    const destination = new DummyWritable();

    parser.saToken = "service-account-token";
    parser.publicKey = jwtPublicKey;

    const token = jwt.sign({
      exp: Math.floor(Date.now() / 1000) + (60 * 60),
      sub: "johndoe"
    }, jwtPrivateKey, { algorithm: "RS256" });

    stream.pipe(parser).pipe(destination);
    stream.write(`GET / HTTP/1.1\r\nAccept: application/json\r\nContent-Type: application/json\r\nAuthorization: Bearer ${token}\r\n\r\n`);
    stream.write(`GET /version HTTP/1.1\r\nAccept: application/json\r\nContent-Type: application/json\r\nAuthorization: Bearer ${token}\r\n\r\n`);
    stream.write(`GET /foo HTTP/1.1\r\nAccept: application/json\r\nContent-Type: application/json\r\nAuthorization: Bearer ${token}\r\n\r\n`);
    expect(destination.buffer.toString()).toMatchSnapshot();
  });


  it ("handles body separator splitted to separate chunks", async () => {
    const stream = new PassThrough();
    const parser = new StreamImpersonator();
    const destination = new DummyWritable();

    parser.saToken = "service-account-token";
    parser.publicKey = jwtPublicKey;

    const token = jwt.sign({
      exp: Math.floor(Date.now() / 1000) + (60 * 60),
      sub: "johndoe"
    }, jwtPrivateKey, { algorithm: "RS256" });

    stream.pipe(parser).pipe(destination);
    stream.write(`GET / HTTP/1.1\r\nAccept: application/json\r\nContent-Type:`);
    stream.write(` application/json\r\nAuthorization: Bearer ${token}\r\n\r`);
    stream.write("\n");
    expect(destination.buffer.toString()).toMatchSnapshot();
  });

  it("does not impersonate on invalid token", async () => {
    const stream = new PassThrough();
    const parser = new StreamImpersonator();
    const destination = new DummyWritable();

    parser.saToken = "service-account-token";
    parser.publicKey = jwtPublicKey;

    stream.pipe(parser).pipe(destination);
    stream.write("GET / HTTP/1.1\r\n");
    stream.write("Accept: application/json\r\n");
    stream.write(`Authorization: Bearer invalid.token.is\r\n`);
    stream.write("Content-Type: application/json\r\n\r\n");
    stream.write("hello world");

    expect(destination.buffer.toString()).toMatchSnapshot();
  });
});
