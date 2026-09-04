"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ── Types ── */

interface Comp {
  name: string; partNo?: string;
  lambda: string | number; mtbf: number | string; mttr: number | string;
  opTime?: number | string; repair?: string; fit?: string | number; fpmh?: string | number;
}
interface Block { id: number; comp: Comp; x: number; y: number; el: HTMLDivElement | null; }
interface Conn { id: number; from: { bid: number; side: string }; to: { bid: number; side: string }; el: SVGPathElement | null; mode: string; }
interface Step { type: string; blocks: string[]; formula: string; result: string; }

const fmtSCI = (v: number) => (v ? Number(v).toExponential(2) : "0");
const fmtIN = (n: number) => {
  if (!n) return "0";
  const s = Math.round(n).toString();
  const l = s.slice(-3);
  const r = s.slice(0, -3);
  return r ? r.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + l : l;
};
const num = (v: unknown) => parseFloat(v as string) || 0;

/* ── Component ── */

export default function RBDSheet() {
  const [comps, setComps] = useState<Comp[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [conns, setConns] = useState<Conn[]>([]);
  const [mode, setMode] = useState<string | null>(null);
  const [selConn, setSelConn] = useState<number | null>(null);
  const [summary, setSummary] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [showReason, setShowReason] = useState(false);
  const [picking, setPicking] = useState(false);
  const [libStatus, setLibStatus] = useState("Loading...");

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
  const blocksRef = useRef<Block[]>([]);
  const connsRef = useRef<Conn[]>([]);
  const modeRef = useRef<string | null>(null);
  /* pending first-port pick: { bid, side, el } — same role as `cs` in original */
  const csRef = useRef<{ bid: number; side: string; el: HTMLElement } | null>(null);
  const tlRef = useRef<SVGPathElement | null>(null);
  const anchorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  useEffect(() => { connsRef.current = conns; }, [conns]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

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

  /* ── Temp preview line (PowerPoint-style rubber band) ── */

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

  /* Port click handler — pure click-click (PowerPoint): click dot 1 → preview, click dot 2 → connect.
     Tool stays active (toggle off via button only). Each wire = exactly 2 dots. */
  const onPortDown = useCallback((e: MouseEvent, bid: number, side: string, portEl: HTMLElement) => {
    e.stopPropagation();
    e.preventDefault();
    if (!modeRef.current) return;
    const cs = csRef.current;

    /* Second click — complete the wire */
    if (cs) {
      if (cs.bid === bid && cs.side === side) { cancelPick(); return; }
      makeConn(cs.bid, cs.side, bid, side);
      cancelPick(); /* clears first-dot highlight + preview; tool stays active */
      return;
    }

    /* First click — arm this port, show preview line */
    csRef.current = { bid, side, el: portEl };
    setPicking(true);
    portEl.style.background = "#3b82f6";
    showTemp(portEl);
  }, [makeConn, cancelPick, showTemp]);

  /* Ref so ports always call the latest handler (avoids stale closures) */
  const onPortDownRef = useRef(onPortDown);
  useEffect(() => { onPortDownRef.current = onPortDown; }, [onPortDown]);

  /* ── Blocks ── */

  const addBlock = useCallback((c: Comp, x: number, y: number) => {
    const id = nidRef.current++;
    let dLam = num(c.lambda);
    if (!dLam && num(c.mtbf) > 0) dLam = 1 / num(c.mtbf);

    const el = document.createElement("div");
    el.className = "rbd-block";
    el.dataset.bid = String(id);
    el.innerHTML =
      `<button class="rbd-xbtn" data-action="delete">&times;</button>` +
      `<div class="rbd-bname">${c.name || "Unnamed"}</div>` +
      (dLam ? `<div class="rbd-blam">&lambda;=${fmtSCI(dLam)}</div>` : "") +
      (num(c.mtbf) ? `<div class="rbd-bmtbf">MTBF:${fmtIN(num(c.mtbf))}</div>` : "") +
      (num(c.mttr) ? `<div class="rbd-bmttr">MTTR:${c.mttr}hrs</div>` : "") +
      `<div class="rbd-port rbd-pl" data-bid="${id}" data-side="left"></div>` +
      `<div class="rbd-port rbd-pr" data-bid="${id}" data-side="right"></div>`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    wsRef.current?.appendChild(el);

    const block: Block = { id, comp: c, x, y, el };
    setBlocks((prev) => [...prev, block]);

    /* drag */
    el.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest(".rbd-port, .rbd-xbtn")) return;
      if (modeRef.current) return;
      e.preventDefault();
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

    /* delete block */
    el.querySelector("[data-action='delete']")?.addEventListener("click", () => {
      el.remove();
      setBlocks((prev) => prev.filter((b) => b.id !== id));
      setConns((prev) => {
        const gone = prev.filter((cn) => cn.from.bid === id || cn.to.bid === id);
        gone.forEach((cn) => cn.el?.remove());
        return prev.filter((cn) => cn.from.bid !== id && cn.to.bid !== id);
      });
    });

    /* ports — use ref so they always call the latest handler */
    el.querySelectorAll(".rbd-port").forEach((port) => {
      port.addEventListener("mousedown", (e) => {
        const p = port as HTMLElement;
        onPortDownRef.current(e as MouseEvent, id, p.dataset.side || "left", p);
      });
    });
  }, [updateConns]);

  /* Highlight ports that have connections (original updPV) */
  useEffect(() => {
    document.querySelectorAll(".rbd-port.rbd-linked").forEach((p) => p.classList.remove("rbd-linked"));
    conns.forEach((cn) => {
      const b1 = blocksRef.current.find((b) => b.id === cn.from.bid);
      const b2 = blocksRef.current.find((b) => b.id === cn.to.bid);
      b1?.el?.querySelector(cn.from.side === "left" ? ".rbd-pl" : ".rbd-pr")?.classList.add("rbd-linked");
      b2?.el?.querySelector(cn.to.side === "left" ? ".rbd-pl" : ".rbd-pr")?.classList.add("rbd-linked");
    });
  }, [conns, blocks]);

  /* Selected connection highlight */
  useEffect(() => {
    conns.forEach((cn) => cn.el?.classList.toggle("rbd-selected", cn.id === selConn));
  }, [selConn, conns]);

  /* Keys: Delete removes selected line, Escape cancels pick + mode (original setupKeys) */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selConn !== null) {
        e.preventDefault();
        setConns((prev) => {
          prev.find((c) => c.id === selConn)?.el?.remove();
          return prev.filter((c) => c.id !== selConn);
        });
        setSelConn(null);
      }
      if (e.key === "Escape") {
        setSelConn(null);
        cancelPick();
        setMode(null);
        setShowReason(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selConn, cancelPick, setShowReason]);

  /* Line tool toggle (original setLM) */
  const setLineMode = useCallback((m: string) => {
    setMode((prev) => {
      const next = prev === m ? null : m;
      modeRef.current = next;
      return next;
    });
    cancelPick();
  }, [cancelPick]);

  /* ── Run / Clear / Reset (original run/clr/rst) ── */

  const runAnalysis = useCallback(() => {
    if (!blocksRef.current.length) { setSummary("No blocks. Drag components first."); setSteps([]); return; }
    if (!connsRef.current.length) { setSummary("No connections. Click two ports."); setSteps([]); return; }
    setSummary("Analyzing...");
    fetch("/api/analyze-rbd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blocks: blocksRef.current.map((b) => {
          let lam = num(b.comp.lambda);
          if (!lam && num(b.comp.mtbf) > 0) lam = 1 / num(b.comp.mtbf);
          return {
            id: b.id, name: b.comp.name, lambda: lam,
            mtbf: num(b.comp.mtbf), mttr: num(b.comp.mttr),
            opTime: num(b.comp.opTime), repair: b.comp.repair || "Repairable",
          };
        }),
        connections: connsRef.current.map((cn) => ({
          from: { blockId: cn.from.bid, side: cn.from.side },
          to: { blockId: cn.to.bid, side: cn.to.side },
        })),
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setSummary(d.error); setSteps([]); return; }
        /* Parse result_value: "lambda = X failures/hr | MTBF = Y hrs | MTTR = Z hrs | Availability = W%" */
        const raw = d.result_value || "";
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
          setSummary(raw || `${d.result_label} = No result`);
        }
        setSteps(Array.isArray(d.steps) ? d.steps : []);
      })
      .catch((e) => { setSummary(`Backend error: ${e.message}`); setSteps([]); });
  }, []);

  const clearAll = useCallback(() => {
    cancelPick();
    blocksRef.current.forEach((b) => b.el?.remove());
    connsRef.current.forEach((c) => c.el?.remove());
    setBlocks([]); setConns([]); setSelConn(null); nidRef.current = 1;
    setSummary(""); setSteps([]); setShowReason(false);
  }, [cancelPick]);

  const resetResult = useCallback(() => {
    setSummary(""); setSteps([]); setShowReason(false);
  }, []);

  return (
    <div className="relative flex flex-col h-full bg-[#0f172a]">
      <style>{`
        .rbd-block{position:absolute;background:#1e293b;border:2px solid #475569;border-radius:4px;padding:10px 12px;cursor:move;z-index:2;min-width:120px;max-width:160px;text-align:center;user-select:none;transition:box-shadow .2s;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,sans-serif}
        .rbd-block:hover{box-shadow:0 0 14px rgba(59,130,246,.35)}
        .rbd-bname{font-size:11px;font-weight:700;color:#e2e8f0;margin-bottom:3px}
        .rbd-blam{font-size:10px;color:#f87171;font-family:ui-monospace,SFMono-Regular,monospace;margin-bottom:1px}
        .rbd-bmtbf{font-size:10px;color:#34d399;margin-bottom:1px}
        .rbd-bmttr{font-size:10px;color:#fbbf24}
        .rbd-xbtn{position:absolute;top:-5px;right:-5px;width:14px;height:14px;background:#ef4444;border:none;border-radius:50%;color:#fff;font-size:9px;cursor:pointer;display:none;align-items:center;justify-content:center;z-index:10;line-height:1}
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
        .rbd-lib{background:#1e293b;border:2px solid #475569;border-radius:7px;padding:8px;margin-bottom:6px;cursor:grab;transition:transform .15s,box-shadow .15s;user-select:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,sans-serif}
        .rbd-lib:hover{transform:scale(1.03);box-shadow:0 0 10px rgba(59,130,246,.35)}
        .rbd-lib:active{cursor:grabbing}
        .rbd-tool{padding:5px 10px;border-radius:5px;cursor:pointer;font-weight:700;font-size:10px;border:2px solid transparent;display:inline-flex;align-items:center;gap:4px;transition:background .15s;color:#fff}
        .rbd-tool.active{border-color:#3b82f6 !important;animation:rbd-pulse 1s infinite}
        @keyframes rbd-pulse{0%,100%{box-shadow:0 0 4px #3b82f6}50%{box-shadow:0 0 12px #3b82f6}}
      `}</style>
      <div className="flex h-full">
        {/* Library */}
        <div className="w-[210px] bg-[#1e293b] border-r border-slate-700/60 flex flex-col p-2.5 overflow-y-auto shrink-0">
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
          <div id="rbd-lib-list" className="flex-1">
            {comps.length === 0 && (
              <div className="text-[10px] text-slate-600 text-center mt-8 leading-relaxed">{libStatus}</div>
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
                  <div className="text-[10px] font-bold text-slate-200">{c.name || "Unnamed"}</div>
                  {lam > 0 && <div className="text-[9px] text-red-400 font-mono">&lambda;={fmtSCI(lam)}</div>}
                  {num(c.mtbf) > 0 && <div className="text-[9px] text-emerald-400">MTBF:{fmtIN(num(c.mtbf))}</div>}
                  {num(c.mttr) > 0 && <div className="text-[9px] text-amber-400">MTTR:{c.mttr}hrs</div>}
                </div>
              );
            })}
          </div>
          <div className="mt-auto pt-2 border-t border-slate-700/60 text-[9px] text-slate-600">{libStatus}</div>
        </div>

        {/* Right */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="bg-[#1e293b] px-3 py-1.5 flex items-center gap-1.5 border-b border-slate-700/60 shrink-0">
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
            {summary && (
              <div
                title={summary}
                className={`ml-1 flex items-center gap-1.5 rounded px-2 py-0.5 border text-[10px] font-bold ${steps.length ? "bg-emerald-600/15 border-emerald-500/40" : "bg-slate-800 border-slate-700"}`}
              >
                <span className="text-emerald-400/80 uppercase tracking-wider text-[8px]">Result</span>
                <span className="text-slate-300">λ=<span className="text-red-400">{summaryParts.lam}</span></span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-300">MTBF=<span className="text-emerald-400">{summaryParts.mtbf}</span></span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-300">MTTR=<span className="text-amber-400">{summaryParts.mttr}</span></span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-300">Av=<span className="text-cyan-400">{summaryParts.av}</span></span>
              </div>
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
                {mode ? (picking ? "Click 2nd port" : "Click a port") : "Drag blocks"}
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
              try {
                const c = JSON.parse(e.dataTransfer.getData("text/plain"));
                const rect = wsRef.current!.getBoundingClientRect();
                addBlock(c, e.clientX - rect.left - 60, e.clientY - rect.top - 20);
              } catch {}
            }}
          >
            <svg ref={svgRef} className="absolute inset-0 w-full h-full z-[1]" style={{ pointerEvents: "none" }}>
              <g style={{ pointerEvents: "auto" }} />
            </svg>
          </div>

          {/* Reasoning — floating popup box, no screen dimming */}
          {showReason && steps.length > 0 && (
            <div
              className="absolute z-50 top-14 right-4 w-[420px] max-h-[60%] overflow-y-auto bg-[#1e293b] border border-slate-600 rounded-lg shadow-2xl p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Reasoning — process and calculations</h3>
                <button
                  onClick={() => setShowReason(false)}
                  className="text-slate-500 hover:text-white text-lg leading-none px-1 transition-colors"
                  title="Close"
                >
                  &times;
                </button>
              </div>
              {steps.map((s, i) => (
                <div key={i} className="text-[11px] leading-relaxed text-slate-400 py-0.5 border-b border-slate-800 last:border-0">
                  {i + 1}. [{s.type.toUpperCase()}] {s.blocks.join(s.type === "parallel" ? " || " : " + ")} &rarr; {s.formula} = <strong className="text-slate-100">{s.result}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
