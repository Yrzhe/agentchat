import { describe, it, expect } from "vitest";
import { parseMentions, containsBroadcastKeyword } from "../../src/core/chat/parse";

describe("parseMentions", () => {
  it("extracts a single @-mention", () => {
    expect(parseMentions("hi @alice please review")).toEqual(["alice"]);
  });

  it("extracts multiple mentions, dedups, preserves order of first occurrence", () => {
    expect(parseMentions("@bob @carol @bob")).toEqual(["bob", "carol"]);
  });

  it("ignores email addresses and code-fences", () => {
    expect(parseMentions("send to test@example.com later")).toEqual([]);
    expect(parseMentions("see `@nope` in code")).toEqual([]);
  });

  it("returns empty for body with no mentions", () => {
    expect(parseMentions("hello world")).toEqual([]);
  });

  it("matches mentions with hyphens, underscores, dots", () => {
    expect(parseMentions("@alice-1 @bob_2 @carol.dev")).toEqual(["alice-1", "bob_2", "carol.dev"]);
  });
});

describe("containsBroadcastKeyword", () => {
  it("rejects @all and @everyone (case-insensitive)", () => {
    expect(containsBroadcastKeyword("@all heads up")).toBe(true);
    expect(containsBroadcastKeyword("ping @Everyone now")).toBe(true);
    expect(containsBroadcastKeyword("@channel doesn't count")).toBe(false);
    expect(containsBroadcastKeyword("call all hands")).toBe(false);
  });
});
