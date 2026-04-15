import { app, BrowserWindow, ipcMain, Menu } from "electron";
import { execFile, execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const launcherRoot = path.resolve(__dirname, "..");
const sourceWorkspaceRoot = path.resolve(launcherRoot, "..");
const runtimeDirName = "LuokeMacroHotkey";
const snapshotPollMs = 700;
const runtimeExitPollMs = 60;
const gracefulStopTimeoutMs = 450;
const forcedStopTimeoutMs = 1200;
const processExitPollMs = 60;

const defaultHint =
  "先用鼠标选中需要运行脚本的窗口，再按 F8 开始或暂停；按 F9 退出整个脚本。";
const defaultHotkeys = [
  { key: "F8", description: "开始 / 暂停" },
  { key: "F9", description: "退出脚本" },
];

type LaunchKind = "exe" | "python" | "missing";
type LogLevel = "info" | "success" | "warn" | "error";
type ScriptVariant = "solo" | "double" | "doubleLaugh";

type HotkeyInfo = {
  key: string;
  description: string;
};

type VariantConfig = {
  label: string;
  statusFileName: string;
  commandFileName: string;
  sourceScriptRelativePath: string[];
  bundledBackendName: string;
  bundledBackendDirName: string;
};

type LogEntry = {
  id: number;
  level: LogLevel;
  message: string;
  time: string;
  cycle?: number;
  timestampMs?: number;
};

type RuntimeLogEntry = Partial<LogEntry> & {
  timestamp_ms?: number;
};

type RuntimeStatusPayload = {
  pid?: number;
  started_at_ms?: number;
  updated_at_ms?: number;
  phase?: string;
  status_label?: string;
  running?: boolean;
  cycle?: number;
  hint?: string;
  hotkeys?: HotkeyInfo[];
  logs?: RuntimeLogEntry[];
};

type LauncherState = {
  running: boolean;
  status: string;
  targetLabel: string;
  targetPath: string;
  pid: number | null;
  startedAt: number | null;
  updatedAt: number | null;
  launchKind: LaunchKind;
  cycle: number;
  phase: string;
  hint: string;
  hotkeys: HotkeyInfo[];
  selectedVariant: ScriptVariant;
  activeVariant: ScriptVariant | null;
};

type LaunchTarget = {
  variant: ScriptVariant;
  variantLabel: string;
  kind: LaunchKind;
  label: string;
  targetPath: string;
  commandPath: string;
  args: string[];
  processName: string;
  statusFilePath: string;
  commandFilePath: string;
};

type ActionResult = {
  ok: boolean;
  message: string;
  state: LauncherState;
};

const variantConfigs: Record<ScriptVariant, VariantConfig> = {
  solo: {
    label: "小号单人鞠躬模式",
    statusFileName: "launcher_status.json",
    commandFileName: "launcher_command.json",
    sourceScriptRelativePath: ["backend", "solo", "luoke_macro_hotkey.py"],
    bundledBackendName: "SoloBowBackend.exe",
    bundledBackendDirName: "SoloBowBackend",
  },
  double: {
    label: "双人鞠躬跳模式",
    statusFileName: "launcher_status_double.json",
    commandFileName: "launcher_command_double.json",
    sourceScriptRelativePath: ["backend", "double", "luoke_macro_hotkey_double.py"],
    bundledBackendName: "DoubleBowBackend.exe",
    bundledBackendDirName: "DoubleBowBackend",
  },
  doubleLaugh: {
    label: "双人大笑模式",
    statusFileName: "launcher_status_double_laugh.json",
    commandFileName: "launcher_command_double_laugh.json",
    sourceScriptRelativePath: ["backend", "doubleLaugh", "luoke_macro_hotkey_double_laugh.py"],
    bundledBackendName: "DoubleLaughBowBackend.exe",
    bundledBackendDirName: "DoubleLaughBowBackend",
  },
};

const scriptVariants = Object.keys(variantConfigs) as ScriptVariant[];
const defaultVariant: ScriptVariant = "solo";

let mainWindow: BrowserWindow | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let logSequence = 1;
let lastBroadcastSignature = "";
let isWindowClosing = false;
const launcherSessionStartedAtMs = Date.now();

const logs: LogEntry[] = [];
const state: LauncherState = {
  running: false,
  status: "等待启动",
  targetLabel: "检测中",
  targetPath: "",
  pid: null,
  startedAt: null,
  updatedAt: null,
  launchKind: "missing",
  cycle: 0,
  phase: "idle",
  hint: defaultHint,
  hotkeys: defaultHotkeys,
  selectedVariant: defaultVariant,
  activeVariant: null,
};

function nowLabel(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function getVariantConfig(variant: ScriptVariant): VariantConfig {
  return variantConfigs[variant];
}

function isScriptVariant(value: unknown): value is ScriptVariant {
  return typeof value === "string" && value in variantConfigs;
}

function getStatusFilePath(variant: ScriptVariant): string {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, runtimeDirName, getVariantConfig(variant).statusFileName);
}

function getCommandFilePath(variant: ScriptVariant): string {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, runtimeDirName, getVariantConfig(variant).commandFileName);
}

function getVisibleAppDir(): string {
  if (!app.isPackaged) {
    return sourceWorkspaceRoot;
  }
  return process.env.PORTABLE_EXECUTABLE_DIR ?? path.dirname(process.execPath);
}

function getWorkingDirectory(): string {
  return getVisibleAppDir();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setState(patch: Partial<LauncherState>): LauncherState {
  Object.assign(state, patch);
  broadcastSnapshot();
  return { ...state };
}

function setLogs(nextLogs: RuntimeLogEntry[]): void {
  const sessionLogs = nextLogs.filter(
    (entry) => typeof entry.timestamp_ms === "number" && entry.timestamp_ms >= launcherSessionStartedAtMs
  );
  logs.splice(
    0,
    logs.length,
    ...sessionLogs.slice(0, 30).map((entry) => ({
      id: logSequence++,
      level: (entry.level as LogLevel) ?? "info",
      message: entry.message ?? "",
      time: entry.time ?? nowLabel(),
      cycle: typeof entry.cycle === "number" ? entry.cycle : undefined,
      timestampMs: typeof entry.timestamp_ms === "number" ? entry.timestamp_ms : undefined,
    }))
  );
  broadcastSnapshot();
}

function pushLocalLog(message: string, level: LogLevel = "info", cycle?: number): void {
  logs.unshift({
    id: logSequence++,
    level,
    message,
    time: nowLabel(),
    cycle,
  });
  if (logs.length > 30) {
    logs.pop();
  }
  broadcastSnapshot();
}

function broadcastSnapshot(): void {
  const payload = {
    state: { ...state },
    logs: [...logs],
  };
  const signature = JSON.stringify({
    state: payload.state,
    logs: payload.logs.map(({ id, ...entry }) => entry),
  });
  if (signature === lastBroadcastSignature) {
    return;
  }
  lastBroadcastSignature = signature;
  mainWindow?.webContents.send("launcher:snapshot", payload);
}

function existsOnPath(command: string): boolean {
  try {
    execFileSync("where", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

function isLauncherBackendActive(currentState: LauncherState = state): boolean {
  return currentState.pid !== null && currentState.phase !== "exited" && currentState.phase !== "missing";
}

function getVariantOrder(preferredVariant: ScriptVariant): ScriptVariant[] {
  return [preferredVariant, ...scriptVariants.filter((variant) => variant !== preferredVariant)];
}

function resolveBundledBackend(variant: ScriptVariant): string | null {
  if (!app.isPackaged) {
    return null;
  }

  const config = getVariantConfig(variant);
  const backendPath = path.join(
    process.resourcesPath,
    "backend",
    config.bundledBackendDirName,
    config.bundledBackendName
  );
  return existsSync(backendPath) ? backendPath : null;
}

function resolveTarget(variant: ScriptVariant): LaunchTarget {
  const config = getVariantConfig(variant);
  const bundledBackend = resolveBundledBackend(variant);
  if (bundledBackend) {
    return {
      variant,
      variantLabel: config.label,
      kind: "exe",
      label: `${config.label} · 内置脚本后端`,
      targetPath: bundledBackend,
      commandPath: bundledBackend,
      args: [],
      processName: config.bundledBackendName,
      statusFilePath: getStatusFilePath(variant),
      commandFilePath: getCommandFilePath(variant),
    };
  }

  const scriptPath = path.join(sourceWorkspaceRoot, ...config.sourceScriptRelativePath);
  if (existsSync(scriptPath)) {
    const pythonCommand = existsOnPath("pythonw")
      ? "pythonw"
      : existsOnPath("pyw")
        ? "pyw"
        : existsOnPath("py")
          ? "py"
          : existsOnPath("python")
            ? "python"
            : "";
    if (pythonCommand) {
      return {
        variant,
        variantLabel: config.label,
        kind: "python",
        label: `${config.label} · Python 脚本后端`,
        targetPath: scriptPath,
        commandPath: pythonCommand,
        args: pythonCommand === "py" ? ["-3", scriptPath] : [scriptPath],
        processName: path.basename(
          pythonCommand === "py"
            ? "py.exe"
            : pythonCommand === "pythonw"
              ? "pythonw.exe"
              : pythonCommand
        ),
        statusFilePath: getStatusFilePath(variant),
        commandFilePath: getCommandFilePath(variant),
      };
    }
  }

  return {
    variant,
    variantLabel: config.label,
    kind: "missing",
    label: `${config.label} · 未找到脚本后端`,
    targetPath: "",
    commandPath: "",
    args: [],
    processName: "",
    statusFilePath: getStatusFilePath(variant),
    commandFilePath: getCommandFilePath(variant),
  };
}

function applyIdleSnapshot(target: LaunchTarget, selectedVariant: ScriptVariant): LauncherState {
  const launchingSameVariant = state.phase === "launching" && state.activeVariant === selectedVariant && state.pid;
  const launchingPidAlive = Boolean(launchingSameVariant && isPidAlive(state.pid as number));
  const nextStatus = target.kind === "missing" ? "未找到脚本" : launchingPidAlive ? "启动中" : "等待启动";

  return setState({
    running: false,
    status: nextStatus,
    targetLabel: target.label,
    targetPath: target.targetPath,
    pid: launchingPidAlive ? state.pid : null,
    startedAt: launchingPidAlive ? state.startedAt : null,
    updatedAt: launchingPidAlive ? Date.now() : state.updatedAt,
    launchKind: target.kind,
    cycle: 0,
    phase: target.kind === "missing" ? "missing" : launchingPidAlive ? "launching" : "idle",
    hint: defaultHint,
    hotkeys: defaultHotkeys,
    selectedVariant,
    activeVariant: launchingPidAlive ? selectedVariant : null,
  });
}

function readRuntimePayload(variant: ScriptVariant): RuntimeStatusPayload | null {
  const statusFilePath = getStatusFilePath(variant);
  if (!existsSync(statusFilePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(statusFilePath, "utf-8")) as RuntimeStatusPayload;
  } catch {
    return null;
  }
}

function getRuntimePid(runtime: RuntimeStatusPayload | null): number | null {
  return typeof runtime?.pid === "number" ? runtime.pid : null;
}

function isRuntimeReady(runtime: RuntimeStatusPayload | null): boolean {
  const pid = getRuntimePid(runtime);
  if (!pid || !isPidAlive(pid)) {
    return false;
  }

  return (runtime?.phase ?? "") !== "elevating";
}

function findActiveRuntime(
  preferredVariant: ScriptVariant
): { variant: ScriptVariant; runtime: RuntimeStatusPayload } | null {
  for (const variant of getVariantOrder(preferredVariant)) {
    const runtime = readRuntimePayload(variant);
    const pid = getRuntimePid(runtime);
    if (runtime && pid && isPidAlive(pid)) {
      return { variant, runtime };
    }
  }

  return null;
}

function getStopCandidatePids(runtime: RuntimeStatusPayload | null): number[] {
  const candidates = [getRuntimePid(runtime), state.pid].filter(
    (pid): pid is number => typeof pid === "number" && pid > 0
  );
  return [...new Set(candidates)];
}

async function discoverBackendPids(target: LaunchTarget): Promise<number[]> {
  if (target.kind === "missing") {
    return [];
  }

  const script = `
$targetPath = ${JSON.stringify(target.targetPath)};
$processName = ${JSON.stringify(target.processName)};
$kind = ${JSON.stringify(target.kind)};
if ($kind -eq 'exe') {
  Get-CimInstance Win32_Process -Filter "Name = '$processName'" |
    Select-Object -ExpandProperty ProcessId
} else {
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -in @('python.exe', 'pythonw.exe', 'py.exe') -and
      $_.CommandLine -and
      $_.CommandLine.Contains($targetPath)
    } |
    Select-Object -ExpandProperty ProcessId
}
`.trim();

  try {
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { cwd: getWorkingDirectory(), windowsHide: true }
    );

    return [
      ...new Set(
        stdout
          .split(/\r?\n/)
          .map((line) => Number.parseInt(line.trim(), 10))
          .filter((pid): pid is number => Number.isFinite(pid) && pid > 0)
      ),
    ];
  } catch {
    return [];
  }
}

async function waitForRuntimeReady(
  variant: ScriptVariant,
  timeoutMs: number
): Promise<RuntimeStatusPayload | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runtime = readRuntimePayload(variant);
    if (isRuntimeReady(runtime)) {
      return runtime;
    }
    await sleep(220);
  }
  const runtime = readRuntimePayload(variant);
  return isRuntimeReady(runtime) ? runtime : null;
}

async function waitForRuntimeExit(
  variant: ScriptVariant,
  timeoutMs: number,
  candidatePids: number[] = []
): Promise<boolean> {
  const observedPids = new Set(candidatePids.filter((pid) => pid > 0));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runtime = readRuntimePayload(variant);
    const runtimePid = getRuntimePid(runtime);
    if (runtimePid) {
      observedPids.add(runtimePid);
    }
    const aliveObservedPid = [...observedPids].some((pid) => isPidAlive(pid));

    if (!runtime) {
      if (!aliveObservedPid) {
        return true;
      }
      await sleep(runtimeExitPollMs);
      continue;
    }

    if (runtime.phase === "exited" && !aliveObservedPid) {
      return true;
    }

    if (!aliveObservedPid && (!runtimePid || !isPidAlive(runtimePid))) {
      return true;
    }

    await sleep(runtimeExitPollMs);
  }

  const runtime = readRuntimePayload(variant);
  const runtimePid = getRuntimePid(runtime);
  const aliveObservedPid = [...observedPids].some((pid) => isPidAlive(pid));
  if (!runtime) {
    return !aliveObservedPid;
  }
  return (runtime.phase === "exited" || !runtimePid || !isPidAlive(runtimePid)) && !aliveObservedPid;
}

function refreshRuntimeSnapshot(): LauncherState {
  const activeRuntime = findActiveRuntime(state.activeVariant ?? state.selectedVariant);

  if (!activeRuntime) {
    setLogs([]);
    return applyIdleSnapshot(resolveTarget(state.selectedVariant), state.selectedVariant);
  }

  const { variant, runtime } = activeRuntime;
  const target = resolveTarget(variant);
  let pid = typeof runtime.pid === "number" ? runtime.pid : null;
  const pidAlive = pid ? isPidAlive(pid) : false;
  let running = Boolean(runtime.running) && pidAlive;
  let phase = runtime.phase ?? "idle";
  let statusLabel = runtime.status_label ?? "等待启动";
  const runtimeStartedAt =
    typeof runtime.started_at_ms === "number" ? runtime.started_at_ms : null;
  const isCurrentSessionRuntime =
    runtimeStartedAt !== null && runtimeStartedAt >= launcherSessionStartedAtMs;

  if (pid && !pidAlive && phase !== "exited" && phase !== "error") {
    pid = null;
    running = false;
    phase = "exited";
    statusLabel = "已退出";
  }

  setLogs(Array.isArray(runtime.logs) ? runtime.logs : []);
  return setState({
    running,
    status: statusLabel,
    targetLabel: target.label,
    targetPath: target.targetPath,
    pid,
    startedAt: runtimeStartedAt,
    updatedAt: typeof runtime.updated_at_ms === "number" ? runtime.updated_at_ms : Date.now(),
    launchKind: target.kind,
    cycle: isCurrentSessionRuntime && typeof runtime.cycle === "number" ? runtime.cycle : 0,
    phase,
    hint: typeof runtime.hint === "string" && runtime.hint.trim() ? runtime.hint : defaultHint,
    hotkeys:
      Array.isArray(runtime.hotkeys) && runtime.hotkeys.length
        ? runtime.hotkeys.filter(
            (entry): entry is HotkeyInfo =>
              Boolean(entry) &&
              typeof entry.key === "string" &&
              typeof entry.description === "string"
          )
        : defaultHotkeys,
    selectedVariant: variant,
    activeVariant: pidAlive ? variant : null,
  });
}

function startPolling(): void {
  if (pollTimer) {
    return;
  }
  pollTimer = setInterval(() => {
    refreshRuntimeSnapshot();
  }, snapshotPollMs);
}

function launchArguments(target: LaunchTarget): string[] {
  return [
    ...target.args,
    "--status-file",
    target.statusFilePath,
    "--command-file",
    target.commandFilePath,
  ];
}

async function launchWithPowerShell(target: LaunchTarget): Promise<number> {
  const args = launchArguments(target);
  const startProcessCommand = [
    `Start-Process -FilePath '${target.commandPath.replace(/'/g, "''")}'`,
    `-WorkingDirectory '${getWorkingDirectory().replace(/'/g, "''")}'`,
    args.length ? `-ArgumentList ${args.map((arg) => `'${arg.replace(/'/g, "''")}'`).join(", ")}` : "",
    "-WindowStyle Hidden",
    "-Verb RunAs -PassThru",
  ]
    .filter(Boolean)
    .join(" ");
  const command = `$p = ${startProcessCommand}; $p.Id`;

  const { stdout } = await execFileAsync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { cwd: getWorkingDirectory(), windowsHide: true }
  );

  const pid = Number.parseInt(stdout.trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error("没有拿到新的进程号");
  }
  return pid;
}

async function stopWithPowerShell(pid: number): Promise<void> {
  const command = [
    "Start-Process -FilePath 'cmd.exe'",
    `-ArgumentList '/c', 'taskkill /PID ${pid} /T /F'`,
    "-Verb RunAs -Wait -WindowStyle Hidden",
  ].join(" ");

  await execFileAsync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { cwd: getWorkingDirectory(), windowsHide: true }
  );
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await sleep(processExitPollMs);
  }
  return !isPidAlive(pid);
}

function writeCommandFile(variant: ScriptVariant, command: "stop" | "f9"): void {
  const commandFilePath = getCommandFilePath(variant);
  const commandDir = path.dirname(commandFilePath);
  if (!existsSync(commandDir)) {
    mkdirSync(commandDir, { recursive: true });
  }
  const tempPath = `${commandFilePath}.tmp`;
  writeFileSync(
    tempPath,
    JSON.stringify(
      {
        command,
        issued_at_ms: Date.now(),
      },
      null,
      0
    ),
    "utf-8"
  );
  try {
    unlinkSync(commandFilePath);
  } catch {
    // Ignore missing stale command file.
  }
  renameSync(tempPath, commandFilePath);
}

async function startTarget(): Promise<ActionResult> {
  refreshRuntimeSnapshot();

  if (isLauncherBackendActive(state) && state.pid) {
    const activeLabel = getVariantConfig(state.activeVariant ?? state.selectedVariant).label;
    return {
      ok: true,
      message: `${activeLabel}已经在运行，PID ${state.pid}`,
      state: { ...state },
    };
  }

  const target = resolveTarget(state.selectedVariant);
  if (target.kind === "missing") {
    applyIdleSnapshot(target, state.selectedVariant);
    pushLocalLog(`没有找到${target.variantLabel}可运行的脚本后端。`, "error");
    return {
      ok: false,
      message: `没有找到${target.variantLabel}可运行的脚本后端。`,
      state: { ...state },
    };
  }

  try {
    if (existsSync(target.statusFilePath)) {
      unlinkSync(target.statusFilePath);
    }
    if (existsSync(target.commandFilePath)) {
      unlinkSync(target.commandFilePath);
    }
  } catch {
    // Ignore stale runtime-file cleanup errors.
  }
  setLogs([]);

  try {
    const pid = await launchWithPowerShell(target);
    setState({
      running: false,
      status: "启动中",
      targetLabel: target.label,
      targetPath: target.targetPath,
      pid,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      launchKind: target.kind,
      cycle: 0,
      phase: "launching",
      hint: defaultHint,
      hotkeys: defaultHotkeys,
      selectedVariant: target.variant,
      activeVariant: target.variant,
    });
    const runtime = await waitForRuntimeReady(target.variant, 12000);
    refreshRuntimeSnapshot();
    if (!runtime) {
      const message = `${target.variantLabel}启动请求已发出，请确认管理员权限提示是否已允许。`;
      pushLocalLog(message, "warn");
      return {
        ok: false,
        message,
        state: { ...state },
      };
    }
    return {
      ok: true,
      message: `已启动${target.variantLabel}`,
      state: { ...state },
    };
  } catch (error) {
    const message = (error as Error).message || "未知错误";
    refreshRuntimeSnapshot();
    pushLocalLog(`启动失败：${message}`, "error");
    return {
      ok: false,
      message: `启动失败：${message}`,
      state: { ...state },
    };
  }
}

async function stopTarget(): Promise<ActionResult> {
  refreshRuntimeSnapshot();

  const activeVariant = state.activeVariant ?? state.selectedVariant;
  const target = resolveTarget(activeVariant);
  const runtimeBefore = readRuntimePayload(activeVariant);
  const discoveredPids = await discoverBackendPids(target);
  const candidatePids = [...new Set([...getStopCandidatePids(runtimeBefore), ...discoveredPids])];
  const pid = candidatePids[0] ?? null;
  const hasLiveRuntime =
    candidatePids.some((candidatePid) => isPidAlive(candidatePid)) ||
    (Boolean(runtimeBefore) &&
      runtimeBefore?.phase !== "exited" &&
      (!getRuntimePid(runtimeBefore) || isPidAlive(getRuntimePid(runtimeBefore) as number)));

  if (!pid && !hasLiveRuntime) {
    try {
      unlinkSync(target.commandFilePath);
    } catch {
      // Ignore stale command-file cleanup errors.
    }
    return {
      ok: true,
      message: "脚本未运行",
      state: { ...state },
    };
  }

  try {
    writeCommandFile(activeVariant, "f9");
    setState({
      running: false,
      status: "退出中",
      phase: "stopping",
      updatedAt: Date.now(),
      activeVariant,
    });
    let stopped = await waitForRuntimeExit(activeVariant, gracefulStopTimeoutMs, candidatePids);
    if (!stopped) {
      for (const candidatePid of candidatePids) {
        if (!isPidAlive(candidatePid)) {
          continue;
        }
        await stopWithPowerShell(candidatePid);
        stopped =
          (await waitForRuntimeExit(activeVariant, forcedStopTimeoutMs, candidatePids)) ||
          (await waitForProcessExit(candidatePid, forcedStopTimeoutMs));
        if (stopped) {
          break;
        }
      }
    }
    refreshRuntimeSnapshot();
    const message = stopped ? `${target.variantLabel}已关闭` : `${target.variantLabel}关闭请求已发送`;
    pushLocalLog(message, "info");
    return {
      ok: true,
      message,
      state: { ...state },
    };
  } catch (error) {
    const message = (error as Error).message || "未知错误";
    refreshRuntimeSnapshot();
    pushLocalLog(`关闭失败：${message}`, "error");
    return {
      ok: false,
      message: `关闭失败：${message}`,
      state: { ...state },
    };
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 880,
    height: 540,
    minWidth: 880,
    minHeight: 540,
    maxWidth: 880,
    maxHeight: 540,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "洛克王国脚本",
    backgroundColor: "#ece4d8",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.setMenuBarVisibility(false);
  void mainWindow.loadFile(path.join(launcherRoot, "index.html"));
  mainWindow.on("close", (event) => {
    if (isWindowClosing) {
      return;
    }

    event.preventDefault();
    isWindowClosing = true;
    void (async () => {
      try {
        await stopTarget();
      } finally {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.destroy();
        }
      }
    })();
  });
  mainWindow.on("closed", () => {
    isWindowClosing = false;
    mainWindow = null;
  });
}

ipcMain.handle("launcher:get-snapshot", async () => ({
  state: refreshRuntimeSnapshot(),
  logs: [...logs],
}));

ipcMain.handle("launcher:set-variant", async (_event, nextVariant: unknown) => {
  refreshRuntimeSnapshot();
  if (!isScriptVariant(nextVariant)) {
    throw new Error("Unknown script variant.");
  }
  if (isLauncherBackendActive(state)) {
    return {
      state: { ...state },
      logs: [...logs],
    };
  }
  return {
    state: applyIdleSnapshot(resolveTarget(nextVariant), nextVariant),
    logs: [...logs],
  };
});

ipcMain.handle("launcher:start", startTarget);
ipcMain.handle("launcher:stop", stopTarget);
ipcMain.handle("launcher:refresh-now", async () => ({
  state: refreshRuntimeSnapshot(),
  logs: [...logs],
}));

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  refreshRuntimeSnapshot();
  startPolling();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      broadcastSnapshot();
    }
  });
});

app.on("window-all-closed", () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
