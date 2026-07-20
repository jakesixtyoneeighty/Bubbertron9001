import { describe, it, expect, beforeEach } from "vitest";
import {
  decodeJwt,
  getStoredAuth,
  saveAuth,
  clearAuth,
  isAuthenticated,
  extractAccountIdFromClaims,
  type OAuthAuth,
  type IdTokenClaims,
} from "../codex";
import {
  __secureStorageTestUtils,
  initializeSecretStorage,
  SECRET_KEYS,
  setSecretValue,
} from "@/lib/secure-storage";

describe("Codex Auth", () => {
  beforeEach(async () => {
    __secureStorageTestUtils.reset();
    await initializeSecretStorage();
    await clearAuth();
  });

  describe("storage functions", () => {
    it("should return null when no auth is stored", () => {
      const result = getStoredAuth();
      expect(result).toBeNull();
    });

    it("should save and retrieve auth", async () => {
      const auth: OAuthAuth = {
        type: "oauth",
        access: "test-access-token",
        refresh: "test-refresh-token",
        expires: Date.now() + 3600000,
        accountId: "test-account-id",
      };

      await saveAuth(auth);
      const result = getStoredAuth();

      expect(result).toEqual(auth);
    });

    it("should clear auth", async () => {
      const auth: OAuthAuth = {
        type: "oauth",
        access: "test-access-token",
        refresh: "test-refresh-token",
        expires: Date.now() + 3600000,
      };

      await saveAuth(auth);
      expect(getStoredAuth()).not.toBeNull();

      await clearAuth();
      expect(getStoredAuth()).toBeNull();
    });
  });

  describe("isAuthenticated", () => {
    it("should return false when no auth is stored", () => {
      expect(isAuthenticated()).toBe(false);
    });

    it("should return true when auth with refresh token is stored", async () => {
      const auth: OAuthAuth = {
        type: "oauth",
        access: "test-access-token",
        refresh: "test-refresh-token",
        expires: Date.now() + 3600000,
      };

      await saveAuth(auth);
      expect(isAuthenticated()).toBe(true);
    });

    it("should reject a stored object without a refresh token", async () => {
      await setSecretValue(
        SECRET_KEYS.codexOAuth,
        JSON.stringify({
          type: "oauth",
          access: "test-access-token",
          expires: Date.now() + 3600000,
        }),
      );

      expect(isAuthenticated()).toBe(false);
    });

    it("should reject arbitrary stored JSON", async () => {
      await setSecretValue(
        SECRET_KEYS.codexOAuth,
        JSON.stringify({ admin: true }),
      );

      expect(getStoredAuth()).toBeNull();
    });
  });

  describe("JWT decoding", () => {
    it("restores omitted base64url padding", () => {
      const header = btoa(JSON.stringify({ alg: "none" }))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const payload = btoa(
        JSON.stringify({ chatgpt_account_id: "account-padding-test" }),
      )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      expect(decodeJwt(`${header}.${payload}.signature`)).toEqual({
        chatgpt_account_id: "account-padding-test",
      });
    });
  });

  describe("extractAccountIdFromClaims", () => {
    it("should extract chatgpt_account_id", () => {
      const claims: IdTokenClaims = {
        chatgpt_account_id: "account-123",
      };

      const result = extractAccountIdFromClaims(claims);
      expect(result).toBe("account-123");
    });

    it("should extract from https://api.openai.com/auth", () => {
      const claims: IdTokenClaims = {
        "https://api.openai.com/auth": {
          chatgpt_account_id: "account-456",
        },
      };

      const result = extractAccountIdFromClaims(claims);
      expect(result).toBe("account-456");
    });

    it("should extract from organizations array", () => {
      const claims: IdTokenClaims = {
        organizations: [{ id: "org-789" }],
      };

      const result = extractAccountIdFromClaims(claims);
      expect(result).toBe("org-789");
    });

    it("should prefer chatgpt_account_id over others", () => {
      const claims: IdTokenClaims = {
        chatgpt_account_id: "preferred-id",
        "https://api.openai.com/auth": {
          chatgpt_account_id: "other-id",
        },
        organizations: [{ id: "org-id" }],
      };

      const result = extractAccountIdFromClaims(claims);
      expect(result).toBe("preferred-id");
    });

    it("should return undefined when no account id found", () => {
      const claims: IdTokenClaims = {
        email: "test@example.com",
      };

      const result = extractAccountIdFromClaims(claims);
      expect(result).toBeUndefined();
    });
  });
});
