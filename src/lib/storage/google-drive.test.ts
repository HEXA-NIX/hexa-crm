import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PROJECT_UPLOAD_BYTES, testGoogleDrive, uploadToGoogleDrive } from "./google-drive";

afterEach(() => vi.unstubAllGlobals());

describe("Google Drive storage provider", () => {
  it("tests an OAuth credential without exposing it in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ files: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(testGoogleDrive("secret-token")).resolves.toMatchObject({ ok: true });
    expect(fetchMock.mock.calls[0][0]).not.toContain("secret-token");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer secret-token");
  });

  it("uploads multipart content and returns a stable Drive link", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "drive-file-1",
      name: "brief.pdf",
      mimeType: "application/pdf",
      size: "3",
      webViewLink: "https://drive.google.com/file/d/drive-file-1/view",
    }), { status: 200 })));
    const result = await uploadToGoogleDrive({ folder_id: "folder_1234567890" }, "token", {
      name: "brief.pdf",
      mime_type: "application/pdf",
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(result).toMatchObject({ remote_id: "drive-file-1", size: 3, provider: "google_drive" });
  });

  it("rejects files over the configured limit before doing network I/O", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(uploadToGoogleDrive({}, "token", {
      name: "huge.bin",
      mime_type: "application/octet-stream",
      bytes: new Uint8Array(MAX_PROJECT_UPLOAD_BYTES + 1),
    })).rejects.toThrow(/20 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
