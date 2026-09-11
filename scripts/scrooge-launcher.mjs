import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "..");
const localAppData = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? process.cwd(), "AppData", "Local");
const authFile = process.env.SCROOGE_AUTH_FILE ?? join(localAppData, "scrooge-mcp", "auth.dpapi");
const quote = value => `'${value.replaceAll("'", "''")}'`;
const command = [
  "$ProgressPreference = 'SilentlyContinue'",
  `$s = ConvertTo-SecureString -String (Get-Content -Raw -LiteralPath ${quote(authFile)})`,
  `$env:DEEPSEEK_API_KEY = [System.Net.NetworkCredential]::new([string]::Empty, $s).Password`,
  `& ${quote(process.execPath)} ${quote(join(projectDir, "dist", "index.js"))}`,
].join("; ");
const encodedCommand = Buffer.from(command, "utf16le").toString("base64");
const powershell = process.env.SystemRoot
  ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  : "powershell.exe";
const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand], {
  cwd: projectDir,
  env: { ...process.env, PSModulePath: `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\Modules` },
  stdio: "inherit",
  windowsHide: true,
});
child.once("error", error => { console.error(`Scrooge could not start: ${error.message}`); process.exit(1); });
child.once("exit", (code, signal) => { if (signal !== null) process.kill(process.pid, signal); else process.exit(code ?? 1); });
