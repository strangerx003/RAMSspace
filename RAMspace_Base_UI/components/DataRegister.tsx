"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/* ── Types (same fields as original Data Register) ── */

interface ComponentData {
  name: string;
  partNo: string;
  lambda: string;
  mtbf: string;
  mttr: string;
  opTime: string;
  repair: string;
  fit: string;
  fpmh: string;
}

const emptyRow = (): ComponentData => ({
  name: "",
  partNo: "",
  lambda: "",
  mtbf: "",
  mttr: "",
  opTime: "8760",
  repair: "Repairable",
  fit: "",
  fpmh: "",
});

/* 10 default components */
const DEFAULTS: ComponentData[] = [
  { name: "Power Supply", partNo: "PS-1001", lambda: "5.0e-6", mtbf: "200000", mttr: "4", opTime: "8760", repair: "Repairable", fit: "5", fpmh: "5" },
  { name: "Processor", partNo: "CPU-2001", lambda: "2.0e-6", mtbf: "500000", mttr: "2", opTime: "8760", repair: "Repairable", fit: "2", fpmh: "2" },
  { name: "Memory Module", partNo: "MEM-3001", lambda: "1.0e-6", mtbf: "1000000", mttr: "1", opTime: "8760", repair: "Repairable", fit: "1", fpmh: "1" },
  { name: "Sensor", partNo: "SNS-4001", lambda: "3.0e-6", mtbf: "333333", mttr: "3", opTime: "8760", repair: "Repairable", fit: "3", fpmh: "3" },
  { name: "Communication Module", partNo: "COM-5001", lambda: "4.0e-6", mtbf: "250000", mttr: "6", opTime: "8760", repair: "Repairable", fit: "4", fpmh: "4" },
  { name: "Display Unit", partNo: "DSP-6001", lambda: "1.5e-6", mtbf: "666667", mttr: "2", opTime: "8760", repair: "Repairable", fit: "1.5", fpmh: "1.5" },
  { name: "Cooling Fan", partNo: "FAN-7001", lambda: "10.0e-6", mtbf: "100000", mttr: "1", opTime: "8760", repair: "Non Repairable", fit: "10", fpmh: "10" },
  { name: "Battery", partNo: "BAT-8001", lambda: "8.0e-6", mtbf: "125000", mttr: "8", opTime: "8760", repair: "Non Repairable", fit: "8", fpmh: "8" },
  { name: "Hard Drive", partNo: "HDD-9001", lambda: "6.0e-6", mtbf: "166667", mttr: "2", opTime: "8760", repair: "Repairable", fit: "6", fpmh: "6" },
  { name: "UPS", partNo: "UPS-9002", lambda: "3.5e-6", mtbf: "285714", mttr: "4", opTime: "8760", repair: "Repairable", fit: "3.5", fpmh: "3.5" },
];

/* ── Component ── */

export default function DataRegister() {
  const [rows, setRows] = useState<ComponentData[]>([]);
  const [optShow, setOptShow] = useState(false);
  const [status, setStatus] = useState("Loading...");
  const rowsRef = useRef<ComponentData[]>([]);
  rowsRef.current = rows;

  /* Sync persist — same as original (blocks until saved) */
  const persist = useCallback((data: ComponentData[]) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/components", false);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(JSON.stringify(data));
      setStatus(`Saved: ${data.length} components`);
    } catch (e) {
      setStatus(`Save FAILED: ${(e as Error).message}`);
    }
  }, []);

  /* Load — server first, defaults when empty/offline (same as original) */
  useEffect(() => {
    fetch("/api/components")
      .then((r) => r.json())
      .then((d: ComponentData[]) => {
        if (Array.isArray(d) && d.length > 0) {
          const loaded = d.map((r) => ({ ...emptyRow(), ...r }));
          if (loaded.length < DEFAULTS.length) {
            const merged = [...loaded];
            for (const def of DEFAULTS) {
              if (merged.length >= DEFAULTS.length) break;
              if (!merged.some((r) => r.name === def.name)) merged.push({ ...def });
            }
            setRows(merged);
            setStatus(`Loaded: ${d.length} saved + defaults = ${merged.length} components`);
          } else {
            setRows(loaded);
            setStatus(`Loaded: ${d.length} components`);
          }
        } else {
          setRows(DEFAULTS.map((r) => ({ ...r })));
          setStatus(`Loaded: ${DEFAULTS.length} components`);
          setTimeout(() => persist(DEFAULTS), 0);
        }
      })
      .catch(() => {
        setRows(DEFAULTS.map((r) => ({ ...r })));
        setStatus("API error, loaded defaults");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Save-on-close beacon — same as original */
  useEffect(() => {
    const handler = () => {
      const d = rowsRef.current.filter((r) => r.name.trim());
      navigator.sendBeacon("/api/components", new Blob([JSON.stringify(d)], { type: "application/json" }));
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  /* λ↔MTBF auto-derive ONLY when the other field is empty (original behavior) */
  const updateRow = useCallback((idx: number, field: string, value: string) => {
    setRows((prev) => {
      const next = [...prev];
      const row = { ...next[idx], [field]: value } as ComponentData;
      if (field === "lambda") {
        const lam = parseFloat(value) || 0;
        if (lam > 0 && row.mtbf === "") row.mtbf = String(Math.round(1 / lam));
      } else if (field === "mtbf") {
        const mb = parseFloat(value) || 0;
        if (mb > 0 && row.lambda === "") row.lambda = (1 / mb).toExponential(2);
      }
      next[idx] = row;
      return next;
    });
  }, []);

  /* Persist after every edit (debounced so typing stays smooth) */
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (rows.length === 0) return;
    if (editTimer.current) clearTimeout(editTimer.current);
    editTimer.current = setTimeout(() => persist(rows.filter((r) => r.name.trim())), 400);
  }, [rows, persist]);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, emptyRow()]);
  }, []);

  const deleteRow = useCallback((idx: number) => {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : [emptyRow()];
    });
  }, []);

  const inputCls =
    "w-full bg-transparent border border-slate-700 rounded px-1 py-0.5 text-[11px] text-slate-200 placeholder-slate-600 focus:border-blue-500 focus:outline-none transition-colors";
  const thCls = "py-1 px-0.5 text-[10px] font-semibold text-slate-400 text-left whitespace-nowrap";
  const thReq = "py-1 px-0.5 text-[10px] font-semibold text-red-400 text-left whitespace-nowrap";
  const tdCls = "py-0.5 px-0.5";

  return (
    <div className="flex flex-col h-full bg-[#0f172a]">
      {/* Header — same controls as original: title, More/Less, Add */}
      <div className="flex items-center gap-2 px-4 py-2.5 shrink-0">
        <h2 className="text-[15px] font-semibold text-emerald-400">Component / LRU Register</h2>
        <button
          onClick={() => setOptShow((s) => !s)}
          className="px-3 py-1.5 rounded text-[11px] font-bold bg-amber-500/90 hover:bg-amber-500 text-slate-900 transition-colors"
        >
          {optShow ? "Less" : "More"}
        </button>
        <button
          onClick={addRow}
          className="px-3 py-1.5 rounded text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
        >
          + Add
        </button>
      </div>

      {/* Table — fixed layout for tight columns */}
      <div className="flex-1 overflow-auto border border-slate-700/60 mx-4 rounded">
        <table className="border-collapse" style={{ tableLayout: "fixed" }}>
          <thead className="sticky top-0 bg-[#1e293b] z-10">
            <tr className="border-b-2 border-slate-700/60">
              <th className={thCls} style={{ width: 28 }}>#</th>
              <th className={thReq} style={{ width: 130 }}>Component / LRU</th>
              <th className={thReq} style={{ width: 80 }}>Part No.</th>
              <th className={thReq} style={{ width: 72 }}>&lambda;</th>
              <th className={thReq} style={{ width: 82 }}>MTBF</th>
              <th className={thReq} style={{ width: 66 }}>MTTR</th>
              <th className={thReq} style={{ width: 82 }}>Operating Time</th>
              <th className={thReq} style={{ width: 80 }}>Repair</th>
              {optShow && <th className="py-1.5 px-1 text-[11px] font-semibold text-amber-400 text-left whitespace-nowrap">FIT</th>}
              {optShow && <th className="py-1.5 px-1 text-[11px] font-semibold text-amber-400 text-left whitespace-nowrap">FPMH</th>}
              <th style={{ width: 30 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-slate-800 odd:bg-transparent even:bg-slate-800/30 hover:bg-slate-800/60 transition-colors">
                <td className={`${tdCls} text-center text-xs text-slate-500`}>{i + 1}</td>
                <td className={tdCls}>
                  <input value={row.name} onChange={(e) => updateRow(i, "name", e.target.value)} placeholder="Component Name" className={inputCls} />
                </td>
                <td className={tdCls}>
                  <input value={row.partNo} onChange={(e) => updateRow(i, "partNo", e.target.value)} placeholder="Part No" className={inputCls} />
                </td>
                <td className={tdCls}>
                  <input value={row.lambda} onChange={(e) => updateRow(i, "lambda", e.target.value)} placeholder="e.g. 5e-6" className={`${inputCls} font-mono`} />
                </td>
                <td className={tdCls}>
                  <input type="number" value={row.mtbf} onChange={(e) => updateRow(i, "mtbf", e.target.value)} placeholder="MTBF" className={inputCls} />
                </td>
                <td className={tdCls}>
                  <input type="number" step="0.1" value={row.mttr} onChange={(e) => updateRow(i, "mttr", e.target.value)} placeholder="MTTR" className={inputCls} />
                </td>
                <td className={tdCls}>
                  <input type="number" value={row.opTime} onChange={(e) => updateRow(i, "opTime", e.target.value)} placeholder="Hours" className={inputCls} />
                </td>
                <td className={tdCls}>
                  <select value={row.repair} onChange={(e) => updateRow(i, "repair", e.target.value)} className={`${inputCls} bg-[#0f172a]`}>
                    <option value="Repairable">Repairable</option>
                    <option value="Non Repairable">Non Repairable</option>
                  </select>
                </td>
                {optShow && (
                  <td className={tdCls}>
                    <input value={row.fit} onChange={(e) => updateRow(i, "fit", e.target.value)} placeholder="FIT" className={`${inputCls} text-center`} />
                  </td>
                )}
                {optShow && (
                  <td className={tdCls}>
                    <input value={row.fpmh} onChange={(e) => updateRow(i, "fpmh", e.target.value)} placeholder="FPMH" className={`${inputCls} text-center`} />
                  </td>
                )}
                <td className={`${tdCls} text-center`}>
                  <button onClick={() => deleteRow(i)} className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500 hover:bg-red-400 text-white transition-colors">
                    X
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Status bar — same as original */}
      <div className="flex gap-4 px-4 py-2 bg-[#1e293b] border-t border-slate-700/60 text-[11px] text-slate-500 shrink-0">
        <div>Total: <span className="text-emerald-400 font-bold">{rows.length}</span></div>
        <div>{status}</div>
      </div>
    </div>
  );
}
