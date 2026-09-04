import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const COMP_FILE = path.join(process.cwd(), "components.json");

let inMemory: unknown[] = [];

function load(): unknown[] {
  if (inMemory.length) return [...inMemory];
  try {
    if (fs.existsSync(COMP_FILE)) {
      inMemory = JSON.parse(fs.readFileSync(COMP_FILE, "utf-8"));
      return [...inMemory];
    }
  } catch {}
  return [];
}

function save(data: unknown[]) {
  inMemory = [...data];
  try {
    fs.writeFileSync(COMP_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch {}
}

export async function GET() {
  return NextResponse.json(load());
}

export async function POST(req: Request) {
  const data = await req.json();
  save(Array.isArray(data) ? data : []);
  return NextResponse.json({ ok: true, count: Array.isArray(data) ? data.length : 0 });
}
