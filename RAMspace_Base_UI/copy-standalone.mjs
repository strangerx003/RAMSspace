/* Copies build output into the standalone dir so
 * `node .next/standalone/server.js` serves CSS/JS/fonts.
 * Runs automatically after every build (npm postbuild hook).
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";

if (existsSync(".next/static")) {
  mkdirSync(".next/standalone/.next/static", { recursive: true });
  cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
  console.log("standalone: .next/static copied");
} else {
  console.log("standalone: WARNING .next/static missing");
}

if (existsSync("public")) {
  mkdirSync(".next/standalone/public", { recursive: true });
  cpSync("public", ".next/standalone/public", { recursive: true });
  console.log("standalone: public copied");
}
