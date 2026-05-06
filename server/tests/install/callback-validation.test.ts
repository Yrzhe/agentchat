import { describe, it, expect } from "vitest";
import { isValidLoopbackCallback } from "../../src/install/handlers";

describe("isValidLoopbackCallback", () => {
  it("accepts plain http://127.0.0.1:<port>", () => {
    expect(isValidLoopbackCallback("http://127.0.0.1:51000")).toBe(true);
    expect(isValidLoopbackCallback("http://127.0.0.1:1/")).toBe(true);
    expect(isValidLoopbackCallback("http://127.0.0.1:65535/cb?x=1")).toBe(true);
  });

  it("rejects userinfo bypass (CRITICAL #2)", () => {
    // The historical startsWith check accepted these — must now be rejected.
    expect(isValidLoopbackCallback("http://127.0.0.1:1@evil.example/x")).toBe(false);
    expect(isValidLoopbackCallback("http://127.0.0.1:80@attacker/")).toBe(false);
    expect(isValidLoopbackCallback("http://user:pass@127.0.0.1:9000")).toBe(false);
  });

  it("rejects non-http schemes", () => {
    expect(isValidLoopbackCallback("https://127.0.0.1:443")).toBe(false);
    expect(isValidLoopbackCallback("file://127.0.0.1:1")).toBe(false);
    expect(isValidLoopbackCallback("javascript://127.0.0.1:1")).toBe(false);
  });

  it("rejects non-loopback hostnames", () => {
    expect(isValidLoopbackCallback("http://localhost:8080")).toBe(false);
    expect(isValidLoopbackCallback("http://0.0.0.0:8080")).toBe(false);
    expect(isValidLoopbackCallback("http://127.0.0.2:8080")).toBe(false);
    expect(isValidLoopbackCallback("http://[::1]:8080")).toBe(false);
  });

  it("rejects missing or invalid port", () => {
    expect(isValidLoopbackCallback("http://127.0.0.1")).toBe(false);
    expect(isValidLoopbackCallback("http://127.0.0.1:0")).toBe(false);
    expect(isValidLoopbackCallback("http://127.0.0.1:abc")).toBe(false);
    expect(isValidLoopbackCallback("http://127.0.0.1:99999")).toBe(false);
  });

  it("rejects garbage strings", () => {
    expect(isValidLoopbackCallback("")).toBe(false);
    expect(isValidLoopbackCallback("not a url")).toBe(false);
    expect(isValidLoopbackCallback("//127.0.0.1:80")).toBe(false);
  });
});
