import { spawn } from "node:child_process";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [
  spawn(npmCmd, ["run", "dev:api"], { shell: process.platform === "win32", stdio: "inherit" }),
  spawn(npmCmd, ["run", "dev:web", "--", "--port", "5173"], { shell: process.platform === "win32", stdio: "inherit" }),
];

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) shutdown(code);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
