import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGoogleAuthorization,
  currentGoogleAccessToken,
  decodeGoogleCredential,
  encodeGoogleCredential,
  exchangeGoogleCode,
} from "./google-oauth.server";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

function configure() {
  process.env.GOOGLE_DRIVE_CLIENT_ID = "client-id";
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = "client-secret";
  process.env.HEXA_MASTER_ENCRYPTION_KEY = "test-master-key-with-enough-entropy";
}

describe("Google Drive persistent OAuth", () => {
  it("builds one-click authorization with offline access and narrow scope", () => {
    configure();
    const result = createGoogleAuthorization(new URL("https://crm.example.com/api/storage/google-drive/connect"));
    const url = new URL(result.authorization_url);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
    expect(url.searchParams.get("redirect_uri")).toBe("https://crm.example.com/api/storage/google-drive/callback");
  });

  it("exchanges a code and encrypts the persistent credential", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
    }), { status: 200 })));
    const credential = await exchangeGoogleCode("code", new URL("https://crm.example.com/api/storage/google-drive/callback"));
    const encrypted = encodeGoogleCredential(credential);
    expect(encrypted).not.toContain("refresh");
    expect(decodeGoogleCredential(encrypted).refresh_token).toBe("refresh");
  });

  it("refreshes access without asking the user again", async () => {
    configure();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "new-access", expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const refreshed = await currentGoogleAccessToken({ access_token: "old", refresh_token: "refresh", expires_at: 0 });
    expect(refreshed.access_token).toBe("new-access");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
