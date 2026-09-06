"use client";

import React from "react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ═══════════════════════════════════════════════════════════════════
 *  FTA Module — IEC 61025 + MIL-STD-882E
 *
 *  Fault Tree Analysis with qualitative (minimal cut sets) and
 *  quantitative (probability, importance measures) analysis.
 *  Integrated hazard risk assessment per MIL-STD-882E.
 * ═══════════════════════════════════════════════════════════════════ */

/* ── Types ── */

type GateType = "AND" | "OR" | "VOTING" | "INHIBIT" | "PAND" | "XOR";
type EventType = "BASIC" | "INTERMEDIATE" | "UNDEVELOPED" | "EXTERNAL" | "HOUSE" | "CONDITIONING";
type SeverityLevel = "I" | "II" | "III" | "IV";
type ProbLevel = "A" | "B" | "C" | "D" | "E" | "F";
type RiskLevel = "HIGH" | "SERIOUS" | "MEDIUM" | "LOW" | "ELIMINATED";

interface FTANode {
  id: string;
  label: string;
  gateType?: GateType;
  eventType?: EventType;
  probability: number;
  failureRate: number;
  votingK?: number;
  description: string;
  children: string[];
  parentId: string | null;
}

interface CutSet {
  events: string[];
  order: number;
  probability: number;
}

interface ImportanceResult {
  eventId: string;
  birnbaum: number;
  criticality: number;
  fussellVesely: number;
  raw: number;
  rrw: number;
}

interface HazardEntry {
  id: string;
  description: string;
  severity: SeverityLevel;
  phase: string;
  topEventId: string;
  rac: string;
  riskLevel: RiskLevel;
  mitigation: string;
  status: "OPEN" | "MITIGATED" | "CLOSED" | "ACCEPTED";
}

/* ── Constants ── */

const SEVERITY_LABELS: Record<SeverityLevel, string> = {
  I: "Catastrophic", II: "Critical", III: "Marginal", IV: "Negligible",
};
const PROB_LABELS: Record<ProbLevel, string> = {
  A: "Frequent", B: "Probable", C: "Occasional", D: "Remote", E: "Improbable", F: "Eliminated",
};

const RISK_MATRIX: Record<ProbLevel, Record<SeverityLevel, RiskLevel>> = {
  A: { I: "HIGH", II: "HIGH", III: "SERIOUS", IV: "MEDIUM" },
  B: { I: "HIGH", II: "HIGH", III: "SERIOUS", IV: "MEDIUM" },
  C: { I: "HIGH", II: "SERIOUS", III: "MEDIUM", IV: "LOW" },
  D: { I: "SERIOUS", II: "MEDIUM", III: "MEDIUM", IV: "LOW" },
  E: { I: "MEDIUM", II: "MEDIUM", III: "MEDIUM", IV: "LOW" },
  F: { I: "ELIMINATED", II: "ELIMINATED", III: "ELIMINATED", IV: "ELIMINATED" },
};

const RISK_COLORS: Record<RiskLevel, string> = {
  HIGH: "#ef4444", SERIOUS: "#f97316", MEDIUM: "#eab308", LOW: "#22c55e", ELIMINATED: "#6b7280",
};

const GATE_COLORS: Record<GateType, string> = {
  AND: "#3b82f6", OR: "#8b5cf6", VOTING: "#06b6d4", INHIBIT: "#f59e0b", PAND: "#ec4899", XOR: "#64748b",
};

const GATE_SYMBOLS: Record<GateType, string> = {
  AND: "AND", OR: "OR", VOTING: "VOT", INHIBIT: "INH", PAND: "PAND", XOR: "XOR",
};

const EVENT_SYMBOLS: Record<EventType, string> = {
  BASIC: "circle", INTERMEDIATE: "rect", UNDEVELOPED: "diamond", EXTERNAL: "house", HOUSE: "house", CONDITIONING: "smallcircle",
};

/* ── Utility ── */

const fmtSCI = (v: number) => (v ? Number(v).toExponential(2) : "0");
const num = (v: unknown) => parseFloat(v as string) || 0;
const probToLevel = (p: number): ProbLevel => {
  if (p > 1e-2) return "A"; if (p > 1e-3) return "B";
  if (p > 1e-4) return "C"; if (p > 1e-5) return "D"; return "E";
};
const getRAC = (sev: SeverityLevel, prob: ProbLevel): string => `${sev}${prob}`;
const getRiskLevel = (sev: SeverityLevel, prob: ProbLevel): RiskLevel => RISK_MATRIX[prob][sev];
const nId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ═══════════════════════════════════════════════════════════════════
 *  FTA ANALYSIS ENGINE (IEC 61025)
 * ═══════════════════════════════════════════════════════════════════ */

/* MOCUS — Method for Obtaining Cut Sets */
function mocus(nodes: Map<string, FTANode>, topId: string): string[][] {
  let sets: string[][] = [[topId]];

  for (let iter = 0; iter < 50; iter++) {
    let expanded = false;
    const nextSets: string[][] = [];

    for (const set of sets) {
      const newSet: string[][] = [[]];
      let hasGate = false;

      for (const id of set) {
        const node = nodes.get(id);
        if (!node) { newSet.forEach((s) => s.push(id)); continue; }
        if (node.gateType && node.children.length > 0) {
          hasGate = true;
          if (node.gateType === "AND") {
            for (const s of newSet) s.push(...node.children);
          } else if (node.gateType === "OR" || node.gateType === "XOR") {
            const expanded2: string[][] = [];
            for (const child of node.children) {
              for (const s of newSet) expanded2.push([...s, child]);
            }
            newSet.length = 0;
            newSet.push(...expanded2);
          } else if (node.gateType === "VOTING") {
            const k = node.votingK || 1;
            const n = node.children.length;
            const combos: string[][] = [];
            const combine = (start: number, combo: string[]) => {
              if (combo.length === k) { combos.push([...combo]); return; }
              for (let i = start; i < n; i++) { combo.push(node.children[i]); combine(i + 1, combo); combo.pop(); }
            };
            combine(0, []);
            const expanded3: string[][] = [];
            for (const combo of combos) {
              for (const s of newSet) expanded3.push([...s, ...combo]);
            }
            newSet.length = 0;
            newSet.push(...expanded3);
          } else {
            /* INHIBIT, PAND — treat as AND */
            for (const s of newSet) s.push(...node.children);
          }
        } else {
          newSet.forEach((s) => s.push(id));
        }
      }
      if (hasGate) expanded = true;
      nextSets.push(...newSet);
    }
    sets = nextSets;
    if (!expanded) break;
  }

  /* Deduplicate + remove supersets */
  const unique = new Map<string, string[]>();
  for (const set of sets) {
    const basicOnly = [...new Set(set.filter((id) => {
      const n = nodes.get(id);
      return !n || n.eventType === "BASIC" || n.eventType === "UNDEVELOPED" || n.eventType === "EXTERNAL" || n.eventType === "HOUSE";
    }))];
    basicOnly.sort();
    const key = basicOnly.join("|");
    if (!unique.has(key)) unique.set(key, basicOnly);
  }

  const result = [...unique.values()];
  /* Remove supersets */
  return result.filter((a) => !result.some((b) => b !== a && b.length < a.length && b.every((e) => a.includes(e))));
}

/* Quantitative: top event probability from cut sets */
function calcTopProb(cutSets: string[][], nodes: Map<string, FTANode>): number {
  const pTop = cutSets.reduce((acc, cs) => {
    const pCS = cs.reduce((a, eId) => {
      const node = nodes.get(eId);
      return a * (node?.probability || 0);
    }, 1);
    return acc * (1 - pCS);
  }, 1);
  return 1 - pTop;
}

/* Importance measures */
function calcImportance(
  eventId: string, cutSets: string[][], nodes: Map<string, FTANode>, topProb: number
): { birnbaum: number; criticality: number; fussellVesely: number; raw: number; rrw: number } {
  /* Birnbaum: P(TOP|A=1) - P(TOP|A=0) */
  const nodesWithA = new Map(nodes);
  const pA0 = nodes.get(eventId)?.probability || 0;
  nodesWithA.set(eventId, { ...nodes.get(eventId)!, probability: 1 });
  const pGivenA1 = calcTopProb(cutSets, nodesWithA);
  nodesWithA.set(eventId, { ...nodes.get(eventId)!, probability: 0 });
  const pGivenA0 = calcTopProb(cutSets, nodesWithA);
  const birnbaum = pGivenA1 - pGivenA0;

  /* Fussell-Vesely: P(cut sets containing A) / P(TOP) */
  const relevantCS = cutSets.filter((cs) => cs.includes(eventId));
  const pRelevant = 1 - relevantCS.reduce((acc, cs) => {
    const pCS = cs.reduce((a, eId) => a * (nodes.get(eId)?.probability || 0), 1);
    return acc * (1 - pCS);
  }, 1);
  const fussellVesely = topProb > 0 ? pRelevant / topProb : 0;

  /* Criticality: I_B(A) * P(A) / P(TOP) */
  const criticality = topProb > 0 ? birnbaum * pA0 / topProb : 0;

  /* RAW: P(TOP | A=1) / P(TOP) */
  const raw = topProb > 0 ? pGivenA1 / topProb : 0;

  /* RRW: P(TOP) / P(TOP | A=0) */
  const rrw = pGivenA0 > 0 ? topProb / pGivenA0 : 0;

  return { birnbaum, criticality, fussellVesely, raw, rrw };
}

/* ═══════════════════════════════════════════════════════════════════
 *  COMPONENT
 * ═══════════════════════════════════════════════════════════════════ */

export default function FTASheet() {
  /* ── State ── */
  const [nodes, setNodes] = useState<Map<string, FTANode>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cutSets, setCutSets] = useState<CutSet[]>([]);
  const [topProb, setTopProb] = useState(0);
  const [importance, setImportance] = useState<ImportanceResult[]>([]);
  const [hazards, setHazards] = useState<HazardEntry[]>([]);

  /* Dialogs */
  const [addGateDialog, setAddGateDialog] = useState(false);
  const [addEventDialog, setAddEventDialog] = useState(false);
  const [riskDialog, setRiskDialog] = useState(false);
  const [editDialog, setEditDialog] = useState<{ id: string } | null>(null);

  /* Form state */
  const [gateType, setGateType] = useState<GateType>("AND");
  const [eventType, setEventType] = useState<EventType>("BASIC");
  const [nodeLabel, setNodeLabel] = useState("");
  const [nodeProb, setNodeProb] = useState("0");
  const [nodeLambda, setNodeLambda] = useState("0");
  const [nodeDesc, setNodeDesc] = useState("");
  const [votingK, setVotingK] = useState("1");

  /* Hazard form */
  const [hazDesc, setHazDesc] = useState("");
  const [hazSeverity, setHazSeverity] = useState<SeverityLevel>("III");
  const [hazPhase, setHazPhase] = useState("");
  const [hazMitigation, setHazMitigation] = useState("");

  /* UI state */
  const [showWorksheet, setShowWorksheet] = useState(true);
  const [showResults, setShowResults] = useState(false);
  const [tab, setTab] = useState<"tree" | "hazards">("tree");
  const [copied, setCopied] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<Map<string, FTANode>>(new Map());

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  /* ── Initialize with a default tree ── */
  useEffect(() => {
    const topId = nId();
    const g1Id = nId();
    const e1Id = nId();
    const e2Id = nId();
    const init = new Map<string, FTANode>();
    init.set(topId, { id: topId, label: "Top Event", eventType: "INTERMEDIATE", probability: 0, failureRate: 0, children: [g1Id], parentId: null, description: "Define your top event" });
    init.set(g1Id, { id: g1Id, label: "AND Gate", gateType: "AND", probability: 0, failureRate: 0, children: [e1Id, e2Id], parentId: topId, description: "" });
    init.set(e1Id, { id: e1Id, label: "Event A", eventType: "BASIC", probability: 0.01, failureRate: 0, children: [], parentId: g1Id, description: "" });
    init.set(e2Id, { id: e2Id, label: "Event B", eventType: "BASIC", probability: 0.01, failureRate: 0, children: [], parentId: g1Id, description: "" });
    setNodes(init);
    setSelectedId(topId);
  }, []);

  /* ── Get top node ── */
  const topNode = useMemo(() => {
    for (const n of nodes.values()) { if (!n.parentId) return n; }
    return null;
  }, [nodes]);

  /* ── Add gate under selected node ── */
  const addGate = useCallback(() => {
    if (!selectedId) { alert("Select a node first."); return; }
    const parent = nodesRef.current.get(selectedId);
    if (!parent) return;
    const id = nId();
    const newNode: FTANode = {
      id, label: nodeLabel || `${gateType} Gate`, gateType, probability: 0, failureRate: 0,
      children: [], parentId: selectedId, description: nodeDesc,
      votingK: gateType === "VOTING" ? parseInt(votingK) || 1 : undefined,
    };
    if (gateType === "VOTING") { newNode.votingK = parseInt(votingK) || 1; }
    setNodes((prev) => {
      const next = new Map(prev);
      const p = next.get(selectedId);
      if (p) next.set(selectedId, { ...p, children: [...p.children, id] });
      next.set(id, newNode);
      return next;
    });
    setAddGateDialog(false); setNodeLabel(""); setNodeDesc("");
  }, [selectedId, gateType, nodeLabel, nodeDesc, votingK]);

  /* ── Add event under selected node ── */
  const addEvent = useCallback(() => {
    if (!selectedId) { alert("Select a node first."); return; }
    const parent = nodesRef.current.get(selectedId);
    if (!parent) return;
    const id = nId();
    const prob = num(nodeProb);
    const newNode: FTANode = {
      id, label: nodeLabel || `Event ${Date.now().toString(36).slice(-3)}`, eventType,
      probability: prob, failureRate: num(nodeLambda),
      children: [], parentId: selectedId, description: nodeDesc,
    };
    setNodes((prev) => {
      const next = new Map(prev);
      const p = next.get(selectedId);
      if (p) next.set(selectedId, { ...p, children: [...p.children, id] });
      next.set(id, newNode);
      return next;
    });
    setAddEventDialog(false); setNodeLabel(""); setNodeProb("0"); setNodeLambda("0"); setNodeDesc("");
  }, [selectedId, eventType, nodeLabel, nodeProb, nodeLambda, nodeDesc]);

  /* ── Delete node ── */
  const deleteNode = useCallback((id: string) => {
    setNodes((prev) => {
      const next = new Map(prev);
      const node = next.get(id);
      if (!node || !node.parentId) return prev; /* can't delete top */
      /* Remove from parent's children */
      const parent = next.get(node.parentId);
      if (parent) next.set(node.parentId, { ...parent, children: parent.children.filter((c) => c !== id) });
      /* Recursively remove descendants */
      const remove = (nid: string) => {
        const n = next.get(nid);
        if (n) { n.children.forEach(remove); next.delete(nid); }
      };
      remove(id);
      return next;
    });
    setSelectedId(null);
  }, []);

  /* ── Run analysis ── */
  const runAnalysis = useCallback(() => {
    if (nodes.size === 0) { alert("Build a tree first."); return; }
    const top = topNode;
    if (!top) { alert("No top event found."); return; }

    const mcs = mocus(nodes, top.id);
    const tProb = calcTopProb(mcs, nodes);

    const csResults: CutSet[] = mcs.map((cs) => ({
      events: cs,
      order: cs.length,
      probability: cs.reduce((a, eId) => a * (nodes.get(eId)?.probability || 0), 1),
    }));

    /* Importance for each basic event */
    const basicEvents = [...nodes.values()].filter((n) => n.eventType === "BASIC" || n.eventType === "UNDEVELOPED");
    const impResults: ImportanceResult[] = basicEvents.map((be) => ({
      eventId: be.id,
      ...calcImportance(be.id, mcs, nodes, tProb),
    }));
    impResults.sort((a, b) => b.fussellVesely - a.fussellVesely);

    setCutSets(csResults);
    setTopProb(tProb);
    setImportance(impResults);
    setShowResults(true);
  }, [nodes, topNode]);

  /* ── Copy results ── */
  const copyResults = useCallback(() => {
    const top = topNode;
    let text = `FTA Analysis — ${top?.label || "Top Event"}\n`;
    text += `Top Event Probability: ${fmtSCI(topProb)}\n\n`;
    text += `Minimal Cut Sets (${cutSets.length}):\n`;
    cutSets.forEach((cs, i) => {
      const names = cs.events.map((eId) => nodes.get(eId)?.label || eId).join(", ");
      text += `  ${i + 1}. {${names}} — P=${fmtSCI(cs.probability)}\n`;
    });
    text += `\nImportance Measures:\n`;
    text += `Event | Fussell-Vesely | Birnbaum | Criticality | RAW | RRW\n`;
    importance.forEach((imp) => {
      const name = nodes.get(imp.eventId)?.label || imp.eventId;
      text += `${name} | ${(imp.fussellVesely * 100).toFixed(2)}% | ${imp.birnbaum.toFixed(4)} | ${(imp.criticality * 100).toFixed(2)}% | ${imp.raw.toFixed(2)} | ${imp.rrw.toFixed(2)}\n`;
    });

    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => {});
    else done();
  }, [topNode, topProb, cutSets, importance, nodes]);

  /* ── Delete selected ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !addGateDialog && !addEventDialog && !editDialog) {
        const node = nodesRef.current.get(selectedId);
        if (node && node.parentId) deleteNode(selectedId);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectedId, addGateDialog, addEventDialog, editDialog, deleteNode]);

  /* ── Add hazard ── */
  const addHazard = useCallback(() => {
    const id = `HAZ-${hazards.length + 1}`;
    const rac = getRAC(hazSeverity, probToLevel(topProb));
    const risk = getRiskLevel(hazSeverity, probToLevel(topProb));
    setHazards((prev) => [...prev, {
      id, description: hazDesc || "Untitled Hazard", severity: hazSeverity,
      phase: hazPhase, topEventId: topNode?.id || "", rac, riskLevel: risk,
      mitigation: hazMitigation, status: "OPEN",
    }]);
    setRiskDialog(false); setHazDesc(""); setHazPhase(""); setHazMitigation("");
  }, [hazards.length, hazDesc, hazSeverity, hazPhase, hazMitigation, topNode, topProb]);

  /* ═══════════════════════════════════════════════════════════════════
   *  TREE LAYOUT (simple recursive)
   * ═══════════════════════════════════════════════════════════════════ */

  interface LayoutNode { id: string; x: number; y: number; w: number; h: number; }

  const layout = useMemo(() => {
    if (nodes.size === 0) return { positions: new Map<string, LayoutNode>(), width: 0, height: 0 };
    const top = topNode;
    if (!top) return { positions: new Map<string, LayoutNode>(), width: 0, height: 0 };

    const GAP_X = 40;
    const GAP_Y = 80;
    const NODE_W = 100;
    const NODE_H = 50;
    const positions = new Map<string, LayoutNode>();
    let maxX = 0;

    const measure = (id: string): number => {
      const node = nodes.get(id);
      if (!node || node.children.length === 0) return NODE_W;
      const childWidths = node.children.map(measure);
      const total = childWidths.reduce((s, w) => s + w, 0) + (childWidths.length - 1) * GAP_X;
      return Math.max(NODE_W, total);
    };

    const place = (id: string, x: number, y: number, availWidth: number) => {
      const node = nodes.get(id);
      if (!node) return;
      const myW = NODE_W;
      positions.set(id, { id, x: x + availWidth / 2 - myW / 2, y, w: myW, h: NODE_H });
      if (node.children.length === 0) return;
      const childWidths = node.children.map(measure);
      const totalChildW = childWidths.reduce((s, w) => s + w, 0) + (node.children.length - 1) * GAP_X;
      let cx = x + (availWidth - totalChildW) / 2;
      for (let i = 0; i < node.children.length; i++) {
        place(node.children[i], cx, y + GAP_Y, childWidths[i]);
        cx += childWidths[i] + GAP_X;
      }
    };

    const totalW = measure(top.id);
    place(top.id, 0, 20, totalW);
    let maxY = 0;
    positions.forEach((p) => { maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h); });

    return { positions, width: maxX + 60, height: maxY + 60 };
  }, [nodes, topNode]);

  /* ═══════════════════════════════════════════════════════════════════
   *  RENDER
   * ═══════════════════════════════════════════════════════════════════ */

  const selectedNode = selectedId ? nodes.get(selectedId) : null;

  return (
    <div className="relative flex flex-col h-full bg-[#0f172a]">
      <style>{`
        .fta-node{cursor:pointer;transition:filter .15s}
        .fta-node:hover{filter:brightness(1.2)}
        .fta-node-sel{filter:drop-shadow(0 0 6px #f59e0b)}
        .fta-gate{fill:#1e293b;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
        .fta-event-basic{fill:#1e293b;stroke:#10b981;stroke-width:2}
        .fta-event-intermediate{fill:#1e293b;stroke:#94a3b8;stroke-width:2}
        .fta-event-undeveloped{fill:#1e293b;stroke:#f59e0b;stroke-width:2}
        .fta-event-external{fill:#1e293b;stroke:#ec4899;stroke-width:2}
        .fta-event-house{fill:#1e293b;stroke:#8b5cf6;stroke-width:2}
        .fta-edge{stroke:#475569;stroke-width:1.5;fill:none}
        .fta-label{fill:#e2e8f0;font-size:10px;font-weight:700;text-anchor:middle;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
        .fta-sublabel{fill:#94a3b8;font-size:8px;text-anchor:middle;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
        .fta-worksheet{background:#1e293b;border:1px solid #334155;border-radius:6px;padding:8px;font-size:11px;color:#e2e8f0}
        .fta-ws-row{display:grid;grid-template-columns:60px 1fr 80px 70px 50px;gap:4px;padding:3px 0;border-bottom:1px solid #1e293b;align-items:center}
        .fta-ws-header{font-weight:700;color:#94a3b8;border-bottom:1px solid #334155;padding-bottom:4px;margin-bottom:2px}
        .fta-ws-cell{padding:2px 4px;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .fta-ws-row:hover{background:rgba(59,130,246,.1)}
        .fta-btn{padding:4px 10px;border-radius:4px;font-size:10px;font-weight:700;cursor:pointer;border:none;transition:background .15s;color:#fff}
        .fta-btn.primary{background:#3b82f6}.fta-btn.primary:hover{background:#2563eb}
        .fta-btn.danger{background:#ef4444}.fta-btn.danger:hover{background:#dc2626}
        .fta-btn.secondary{background:#334155;color:#cbd5e1}.fta-btn.secondary:hover{background:#475569}
        .fta-dialog{position:fixed;z-index:10001;background:#1e293b;border:1px solid #475569;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.6);padding:16px;min-width:220px}
        .fta-dialog label{display:block;font-size:10px;color:#94a3b8;margin-bottom:3px}
        .fta-dialog input,.fta-dialog select{width:100%;padding:5px 8px;background:#0f172a;border:1px solid #475569;border-radius:4px;color:#e2e8f0;font-size:11px;margin-bottom:6px;outline:none}
        .fta-dialog input:focus,.fta-dialog select:focus{border-color:#3b82f6}
        .fta-dialog select{appearance:auto}
        .fta-tab{padding:4px 10px;font-size:10px;font-weight:700;cursor:pointer;border-radius:4px 4px 0 0;border:1px solid transparent;color:#94a3b8;transition:all .15s}
        .fta-tab.active{background:#1e293b;color:#e2e8f0;border-color:#334155;border-bottom-color:#1e293b}
        .fta-tab:hover:not(.active){color:#e2e8f0}
        .fta-risk-badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700;color:#fff}
        .fta-results-table{width:100%;border-collapse:collapse;font-size:10px}
        .fta-results-table th{text-align:left;padding:4px 8px;color:#94a3b8;border-bottom:1px solid #334155;font-weight:700}
        .fta-results-table td{padding:4px 8px;border-bottom:1px solid #1e293b}
        .fta-results-table tr:hover td{background:rgba(59,130,246,.08)}
      `}</style>

      {/* ── Header toolbar ── */}
      <div className="bg-[#1e293b] px-3 py-1.5 flex items-center gap-1.5 border-b border-slate-700/60 shrink-0">
        <button onClick={() => setTab("tree")} className={`fta-tab ${tab === "tree" ? "active" : ""}`}>Fault Tree</button>
        <button onClick={() => setTab("hazards")} className={`fta-tab ${tab === "hazards" ? "active" : ""}`}>
          Hazards {hazards.length > 0 && <span className="ml-1 bg-red-500 text-white rounded-full px-1.5 text-[8px]">{hazards.length}</span>}
        </button>
        <div className="w-px h-5 bg-slate-700 mx-1" />
        {tab === "tree" && (
          <>
            <button onClick={() => { if (selectedId) setAddGateDialog(true); else alert("Select a node first."); }} className="fta-btn primary">+ Gate</button>
            <button onClick={() => { if (selectedId) setAddEventDialog(true); else alert("Select a node first."); }} className="fta-btn primary">+ Event</button>
            <button onClick={runAnalysis} className="fta-btn" style={{ background: "#10b981" }}>Run Analysis</button>
            {selectedId && nodes.get(selectedId)?.parentId && (
              <button onClick={() => deleteNode(selectedId!)} className="fta-btn danger">Delete</button>
            )}
            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              {showResults && (
                <button onClick={copyResults} className="fta-btn primary">{copied ? "Copied ✓" : "Copy Results"}</button>
              )}
              <button onClick={() => setShowWorksheet((s) => !s)} className={`fta-btn ${showWorksheet ? "primary" : "secondary"}`}>
                {showWorksheet ? "Hide" : "Show"} Worksheet
              </button>
            </div>
          </>
        )}
        {tab === "hazards" && (
          <button onClick={() => setRiskDialog(true)} className="fta-btn primary">+ Add Hazard</button>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* ── Left: Canvas + Worksheet ── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Canvas */}
          {tab === "tree" && (
            <div ref={canvasRef} className="flex-1 overflow-auto" style={{ background: "radial-gradient(circle,#1e293b 1px,transparent 1px)", backgroundSize: "24px 24px", backgroundColor: "#0f172a" }}>
              {layout.positions.size === 0 ? (
                <div className="flex items-center justify-center h-full text-slate-600 text-sm">
                  Click a node, then "+ Gate" or "+ Event" to build the tree
                </div>
              ) : (
                <svg width={layout.width} height={layout.height} style={{ minWidth: layout.width, minHeight: layout.height }}>
                  {/* Edges */}
                  {(() => {
                    const edges: React.ReactElement[] = [];
                    nodes.forEach((node) => {
                      if (!node.parentId) return;
                      const parentPos = layout.positions.get(node.parentId);
                      const childPos = layout.positions.get(node.id);
                      if (!parentPos || !childPos) return;
                      const x1 = parentPos.x + parentPos.w / 2;
                      const y1 = parentPos.y + parentPos.h;
                      const x2 = childPos.x + childPos.w / 2;
                      const y2 = childPos.y;
                      const my = (y1 + y2) / 2;
                      edges.push(<path key={`${node.parentId}-${node.id}`} className="fta-edge" d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`} />);
                    });
                    return edges;
                  })()}
                  {/* Nodes */}
                  {layout.positions.size > 0 && [...layout.positions.values()].map((pos) => {
                    const node = nodes.get(pos.id);
                    if (!node) return null;
                    const isSelected = pos.id === selectedId;
                    const cx = pos.x + pos.w / 2;
                    const cy = pos.y + pos.h / 2;
                    const rx = pos.w / 2 - 2;
                    const ry = pos.h / 2 - 2;

                    let shape: React.ReactElement;
                    if (node.gateType) {
                      /* Gate shape */
                      const color = GATE_COLORS[node.gateType] || "#3b82f6";
                      if (node.gateType === "AND") {
                        shape = (
                          <g>
                            <rect x={pos.x + 2} y={pos.y + ry * 0.4} width={pos.w - 4} height={ry * 1.2} rx={4} className="fta-gate" style={{ stroke: color }} />
                            <rect x={pos.x + 2} y={pos.y + ry * 0.4} width={pos.w - 4} height={ry * 0.5} rx={4} className="fta-gate" style={{ stroke: color, fill: color, opacity: 0.15 }} />
                          </g>
                        );
                      } else if (node.gateType === "OR") {
                        shape = (
                          <path d={`M ${pos.x + 4} ${pos.y + pos.h - 4} Q ${cx} ${pos.y - 4} ${pos.x + pos.w - 4} ${pos.y + pos.h - 4} Q ${cx} ${cy} ${pos.x + 4} ${pos.y + pos.h - 4}`} className="fta-gate" style={{ stroke: color }} />
                        );
                      } else {
                        shape = <rect x={pos.x + 2} y={pos.y + 2} width={pos.w - 4} height={pos.h - 4} rx={6} className="fta-gate" style={{ stroke: color }} />;
                      }
                    } else {
                      /* Event shape */
                      const evType = node.eventType || "BASIC";
                      const evColor = evType === "BASIC" ? "#10b981" : evType === "UNDEVELOPED" ? "#f59e0b" : evType === "EXTERNAL" || evType === "HOUSE" ? "#ec4899" : "#94a3b8";
                      if (evType === "BASIC" || evType === "CONDITIONING") {
                        shape = <ellipse cx={cx} cy={cy} rx={rx} ry={ry} className="fta-event-basic" style={{ stroke: evColor }} />;
                      } else if (evType === "UNDEVELOPED") {
                        shape = <polygon points={`${cx},${pos.y + 2} ${pos.x + pos.w - 2},${cy} ${cx},${pos.y + pos.h - 2} ${pos.x + 2},${cy}`} className="fta-event-undeveloped" />;
                      } else if (evType === "EXTERNAL" || evType === "HOUSE") {
                        shape = <rect x={pos.x + 4} y={pos.y + 8} width={pos.w - 8} height={pos.h - 16} className="fta-event-house" />;
                      } else {
                        shape = <rect x={pos.x + 4} y={pos.y + 4} width={pos.w - 8} height={pos.h - 8} rx={3} className="fta-event-intermediate" />;
                      }
                    }

                    return (
                      <g key={pos.id} className={`fta-node ${isSelected ? "fta-node-sel" : ""}`} onClick={() => setSelectedId(pos.id)}>
                        {shape}
                        <text x={cx} y={cy + (node.gateType ? -2 : 1)} className="fta-label">{node.label}</text>
                        {node.gateType && <text x={cx} y={cy + 12} className="fta-sublabel">{GATE_SYMBOLS[node.gateType]}{node.gateType === "VOTING" && node.votingK ? ` ${node.votingK}/${node.children.length}` : ""}</text>}
                        {!node.gateType && node.probability > 0 && <text x={cx} y={cy + 12} className="fta-sublabel">{fmtSCI(node.probability)}</text>}
                      </g>
                    );
                  })}
                </svg>
              )}
            </div>
          )}

          {/* Hazards table */}
          {tab === "hazards" && (
            <div className="flex-1 overflow-auto p-3">
              <table className="fta-results-table">
                <thead>
                  <tr>
                    <th>ID</th><th>Description</th><th>Severity</th><th>Probability</th>
                    <th>RAC</th><th>Risk Level</th><th>Mitigation</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {hazards.length === 0 && (
                    <tr><td colSpan={9} className="text-center text-slate-600 py-8">No hazards defined. Click "+ Add Hazard" to begin.</td></tr>
                  )}
                  {hazards.map((h, i) => (
                    <tr key={h.id}>
                      <td className="text-sky-400 font-mono">{h.id}</td>
                      <td>{h.description}</td>
                      <td>{SEVERITY_LABELS[h.severity]} ({h.severity})</td>
                      <td>{PROB_LABELS[probToLevel(topProb)]} ({probToLevel(topProb)})</td>
                      <td className="font-mono font-bold">{h.rac}</td>
                      <td><span className="fta-risk-badge" style={{ background: RISK_COLORS[h.riskLevel] }}>{h.riskLevel}</span></td>
                      <td className="max-w-[150px] truncate">{h.mitigation || "—"}</td>
                      <td>
                        <select value={h.status} onChange={(e) => {
                          const v = e.target.value as HazardEntry["status"];
                          setHazards((prev) => prev.map((hh) => hh.id === h.id ? { ...hh, status: v } : hh));
                        }} className="bg-transparent border border-slate-700 rounded text-[10px] px-1 py-0.5 text-slate-300">
                          <option value="OPEN">Open</option>
                          <option value="MITIGATED">Mitigated</option>
                          <option value="CLOSED">Closed</option>
                          <option value="ACCEPTED">Accepted</option>
                        </select>
                      </td>
                      <td>
                        <button onClick={() => setHazards((prev) => prev.filter((hh) => hh.id !== h.id))} className="text-red-400 hover:text-red-300 text-xs">&times;</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Worksheet panel (below canvas) */}
          {tab === "tree" && showWorksheet && (
            <div className="fta-worksheet border-t border-slate-700/60 max-h-[200px] overflow-y-auto">
              <div className="fta-ws-row fta-ws-header">
                <div>ID</div><div>Label</div><div>Type</div><div>Prob</div><div>Gate</div>
              </div>
              {[...nodes.values()].map((n) => (
                <div key={n.id} className={`fta-ws-row cursor-pointer ${n.id === selectedId ? "bg-blue-900/30" : ""}`} onClick={() => setSelectedId(n.id)}>
                  <div className="fta-ws-cell text-slate-500 font-mono">{n.id.slice(-5)}</div>
                  <div className="fta-ws-cell">{n.label}</div>
                  <div className="fta-ws-cell">
                    {n.gateType ? (
                      <span style={{ color: GATE_COLORS[n.gateType] }}>{GATE_SYMBOLS[n.gateType]}</span>
                    ) : (
                      <span className="text-emerald-400">{n.eventType || "BASIC"}</span>
                    )}
                  </div>
                  <div className="fta-ws-cell font-mono">{n.probability > 0 ? fmtSCI(n.probability) : "—"}</div>
                  <div className="fta-ws-cell">
                    {n.parentId ? nodes.get(n.parentId)?.gateType || "" : "TOP"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Right panel: Results ── */}
        {showResults && tab === "tree" && (
          <div className="w-[340px] bg-[#1e293b] border-l border-slate-700/60 flex flex-col overflow-hidden shrink-0">
            <div className="px-3 py-2 border-b border-slate-700/60 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Analysis Results</h3>
              <button onClick={() => setShowResults(false)} className="text-slate-500 hover:text-white text-lg leading-none">&times;</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {/* Top event probability */}
              <div>
                <div className="text-[10px] text-slate-500 uppercase mb-1">Top Event Probability</div>
                <div className="text-lg font-bold text-red-400">{fmtSCI(topProb)}</div>
                <div className="text-[10px] text-slate-400">
                  MIL-STD-882E: {PROB_LABELS[probToLevel(topProb)]} ({probToLevel(topProb)})
                </div>
              </div>

              {/* Minimal cut sets */}
              <div>
                <div className="text-[10px] text-slate-500 uppercase mb-1">Minimal Cut Sets ({cutSets.length})</div>
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {cutSets.map((cs, i) => (
                    <div key={i} className="text-[10px] text-slate-300 bg-[#0f172a] rounded px-2 py-1">
                      <span className="text-slate-500 mr-1">{i + 1}.</span>
                      {"{"}{cs.events.map((eId) => nodes.get(eId)?.label || eId).join(", ")}{"}"}
                      {" "}<span className="text-slate-500">P={fmtSCI(cs.probability)}</span>
                    </div>
                  ))}
                  {cutSets.length === 0 && <div className="text-[10px] text-slate-600">Run analysis to compute</div>}
                </div>
              </div>

              {/* Importance measures */}
              {importance.length > 0 && (
                <div>
                  <div className="text-[10px] text-slate-500 uppercase mb-1">Importance Measures</div>
                  <table className="fta-results-table">
                    <thead>
                      <tr><th>Event</th><th>FV</th><th>Birnbaum</th><th>Crit.</th></tr>
                    </thead>
                    <tbody>
                      {importance.map((imp) => (
                        <tr key={imp.eventId}>
                          <td className="text-slate-200">{nodes.get(imp.eventId)?.label}</td>
                          <td>{(imp.fussellVesely * 100).toFixed(1)}%</td>
                          <td>{imp.birnbaum.toFixed(4)}</td>
                          <td>{(imp.criticality * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Severity legend */}
              <div>
                <div className="text-[10px] text-slate-500 uppercase mb-1">MIL-STD-882E Risk Matrix</div>
                <table className="fta-results-table text-[9px]">
                  <thead>
                    <tr><th></th><th>I Cat.</th><th>II Crit.</th><th>III Marg.</th><th>IV Neg.</th></tr>
                  </thead>
                  <tbody>
                    {(Object.keys(RISK_MATRIX) as ProbLevel[]).map((p) => (
                      <tr key={p}>
                        <td className="text-slate-400 font-bold">{p} {PROB_LABELS[p].slice(0, 4)}</td>
                        {(["I", "II", "III", "IV"] as SeverityLevel[]).map((s) => (
                          <td key={s} className="text-center">
                            <span className="fta-risk-badge" style={{ background: RISK_COLORS[RISK_MATRIX[p][s]], fontSize: 8 }}>
                              {RISK_MATRIX[p][s][0]}
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ Add Gate Dialog ═══ */}
      {addGateDialog && (
        <div className="fta-dialog" style={{ left: "50%", top: "50%", transform: "translate(-50%,-50%)" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>Add Gate</div>
          <label>Gate Type</label>
          <select value={gateType} onChange={(e) => setGateType(e.target.value as GateType)}>
            <option value="AND">AND</option>
            <option value="OR">OR</option>
            <option value="VOTING">Voting (k/n)</option>
            <option value="INHIBIT">Inhibit</option>
            <option value="PAND">Priority-AND</option>
            <option value="XOR">Exclusive-OR</option>
          </select>
          {gateType === "VOTING" && <>
            <label>k (min required)</label>
            <input type="number" min="1" value={votingK} onChange={(e) => setVotingK(e.target.value)} />
          </>}
          <label>Label</label>
          <input type="text" value={nodeLabel} onChange={(e) => setNodeLabel(e.target.value)} placeholder={`${gateType} Gate`} autoFocus />
          <label>Description</label>
          <input type="text" value={nodeDesc} onChange={(e) => setNodeDesc(e.target.value)} placeholder="Optional" />
          <div className="flex gap-2 justify-end mt-2">
            <button className="fta-btn secondary" onClick={() => setAddGateDialog(false)}>Cancel</button>
            <button className="fta-btn primary" onClick={addGate}>Add</button>
          </div>
        </div>
      )}

      {/* ═══ Add Event Dialog ═══ */}
      {addEventDialog && (
        <div className="fta-dialog" style={{ left: "50%", top: "50%", transform: "translate(-50%,-50%)" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>Add Event</div>
          <label>Event Type</label>
          <select value={eventType} onChange={(e) => setEventType(e.target.value as EventType)}>
            <option value="BASIC">Basic (Circle)</option>
            <option value="UNDEVELOPED">Undeveloped (Diamond)</option>
            <option value="EXTERNAL">External (House)</option>
            <option value="HOUSE">House Event</option>
            <option value="CONDITIONING">Conditioning</option>
          </select>
          <label>Label</label>
          <input type="text" value={nodeLabel} onChange={(e) => setNodeLabel(e.target.value)} placeholder="Event name" autoFocus />
          <label>Probability</label>
          <input type="number" min="0" max="1" step="0.001" value={nodeProb} onChange={(e) => setNodeProb(e.target.value)} />
          <label>Description</label>
          <input type="text" value={nodeDesc} onChange={(e) => setNodeDesc(e.target.value)} placeholder="Optional" />
          <div className="flex gap-2 justify-end mt-2">
            <button className="fta-btn secondary" onClick={() => setAddEventDialog(false)}>Cancel</button>
            <button className="fta-btn primary" onClick={addEvent}>Add</button>
          </div>
        </div>
      )}

      {/* ═══ Add Hazard Dialog ═══ */}
      {riskDialog && (
        <div className="fta-dialog" style={{ left: "50%", top: "50%", transform: "translate(-50%,-50%)" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>Add Hazard (MIL-STD-882E)</div>
          <label>Description</label>
          <input type="text" value={hazDesc} onChange={(e) => setHazDesc(e.target.value)} placeholder="Hazard description" autoFocus />
          <label>Severity Level</label>
          <select value={hazSeverity} onChange={(e) => setHazSeverity(e.target.value as SeverityLevel)}>
            <option value="I">I — Catastrophic</option>
            <option value="II">II — Critical</option>
            <option value="III">III — Marginal</option>
            <option value="IV">IV — Negligible</option>
          </select>
          <label>System Phase</label>
          <input type="text" value={hazPhase} onChange={(e) => setHazPhase(e.target.value)} placeholder="e.g. Operation, Maintenance" />
          <label>Mitigation</label>
          <input type="text" value={hazMitigation} onChange={(e) => setHazMitigation(e.target.value)} placeholder="Mitigation plan" />
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
            RAC will be: <strong style={{ color: "#e2e8f0" }}>{getRAC(hazSeverity, probToLevel(topProb))}</strong>
            {" — "}
            Risk: <span className="fta-risk-badge" style={{ background: RISK_COLORS[getRiskLevel(hazSeverity, probToLevel(topProb))] }}>
              {getRiskLevel(hazSeverity, probToLevel(topProb))}
            </span>
          </div>
          <div className="flex gap-2 justify-end mt-3">
            <button className="fta-btn secondary" onClick={() => setRiskDialog(false)}>Cancel</button>
            <button className="fta-btn primary" onClick={addHazard}>Add</button>
          </div>
        </div>
      )}
    </div>
  );
}
