import { describe, it, expect } from "vitest";
import { deriveWorkspaceId } from "../../src/core/workspace";

describe("deriveWorkspaceId", () => {
  it("derives same id for the same normalized origin across formats", async () => {
    const a = await deriveWorkspaceId("https://github.com/yrzhe/agentchat.git", null);
    const b = await deriveWorkspaceId("git@github.com:yrzhe/agentchat.git", null);
    const c = await deriveWorkspaceId("https://github.com/yrzhe/AgentChat", null);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("falls back to alias-based id when origin is empty", async () => {
    const id = await deriveWorkspaceId("", "my-local");
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("throws when both origin and alias missing", async () => {
    await expect(deriveWorkspaceId("", null)).rejects.toThrow(/origin or alias/i);
  });

  it("two different origins yield different ids", async () => {
    const a = await deriveWorkspaceId("https://github.com/a/x", null);
    const b = await deriveWorkspaceId("https://github.com/b/x", null);
    expect(a).not.toEqual(b);
  });
});
