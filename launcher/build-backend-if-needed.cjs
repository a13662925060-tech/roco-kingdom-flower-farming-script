const { existsSync, statSync } = require("fs");
const { resolve } = require("path");
const { spawnSync } = require("child_process");

const launcherRoot = __dirname;
const forceRebuild = process.argv.includes("--force");
const sharedSourceFiles = [
  resolve(launcherRoot, "..", "backend", "shared", "config.py"),
  resolve(launcherRoot, "..", "backend", "shared", "luoke_macro.py"),
  resolve(launcherRoot, "..", "backend", "shared", "runtime_io.py"),
];

const backendTargets = [
  {
    id: "solo",
    specFile: "SoloBowBackend.spec",
    sourceFiles: [
      resolve(launcherRoot, "..", "backend", "solo", "luoke_macro_hotkey.py"),
      ...sharedSourceFiles,
      resolve(launcherRoot, "SoloBowBackend.spec"),
    ],
    outputFile: resolve(
      launcherRoot,
      "artifacts",
      "backend",
      "SoloBowBackend",
      "SoloBowBackend.exe"
    ),
    workPath: "build_backend_solo",
  },
  {
    id: "double",
    specFile: "DoubleBowBackend.spec",
    sourceFiles: [
      resolve(launcherRoot, "..", "backend", "double", "luoke_macro_hotkey_double.py"),
      ...sharedSourceFiles,
      resolve(launcherRoot, "DoubleBowBackend.spec"),
    ],
    outputFile: resolve(
      launcherRoot,
      "artifacts",
      "backend",
      "DoubleBowBackend",
      "DoubleBowBackend.exe"
    ),
    workPath: "build_backend_double",
  },
  {
    id: "doubleLaugh",
    specFile: "DoubleLaughBowBackend.spec",
    sourceFiles: [
      resolve(launcherRoot, "..", "backend", "doubleLaugh", "luoke_macro_hotkey_double_laugh.py"),
      ...sharedSourceFiles,
      resolve(launcherRoot, "DoubleLaughBowBackend.spec"),
    ],
    outputFile: resolve(
      launcherRoot,
      "artifacts",
      "backend",
      "DoubleLaughBowBackend",
      "DoubleLaughBowBackend.exe"
    ),
    workPath: "build_backend_double_laugh",
  },
];

function getMtimeMs(filePath) {
  return statSync(filePath).mtimeMs;
}

function shouldRebuildBackend(target) {
  if (forceRebuild || !existsSync(target.outputFile)) {
    return true;
  }

  const outputMtimeMs = getMtimeMs(target.outputFile);
  return target.sourceFiles.some((filePath) => getMtimeMs(filePath) > outputMtimeMs);
}

const targetsToBuild = backendTargets.filter(shouldRebuildBackend);

if (!targetsToBuild.length) {
  console.log("Bundled backend builds are up to date, skipping PyInstaller rebuild.");
  process.exit(0);
}

for (const target of targetsToBuild) {
  const result = spawnSync(
    "pyinstaller",
    [target.specFile, "--distpath", "artifacts/backend", "--workpath", target.workPath, "--noconfirm"],
    {
      cwd: launcherRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    }
  );

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }

  if (typeof result.status !== "number") {
    process.exit(1);
  }
}
