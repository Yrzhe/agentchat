import { describe, it, expect } from "vitest";
import { isSameOriginRequest } from "../../src/web/csrf";

function req(url: string, headers: Record<string, string>) {
  return new Request(url, { method: "POST", headers });
}

describe("isSameOriginRequest", () => {
  it("accepts same-origin Origin header", () => {
    expect(
      isSameOriginRequest(req("https://app.example/api/x", { origin: "https://app.example" }))
    ).toBe(true);
  });

  it("rejects cross-origin Origin header (the actual CSRF case)", () => {
    expect(
      isSameOriginRequest(req("https://app.example/api/x", { origin: "https://evil.example" }))
    ).toBe(false);
  });

  it("rejects Origin with same host but different scheme/port", () => {
    expect(
      isSameOriginRequest(req("https://app.example/api/x", { origin: "http://app.example" }))
    ).toBe(false);
    expect(
      isSameOriginRequest(req("https://app.example:443/api/x", { origin: "https://app.example:8443" }))
    ).toBe(false);
  });

  it("falls back to Referer when Origin is absent", () => {
    expect(
      isSameOriginRequest(req("https://app.example/api/x", { referer: "https://app.example/dashboard" }))
    ).toBe(true);
    expect(
      isSameOriginRequest(req("https://app.example/api/x", { referer: "https://evil.example/x" }))
    ).toBe(false);
  });

  it("rejects requests with no Origin and no Referer", () => {
    expect(isSameOriginRequest(req("https://app.example/api/x", {}))).toBe(false);
  });

  it("rejects garbage Referer that fails to parse", () => {
    expect(
      isSameOriginRequest(req("https://app.example/api/x", { referer: "not a url" }))
    ).toBe(false);
  });
});
