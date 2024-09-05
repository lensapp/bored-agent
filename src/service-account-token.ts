import { readFileSync } from "fs";
import logger from "./logger";

export const serviceAccountTokenPath = process.env.SERVICEACCOUNT_TOKEN_PATH || "/var/run/secrets/kubernetes.io/serviceaccount/token";

/**
 * Get decoded and JSON-parsed of the second part of the JWT
 * @param token token as string
 * @returns 
 */
const getDecodedToken = (token: string) => {
  const parts = token.split(".");
  const decoded = Buffer.from(parts[1] ?? "", "base64").toString();

  return JSON.parse(decoded ?? "{}") ?? {};
};

// How often token expiry is checked
const expiryIntervalMs = 60 * 1_000;

// If the token expires in the next expirationThresholdMs, it is considered to be expired soon
// so that we can already refresh it
const expirationThresholdMs = expiryIntervalMs * 3;

export const isTokenExpiredSoon = (token: string | undefined, threshold = expirationThresholdMs) => {
  if (!token) {
    // Non-existing token is not expired
    return false;
  }

  const exp = getDecodedToken(token).exp;

  // Malformed data or no expiry
  if (!exp) {
    return false;
  }

  return (Date.now() + threshold) > (exp * 1000);
};

export interface ServiceAccountTokenProviderDependencies {
  readFileSync: typeof readFileSync;
}

export class ServiceAccountTokenProvider {
  // Interval for token refresh
  public interval: NodeJS.Timer; 

  // True if service account token file exists.
  // If not the token is not read or refreshed at all, and saToken is always undefined
  private fileExists: boolean;

  private saToken: string | undefined;

  private dependencies: ServiceAccountTokenProviderDependencies;

  constructor(fileExists: boolean, dependencies: ServiceAccountTokenProviderDependencies = { 
    readFileSync,
  }) {
    this.fileExists = fileExists;
    this.dependencies = dependencies;
    this.saToken = undefined;

    if (this.fileExists) {
      this.refreshToken();
    }

    this.interval = setInterval(() => {
      if (this.fileExists) {
        this.refreshTokenIfNeeded();
      }
    }, expiryIntervalMs);
  }

  public getSaToken() {
    return this.saToken;
  }
  
  private isTokenExpiredSoon() {
    return isTokenExpiredSoon(this.getSaToken());
  }

  private refreshTokenIfNeeded() {
    if (!this.getSaToken() || this.isTokenExpiredSoon()) {
      logger.info("[SERVICE-ACCOUNT] Refreshing Service Account Token now");
      this.refreshToken();
    }
  }

  private refreshToken() {
    const token = this.dependencies.readFileSync(serviceAccountTokenPath);

    logger.info("[SERVICE-ACCOUNT] Service Account Token refreshed");

    this.saToken = token.toString();
  }
}
