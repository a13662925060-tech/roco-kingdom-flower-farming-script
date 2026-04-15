const { existsSync, statSync } = require("fs");
const { resolve } = require("path");
const { spawnSync } = require("child_process");

const launcherRoot = __dirname;
const sourceFiles = [
  resolve(launcherRoot, "..", "backend", "solo", "luoke_macro_hotkey.py"),
  resolve(launcherRoot, "SoloBowBackend.spec"),
];
const outputFile = resolve(
  launcherRoot,
  "artifacts",
  "backend",
  "SoloBowBackend",
  "SoloBowBackend.exe"
);

function getMtimeMs(filePath) {
  return statSync(filePath).mtimeMs;
}

function shouldRebuildBackend() {
  if (!existsSync(outputFile)) {
    return true;
  }

  const outputMtimeMs = getMtimeMs(outputFile);
  return sourceFiles.some((filePath) => getMtimeMs(filePath) > outputMtimeMs);
}

if (!shouldRebuildBackend()) {
  console.log("SoloBowBackend onedir build is up to date, skipping PyInstaller rebuild.");
  process.exit(0);
}

const result = spawnSync(
  "pyinstaller",
  ["SoloBowBackend.spec", "--distpath", "artifacts/backend", "--workpath", "build_backend", "--noconfirm"],
  {
    cwd: launcherRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  }
);

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
