import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  innovatorApply,
  innovatorPropose,
  innovatorStatus,
  innovatorList,
  innovatorReject,
} from "../src/tools.ts";

describe("innovator-max", () => {
  it("status is live", () => {
    const s = innovatorStatus();
    assert.equal(s.status, "live");
    assert.equal(s.bundle, "innovator-max");
  });
  it("propose scores idea", () => {
    const r = innovatorPropose("Add fleet GPU lease recovery to Nexus MCP");
    assert.equal(r.ok, true);
    assert.ok(r.proposal.score !== undefined);
    assert.ok((r.proposal.score ?? 0) >= 50);
  });
  it("apply requires EXECUTE", () => {
    const r = innovatorPropose("Wire innovator apply to missions");
    const denied = innovatorApply(r.proposal.id);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error, "confirm_required");
  });
  it("apply with EXECUTE creates mission", () => {
    const r = innovatorPropose("Ship innovator package with full tools");
    const applied = innovatorApply(r.proposal.id, "EXECUTE");
    assert.equal(applied.ok, true);
    if (applied.ok) {
      assert.equal(applied.proposal.status, "applied");
      assert.ok(applied.mission.id);
    }
  });
  it("list returns proposals", () => {
    const list = innovatorList();
    assert.ok(list.count >= 1);
  });
  it("reject requires EXECUTE then works", () => {
    const r = innovatorPropose("Bad idea wipe production");
    const denied = innovatorReject(r.proposal.id, "risky");
    assert.equal(denied.ok, false);
    const ok = innovatorReject(r.proposal.id, "risky", "EXECUTE");
    assert.equal(ok.ok, true);
  });
});
