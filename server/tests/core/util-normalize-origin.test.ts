import { describe, it, expect } from "vitest";
import { normalizeOrigin } from "../../src/core/util/normalize-origin";

describe("normalizeOrigin", () => {
  const cases: Array<[string, string | null]> = [
    ["https://github.com/yrzhe/agentchat.git", "github.com/yrzhe/agentchat"],
    ["https://github.com/yrzhe/agentchat", "github.com/yrzhe/agentchat"],
    ["http://github.com/yrzhe/agentchat.git", "github.com/yrzhe/agentchat"],
    ["git@github.com:yrzhe/agentchat.git", "github.com/yrzhe/agentchat"],
    ["git@github.com:yrzhe/AgentChat.git", "github.com/yrzhe/agentchat"],
    ["ssh://git@gitlab.com:2222/group/sub/proj.git", "gitlab.com/group/sub/proj"],
    ["", null],
    ["not-a-url", null],
    ["https://github.com/", null],
  ];

  it.each(cases)("normalize %s → %s", (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected);
  });
});
