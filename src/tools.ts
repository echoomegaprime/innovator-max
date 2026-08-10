import { completeJob, createJob, id, loadJson, saveJson, audit } from "./lib/store.js";
import type { ToolDef } from "./lib/mcp-http.js";

export type Proposal = {
  id: string;
  idea: string;
  status: "proposed" | "applied" | "rejected" | "scored";
  score?: number;
  rationale?: string;
  at: string;
  appliedAt?: string;
  missionId?: string;
  notes?: string;
};

export type Mission = {
  id: string;
  title: string;
  summary: string;
  status: "queued" | "active" | "done";
  proposalId: string;
  createdAt: string;
};

function proposals() {
  return loadJson<Proposal[]>("proposals.json", []);
}

function missions() {
  return loadJson<Mission[]>("missions.json", []);
}

export function innovatorStatus() {
  const props = proposals();
  return {
    status: "live",
    bundle: "innovator-max",
    version: "1.0.0",
    proposals: props.length,
    open: props.filter((p) => p.status === "proposed" || p.status === "scored").length,
    applied: props.filter((p) => p.status === "applied").length,
    rejected: props.filter((p) => p.status === "rejected").length,
    missions: missions().length,
    policy: { apply_requires_confirm: "EXECUTE", no_raw_shell: true },
  };
}

export function innovatorPropose(idea: string, tags: string[] = []) {
  const text = idea.trim().slice(0, 4000);
  if (!text) throw new Error("idea_required");
  const props = proposals();
  const p: Proposal = {
    id: id("prop"),
    idea: text,
    status: "proposed",
    at: new Date().toISOString(),
    notes: tags.length ? `tags:${tags.join(",")}` : undefined,
  };
  // auto-score heuristic
  let score = 50;
  if (/security|auth|oauth|lease|gpu/i.test(text)) score += 15;
  if (/fleet|nexus|mcp|ci|deploy/i.test(text)) score += 10;
  if (/delete|destroy|wipe|raw shell/i.test(text)) score -= 30;
  p.score = Math.max(0, Math.min(100, score));
  p.status = "scored";
  p.rationale = `Heuristic score ${p.score}/100 based on domain keywords and risk phrases.`;
  props.unshift(p);
  saveJson("proposals.json", props.slice(0, 500));
  audit("innovator.propose", { id: p.id, score: p.score });
  return { ok: true as const, proposal: p };
}

export function innovatorList(status?: string) {
  let props = proposals();
  if (status) props = props.filter((p) => p.status === status);
  return { count: props.length, proposals: props.slice(0, 50) };
}

export function innovatorGet(proposalId: string) {
  const p = proposals().find((x) => x.id === proposalId);
  if (!p) return { ok: false as const, error: "proposal_not_found" };
  return { ok: true as const, proposal: p };
}

export function innovatorReject(proposalId: string, reason?: string, confirm?: string) {
  if (confirm !== "EXECUTE") {
    return { ok: false as const, error: "confirm_required", confirm_word: "EXECUTE" };
  }
  const props = proposals();
  const i = props.findIndex((p) => p.id === proposalId);
  if (i < 0) return { ok: false as const, error: "proposal_not_found" };
  props[i] = {
    ...props[i],
    status: "rejected",
    notes: reason?.slice(0, 500) || props[i].notes,
  };
  saveJson("proposals.json", props);
  audit("innovator.reject", { id: proposalId });
  return { ok: true as const, proposal: props[i] };
}

export function innovatorApply(proposalId: string, confirm?: string) {
  if (confirm !== "EXECUTE") {
    return { ok: false as const, error: "confirm_required", confirm_word: "EXECUTE" };
  }
  const props = proposals();
  const i = props.findIndex((p) => p.id === proposalId);
  if (i < 0) return { ok: false as const, error: "proposal_not_found" };
  if (props[i].status === "rejected") {
    return { ok: false as const, error: "proposal_rejected" };
  }
  const job = createJob("innovator_apply", "innovator_apply", { proposalId });
  const mission: Mission = {
    id: id("ms"),
    title: `Innovator: ${props[i].idea.slice(0, 80)}`,
    summary: props[i].idea.slice(0, 1000),
    status: "queued",
    proposalId,
    createdAt: new Date().toISOString(),
  };
  const ms = missions();
  ms.unshift(mission);
  saveJson("missions.json", ms.slice(0, 200));
  props[i] = {
    ...props[i],
    status: "applied",
    appliedAt: new Date().toISOString(),
    missionId: mission.id,
    notes: "Applied — mission queued for agent execution",
  };
  saveJson("proposals.json", props);
  completeJob(job.id, { proposal: props[i], mission });
  audit("innovator.apply", { id: proposalId, missionId: mission.id, jobId: job.id });
  return {
    ok: true as const,
    applied: true,
    proposal: props[i],
    mission,
    job_id: job.id,
    rollback: { action: "mark_proposal_rejected", proposalId },
  };
}

export const tools: ToolDef[] = [
  {
    name: "innovator_status",
    description: "Bundle status, proposal counts, policy",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => innovatorStatus(),
  },
  {
    name: "innovator_propose",
    description: "Create and auto-score a proposal",
    inputSchema: {
      type: "object",
      properties: {
        idea: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["idea"],
    },
    handler: (a) =>
      innovatorPropose(String(a.idea ?? ""), Array.isArray(a.tags) ? a.tags.map(String) : []),
  },
  {
    name: "innovator_list",
    description: "List proposals optionally filtered by status",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string" } },
    },
    handler: (a) => innovatorList(a.status != null ? String(a.status) : undefined),
  },
  {
    name: "innovator_get",
    description: "Get one proposal by id",
    inputSchema: {
      type: "object",
      properties: { proposal_id: { type: "string" } },
      required: ["proposal_id"],
    },
    handler: (a) => innovatorGet(String(a.proposal_id ?? "")),
  },
  {
    name: "innovator_apply",
    description: "Apply proposal (confirm=EXECUTE) and queue mission",
    inputSchema: {
      type: "object",
      properties: {
        proposal_id: { type: "string" },
        confirm: { type: "string" },
      },
      required: ["proposal_id"],
    },
    handler: (a) =>
      innovatorApply(String(a.proposal_id ?? ""), a.confirm != null ? String(a.confirm) : undefined),
  },
  {
    name: "innovator_reject",
    description: "Reject proposal (confirm=EXECUTE)",
    inputSchema: {
      type: "object",
      properties: {
        proposal_id: { type: "string" },
        reason: { type: "string" },
        confirm: { type: "string" },
      },
      required: ["proposal_id"],
    },
    handler: (a) =>
      innovatorReject(
        String(a.proposal_id ?? ""),
        a.reason != null ? String(a.reason) : undefined,
        a.confirm != null ? String(a.confirm) : undefined,
      ),
  },
];
