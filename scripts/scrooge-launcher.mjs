import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "..");
const localAppData = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? process.cwd(), "AppData", "Local");
const authFile = process.env.SCROOGE_AUTH_FILE ?? join(localAppData, "scrooge-mcp", "auth.dpapi");

try {
  const exec = promisify(execFile);
  const command = "$s = ConvertTo-SecureString -String (Get-Content -Raw -LiteralPath $args[0]); $p = [System.Net.NetworkCredential]::new('', $s).Password; [Console]::Out.Write($p)";
  const result = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command, authFile], { windowsHide: true, maxBuffer: 16 * 1024 });
  const key = result.stdout.trim();
  if (key.length === 0) throw new Error("the decrypted key is empty");
  start(key);
} catch (error) {
  console.error(`Scrooge DPAPI auth file could not be read: ${authFile}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function start(key) {
const child = spawn(process.execPath, [join(projectDir, "dist", "index.js")], {
  cwd: projectDir,
  env: { ...process.env, DEEPSEEK_API_KEY: key },
  stdio: "inherit",
  windowsHide: true,
});

child.once("error", error => {
  console.error(`Scrooge could not start: ${error.message}`);
  process.exit(1);
});
child.once("exit", (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
}
