import { NextResponse } from "next/server";

/* ── Helpers ── */

function fmtSci(v: number) {
  return v ? v.toExponential(2) : "0";
}

function fmtIndian(n: number) {
  const s = Math.round(n).toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  let rest = s.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.push(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.push(rest);
  parts.reverse();
  return parts.join(",") + "," + last3;
}

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/* ── Formulas ── */

interface B {
  id: number | string;
  name: string;
  lambda: number;
  mtbf: number;
  mttr: number;
  mu?: number;
}

type Step = { type: string; blocks: string[]; formula: string; result: string };

function calcSeries(blocks: B[]): [number, number, number, string, string] {
  const totalLambda = blocks.reduce((s, b) => s + b.lambda, 0);
  const mtbf = totalLambda > 0 ? 1 / totalLambda : 0;
  const mttr =
    totalLambda > 0
      ? blocks.reduce((s, b) => s + b.lambda * b.mttr, 0) / totalLambda
      : 0;
  const formula = blocks.map((b) => fmtSci(b.lambda)).join(" + ");
  const result = `lambda=${fmtSci(totalLambda)}, MTBF=${fmtIndian(mtbf)} hrs, MTTR=${mttr.toFixed(1)} hrs`;
  return [totalLambda, mtbf, mttr, formula, result];
}

function calcParallelMarkov(
  b1: B,
  b2: B
): [number, number, number, string, string] {
  const l1 = b1.lambda,
    l2 = b2.lambda;
  const t1 = b1.mttr > 0 ? b1.mttr : 1;
  const t2 = b2.mttr > 0 ? b2.mttr : 1;
  const mu1 = 1 / t1,
    mu2 = 1 / t2;

  const num = mu1 * mu2 + (l1 + l2) * (mu1 + mu2);
  const den = l1 * l2 * (l1 + l2 + mu1 + mu2);
  const mtbf = den > 0 ? num / den : 0;
  const ls = mtbf > 0 ? 1 / mtbf : 0;
  const avgMu = (mu1 + mu2) / 2;
  const mttr = avgMu > 0 ? 1 / (2 * avgMu) : 0;

  const formula = `[μ1μ2+(λ1+λ2)(μ1+μ2)]/[λ1λ2(λ1+λ2+μ1+μ2)]`;
  const result = `lambda=${fmtSci(ls)}, MTBF=${fmtIndian(mtbf)} hrs, MTTR=${mttr.toFixed(1)} hrs`;
  return [ls, mtbf, mttr, formula, result];
}

function calcParallelSimple(blocks: B[]): [number, number, number, string, string] {
  if (blocks.length === 2) return calcParallelMarkov(blocks[0], blocks[1]);

  const working = [...blocks];
  while (working.length > 2) {
    const b1 = working.shift()!;
    const b2 = working.shift()!;
    const [ls, mtbf, mttr] = calcParallelMarkov(b1, b2);
    working.unshift({ id: -Date.now(), name: `${b1.name}||${b2.name}`, lambda: ls, mtbf, mttr });
  }

  const [ls, mtbf, mttr] = calcParallelMarkov(working[0], working[1]);
  const formula = blocks.map((b) => fmtSci(b.lambda)).join(" + ");
  const result = `lambda=${fmtSci(ls)}, MTBF=${fmtIndian(mtbf)} hrs, MTTR=${mttr.toFixed(1)} hrs`;
  return [ls, mtbf, mttr, formula, result];
}

function calcROfN(b1: B, n: number, r: number): [number, number, number, string, string] {
  const l1 = b1.lambda;
  const t1 = b1.mttr > 0 ? b1.mttr : 1;
  const mu = 1 / t1;
  const coeff = factorial(n) / (factorial(r - 1) * factorial(n - r + 1));
  const ls = coeff * Math.pow(l1, n - r + 1) * Math.pow(t1, n - r);
  const mtbf = ls > 0 ? 1 / ls : 0;
  const mttr = mu > 0 ? 1 / ((n - r + 1) * mu) : 0;
  const formula = `C(${n},${r}) * ${fmtSci(l1)}^${n - r + 1} * ${fmtSci(t1)}^${n - r}`;
  const result = `lambda=${fmtSci(ls)}, MTBF=${fmtIndian(mtbf)} hrs, MTTR=${mttr.toFixed(1)} hrs`;
  return [ls, mtbf, mttr, formula, result];
}

/* ── Union-Find ── */

function createUF() {
  const parent: Record<string, string> = {};
  function find(key: string): string {
    if (!(key in parent)) parent[key] = key;
    if (parent[key] !== key) parent[key] = find(parent[key]);
    return parent[key];
  }
  function union(a: string, b: string) {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  return { find, union };
}

/* ── Main analysis ── */

function analyzeRbd(payload: { blocks?: unknown[]; connections?: unknown[] }) {
  const rawBlocks = (payload.blocks || []) as Record<string, unknown>[];
  const rawConns = (payload.connections || []) as Record<string, unknown>[];

  if (!rawBlocks.length) return { error: "No blocks provided." };
  if (!rawConns.length) return { error: "No connections provided." };

  // Derive — MTBF always authoritative
  const blocks: B[] = rawBlocks.map((b) => {
    const id = b.id as number;
    const name = (b.name as string) || "Unnamed";
    let lambda = (b.lambda as number) || 0;
    const mtbf = (b.mtbf as number) || 0;
    const mttr = (b.mttr as number) || 0;

    if (mtbf > 0) lambda = 1 / mtbf;
    else if (lambda > 0) { /* keep */ }

    return { id, name, lambda, mtbf, mttr, mu: mttr > 0 ? 1 / mttr : 0 };
  });

  const connections = rawConns.map((c) => {
    const from = c.from as Record<string, unknown>;
    const to = c.to as Record<string, unknown>;
    return {
      from: { blockId: from.blockId as number, side: from.side as string },
      to: { blockId: to.blockId as number, side: to.side as string },
    };
  });

  const uf = createUF();
  const portKey = (bid: number | string, side: string) => `b${bid}-${side}`;
  const nodeOf = (bid: number | string, side: string) => uf.find(portKey(bid, side));

  // Init all ports
  for (const b of blocks) {
    uf.find(portKey(b.id, "left"));
    uf.find(portKey(b.id, "right"));
  }

  // Unions from connections
  for (const c of connections) {
    uf.union(portKey(c.from.blockId, c.from.side), portKey(c.to.blockId, c.to.side));
  }

  let remaining = [...blocks];
  const steps: Step[] = [];

  for (let iter = 0; iter < 50; iter++) {
    if (remaining.length <= 1) break;

    let simplified = false;

    // Parallel
    const pairMap: Record<string, B[]> = {};
    for (const b of remaining) {
      const key = [nodeOf(b.id, "left"), nodeOf(b.id, "right")].sort().join("|");
      (pairMap[key] ??= []).push(b);
    }

    for (const group of Object.values(pairMap)) {
      if (group.length >= 2) {
        const [ls, mtbf, mttr, formula, result] = calcParallelSimple(group);
        steps.push({ type: "parallel", blocks: group.map((g) => g.name), formula, result });
        const eqId = -(steps.length + 100);
        const eq: B = { id: eqId, name: "Eq", lambda: ls, mtbf, mttr };
        uf.find(portKey(eqId, "left"));
        uf.find(portKey(eqId, "right"));
        const key = [nodeOf(group[0].id, "left"), nodeOf(group[0].id, "right")].sort().join("|");
        uf.union(portKey(eqId, "left"), key.split("|")[0]);
        uf.union(portKey(eqId, "right"), key.split("|")[1]);
        for (const g of group) remaining = remaining.filter((r) => r.id !== g.id);
        remaining.push(eq);
        simplified = true;
        break;
      }
    }
    if (simplified) continue;

    // Series
    let found = false;
    for (const b of remaining) {
      const bRight = nodeOf(b.id, "right");
      const candidates = remaining.filter(
        (ob) => ob.id !== b.id && nodeOf(ob.id, "left") === bRight
      );
      if (candidates.length !== 1) continue;
      const nb = candidates[0];
      const allAt = remaining.filter(
        (ob) => nodeOf(ob.id, "left") === bRight || nodeOf(ob.id, "right") === bRight
      );
      if (allAt.length !== 2) continue;

      const bLeft = nodeOf(b.id, "left");
      const nbRight = nodeOf(nb.id, "right");
      const [ls, mtbf, mttr, formula, result] = calcSeries([b, nb]);
      steps.push({ type: "series", blocks: [b.name, nb.name], formula, result });
      const eqId = -(steps.length + 100);
      const eq: B = { id: eqId, name: "Eq", lambda: ls, mtbf, mttr };
      uf.find(portKey(eqId, "left"));
      uf.find(portKey(eqId, "right"));
      uf.union(portKey(eqId, "left"), bLeft);
      uf.union(portKey(eqId, "right"), nbRight);
      remaining = remaining.filter((r) => r.id !== b.id && r.id !== nb.id);
      remaining.push(eq);
      found = true;
      break;
    }
    if (!found) break;
  }

  // Final
  let finalLambda = 0,
    finalMtbf = 0,
    finalMttr = 0;

  if (remaining.length === 0) {
    // all zero
  } else if (remaining.length === 1) {
    finalLambda = remaining[0].lambda;
    finalMtbf = remaining[0].mtbf;
    finalMttr = remaining[0].mttr;
  } else {
    finalLambda = remaining.reduce((s, b) => s + b.lambda, 0);
    finalMtbf = finalLambda > 0 ? 1 / finalLambda : 0;
    finalMttr = remaining.reduce((s, b) => s + b.mttr, 0) / remaining.length;
    steps.push({
      type: "final_series",
      blocks: remaining.map((b) => b.name),
      formula: remaining.map((b) => fmtSci(b.lambda)).join(" + "),
      result: `lambda=${fmtSci(finalLambda)}, MTBF=${fmtIndian(finalMtbf)} hrs, MTTR=${finalMttr.toFixed(1)} hrs`,
    });
  }

  const avail =
    finalMtbf + finalMttr > 0 ? finalMtbf / (finalMtbf + finalMttr) : 0;
  const resultLabel = "System Reliability";
  const resultValue =
    `lambda = ${fmtSci(finalLambda)} failures/hr | ` +
    `MTBF = ${fmtIndian(finalMtbf)} hrs | ` +
    `MTTR = ${finalMttr.toFixed(1)} hrs | ` +
    `Availability = ${(avail * 100).toFixed(4)}%`;

  return {
    steps,
    result_label: resultLabel,
    result_value: resultValue,
    block_count: blocks.length,
    connection_count: connections.length,
  };
}

/* ── Route handler ── */

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = analyzeRbd(body);
    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message || "Analysis failed" }, { status: 400 });
  }
}
