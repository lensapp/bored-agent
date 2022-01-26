import { parseHeader, parseTokenFromHttpHeaders } from "../parse-header";

describe("parseHeader", () => {
  it("parses header from a string", () => {
    const [key, value] = parseHeader("Authorization: Bearer token");

    expect(key).toBe("authorization");
    expect(value).toBe("Bearer token");
  });

  it("parses header from a string with a newline", () => {
    const [key, value] = parseHeader("X-Foo-Bar: some\ndata");

    expect(key).toBe("x-foo-bar");
    expect(value).toBe("some\ndata");
  });

  it("returns undefined if string starts with a newline", () => {
    const [key, value] = parseHeader(" Authorization: Bearer token");

    expect(key).toBeUndefined();
    expect(value).toBeUndefined();
  });

  it("returns undefined if string has a newline before separator", () => {
    const [key, value] = parseHeader("Authorization : Bearer token");

    expect(key).toBeUndefined();
    expect(value).toBeUndefined();
  });

  it("returns undefined if string does not have separator", () => {
    const [key, value] = parseHeader("Authorization Bearer token");

    expect(key).toBeUndefined();
    expect(value).toBeUndefined();
  });

  it("throws error if string has a carriage return", () => {
    expect(() => {
      parseHeader("Authorization: Bearer token\r\nfoo");
    }).toThrowError("HPE_LF_EXPECTED");
  });
});


describe("parseTokenFromHttpHeaders", () => {
  it("returns correct token", () => {
    const token = parseTokenFromHttpHeaders(Buffer.from(`GET / HTTP/1.1\r\nAccept: application/json\r\nAuthorization: Bearer jwt.token\r\nHost: localhost\r\n\r\n`));

    expect(token).toBe("jwt.token");
  });

  it("returns correct token with lowercase header name", () => {
    const token = parseTokenFromHttpHeaders(Buffer.from(`GET / HTTP/1.1\r\nAccept: application/json\r\nauthorization: Bearer jwt.token\r\nHost: localhost\r\n\r\n`));

    expect(token).toBe("jwt.token");
  });

  it("returns undefined if token not found", () => {
    const token = parseTokenFromHttpHeaders(Buffer.from(`GET / HTTP/1.1\r\nAccept: application/json\r\nHost: localhost\r\n\r\n`));

    expect(token).toBeUndefined();
  });
});
