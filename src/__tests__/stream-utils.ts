import { removeBytesFromBuffersHead } from "../stream-utils";

describe("stream-utils", () => {
  describe("removeBytesFromBuffersHead", () => {
    describe("no buffers", () => {
      describe("zero bytes to remove", () => {
        it("removes nothing", () => {
          expect(removeBytesFromBuffersHead([], 0)).toEqual([]);
        });
      });

      describe("one byte to remove", () => {
        it("removes nothing", () => {
          expect(removeBytesFromBuffersHead([], 0)).toEqual([]);
        });
      });

      describe("minutes 1 byte to remove", () => {
        it("removes nothing", () => {
          expect(removeBytesFromBuffersHead([], -1)).toEqual([]);
        });
      });
    });

    describe("one buffer", () => {
      describe("has one byte", () => {
        it("is removed completely", () => {
          const buffer = Buffer.from([0x01]);

          expect(removeBytesFromBuffersHead([buffer], 1)).toEqual([]);
        });
      });

      describe("has one byte and removes 2", () => {
        it("is removed completely", () => {
          const buffer = Buffer.from([0x01]);

          expect(removeBytesFromBuffersHead([buffer], 2)).toEqual([]);
        });
      });

      describe("has empty buffer", () => {
        it("is removed completely", () => {
          const buffer = Buffer.from([]);

          expect(removeBytesFromBuffersHead([buffer], 1)).toEqual([]);
        });
      });

      describe("bytes to remove matches last buffer length", () => {
        it("is removed completely", () => {
          const buffer = Buffer.from([0x01, 0x02, 0x03]);

          expect(removeBytesFromBuffersHead([buffer], 3)).toEqual([]);
        });
      });

      describe("bytes to remove doesn't match last buffer length", () => {
        it("is removed partially", () => {
          const buffer = Buffer.from([0x01, 0x02, 0x03]);

          expect(removeBytesFromBuffersHead([buffer], 2)).toEqual([Buffer.from([0x03])]);
        });
      });
    });

    describe("many buffers", () => {
      describe("bytes to remove matches last buffer length", () => {
        it("first buffer is removed completely", () => {
          const buffer1 = Buffer.from([0x01, 0x02, 0x03]);
          const buffer2 = Buffer.from([0x04, 0x05, 0x06]);

          expect(removeBytesFromBuffersHead([buffer1, buffer2], 3)).toEqual([buffer2]);
        });
      });

      describe("bytes to remove is less than last buffer length", () => {
        it("is removed partially", () => {
          const buffer1 = Buffer.from([0x01, 0x02, 0x03]);
          const buffer2 = Buffer.from([0x04, 0x05, 0x06]);

          expect(removeBytesFromBuffersHead([buffer1, buffer2], 2)).toEqual([ Buffer.from([0x03]), buffer2]);
        });
      });

      describe("bytes to remove is more than last buffer length", () => {
        it("is removed partially", () => {
          const buffer1 = Buffer.from([0x01, 0x02, 0x03]);
          const buffer2 = Buffer.from([0x04, 0x05, 0x06]);

          expect(removeBytesFromBuffersHead([buffer1, buffer2], 4)).toEqual([Buffer.from([0x05, 0x06])]);
        });
      });

      describe("bytes to remove is equal to sum of all buffer lengths", () => {
        it("is removed completely", () => {
          const buffer1 = Buffer.from([0x01, 0x02, 0x03]);
          const buffer2 = Buffer.from([0x04, 0x05, 0x06]);

          expect(removeBytesFromBuffersHead([buffer1, buffer2], 6)).toEqual([]);
        });
      });

      describe("bytes to remove is more than the sum of all buffer lengths", () => {
        it("is removed completely", () => {
          const buffer1 = Buffer.from([0x01, 0x02, 0x03]);
          const buffer2 = Buffer.from([0x04, 0x05, 0x06]);

          expect(removeBytesFromBuffersHead([buffer1, buffer2], 9999)).toEqual([]);
        });
      });
    });
  });
});
