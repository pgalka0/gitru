import { describe, expect, test } from "vitest";
import {
  githubAccountAvatarUrl,
  githubCommitterAvatarUrl,
  normalizeExternalHttpsUrl,
  normalizeGithubContentImageUrl,
  normalizeRemoteImageUrl,
} from "../src/lib/external-content";

describe("external URL validation", () => {
  test("accepts HTTPS links and normalizes them", () => {
    expect(normalizeExternalHttpsUrl("https://gitru.app/docs")).toBe(
      "https://gitru.app/docs",
    );
  });

  test("rejects executable, local-file, insecure, and credential URLs", () => {
    for (const value of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "http://gitru.app/docs",
      "https://token@example.com/private",
    ]) {
      expect(normalizeExternalHttpsUrl(value)).toBeNull();
    }
  });
});

describe("remote image validation", () => {
  test("allows only exact configured avatar hosts", () => {
    expect(normalizeRemoteImageUrl("https://github.com/gitru-app.png")).toBe(
      "https://github.com/gitru-app.png",
    );
    expect(
      normalizeRemoteImageUrl("https://evilgithub.com/gitru-app.png"),
    ).toBeUndefined();
    expect(
      normalizeRemoteImageUrl("https://example.com/avatar.png"),
    ).toBeUndefined();
    expect(
      normalizeRemoteImageUrl("https://github.com/gitru-app/private"),
    ).toBeUndefined();
    expect(
      normalizeRemoteImageUrl(
        "https://avatars.githubusercontent.com/u/e?email=a%40b.com&redirect=evil",
      ),
    ).toBeUndefined();
  });

  test("allows GitHub API avatars for users and apps", () => {
    expect(
      normalizeRemoteImageUrl(
        "https://avatars.githubusercontent.com/u/9440455?u=c3d8f1421af362012ed0133c48dc639d2d66c369&v=4",
      ),
    ).toBe(
      "https://avatars.githubusercontent.com/u/9440455?u=c3d8f1421af362012ed0133c48dc639d2d66c369&v=4",
    );
    expect(
      normalizeRemoteImageUrl(
        "https://avatars.githubusercontent.com/in/3557673?v=4",
      ),
    ).toBeDefined();
    expect(
      normalizeRemoteImageUrl(
        "https://avatars.githubusercontent.com/u/1?v=4&redirect=evil",
      ),
    ).toBeUndefined();
    expect(
      normalizeRemoteImageUrl("https://avatars.githubusercontent.com/u/abc"),
    ).toBeUndefined();
  });

  test("markdown images stay on GitHub content hosts", () => {
    for (const allowed of [
      "https://camo.githubusercontent.com/abc/def",
      "https://private-user-images.githubusercontent.com/1/2.png?jwt=x",
      "https://github.com/user-attachments/assets/123",
    ]) {
      expect(normalizeGithubContentImageUrl(allowed)).toBe(allowed);
    }
    for (const rejected of [
      "https://evil.com/x.png",
      "https://githubusercontent.com.evil.com/x.png",
      "http://camo.githubusercontent.com/x",
      "javascript:alert(1)",
    ]) {
      expect(normalizeGithubContentImageUrl(rejected)).toBeUndefined();
    }
  });

  test("rejects malformed account names and safely encodes commit emails", () => {
    expect(githubAccountAvatarUrl("../admin")).toBeUndefined();
    expect(githubCommitterAvatarUrl("a+b@example.com&size=huge")).toContain(
      "email=a%2Bb%40example.com%26size%3Dhuge",
    );
  });
});
