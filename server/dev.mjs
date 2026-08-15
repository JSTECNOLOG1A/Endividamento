import { spawn } from "node:child_process";

const children = [];

function run(command, args, name) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  child.on("exit", (code) => {
    for (const other of children) {
      if (other !== child && !other.killed) other.kill("SIGTERM");
    }
    process.exit(code ?? 0);
  });
  children.push(child);
  console.log(`[dev] ${name} pid ${child.pid}`);
}

run(process.execPath, ["server/index.js"], "api");
run(process.execPath, ["./node_modules/vite/bin/vite.js"], "web");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
}
