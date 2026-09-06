/* RAMSspace UI presence check: verifies every visible element of both modules.
 * Spawns its own production server (port 3102), seeds component data,
 * checks SSR content + API fields + client bundle + static assets (200s).
 * Run:  npm run test:ui        (from RAMspace_Base_UI)
 * Exit: 0 = all pass, 1 = failures.
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PORT = 3102;
const BASE = `http://localhost:${PORT}`;
let fail = 0, pass = 0;

function check(label, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${detail}`); }
}

async function waitReady(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`${BASE}/`); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const server = spawn(process.execPath, [".next/standalone/server.js"], {
  env: { ...process.env, PORT: String(PORT), HOSTNAME: "127.0.0.1" },
  stdio: "ignore",
});

try {
  console.log(`Starting UI test server on ${PORT}...`);
  if (!(await waitReady())) { console.log("FAIL  server did not become ready"); process.exit(1); }

  /* Seed full 9-field rows so content checks are deterministic */
  await fetch(`${BASE}/api/components`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([
      { name: "Power Supply", partNo: "PS-1001", lambda: "5.0e-6", mtbf: "200000", mttr: "4", opTime: "8760", repair: "Repairable", fit: "5", fpmh: "5" },
      { name: "Cooling Fan", partNo: "FAN-7001", lambda: "10.0e-6", mtbf: "100000", mttr: "1", opTime: "8760", repair: "Non Repairable", fit: "10", fpmh: "10" },
    ]),
  });

  const home = await (await fetch(`${BASE}/`)).text();

  /* Sidebar */
  for (const s of ["RAMspace", "Analysis Modules", "Data Register", "Reliability Block Diagram",
    "RAM Analysis", "FMECA", "Life Cycle Cost", "Spare Parts", "Reliability Calc",
    "Fault Tree Analysis", "RAM Monitoring", "RAM Demonstration", "SOON"])
    check(`sidebar:${s}`, home.includes(s));

  /* Data Register (default module, SSR) */
  for (const s of ["Component / LRU Register", "Part No.", "MTBF", "MTTR",
    "Operating Time", "Repair", "+ Add", "More", "Total:"])
    check(`register:${s}`, home.includes(s));
  check("register:lambda-header", home.includes("&lambda;") || home.includes("λ"));

  /* API rows carry all 9 factors */
  const comps = await (await fetch(`${BASE}/api/components`)).json();
  check("api:components-array", Array.isArray(comps), typeof comps);
  check("api:components-nonempty", comps.length > 0, `len=${comps?.length}`);
  if (comps.length) {
    const c = comps[0];
    for (const k of ["name", "partNo", "lambda", "mtbf", "mttr", "opTime", "repair", "fit", "fpmh"])
      check(`api:field-${k}`, k in c, JSON.stringify(c).slice(0, 160));
  }

  /* RBD module ships in client bundle (rendered on module switch) */
  let bundle = "";
  (function walk(d) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (f !== "standalone") walk(p); }
      else if (f.endsWith(".js")) bundle += readFileSync(p, "utf8");
    }
  })(".next/static");
  for (const s of ["Reasoning", "rbd-block", "rbd-port", "Click a port", "Drag blocks",
    "Straight", "Elbow", "Straight connector", "Elbow (right-angle) connector", "Analyzing",
    "Formulas", "Groups", "Reset", "Series (1oo1)", "failures/hr", "Copied"])
    check(`rbd-bundle:${s}`, bundle.includes(s));

  /* Static assets must load with 200 or the page renders unstyled */
  const assetUrls = [...home.matchAll(/\/_next\/static\/[a-zA-Z0-9\/_.\-]+\.(css|js)/g)].map((m) => m[0]);
  check("assets:referenced", assetUrls.length > 0, `found=${assetUrls.length}`);
  const seen = new Set();
  for (const u of assetUrls) {
    if (seen.has(u)) continue;
    seen.add(u);
    if (seen.size > 4) break;
    const r = await fetch(BASE + u);
    const body = await r.text();
    check(`assets:200 ${u.slice(-44)}`, r.status === 200 && body.length > 100, `status=${r.status} len=${body.length}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
} finally {
  server.kill();
}
