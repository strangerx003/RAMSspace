/* RAMSspace API test suite.
 * Spawns the production standalone server on a test port, runs assertions
 * against pages + API routes, then shuts the server down.
 * Run:  npm run test:api        (from RAMspace_Base_UI)
 * Exit: 0 = all pass, 1 = failures.
 */
import { spawn } from "node:child_process";

const PORT = 3101;
const BASE = `http://localhost:${PORT}`;
let failures = 0;
let passes = 0;

function check(label, cond, detail = "") {
  if (cond) { passes++; console.log(`PASS  ${label}`); }
  else { failures++; console.log(`FAIL  ${label}  ${detail}`); }
}

async function waitReady(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function postJSON(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

const server = spawn(process.execPath, [".next/standalone/server.js"], {
  env: { ...process.env, PORT: String(PORT), HOSTNAME: "127.0.0.1" },
  stdio: "ignore",
});

try {
  console.log(`Starting test server on ${PORT}...`);
  if (!(await waitReady())) {
    console.log("FAIL  server did not become ready");
    process.exit(1);
  }

  /* 1 — homepage renders Data Register (default module) */
  const homeRes = await fetch(`${BASE}/`);
  check("home-200", homeRes.status === 200, `status=${homeRes.status}`);
  const home = await homeRes.text();
  for (const s of ["Data Register", "Reliability Block Diagram", "Component / LRU", "Part No."]) {
    check(`home-contains:${s}`, home.includes(s));
  }

  /* 2 — save rows with ALL 9 original factors */
  const rows = [
    { name: "Power Supply", partNo: "PS-1001", lambda: "5.0e-6", mtbf: "200000", mttr: "4", opTime: "8760", repair: "Repairable", fit: "5", fpmh: "5" },
    { name: "Cooling Fan", partNo: "FAN-7001", lambda: "10.0e-6", mtbf: "100000", mttr: "1", opTime: "8760", repair: "Non Repairable", fit: "10", fpmh: "10" },
  ];
  let r = await postJSON("/api/components", rows);
  check("save-200", r.status === 200, `status=${r.status}`);
  check("save-count-2", r.json.count === 2, JSON.stringify(r.json));

  /* 3 — GET round-trip keeps every factor incl partNo / fit / fpmh */
  r = await fetch(`${BASE}/api/components`);
  check("get-200", r.status === 200, `status=${r.status}`);
  const got = await r.json();
  check("get-2-rows", Array.isArray(got) && got.length === 2, JSON.stringify(got).slice(0, 120));
  check("get-partNo", got[0].partNo === "PS-1001", got[0].partNo);
  check("get-lambda", got[0].lambda === "5.0e-6", got[0].lambda);
  check("get-fit-fpmh", got[0].fit === "5" && got[0].fpmh === "5", `${got[0].fit}/${got[0].fpmh}`);
  check("get-repair-space", got[1].repair === "Non Repairable", got[1].repair);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
} finally {
  server.kill();
}
