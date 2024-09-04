import { readFileSync } from "fs";
import { isTokenExpiredSoon, ServiceAccountTokenProvider } from "../service-account-token";

const btoa = (input: string) => Buffer.from(input).toString("base64");
const atob = (input: string | undefined) => Buffer.from(input ?? "", "base64").toString();

describe("service-account-token", () => {
  describe("ServiceAccountTokenProvider", () => {
    // Token expiry
    const firstExp = 1756973734;
    const secondExp = 1856973734;

    const firstToken = `${btoa(JSON.stringify({}))}.${btoa(JSON.stringify({ exp: firstExp }))}`;
    const secondToken = `${btoa(JSON.stringify({}))}.${btoa(JSON.stringify({ exp: secondExp }))}`;

    let readFileMock: typeof readFileSync;

    beforeEach(() => {
      readFileMock = jest.fn().mockReturnValueOnce(firstToken).mockReturnValueOnce(secondToken);
    });

    describe("getSaToken", () => {
      describe("file exists", () => {
        it("returns the token", () => {
          const provider = new ServiceAccountTokenProvider(true, {
            readFileSync: readFileMock
          });

          expect(provider.getSaToken()).toEqual("e30=.eyJleHAiOjE3NTY5NzM3MzR9");
        });

        it("reads the file", () => {
          new ServiceAccountTokenProvider(true, {
            readFileSync: readFileMock
          });

          expect(readFileMock).toHaveBeenCalledWith("/var/run/secrets/kubernetes.io/serviceaccount/token");
        });

        it("token has right expiry", () => {
          const provider = new ServiceAccountTokenProvider(true, {
            readFileSync: readFileMock
          });

          expect(
            JSON.parse(
              atob(provider.getSaToken()?.split(".")[1])
            ).exp
          ).toEqual(firstExp);
        });
      });

      describe("file doesn't exists", () => {
        it("returns undefined", () => {
          const provider = new ServiceAccountTokenProvider(false, {
            readFileSync: readFileMock
          });

          expect(provider.getSaToken()).toEqual(undefined);
        });

        it("doesn't try to read the token file", () => {
          new ServiceAccountTokenProvider(false, {
            readFileSync: readFileMock
          });

          expect(readFileMock).not.toHaveBeenCalled();
        });
      });
    });

    describe("token refresh", () => {
      describe("token has not expired", () => {
        it("returns the second token after refresh", () => {
          // First, current time is significantly before expiry of the first token
          jest
            .useFakeTimers("modern")
            .setSystemTime(new Date(firstExp * 1000 - 600000));

          const provider = new ServiceAccountTokenProvider(true, {
            readFileSync: readFileMock
          });

          expect(
            JSON.parse(
              atob(provider.getSaToken()?.split(".")[1])
            ).exp
          ).toEqual(firstExp);
        });
      });

      describe("token has expired", () => {
        it("returns the second token after refresh", () => {
          // First, current time is significantly before expiry of the first token
          jest
            .useFakeTimers("modern")
            .setSystemTime(new Date(firstExp * 1000 - 600000));

          const provider = new ServiceAccountTokenProvider(true, {
            readFileSync: readFileMock
          });

          // Advance time to right before expiry
          jest.advanceTimersByTime(600000 - 1000);

          expect(
            JSON.parse(
              atob(provider.getSaToken()?.split(".")[1])
            ).exp
          ).toEqual(secondExp);
        });
      });
    });
  });

  describe("isTokenExpiredSoon", () => {
    // expiry time 1756973734
    const tokenExpiryTimeMs = 1756973734 * 1000;
    const token = "eyJhbGciOiJSUzI1NiIsImtpZCI6IlAxYUVYYXRtQ0M5bG9GWWZWM2ZMM1h5dnBOaDh3bjNBM0RPMXB5ZlB1THMifQ.eyJhdWQiOlsiaHR0cHM6Ly9rdWJlcm5ldGVzLmRlZmF1bHQuc3ZjIl0sImV4cCI6MTc1Njk3MzczNCwiaWF0IjoxNzI1NDM3NzM0LCJpc3MiOiJodHRwczovL2t1YmVybmV0ZXMuZGVmYXVsdC5zdmMiLCJrdWJlcm5ldGVzLmlvIjp7Im5hbWVzcGFjZSI6ImxlbnMtcGxhdGZvcm0iLCJwb2QiOnsibmFtZSI6ImJvcmVkLWFnZW50LTU5ODc5Nzg2OWYtamx2dzYiLCJ1aWQiOiJiZWVlZmE3NS05MmYwLTQ0MDEtYjJhNC0zYmZjMGMyYzdlMzQifSwic2VydmljZWFjY291bnQiOnsibmFtZSI6ImJvcmVkLWFnZW50IiwidWlkIjoiZGQxNTdlNjMtMzJmMi00OWU3LWJiMmMtZDVjOGU4OWE2YjNjIn0sIndhcm5hZnRlciI6MTcyNTQ0MTM0MX0sIm5iZiI6MTcyNTQzNzczNCwic3ViIjoic3lzdGVtOnNlcnZpY2VhY2NvdW50OmxlbnMtcGxhdGZvcm06Ym9yZWQtYWdlbnQifQ.EVri26EmBzNchD6KIVBRFiWxmb4IwB4F_oViqA7CFDT0z9U2vBIbWWu_1QKugKXO1EZTVcJCfFv_3FMWqRmd35PhnDanv3Dko6iNvzGNX1b0hRhdbRYSSLDHuS433loSXzWTvODP-Dx5oCxb8FKtsyJlRD1nIiMa3fl2ke3AgVIQQ0VFPWo3DX-MHVuanjA8ISUQL0Y8UABL7UDAVppRKnkiZEDkFuZrAYGv9dMMHaXAX6DRaO-Cil5k4ltTT9DSUab2IEVf-vmD43LDhNL4JTcz0FqqB88MoQ17kGoUVhlhLroXR46b7FYusx2nHrUwfhh8e5b30CerJFxBZc_0Lgroot@bored-agent-598797869f-jlvw6";

    describe("token is expired", () => {
      beforeEach(() => {
        jest
          .useFakeTimers("modern")
          .setSystemTime(new Date(tokenExpiryTimeMs + 600000));
      });

      it("returns true", () => {
        expect(isTokenExpiredSoon(token)).toEqual(true);
      });
    });

    describe("token is not expired", () => {
      beforeEach(() => {
        jest
          .useFakeTimers("modern")
          .setSystemTime(new Date(tokenExpiryTimeMs - 600000));
      });

      it("returns false", () => {
        expect(isTokenExpiredSoon(token)).toEqual(false);
      });
    });

    describe("threshold is 2s, current time 1s before expiry", () => {
      beforeEach(() => {
        jest
          .useFakeTimers("modern")
          .setSystemTime(new Date(tokenExpiryTimeMs - 1000));
      });

      it("returns true", () => {
        expect(isTokenExpiredSoon(token, 2000)).toEqual(true);
      });
    });

    describe("threshold is 0s, current time 1s before expiry", () => {
      beforeEach(() => {
        jest
          .useFakeTimers("modern")
          .setSystemTime(new Date(tokenExpiryTimeMs - 1000));
      });

      it("returns false", () => {
        expect(isTokenExpiredSoon(token, 0)).toEqual(false);
      });
    });

    describe("threshold is 2s, current time 1s after expiry", () => {
      beforeEach(() => {
        jest
          .useFakeTimers("modern")
          .setSystemTime(new Date(tokenExpiryTimeMs + 1000));
      });

      it("returns true", () => {
        expect(isTokenExpiredSoon(token, 0)).toEqual(true);
      });
    });
  });
});
