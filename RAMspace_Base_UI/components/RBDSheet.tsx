"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ── Types ── */

interface Comp {
  name: string; partNo?: string;
  lambda: string | number; mtbf: number | string; mttr: number | string;
  opTime?: number | string; repair?: string; fit?: string | number; fpmh?: string | number;
}
interface Block { id: number; comp: Comp; x: number; y: number; el: HTMLDivElement | null; roon?: { r: number; n: number } | null; groupId?: number | null; }
interface GroupMember { comp: Comp; dx: number; dy: number; roon?: { r: number; n: number } | null; }
interface GroupWire { fromIdx: number; toIdx: number; fromSide: string; toSide: string; }
interface Group { id: number; name: string; blockIds: number[]; el: HTMLDivElement | null; members?: GroupMember[]; wires?: GroupWire[]; }
interface Conn { id: number; from: { bid: number; side: string }; to: { bid: number; side: string }; el: SVGPathElement | null; mode: string; }
interface Step { type: string; blocks: string[]; formula: string; result: string; }

const fmtSCI = (v: number) => (v ? Number(v).toExponential(2) : "0");
const fmtIN = (n: number) => {
  if (!isFinite(n)) return "∞";
  if (!n) return "0";
  const s = Math.round(n).toString();
  if (s.includes("e") || s.includes("E") || s.includes(".")) return Number(n).toExponential(2);
  const l = s.slice(-3);
  const r = s.slice(0, -3);
  return r ? r.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + l : l;
};
const num = (v: unknown) => parseFloat(v as string) || 0;
const factorial = (n: number) => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };

/* Clipboard fallback for non-secure contexts */
const fallbackCopy = (text: string, done: () => void) => {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    done();
  } catch { /* ignore */ }
};

/* ── RBD analysis engine (self-contained in this file) ── */

interface EB { id: number | string; name: string; lambda: number; mtbf: number; mttr: number; roon?: { r: number; n: number } | null; }
type EStep = { type: string; blocks: string[]; formula: string; result: string };
type ETriple = [number, number, number, string, string];

function engSeries(blocks: EB[]): ETriple {
  const totalLambda = blocks.reduce((s, b) => s + b.lambda, 0);
  const mtbf = totalLambda > 0 ? 1 / totalLambda : 0;
  const mttr = totalLambda > 0 ? blocks.reduce((s, b) => s + b.lambda * b.mttr, 0) / totalLambda : 0;
  const formula = blocks.map((b) => fmtSCI(b.lambda)).join(" + ");
  const result = `lambda=${fmtSCI(totalLambda)}, MTBF=${fmtIN(mtbf)} hrs, MTTR=${mttr.toFixed(1)} hrs`;
  return [totalLambda, mtbf, mttr, formula, result];
}

function engParallelMarkov(b1: EB, b2: EB): ETriple {
  const l1 = b1.lambda, l2 = b2.lambda;
  const t1 = b1.mttr > 0 ? b1.mttr : 1;
  const t2 = b2.mttr > 0 ? b2.mttr : 1;
  const mu1 = 1 / t1, mu2 = 1 / t2;
  const num2 = mu1 * mu2 + (l1 + l2) * (mu1 + mu2);
  const den = l1 * l2 * (l1 + l2 + mu1 + mu2);
  const mtbf = den > 0 ? num2 / den : 0;
  const ls = mtbf > 0 ? 1 / mtbf : 0;
  const avgMu = (mu1 + mu2) / 2;
  const mttr = avgMu > 0 ? 1 / (2 * avgMu) : 0;
  const formula = `[μ1μ2+(λ1+λ2)(μ1+μ2)]/[λ1λ2(λ1+λ2+μ1+μ2)]`;
  const result = `lambda=${fmtSCI(ls)}, MTBF=${fmtIN(mtbf)} hrs, MTTR=${mttr.toFixed(1)} hrs`;
  return [ls, mtbf, mttr, formula, result];
}

function engParallelSimple(blocks: EB[]): ETriple {
  if (blocks.length === 2) return engParallelMarkov(blocks[0], blocks[1]);
  const working = [...blocks];
  while (working.length > 2) {
    const b1 = working.shift()!;
    const b2 = working.shift()!;
    const [ls, mtbf, mttr] = engParallelMarkov(b1, b2);
    working.unshift({ id: -Date.now(), name: `${b1.name}||${b2.name}`, lambda: ls, mtbf, mttr });
  }
  const [ls, mtbf, mttr] = engParallelMarkov(working[0], working[1]);
  const formula = blocks.map((b) => fmtSCI(b.lambda)).join(" + ");
  const result = `lambda=${fmtSCI(ls)}, MTBF=${fmtIN(mtbf)} hrs, MTTR=${mttr.toFixed(1)} hrs`;
  return [ls, mtbf, mttr, formula, result];
}

function engROfN(b1: EB, n: number, r: number): ETriple {
  const l1 = b1.lambda;
  const t1 = b1.mttr > 0 ? b1.mttr : 1;
  /* 1oo2 is parallel — exact 2-block Markov with identical twin */
  if (r === 1 && n === 2) {
    const [ls, mtbf, mttr] = engParallelMarkov(b1, { ...b1 });
    const formula = `1oo2 ≡ parallel: [μ1μ2+(λ1+λ2)(μ1+μ2)]/[λ1λ2(λ1+λ2+μ1+μ2)]`;
    const result = `lambda=${fmtSCI(ls)}, MTBF=${fmtIN(mtbf)} hrs, MTTR=${mttr.toFixed(1)} hrs`;
    return [ls, mtbf, mttr, formula, result];
  }
  const mu = 1 / t1;
  const coeff = factorial(n) / (factorial(r - 1) * factorial(n - r + 1));
  const ls = coeff * Math.pow(l1, n - r + 1) * Math.pow(t1, n - r);
  const mtbf = ls > 0 ? 1 / ls : (l1 > 0 ? Infinity : 0);
  const mttr = mu > 0 ? 1 / ((n - r + 1) * mu) : 0;
  const formula = `C(${n},${r - 1}) * ${fmtSCI(l1)}^${n - r + 1} / ${fmtSCI(mu)}^${n - r}`;
  const result = `lambda=${fmtSCI(ls)}, MTBF=${fmtIN(mtbf)} hrs, MTTR=${mttr.toFixed(1)} hrs`;
  return [ls, mtbf, mttr, formula, result];
}

function engAnalyze(
  inBlocks: { id: number; name: string; lambda: number; mtbf: number; mttr: number; roon?: { r: number; n: number } | null }[],
  inConns: { from: { bid: number; side: string }; to: { bid: number; side: string } }[]
): { error?: string; steps: EStep[]; result_value: string } {
  if (!inBlocks.length) return { error: "No blocks provided.", steps: [], result_value: "" };
  if (!inConns.length) {
    /* Single block — return its own values */
    if (inBlocks.length === 1) {
      const b = inBlocks[0];
      let lambda = b.lambda || 0;
      if (b.mtbf > 0) lambda = 1 / b.mtbf;
      const mtbf = b.mtbf || (lambda > 0 ? 1 / lambda : 0);
      const mttr = b.mttr || 0;
      const avail = mtbf + mttr > 0 ? mtbf / (mtbf + mttr) : 0;
      const result_value =
        `lambda = ${fmtSCI(lambda)} failures/hr | ` +
        `MTBF = ${fmtIN(mtbf)} hrs | ` +
        `MTTR = ${mttr.toFixed(1)} hrs | ` +
        `Availability = ${(avail * 100).toFixed(4)}%`;
      return { steps: [], result_value };
    }
    return { error: "No connections provided.", steps: [], result_value: "" };
  }

  const parent: Record<string, string> = {};
  const find = (key: string): string => {
    if (!(key in parent)) parent[key] = key;
    if (parent[key] !== key) parent[key] = find(parent[key]);
    return parent[key];
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const portKey = (bid: number | string, side: string) => `b${bid}-${side}`;
  const nodeOf = (bid: number | string, side: string) => find(portKey(bid, side));

  const blocks: EB[] = inBlocks.map((b) => {
    let lambda = b.lambda || 0;
    if (b.mtbf > 0) lambda = 1 / b.mtbf;
    return { id: b.id, name: b.name || "Unnamed", lambda, mtbf: b.mtbf || 0, mttr: b.mttr || 0, roon: b.roon || null };
  });

  for (const b of blocks) { find(portKey(b.id, "left")); find(portKey(b.id, "right")); }
  for (const c of inConns) union(portKey(c.from.bid, c.from.side), portKey(c.to.bid, c.to.side));

  /* Filter to only connected blocks (those that participate in at least one connection) */
  const connectedIds = new Set<string | number>();
  for (const c of inConns) { connectedIds.add(c.from.bid); connectedIds.add(c.to.bid); }
  let remaining = blocks.filter((b) => connectedIds.has(b.id));
  if (!remaining.length) return { error: "No connected blocks.", steps: [], result_value: "" };
  const steps: EStep[] = [];

  for (let iter = 0; iter < 50; iter++) {
    if (remaining.length <= 1) break;
    let simplified = false;

    for (const b of remaining) {
      if (b.roon && b.roon.r > 0 && b.roon.n > 0 && b.roon.n >= b.roon.r) {
        const [lEquiv, mtbfEquiv, mttrEquiv, formula, result] = engROfN(b, b.roon.n, b.roon.r);
        steps.push({ type: "roon", blocks: [`${b.name} (${b.roon.r}-out-of-${b.roon.n})`], formula, result });
        b.lambda = lEquiv; b.mtbf = mtbfEquiv; b.mttr = mttrEquiv; b.roon = null;
        simplified = true;
        break;
      }
    }
    if (simplified) continue;

    const pairMap: Record<string, EB[]> = {};
    for (const b of remaining) {
      const key = [nodeOf(b.id, "left"), nodeOf(b.id, "right")].sort().join("|");
      (pairMap[key] ??= []).push(b);
    }
    for (const group of Object.values(pairMap)) {
      if (group.length >= 2) {
        const [ls, mtbf, mttr, formula, result] = engParallelSimple(group);
        steps.push({ type: "parallel", blocks: group.map((g) => g.name), formula, result });
        const eqId = -(steps.length + 100);
        const eq: EB = { id: eqId, name: "Eq", lambda: ls, mtbf, mttr };
        find(portKey(eqId, "left")); find(portKey(eqId, "right"));
        const key = [nodeOf(group[0].id, "left"), nodeOf(group[0].id, "right")].sort().join("|");
        union(portKey(eqId, "left"), key.split("|")[0]);
        union(portKey(eqId, "right"), key.split("|")[1]);
        for (const g of group) remaining = remaining.filter((r) => r.id !== g.id);
        remaining.push(eq);
        simplified = true;
        break;
      }
    }
    if (simplified) continue;

    let found = false;
    for (const b of remaining) {
      const bRight = nodeOf(b.id, "right");
      const candidates = remaining.filter((ob) => ob.id !== b.id && nodeOf(ob.id, "left") === bRight);
      if (candidates.length !== 1) continue;
      const nb = candidates[0];
      const allAt = remaining.filter((ob) => nodeOf(ob.id, "left") === bRight || nodeOf(ob.id, "right") === bRight);
      if (allAt.length !== 2) continue;
      const bLeft = nodeOf(b.id, "left");
      const nbRight = nodeOf(nb.id, "right");
      const [ls, mtbf, mttr, formula, result] = engSeries([b, nb]);
      steps.push({ type: "series", blocks: [b.name, nb.name], formula, result });
      const eqId = -(steps.length + 100);
      const eq: EB = { id: eqId, name: "Eq", lambda: ls, mtbf, mttr };
      find(portKey(eqId, "left")); find(portKey(eqId, "right"));
      union(portKey(eqId, "left"), bLeft);
      union(portKey(eqId, "right"), nbRight);
      remaining = remaining.filter((r) => r.id !== b.id && r.id !== nb.id);
      remaining.push(eq);
      found = true;
      break;
    }
    if (!found) break;
  }

  let finalLambda = 0, finalMtbf = 0, finalMttr = 0;
  if (remaining.length === 1) {
    finalLambda = remaining[0].lambda; finalMtbf = remaining[0].mtbf; finalMttr = remaining[0].mttr;
  } else if (remaining.length > 1) {
    finalLambda = remaining.reduce((s, b) => s + b.lambda, 0);
    finalMtbf = finalLambda > 0 ? 1 / finalLambda : 0;
    finalMttr = remaining.reduce((s, b) => s + b.mttr, 0) / remaining.length;
    steps.push({
      type: "final_series",
      blocks: remaining.map((b) => b.name),
      formula: remaining.map((b) => fmtSCI(b.lambda)).join(" + "),
      result: `lambda=${fmtSCI(finalLambda)}, MTBF=${fmtIN(finalMtbf)} hrs, MTTR=${finalMttr.toFixed(1)} hrs`,
    });
  }

  const avail = finalMtbf + finalMttr > 0 ? finalMtbf / (finalMtbf + finalMttr) : 0;
  const result_value =
    `lambda = ${fmtSCI(finalLambda)} failures/hr | ` +
    `MTBF = ${fmtIN(finalMtbf)} hrs | ` +
    `MTTR = ${finalMttr.toFixed(1)} hrs | ` +
    `Availability = ${(avail * 100).toFixed(4)}%`;
  return { steps, result_value };
}

/* ── Component ── */

export default function RBDSheet() {
  const [comps, setComps] = useState<Comp[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [conns, setConns] = useState<Conn[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [mode, setMode] = useState<string | null>(null);
  const [selConn, setSelConn] = useState<number | null>(null);
  const [selBlocks, setSelBlocks] = useState<Set<number>>(new Set());
  const [summary, setSummary] = useState("");
  const [resultFull, setResultFull] = useState("");
  const [copied, setCopied] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [showReason, setShowReason] = useState(false);
  const [showFormulas, setShowFormulas] = useState(false);
  const [picking, setPicking] = useState(false);
  const [libStatus, setLibStatus] = useState("Loading...");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: "workspace" | "block"; blockId?: number } | null>(null);
  const [roonDialog, setRoonDialog] = useState<{ blockId: number; x: number; y: number } | null>(null);
  const [roonR, setRoonR] = useState("1");
  const [roonN, setRoonN] = useState("1");
  const [groupDialog, setGroupDialog] = useState<{ x: number; y: number } | null>(null);
  const [groupNameInput, setGroupNameInput] = useState("");

  const summaryParts = useMemo(() => {
    if (!summary) return { lam: "", mtbf: "", mttr: "", av: "" };
    const lam = /λ=([^\s·]+)/.exec(summary)?.[1] || "";
    const mtbf = /MTBF=([^\s·]+)/.exec(summary)?.[1] || "";
    const mttr = /MTTR=([^\s·]+)/.exec(summary)?.[1] || "";
    const av = /Av=([^\s·%]+)%?/.exec(summary)?.[1] || "";
    return { lam, mtbf, mttr, av };
  }, [summary]);
  const wsRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nidRef = useRef(1);
  const groupsIdRef = useRef(1);
  const blocksRef = useRef<Block[]>([]);
  const connsRef = useRef<Conn[]>([]);
  const groupsRef = useRef<Group[]>([]);
  const modeRef = useRef<string | null>(null);
  const selBlocksRef = useRef<Set<number>>(new Set());
  const csRef = useRef<{ bid: number; side: string; el: HTMLElement } | null>(null);
  const tlRef = useRef<SVGPathElement | null>(null);
  const anchorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  useEffect(() => { connsRef.current = conns; }, [conns]);
  useEffect(() => { groupsRef.current = groups; }, [groups]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { selBlocksRef.current = selBlocks; }, [selBlocks]);

  useEffect(() => {
    fetch("/api/components")
      .then((r) => r.json())
      .then((data: Comp[]) => {
        if (data?.length) { setComps(data); setLibStatus(`${data.length} components`); }
        else { setLibStatus("No components registered"); }
      })
      .catch(() => setLibStatus("Load failed"));
  }, []);

  /* ── Geometry ── */

  const portCenter = useCallback((bid: number, side: string) => {
    const b = blocksRef.current.find((b) => b.id === bid);
    if (!b || !b.el) return { x: 0, y: 0 };
    const bw = b.el.offsetWidth, bh = b.el.offsetHeight;
    return side === "left" ? { x: b.x, y: b.y + bh / 2 } : { x: b.x + bw, y: b.y + bh / 2 };
  }, []);

  const elbow = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    if (Math.abs(x2 - x1) < 10) return `M ${x1} ${y1} L ${x2} ${y2}`;
    const mx = x1 + (x2 - x1) / 2;
    return `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`;
  }, []);

  const drawPath = useCallback((conn: Conn) => {
    if (!conn.el) return;
    const p1 = portCenter(conn.from.bid, conn.from.side);
    const p2 = portCenter(conn.to.bid, conn.to.side);
    conn.el.setAttribute("d", conn.mode === "st" ? `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}` : elbow(p1.x, p1.y, p2.x, p2.y));
  }, [portCenter, elbow]);

  const updateConns = useCallback(() => { connsRef.current.forEach(drawPath); }, [drawPath]);

  /* ── Temp preview line ── */

  const showTemp = useCallback((portEl: HTMLElement) => {
    const ws = wsRef.current, svg = svgRef.current;
    if (!ws || !svg) return;
    const r = portEl.getBoundingClientRect(), wr = ws.getBoundingClientRect();
    anchorRef.current = { x: r.left + r.width / 2 - wr.left, y: r.top + r.height / 2 - wr.top };
    const tl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    tl.setAttribute("class", "rbd-temp");
    tl.setAttribute("d", `M ${anchorRef.current.x} ${anchorRef.current.y} L ${anchorRef.current.x} ${anchorRef.current.y}`);
    svg.appendChild(tl);
    tlRef.current = tl;
    const onMove = (e: MouseEvent) => {
      if (!tlRef.current) return;
      const w = ws.getBoundingClientRect();
      const ex = e.clientX - w.left, ey = e.clientY - w.top;
      const { x: sx, y: sy } = anchorRef.current;
      tlRef.current.setAttribute("d", modeRef.current === "st" ? `M ${sx} ${sy} L ${ex} ${ey}` : elbow(sx, sy, ex, ey));
    };
    document.addEventListener("mousemove", onMove);
    (tl as unknown as { _cleanup: () => void })._cleanup = () => document.removeEventListener("mousemove", onMove);
  }, [elbow]);

  const hideTemp = useCallback(() => {
    const tl = tlRef.current;
    if (tl) {
      (tl as unknown as { _cleanup?: () => void })._cleanup?.();
      tl.remove();
      tlRef.current = null;
    }
  }, []);

  const cancelPick = useCallback(() => {
    if (csRef.current) { csRef.current.el.style.background = ""; csRef.current = null; }
    setPicking(false);
    hideTemp();
  }, [hideTemp]);

  /* ── Connections ── */

  const makeConn = useCallback((fb: number, fs: string, tb: number, ts: string) => {
    const dup = connsRef.current.some(
      (cn) => (cn.from.bid === fb && cn.from.side === fs && cn.to.bid === tb && cn.to.side === ts) ||
        (cn.from.bid === tb && cn.from.side === ts && cn.to.bid === fb && cn.to.side === fs)
    );
    if (dup) return;
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("class", "rbd-conn");
    svgRef.current?.appendChild(p);
    const cn: Conn = { id: Date.now() + Math.random(), from: { bid: fb, side: fs }, to: { bid: tb, side: ts }, el: p, mode: modeRef.current || "st" };
    setConns((prev) => [...prev, cn]);
    setTimeout(() => drawPath(cn), 0);
    p.addEventListener("click", (e) => { e.stopPropagation(); setSelConn(cn.id); });
  }, [drawPath]);

  const onPortDown = useCallback((e: MouseEvent, bid: number, side: string, portEl: HTMLElement) => {
    e.stopPropagation();
    e.preventDefault();
    if (!modeRef.current) return;
    const cs = csRef.current;

    if (cs) {
      if (cs.bid === bid && cs.side === side) { cancelPick(); return; }
      makeConn(cs.bid, cs.side, bid, side);
      cancelPick();
      return;
    }

    csRef.current = { bid, side, el: portEl };
    setPicking(true);
    portEl.style.background = "#3b82f6";
    showTemp(portEl);
  }, [makeConn, cancelPick, showTemp]);

  const onPortDownRef = useRef(onPortDown);
  useEffect(() => { onPortDownRef.current = onPortDown; }, [onPortDown]);

  /* ── Delete block helper ── */

  const deleteBlock = useCallback((id: number) => {
    const block = blocksRef.current.find((b) => b.id === id);
    block?.el?.remove();
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setConns((prev) => {
      const gone = prev.filter((cn) => cn.from.bid === id || cn.to.bid === id);
      gone.forEach((cn) => cn.el?.remove());
      return prev.filter((cn) => cn.from.bid !== id && cn.to.bid !== id);
    });
    setSelBlocks((prev) => { const next = new Set(prev); next.delete(id); return next; });
    setGroups((prev) => prev.map((g) => ({ ...g, blockIds: g.blockIds.filter((bid) => bid !== id) })).filter((g) => g.blockIds.length > 0));
  }, []);

  /* ── Blocks ── */

  const addBlock = useCallback((c: Comp, x: number, y: number, roon?: { r: number; n: number } | null, groupId?: number | null) => {
    const id = nidRef.current++;
    let dLam = num(c.lambda);
    if (!dLam && num(c.mtbf) > 0) dLam = 1 / num(c.mtbf);

    const el = document.createElement("div");
    el.className = "rbd-block" + (groupId ? " rbd-group-block" : "");
    el.dataset.bid = String(id);

    let inner = `<button class="rbd-xbtn" data-action="delete">&times;</button>`;

    if (groupId) {
      /* Group block — single connected block */
      const g = groupsRef.current.find((gg) => gg.id === groupId);
      inner += `<div class="rbd-bname" style="color:#38bdf8">${c.name || "Group"}</div>`;
      inner += `<div class="rbd-blam" style="color:#94a3b8;font-size:9px">${g?.members?.length || 0} blocks</div>`;
    } else if (roon && roon.r > 0 && roon.n > 0) {
      if (roon.r === 1 && roon.n === 2) {
        /* 1oo2 = two offset rectangles */
        inner += `<div class="rbd-roon-stack">` +
          `<div class="rbd-roon-layer rbd-roon-layer-1"></div>` +
          `<div class="rbd-roon-layer rbd-roon-layer-2"></div>` +
          `</div>`;
      } else {
        /* RooN = stacked rectangles (N layers) */
        const layers = Math.min(roon.n, 5);
        inner += `<div class="rbd-roon-stack">` +
          Array.from({ length: layers }, (_, i) =>
            `<div class="rbd-roon-layer" style="top:${-(i * 5)}px;left:${i * 5}px;opacity:${0.3 + (i / layers) * 0.7}"></div>`
          ).join("") +
          `</div>`;
      }
      inner += `<div class="rbd-bname">${c.name || "Unnamed"}</div>`;
      inner += `<div class="rbd-roon-label">x(${roon.r} oo ${roon.n})</div>`;
    } else {
      inner += `<div class="rbd-bname">${c.name || "Unnamed"}</div>`;
    }

    if (dLam) inner += `<div class="rbd-blam">&lambda;=${fmtSCI(dLam)}</div>`;
    if (num(c.mtbf)) inner += `<div class="rbd-bmtbf">MTBF:${fmtIN(num(c.mtbf))}</div>`;
    if (num(c.mttr)) inner += `<div class="rbd-bmttr">MTTR:${c.mttr}hrs</div>`;
    inner += `<div class="rbd-port rbd-pl" data-bid="${id}" data-side="left"></div>`;
    inner += `<div class="rbd-port rbd-pr" data-bid="${id}" data-side="right"></div>`;

    el.innerHTML = inner;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    wsRef.current?.appendChild(el);

    const block: Block = { id, comp: c, x, y, el, roon: roon || null, groupId: groupId || null };
    setBlocks((prev) => [...prev, block]);

    /* drag */
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return; /* left button only — right-click is for menus */
      if ((e.target as HTMLElement).closest(".rbd-port, .rbd-xbtn")) return;
      if (modeRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      /* Handle selection on click */
      if (e.shiftKey || e.ctrlKey) {
        setSelBlocks((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        });
        return;
      }

      const sX = e.clientX, sY = e.clientY;
      const oX = parseInt(el.style.left), oY = parseInt(el.style.top);
      el.style.zIndex = "10";
      const mv = (ev: MouseEvent) => {
        el.style.left = `${oX + ev.clientX - sX}px`;
        el.style.top = `${oY + ev.clientY - sY}px`;
        block.x = oX + ev.clientX - sX; block.y = oY + ev.clientY - sY;
        updateConns();
      };
      const up = () => { el.style.zIndex = "2"; document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); };
      document.addEventListener("mousemove", mv);
      document.addEventListener("mouseup", up);
    });

    /* right-click on block */
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, type: "block", blockId: id });
    });

    /* delete block */
    el.querySelector("[data-action='delete']")?.addEventListener("click", () => {
      deleteBlock(id);
    });

    /* ports */
    el.querySelectorAll(".rbd-port").forEach((port) => {
      port.addEventListener("mousedown", (e) => {
        const p = port as HTMLElement;
        onPortDownRef.current(e as MouseEvent, id, p.dataset.side || "left", p);
      });
    });

    return id;
  }, [updateConns, deleteBlock]);

  /* ── Group rendering ── */

  const renderGroups = useCallback(() => {
    groupsRef.current.forEach((g) => g.el?.remove());
    const newGroups: Group[] = [];
    for (const g of groupsRef.current) {
      if (g.blockIds.length < 1) continue;
      const bEls = g.blockIds.map((bid) => blocksRef.current.find((b) => b.id === bid)).filter((b): b is Block & { el: HTMLDivElement } => !!b && !!b.el);
      if (bEls.length === 0) continue;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const b of bEls) {
        const r = b.el.getBoundingClientRect();
        const wr = wsRef.current!.getBoundingClientRect();
        const bx = b.x, by = b.y;
        const bw = r.width, bh = r.height;
        if (bx < minX) minX = bx;
        if (by < minY) minY = by;
        if (bx + bw > maxX) maxX = bx + bw;
        if (by + bh > maxY) maxY = by + bh;
      }

      const pad = 12;
      const groupEl = document.createElement("div");
      groupEl.className = "rbd-group";
      groupEl.style.left = `${minX - pad}px`;
      groupEl.style.top = `${minY - pad - 18}px`;
      groupEl.style.width = `${maxX - minX + pad * 2}px`;
      groupEl.style.height = `${maxY - minY + pad * 2 + 18}px`;

      const labelEl = document.createElement("div");
      labelEl.className = "rbd-group-label";
      labelEl.textContent = g.name;
      groupEl.appendChild(labelEl);

      wsRef.current?.appendChild(groupEl);
      newGroups.push({ ...g, el: groupEl });
    }
    setGroups(newGroups);
  }, []);

  /* Re-render groups when blocks move */
  useEffect(() => {
    if (groups.length > 0) {
      const timer = setTimeout(renderGroups, 50);
      return () => clearTimeout(timer);
    }
  }, [blocks, groups.length, renderGroups]);

  /* ── Highlight ports ── */

  useEffect(() => {
    document.querySelectorAll(".rbd-port.rbd-linked").forEach((p) => p.classList.remove("rbd-linked"));
    conns.forEach((cn) => {
      const b1 = blocksRef.current.find((b) => b.id === cn.from.bid);
      const b2 = blocksRef.current.find((b) => b.id === cn.to.bid);
      b1?.el?.querySelector(cn.from.side === "left" ? ".rbd-pl" : ".rbd-pr")?.classList.add("rbd-linked");
      b2?.el?.querySelector(cn.to.side === "left" ? ".rbd-pl" : ".rbd-pr")?.classList.add("rbd-linked");
    });
  }, [conns, blocks]);

  /* ── Selected connection highlight ── */

  useEffect(() => {
    conns.forEach((cn) => cn.el?.classList.toggle("rbd-selected", cn.id === selConn));
  }, [selConn, conns]);

  /* ── Selected blocks highlight ── */

  useEffect(() => {
    blocks.forEach((b) => {
      if (!b.el) return;
      if (selBlocks.has(b.id)) {
        b.el.classList.add("rbd-sel");
      } else {
        b.el.classList.remove("rbd-sel");
      }
    });
  }, [selBlocks, blocks]);

  /* ── Keyboard shortcuts ── */

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (roonDialog || groupDialog) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selConn !== null) {
        e.preventDefault();
        setConns((prev) => {
          prev.find((c) => c.id === selConn)?.el?.remove();
          return prev.filter((c) => c.id !== selConn);
        });
        setSelConn(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selBlocks.size > 0) {
        e.preventDefault();
        selBlocks.forEach((bid) => deleteBlock(bid));
        setSelBlocks(new Set());
      }
      if (e.key === "Escape") {
        setSelConn(null);
        cancelPick();
        setMode(null);
        setShowReason(false);
        setContextMenu(null);
        setRoonDialog(null);
        setGroupDialog(null);
        setSelBlocks(new Set());
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selConn, selBlocks, cancelPick, setShowReason, deleteBlock, roonDialog, groupDialog]);

  /* ── Line tool toggle ── */

  const setLineMode = useCallback((m: string) => {
    setMode((prev) => {
      const next = prev === m ? null : m;
      modeRef.current = next;
      return next;
    });
    cancelPick();
  }, [cancelPick]);

  /* ── Context menu: workspace ── */

  const onWorkspaceContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    if (target.closest(".rbd-block")) return;
    setContextMenu({ x: e.clientX, y: e.clientY, type: "workspace" });
  }, []);

  /* ── Context menu: click anywhere to close ── */

  useEffect(() => {
    const close = () => { setContextMenu(null); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  /* ── Rubber band selection ── */

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;

    let startX = 0, startY = 0;
    let selDiv: HTMLDivElement | null = null;
    let isDragging = false;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return; /* left button only — right-click is for menus */
      if (modeRef.current) return;
      const target = e.target as HTMLElement;
      if (target.closest(".rbd-block, .rbd-port, .rbd-xbtn")) return;

      startX = e.clientX;
      startY = e.clientY;
      isDragging = false;

      const onMove = (ev: MouseEvent) => {
        const dx = Math.abs(ev.clientX - startX);
        const dy = Math.abs(ev.clientY - startY);
        if (dx > 4 || dy > 4) {
          if (!isDragging) {
            isDragging = true;
            selDiv = document.createElement("div");
            selDiv.style.cssText = "position:fixed;border:1.5px dashed #f59e0b;background:rgba(245,158,11,.10);pointer-events:none;z-index:99;";
            document.body.appendChild(selDiv);
          }
          if (selDiv) {
            const x = Math.min(startX, ev.clientX);
            const y = Math.min(startY, ev.clientY);
            const w = Math.abs(ev.clientX - startX);
            const h = Math.abs(ev.clientY - startY);
            selDiv.style.left = `${x}px`;
            selDiv.style.top = `${y}px`;
            selDiv.style.width = `${w}px`;
            selDiv.style.height = `${h}px`;
          }
        }
      };

      const onUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);

        if (selDiv) {
          selDiv.remove();
          selDiv = null;
        }

        if (!isDragging) {
          /* Single click on empty area — clear selection */
          if (!ev.shiftKey) {
            setSelBlocks(new Set());
          }
          return;
        }

        /* Find blocks whose center is inside the rectangle */
        const rx1 = Math.min(startX, ev.clientX);
        const ry1 = Math.min(startY, ev.clientY);
        const rx2 = Math.max(startX, ev.clientX);
        const ry2 = Math.max(startY, ev.clientY);

        const newSel = new Set<number>();
        for (const b of blocksRef.current) {
          if (!b.el) continue;
          const r = b.el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          if (cx >= rx1 && cx <= rx2 && cy >= ry1 && cy <= ry2) {
            newSel.add(b.id);
          }
        }
        setSelBlocks(newSel);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };

    ws.addEventListener("mousedown", onMouseDown);
    return () => ws.removeEventListener("mousedown", onMouseDown);
  }, []);

  /* ── Group creation ── */

  const createGroup = useCallback(() => {
    if (!groupDialog || selBlocks.size === 0) return;
    const name = groupNameInput.trim() || `Group ${groupsIdRef.current}`;
    const gid = groupsIdRef.current++;
    const selIds = [...selBlocks];
    const selBlocksArr = selIds
      .map((bid) => blocksRef.current.find((b) => b.id === bid))
      .filter((b): b is Block => !!b);
    /* Capture a reusable template: member comps + relative offsets + internal wires */
    const minX = Math.min(...selBlocksArr.map((b) => b.x));
    const minY = Math.min(...selBlocksArr.map((b) => b.y));
    const idxOf = new Map(selIds.map((id, i) => [id, i]));
    const members: GroupMember[] = selBlocksArr.map((b) => ({
      comp: { ...b.comp }, dx: b.x - minX, dy: b.y - minY, roon: b.roon ? { ...b.roon } : null,
    }));
    const wires: GroupWire[] = [];
    for (const cn of connsRef.current) {
      const fi = idxOf.get(cn.from.bid), ti = idxOf.get(cn.to.bid);
      if (fi !== undefined && ti !== undefined) {
        wires.push({ fromIdx: fi, toIdx: ti, fromSide: cn.from.side, toSide: cn.to.side });
      }
    }
    const newGroup: Group = { id: gid, name, blockIds: selIds, el: null, members, wires };
    setGroups((prev) => [...prev, newGroup]);
    setGroupDialog(null);
    setGroupNameInput("");
    setTimeout(renderGroups, 0);
  }, [groupDialog, groupNameInput, selBlocks, renderGroups]);

  /* Instantiate a named group template as a single connectable block */
  const instantiateGroup = useCallback((gid: number, x: number, y: number) => {
    const g = groupsRef.current.find((gg) => gg.id === gid);
    if (!g || !g.members || !g.members.length) return;
    const memberCount = g.members.length;
    /* Create a single group block with combined properties */
    const groupComp: Comp = {
      name: g.name,
      lambda: g.members.reduce((s, m) => {
        let lam = num(m.comp.lambda);
        if (!lam && num(m.comp.mtbf) > 0) lam = 1 / num(m.comp.mtbf);
        return s + lam;
      }, 0),
      mtbf: g.members.reduce((s, m) => s + num(m.comp.mtbf), 0) / memberCount,
      mttr: g.members.reduce((s, m) => s + num(m.comp.mttr), 0) / memberCount,
    };
    addBlock(groupComp, x, y, null, gid);
  }, [addBlock]);

  /* ── RooN apply ── */

  const applyRoon = useCallback(() => {
    if (!roonDialog) return;
    const r = parseInt(roonR) || 0;
    const n = parseInt(roonN) || 0;
    if (r <= 0 || n <= 0 || n < r) return;

    setBlocks((prev) => prev.map((b) => {
      if (b.id !== roonDialog.blockId) return b;
      return { ...b, roon: { r, n } };
    }));

    /* Update the block's innerHTML */
    const block = blocksRef.current.find((b) => b.id === roonDialog.blockId);
    if (block && block.el) {
      let dLam = num(block.comp.lambda);
      if (!dLam && num(block.comp.mtbf) > 0) dLam = 1 / num(block.comp.mtbf);

      let inner = `<button class="rbd-xbtn" data-action="delete">&times;</button>`;
      if (r === 1 && n === 2) {
        inner += `<div class="rbd-roon-stack">` +
          `<div class="rbd-roon-layer rbd-roon-layer-1"></div>` +
          `<div class="rbd-roon-layer rbd-roon-layer-2"></div>` +
          `</div>`;
      } else {
        const layers = Math.min(n, 5);
        inner += `<div class="rbd-roon-stack">` +
          Array.from({ length: layers }, (_, i) =>
            `<div class="rbd-roon-layer" style="top:${-(i * 5)}px;left:${i * 5}px;opacity:${0.3 + (i / layers) * 0.7}"></div>`
          ).join("") +
          `</div>`;
      }
      inner += `<div class="rbd-bname">${block.comp.name || "Unnamed"}</div>`;
      inner += `<div class="rbd-roon-label">x(${r} oo ${n})</div>`;
      if (dLam) inner += `<div class="rbd-blam">&lambda;=${fmtSCI(dLam)}</div>`;
      if (num(block.comp.mtbf)) inner += `<div class="rbd-bmtbf">MTBF:${fmtIN(num(block.comp.mtbf))}</div>`;
      if (num(block.comp.mttr)) inner += `<div class="rbd-bmttr">MTTR:${block.comp.mttr}hrs</div>`;
      inner += `<div class="rbd-port rbd-pl" data-bid="${block.id}" data-side="left"></div>`;
      inner += `<div class="rbd-port rbd-pr" data-bid="${block.id}" data-side="right"></div>`;
      block.el.innerHTML = inner;
      block.roon = { r, n };

      /* Re-attach port listeners */
      block.el.querySelectorAll(".rbd-port").forEach((port) => {
        port.addEventListener("mousedown", (e) => {
          const p = port as HTMLElement;
          onPortDownRef.current(e as MouseEvent, block.id, p.dataset.side || "left", p);
        });
      });
      block.el.querySelector("[data-action='delete']")?.addEventListener("click", () => {
        deleteBlock(block.id);
      });
    }

    setRoonDialog(null);
  }, [roonDialog, roonR, roonN, deleteBlock]);

  const clearRoon = useCallback(() => {
    if (!roonDialog) return;

    setBlocks((prev) => prev.map((b) => {
      if (b.id !== roonDialog.blockId) return b;
      return { ...b, roon: null };
    }));

    const block = blocksRef.current.find((b) => b.id === roonDialog.blockId);
    if (block && block.el) {
      let dLam = num(block.comp.lambda);
      if (!dLam && num(block.comp.mtbf) > 0) dLam = 1 / num(block.comp.mtbf);

      let inner = `<button class="rbd-xbtn" data-action="delete">&times;</button>`;
      inner += `<div class="rbd-bname">${block.comp.name || "Unnamed"}</div>`;
      if (dLam) inner += `<div class="rbd-blam">&lambda;=${fmtSCI(dLam)}</div>`;
      if (num(block.comp.mtbf)) inner += `<div class="rbd-bmtbf">MTBF:${fmtIN(num(block.comp.mtbf))}</div>`;
      if (num(block.comp.mttr)) inner += `<div class="rbd-bmttr">MTTR:${block.comp.mttr}hrs</div>`;
      inner += `<div class="rbd-port rbd-pl" data-bid="${block.id}" data-side="left"></div>`;
      inner += `<div class="rbd-port rbd-pr" data-bid="${block.id}" data-side="right"></div>`;
      block.el.innerHTML = inner;
      block.roon = null;

      block.el.querySelectorAll(".rbd-port").forEach((port) => {
        port.addEventListener("mousedown", (e) => {
          const p = port as HTMLElement;
          onPortDownRef.current(e as MouseEvent, block.id, p.dataset.side || "left", p);
        });
      });
      block.el.querySelector("[data-action='delete']")?.addEventListener("click", () => {
        deleteBlock(block.id);
      });
    }

    setRoonDialog(null);
  }, [roonDialog, deleteBlock]);

  /* Expand a group block into its member blocks, keeping the dashed group border */
  const expandGroup = useCallback((blockId: number) => {
    const block = blocksRef.current.find((b) => b.id === blockId);
    if (!block || !block.groupId) return;
    const g = groupsRef.current.find((gg) => gg.id === block.groupId);
    if (!g || !g.members || !g.members.length) return;

    const bx = block.x, by = block.y;
    /* Remove the group block */
    deleteBlock(blockId);

    /* Create member blocks at same position */
    const newIds: number[] = [];
    for (const m of g.members) {
      const nid = addBlock(m.comp, bx + m.dx, by + m.dy, m.roon || null);
      if (typeof nid === "number") newIds.push(nid);
    }
    /* Create internal wires */
    for (const w of g.wires || []) {
      if (newIds[w.fromIdx] !== undefined && newIds[w.toIdx] !== undefined) {
        makeConn(newIds[w.fromIdx], w.fromSide, newIds[w.toIdx], w.toSide);
      }
    }
    /* Update the group to reference the new block IDs, so the dashed border persists */
    setGroups((prev) => prev.map((gg) =>
      gg.id === block.groupId ? { ...gg, blockIds: newIds } : gg
    ));
    setTimeout(renderGroups, 50);
  }, [deleteBlock, addBlock, makeConn, renderGroups]);

  /* ── Run / Clear / Reset ── */

  const runAnalysis = useCallback(() => {
    if (!blocksRef.current.length) { setSummary("No blocks. Drag components first."); setResultFull(""); setSteps([]); return; }
    if (!connsRef.current.length) { setSummary("No connections. Click two ports."); setResultFull(""); setSteps([]); return; }
    setSummary("Analyzing...");
    setResultFull("");
    setShowFormulas(false);
    /* Local compute (engine lives in this file) — deferred so "Analyzing..." paints */
    setTimeout(() => {
      const payloadBlocks = blocksRef.current.map((b) => {
        let lam = num(b.comp.lambda);
        if (!lam && num(b.comp.mtbf) > 0) lam = 1 / num(b.comp.mtbf);
        return {
          id: b.id, name: b.comp.name, lambda: lam,
          mtbf: num(b.comp.mtbf), mttr: num(b.comp.mttr),
          roon: b.roon || null,
        };
      });
      const payloadConns = connsRef.current.map((cn) => ({
        from: { bid: cn.from.bid, side: cn.from.side },
        to: { bid: cn.to.bid, side: cn.to.side },
      }));
      try {
        const d = engAnalyze(payloadBlocks, payloadConns);
        if (d.error) { setSummary(d.error); setResultFull(""); setSteps([]); return; }
        /* Parse result_value: "lambda = X failures/hr | MTBF = Y hrs | MTTR = Z hrs | Availability = W%" */
        const raw = d.result_value || "";
        setResultFull(raw);
        const parts = raw.split("|").map((s: string) => s.trim());
        const get = (key: string) => {
          const p = parts.find((x: string) => x.startsWith(key));
          if (!p) return "";
          return p.replace(key, "").replace(/failures\/hr|hrs|%/g, "").trim();
        };
        const lamV = get("lambda =");
        const mtbfV = get("MTBF =");
        const mttrV = get("MTTR =");
        const avV = get("Availability =");
        if (lamV && mtbfV && avV) {
          setSummary(`λ=${lamV} · MTBF=${mtbfV} · MTTR=${mttrV} · Av=${avV}%`);
        } else {
          setSummary(raw || "No result");
        }
        setSteps(d.steps);
      } catch (e) {
        setSummary(`Analysis error: ${(e as Error).message}`);
        setResultFull("");
        setSteps([]);
      }
    }, 30);
  }, []);

  const copyResult = useCallback(() => {
    const text = resultFull || summary;
    if (!text) return;
    /* Format copy text with λ symbol and units */
    let copyText = text;
    if (resultFull) {
      const parts = resultFull.split("|").map((s: string) => s.trim());
      const get = (key: string) => {
        const p = parts.find((x: string) => x.startsWith(key));
        if (!p) return "";
        return p.replace(key, "").replace(/failures\/hr|hrs|%/g, "").trim();
      };
      const lam = get("lambda =");
      const mtbf = get("MTBF =");
      const mttr = get("MTTR =");
      const av = get("Availability =");
      if (lam && mtbf) {
        copyText = `λ = ${lam} failures/hr · MTBF = ${mtbf} hrs · MTTR = ${mttr} hrs · Av = ${av}%`;
      }
    }
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(copyText).then(done).catch(() => fallbackCopy(copyText, done));
    } else {
      fallbackCopy(copyText, done);
    }
  }, [resultFull, summary]);

  const clearAll = useCallback(() => {
    cancelPick();
    blocksRef.current.forEach((b) => b.el?.remove());
    connsRef.current.forEach((c) => c.el?.remove());
    groupsRef.current.forEach((g) => g.el?.remove());
    setBlocks([]); setConns([]); setGroups([]); setSelConn(null); setSelBlocks(new Set());
    nidRef.current = 1; groupsIdRef.current = 1;
    setSummary(""); setResultFull(""); setCopied(false); setSteps([]); setShowReason(false); setShowFormulas(false);
  }, [cancelPick]);

  const resetResult = useCallback(() => {
    setSummary(""); setResultFull(""); setCopied(false); setSteps([]); setShowReason(false); setShowFormulas(false);
  }, []);

  /* Block targeted by the RooN dialog (to show its current config) */
  const roonTarget = roonDialog ? blocks.find((b) => b.id === roonDialog.blockId) : undefined;

  return (
    <div className="relative flex flex-col h-full bg-[#0f172a]">
      <style>{`
        .rbd-block{position:absolute;background:linear-gradient(180deg,#3b4a63 0%,#1e293b 55%,#111c30 100%);border:2px solid #94a3b8;border-radius:6px;padding:10px 12px;cursor:move;z-index:2;min-width:130px;max-width:170px;text-align:center;user-select:none;transition:box-shadow .2s,border-color .2s;box-shadow:0 4px 10px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.18),inset 0 -2px 4px rgba(0,0,0,.35);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,sans-serif}
        .rbd-block:hover{box-shadow:0 4px 10px rgba(0,0,0,.5),0 0 14px rgba(59,130,246,.35),inset 0 1px 0 rgba(255,255,255,.18)}
        .rbd-bname{font-size:11px;font-weight:700;color:#e2e8f0;margin-bottom:3px;text-shadow:0 1px 2px rgba(0,0,0,.6)}
        .rbd-blam{font-size:10px;color:#f87171;font-family:ui-monospace,SFMono-Regular,monospace;margin-bottom:1px}
        .rbd-bmtbf{font-size:10px;color:#34d399;margin-bottom:1px}
        .rbd-bmttr{font-size:10px;color:#fbbf24}
        .rbd-xbtn{position:absolute;top:-6px;right:-6px;width:14px;height:14px;background:#ef4444;border:none;border-radius:50%;color:#fff;font-size:9px;cursor:pointer;display:none;align-items:center;justify-content:center;z-index:10;line-height:1}
        .rbd-block:hover .rbd-xbtn{display:flex}
        .rbd-port{position:absolute;width:11px;height:11px;background:#10b981;border:2px solid #e2e8f0;border-radius:50%;cursor:crosshair;z-index:5;transition:transform .2s,background .2s,box-shadow .2s}
        .rbd-port:hover{transform:scale(1.5);background:#3b82f6;box-shadow:0 0 8px rgba(59,130,246,.7)}
        .rbd-pl{left:-5px;top:50%;margin-top:-5px}
        .rbd-pr{right:-5px;top:50%;margin-top:-5px}
        .rbd-linked{background:#f59e0b !important}
        .rbd-conn{stroke:#10b981;stroke-width:3;fill:none;stroke-linecap:round;stroke-linejoin:round;pointer-events:stroke;cursor:pointer;transition:stroke .15s}
        .rbd-conn:hover{stroke:#f59e0b !important;stroke-width:4 !important}
        .rbd-selected{stroke:#3b82f6 !important;stroke-width:4 !important;filter:drop-shadow(0 0 6px rgba(59,130,246,.7))}
        .rbd-temp{stroke:#3b82f6;stroke-width:2;stroke-dasharray:8 4;fill:none;pointer-events:none}
        .rbd-lib{background:linear-gradient(180deg,#2b3a55 0%,#1e293b 100%);border:2px solid #64748b;border-radius:8px;padding:10px;margin-bottom:8px;cursor:grab;transition:transform .15s,box-shadow .15s;user-select:none;box-shadow:0 3px 8px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.12);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,sans-serif}
        .rbd-lib:hover{transform:scale(1.03);box-shadow:0 0 10px rgba(59,130,246,.35)}
        .rbd-lib:active{cursor:grabbing}
        .rbd-tool{padding:5px 10px;border-radius:5px;cursor:pointer;font-weight:700;font-size:10px;border:2px solid transparent;display:inline-flex;align-items:center;gap:4px;transition:background .15s;color:#fff}
        .rbd-tool.active{border-color:#3b82f6 !important;animation:rbd-pulse 1s infinite}
        @keyframes rbd-pulse{0%,100%{box-shadow:0 0 4px #3b82f6}50%{box-shadow:0 0 12px #3b82f6}}
        .rbd-roon-stack{position:relative;width:100%;height:44px;margin-bottom:2px}
        .rbd-roon-layer{position:absolute;width:100%;height:100%;background:linear-gradient(180deg,#38bdf8 0%,#0284c7 60%,#075985 100%);border:2px solid #bae6fd;border-radius:5px;box-shadow:0 3px 8px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.35)}
        .rbd-roon-layer-1{top:0;left:0;opacity:.45}
        .rbd-roon-layer-2{top:-5px;left:5px;opacity:.7}
        .rbd-roon-layer-3{top:-10px;left:10px;opacity:1}
        .rbd-roon-label{font-size:10px;color:#38bdf8;font-weight:700;text-align:center;margin-top:2px}
        .rbd-sel{border-color:#f59e0b !important;box-shadow:0 0 0 2px #f59e0b,0 0 18px rgba(245,158,11,.65),inset 0 1px 0 rgba(255,255,255,.18) !important}
        .rbd-group{position:absolute;border:2px dashed #3b82f6;border-radius:8px;pointer-events:none;z-index:1}
        .rbd-group-label{position:absolute;top:-18px;left:4px;font-size:10px;color:#3b82f6;font-weight:700;background:#0f172a;padding:0 4px}
        .rbd-group-block{border:2px dashed #3b82f6 !important;background:linear-gradient(180deg,#3b4a63 0%,#1e293b 55%,#111c30 100%) !important}
        .rbd-ctx{position:fixed;z-index:10000;background:#1e293b;border:1px solid #475569;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.5);min-width:160px;padding:4px 0}
        .rbd-ctx-item{padding:6px 12px;font-size:11px;color:#cbd5e1;cursor:pointer;display:flex;align-items:center;gap:8px;transition:background .1s}
        .rbd-ctx-item:hover{background:rgba(59,130,246,.2);color:#fff}
        .rbd-dialog{position:fixed;z-index:10001;background:#1e293b;border:1px solid #475569;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.6);padding:16px;min-width:200px}
        .rbd-dialog label{display:block;font-size:11px;color:#94a3b8;margin-bottom:4px}
        .rbd-dialog input{width:100%;padding:6px 8px;background:#0f172a;border:1px solid #475569;border-radius:4px;color:#e2e8f0;font-size:12px;margin-bottom:8px;outline:none;-moz-appearance:textfield;appearance:textfield}
        .rbd-dialog input::-webkit-outer-spin-button,.rbd-dialog input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
        .rbd-dialog input:focus{border-color:#3b82f6}
        .rbd-dialog-btns{display:flex;gap:6px;justify-content:flex-end;margin-top:4px}
        .rbd-dialog-btn{padding:5px 12px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;border:none;transition:background .15s}
        .rbd-dialog-btn.primary{background:#3b82f6;color:#fff}
        .rbd-dialog-btn.primary:hover{background:#2563eb}
        .rbd-dialog-btn.danger{background:#ef4444;color:#fff}
        .rbd-dialog-btn.danger:hover{background:#dc2626}
        .rbd-dialog-btn.secondary{background:#334155;color:#cbd5e1}
        .rbd-dialog-btn.secondary:hover{background:#475569}
      `}</style>
      <div className="flex h-full">
        {/* Library */}
        <div className="w-[230px] bg-[#1e293b] border-r border-slate-700/60 flex flex-col p-2.5 overflow-y-auto shrink-0">
          <div className="flex items-center justify-between mb-2 border-b border-slate-700/60 pb-1.5">
            <h3 className="text-xs font-semibold text-slate-300">Components</h3>
            <button
              onClick={() => { fetch("/api/components").then((r) => r.json()).then((d: Comp[]) => { setComps(d); setLibStatus(`${d.length} components`); }).catch(() => {}); }}
              className="text-emerald-400 hover:text-emerald-300 cursor-pointer text-base leading-none transition-colors"
              title="Refresh"
            >
              &#8635;
            </button>
          </div>
          {/* Named groups — at top, max 3 visible */}
          {groups.length > 0 && (
            <div className="mb-2 pb-2 border-b border-slate-700/60">
              <h3 className="text-xs font-semibold text-slate-300 mb-1.5">Groups</h3>
              <div className="flex flex-col gap-1" style={{ maxHeight: groups.length > 3 ? 130 : undefined, overflowY: groups.length > 3 ? "auto" : undefined }}>
                {groups.map((g) => (
                  <div
                    key={g.id}
                    className="rbd-lib"
                    style={{ borderStyle: "dashed", borderColor: "#3b82f6", padding: "6px 8px", marginBottom: 0 }}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData("application/rbd-group", JSON.stringify({ gid: g.id })); e.dataTransfer.effectAllowed = "copy"; }}
                    onClick={() => {
                      const rect = wsRef.current?.getBoundingClientRect();
                      if (rect) instantiateGroup(g.id, rect.width / 2 - 60, rect.height / 2 - 30);
                    }}
                    title={`Place "${g.name}" (${g.members?.length || g.blockIds.length} blocks)`}
                  >
                    <div className="text-[12px] font-bold text-sky-300">{g.name}</div>
                    <div className="text-[10px] text-slate-400">{g.members?.length || g.blockIds.length} blocks</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div id="rbd-lib-list" className="flex-1">
            {comps.length === 0 && (
              <div className="text-[11px] text-slate-600 text-center mt-8 leading-relaxed">{libStatus}</div>
            )}
            {comps.map((c, i) => {
              let lam = num(c.lambda);
              if (!lam && num(c.mtbf) > 0) lam = 1 / num(c.mtbf);
              return (
                <div
                  key={i}
                  className="rbd-lib"
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData("text/plain", JSON.stringify(c)); e.dataTransfer.effectAllowed = "copy"; }}
                  onClick={() => {
                    const rect = wsRef.current?.getBoundingClientRect();
                    if (rect) addBlock(c, rect.width / 2 - 60 + (Math.random() * 40 - 20), rect.height / 2 - 30 + (Math.random() * 30 - 15));
                  }}
                >
                  <div className="text-[12px] font-bold text-slate-100">{c.name || "Unnamed"}</div>
                  {lam > 0 && <div className="text-[11px] text-red-400 font-mono">&lambda;={fmtSCI(lam)}</div>}
                  {num(c.mtbf) > 0 && <div className="text-[11px] text-emerald-400">MTBF:{fmtIN(num(c.mtbf))}</div>}
                  {num(c.mttr) > 0 && <div className="text-[11px] text-amber-400">MTTR:{c.mttr}hrs</div>}
                </div>
              );
            })}
          </div>
          <div className="mt-auto pt-2 border-t border-slate-700/60 text-[9px] text-slate-600">{libStatus}</div>
        </div>

        {/* Right */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar — with inline result */}
          <div className="bg-[#1e293b] px-3 py-1.5 flex items-center gap-1.5 border-b border-slate-700/60 shrink-0 flex-wrap">
            <button onClick={() => setLineMode("st")} title="Straight connector" className={`rbd-tool bg-sky-600 hover:bg-sky-500 ${mode === "st" ? "active" : ""}`}>
              <svg width="14" height="6"><line x1="0" y1="3" x2="14" y2="3" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></svg>Straight
            </button>
            <button onClick={() => setLineMode("ra")} title="Elbow (right-angle) connector" className={`rbd-tool bg-violet-700 hover:bg-violet-600 ${mode === "ra" ? "active" : ""}`}>
              <svg width="14" height="8"><polyline points="0,3 5,3 5,7 14,7" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>Elbow
            </button>
            <div className="w-px h-5 bg-slate-700 mx-0.5" />
            <button onClick={runAnalysis} className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-[10px] font-bold text-white rounded transition-colors">Run</button>
            <button onClick={clearAll} className="px-2.5 py-1 bg-red-500 hover:bg-red-400 text-[10px] font-bold text-white rounded transition-colors">Clear</button>
            <button onClick={resetResult} className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-[10px] font-bold text-slate-900 rounded transition-colors">Reset</button>
            {/* Inline result */}
            {summary && steps.length > 0 && (
              <>
                <div className="w-px h-5 bg-slate-700 mx-0.5" />
                <span className="text-[13px] font-bold text-slate-100 ml-1">
                  &lambda;=<span className="text-red-400">{summaryParts.lam}</span> <span className="text-[10px] font-semibold text-slate-400">failures/hr</span>
                  <span className="text-slate-600"> · </span>
                  MTBF=<span className="text-emerald-400">{summaryParts.mtbf}</span> <span className="text-[10px] font-semibold text-slate-400">hrs</span>
                  <span className="text-slate-600"> · </span>
                  MTTR=<span className="text-amber-400">{summaryParts.mttr}</span> <span className="text-[10px] font-semibold text-slate-400">hrs</span>
                  <span className="text-slate-600"> · </span>
                  Av=<span className="text-cyan-400">{summaryParts.av}</span><span className="text-cyan-400">%</span>
                </span>
                <button
                  onClick={copyResult}
                  title="Copy result to clipboard"
                  className="ml-2 px-2 py-0.5 bg-sky-600 hover:bg-sky-500 text-[10px] font-bold text-white rounded transition-colors shrink-0"
                >
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </>
            )}
            {summary && steps.length === 0 && (
              <>
                <div className="w-px h-5 bg-slate-700 mx-0.5" />
                <span className="text-[12px] font-semibold text-slate-300 ml-1">{summary}</span>
              </>
            )}
            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setShowReason((s) => !s)}
                disabled={!steps.length}
                title="Show reduction process and calculations"
                className={`px-2.5 py-1 text-[10px] font-bold rounded border transition-colors ${steps.length ? (showReason ? "bg-blue-600/20 border-blue-500/40 text-blue-300" : "bg-slate-800 border-slate-700 text-slate-300 hover:text-white") : "bg-slate-800 border-slate-800 text-slate-600 cursor-not-allowed"}`}
              >
                Reasoning{steps.length ? ` (${steps.length})` : ""}
              </button>
              <div className={`px-2 py-0.5 rounded-full text-[9px] font-bold text-white ${mode === "st" ? "bg-sky-600" : mode === "ra" ? "bg-violet-700" : "bg-slate-700"}`}>
                {mode ? (picking ? "Click 2nd port" : "Click a port") : selBlocks.size > 0 ? `${selBlocks.size} selected` : "Drag blocks"}
              </div>
            </div>
          </div>

          {/* Workspace */}
          <div
            ref={wsRef}
            className="flex-1 relative overflow-hidden"
            style={{ background: "radial-gradient(circle,#1e293b 1px,transparent 1px)", backgroundSize: "30px 30px", backgroundColor: "#0f172a" }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
            onDrop={(e) => {
              e.preventDefault();
              if (modeRef.current) return;
              const rect = wsRef.current!.getBoundingClientRect();
              const gx = e.clientX - rect.left - 60, gy = e.clientY - rect.top - 20;
              /* Named-group template drop */
              const gdata = e.dataTransfer.getData("application/rbd-group");
              if (gdata) {
                try { instantiateGroup(JSON.parse(gdata).gid, gx, gy); } catch {}
                return;
              }
              try {
                const c = JSON.parse(e.dataTransfer.getData("text/plain"));
                addBlock(c, gx, gy);
              } catch {}
            }}
            onContextMenu={onWorkspaceContextMenu}
          >
            <svg ref={svgRef} className="absolute inset-0 w-full h-full z-[1]" style={{ pointerEvents: "none" }}>
              <g style={{ pointerEvents: "auto" }} />
            </svg>
          </div>

          {/* Reasoning popup */}
          {showReason && steps.length > 0 && (
            <div
              className="absolute z-50 top-14 right-4 w-[420px] max-h-[60%] overflow-y-auto bg-[#1e293b] border border-slate-600 rounded-lg shadow-2xl p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Reasoning</h3>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setShowFormulas((s) => !s)}
                    title="Show only the formulas used in this analysis"
                    className={`px-2 py-0.5 text-[10px] font-bold rounded border transition-colors ${showFormulas ? "bg-blue-600/20 border-blue-500/40 text-blue-300" : "bg-slate-800 border-slate-700 text-slate-300 hover:text-white"}`}
                  >
                    Formulas
                  </button>
                  <button
                    onClick={() => setShowReason(false)}
                    className="text-slate-500 hover:text-white text-lg leading-none px-1 transition-colors"
                    title="Close"
                  >
                    &times;
                  </button>
                </div>
              </div>
              {!showFormulas ? (
                steps.map((s, i) => (
                  <div key={i} className="text-[11px] leading-relaxed text-slate-400 py-0.5 border-b border-slate-800 last:border-0">
                    {i + 1}. [{s.type.toUpperCase()}] {s.blocks.join(s.type === "parallel" ? " || " : " + ")} &rarr; <strong className="text-slate-100">{s.result}</strong>
                  </div>
                ))
              ) : (
                <>
                  {[...new Map(steps.map((s) => [s.type, s.formula])).entries()].map(([type, formula], i) => (
                    <div key={i} className="text-[11px] leading-relaxed text-slate-400 py-1 border-b border-slate-800">
                      <strong className="text-blue-300">[{type.toUpperCase()}]</strong> <span className="font-mono text-slate-200">{formula}</span>
                    </div>
                  ))}
                  <div className="text-[11px] leading-relaxed text-slate-400 py-1">
                    <strong className="text-blue-300">[AVAILABILITY]</strong> <span className="font-mono text-slate-200">Av = MTBF / (MTBF + MTTR)</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="rbd-ctx"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === "workspace" && selBlocks.size > 0 && (
            <div
              className="rbd-ctx-item"
              onClick={() => {
                setGroupDialog({ x: contextMenu.x, y: contextMenu.y });
                setContextMenu(null);
              }}
            >
              <span>📦</span> Name Group
            </div>
          )}
          {contextMenu.type === "workspace" && selBlocks.size === 0 && (
            <div className="rbd-ctx-item" style={{ opacity: 0.4, cursor: "default" }}>
              Select blocks first
            </div>
          )}
          {contextMenu.type === "block" && contextMenu.blockId !== undefined && (
            <>
              {(() => {
                const block = blocks.find((b) => b.id === contextMenu.blockId);
                if (block?.groupId) {
                  return (
                    <div
                      className="rbd-ctx-item"
                      onClick={() => {
                        expandGroup(contextMenu.blockId!);
                        setContextMenu(null);
                      }}
                    >
                      <span>📂</span> Expand Group
                    </div>
                  );
                }
                return null;
              })()}
              {selBlocks.size > 1 && selBlocks.has(contextMenu.blockId) && (
                <div
                  className="rbd-ctx-item"
                  onClick={() => {
                    setGroupDialog({ x: contextMenu.x, y: contextMenu.y });
                    setContextMenu(null);
                  }}
                >
                  <span>📦</span> Name Group ({selBlocks.size} blocks)
                </div>
              )}
              <div
                className="rbd-ctx-item"
                onClick={() => {
                  setRoonDialog({ blockId: contextMenu.blockId!, x: contextMenu.x, y: contextMenu.y });
                  const block = blocksRef.current.find((b) => b.id === contextMenu.blockId);
                  setRoonR(String(block?.roon?.r || 1));
                  setRoonN(String(block?.roon?.n || 1));
                  setContextMenu(null);
                }}
              >
                <span>⚙️</span> Configure R-out-of-N
              </div>
              <div
                className="rbd-ctx-item"
                style={{ color: "#f87171" }}
                onClick={() => {
                  deleteBlock(contextMenu.blockId!);
                  setContextMenu(null);
                }}
              >
                <span>🗑</span> Delete Block
              </div>
            </>
          )}
        </div>
      )}

      {/* RooN Dialog */}
      {roonDialog && (
        <div
          className="rbd-dialog"
          style={{ left: roonDialog.x, top: roonDialog.y, minWidth: 180, padding: 12 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>
            R-out-of-N Config
          </div>
          <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 6, lineHeight: 1.4 }}>
            {roonTarget?.roon
              ? <>Current: <strong style={{ color: "#38bdf8" }}>x({roonTarget.roon.r} oo {roonTarget.roon.n})</strong></>
              : <>Current: <strong style={{ color: "#34d399" }}>Series (1oo1)</strong></>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 }}>
            <div>
              <label style={{ fontSize: 9, color: "#94a3b8", marginBottom: 2, display: "block" }}>R (min required)</label>
              <input
                type="number"
                min="1"
                value={roonR}
                onChange={(e) => setRoonR(e.target.value)}
                style={{ width: "100%", padding: "4px 6px", background: "#0f172a", border: "1px solid #475569", borderRadius: 4, color: "#e2e8f0", fontSize: 11, outline: "none" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 9, color: "#94a3b8", marginBottom: 2, display: "block" }}>N (total)</label>
              <input
                type="number"
                min="1"
                value={roonN}
                onChange={(e) => setRoonN(e.target.value)}
                style={{ width: "100%", padding: "4px 6px", background: "#0f172a", border: "1px solid #475569", borderRadius: 4, color: "#e2e8f0", fontSize: 11, outline: "none" }}
              />
            </div>
          </div>
          {parseInt(roonR) === 1 && parseInt(roonN) === 2 && (
            <div style={{ fontSize: 9, color: "#38bdf8", marginBottom: 4 }}>
              Equivalent to parallel configuration
            </div>
          )}
          <div className="rbd-dialog-btns">
            <button className="rbd-dialog-btn secondary" onClick={() => setRoonDialog(null)}>Cancel</button>
            <button className="rbd-dialog-btn primary" onClick={applyRoon}>Apply</button>
          </div>
        </div>
      )}

      {/* Group Dialog */}
      {groupDialog && (
        <div
          className="rbd-dialog"
          style={{ left: groupDialog.x, top: groupDialog.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", marginBottom: 10 }}>
            Name Group ({selBlocks.size} blocks)
          </div>
          <label>Group Name:</label>
          <input
            type="text"
            value={groupNameInput}
            onChange={(e) => setGroupNameInput(e.target.value)}
            placeholder={`Group ${groupsIdRef.current}`}
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") createGroup(); }}
          />
          <div className="rbd-dialog-btns">
            <button className="rbd-dialog-btn secondary" onClick={() => { setGroupDialog(null); setGroupNameInput(""); }}>Cancel</button>
            <button className="rbd-dialog-btn primary" onClick={createGroup}>Create</button>
          </div>
        </div>
      )}
    </div>
  );
}
