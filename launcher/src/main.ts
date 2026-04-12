import { app, BrowserWindow, ipcMain, Menu } from "electron";
import { execFile, execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const launcherRoot = path.resolve(__dirname, "..");
const sourceWorkspaceRoot = path.resolve(launcherRoot, "..");
const bundledBackendName = "SoloBowBackend.exe";
const runtimeDirName = "LuokeMacroHotkey";
const runtimeStatusFileName = "launcher_status.json";
const runtimeCommandFileName = "launcher_command.json";
const snapshotPollMs = 700;

const defaultHint =
  "先用鼠标选中需要运行脚本的窗口，再按 F8 开始或暂停；按 F9 退出整个脚本。";
const defaultHotkeys = [
  { key: "F8", description: "开始 / 暂停" },
  { key: "F9", description: "退出脚本" },
];

type LaunchKind = "exe" | "python" | "missing";
type LogLevel = "info" | "success" | "warn" | "error";

type HotkeyInfo = {
  key: string;
  description: string;
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
};

type LaunchTarget = {
  kind: LaunchKind;
  label: string;
  targetPath: string;
  commandPath: string;
  args: string[];
};

type ActionResult = {
  ok: boolean;
  message: string;
  state: LauncherState;
};

let mainWindow: BrowserWindow | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let logSequence = 1;
let lastBroadcastSignature = "";
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
};

function nowLabel(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function getStatusFilePath(): string {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, runtimeDirName, runtimeStatusFileName);
}

function getCommandFilePath(): string {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, runtimeDirName, runtimeCommandFileName);
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

function resolveBundledBackend(): string | null {
  if (!app.isPackaged) {
    return null;
  }
  const backendPath = path.join(process.resourcesPath, "backend", bundledBackendName);
  return existsSync(backendPath) ? backendPath : null;
}

function resolveTarget(): LaunchTarget {
  const bundledBackend = resolveBundledBackend();
  if (bundledBackend) {
    return {
      kind: "exe",
      label: "内置脚本后端",
      targetPath: bundledBackend,
      commandPath: bundledBackend,
      args: [],
    };
  }

  const scriptPath = path.join(sourceWorkspaceRoot, "backend", "luoke_macro_hotkey.py");
  if (existsSync(scriptPath)) {
    const pythonCommand = existsOnPath("py") ? "py" : existsOnPath("python") ? "python" : "";
    if (pythonCommand) {
      return {
        kind: "python",
        label: "Python 脚本后端",
        targetPath: scriptPath,
        commandPath: pythonCommand,
        args: pythonCommand === "py" ? ["-3", scriptPath] : [scriptPath],
      };
    }
  }

  return {
    kind: "missing",
    label: "未找到脚本后端",
    targetPath: "",
    commandPath: "",
    args: [],
  };
}

function applyIdleSnapshot(target: LaunchTarget): LauncherState {
  const launchingPidAlive = state.phase === "launching" && state.pid ? isPidAlive(state.pid) : false;
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
  });
}

function readRuntimePayload(): RuntimeStatusPayload | null {
  const statusFilePath = getStatusFilePath();
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

async function waitForRuntimeReady(timeoutMs: number): Promise<RuntimeStatusPayload | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runtime = readRuntimePayload();
    if (runtime && getRuntimePid(runtime)) {
      return runtime;
    }
    await sleep(220);
  }
  return readRuntimePayload();
}

async function waitForRuntimeExit(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runtime = readRuntimePayload();
    if (!runtime) {
      return true;
    }
    const runtimePid = getRuntimePid(runtime);
    if (runtime.phase === "exited") {
      return true;
    }
    if (runtimePid && !isPidAlive(runtimePid)) {
      return true;
    }
    await sleep(220);
  }
  return false;
}

function refreshRuntimeSnapshot(): LauncherState {
  const target = resolveTarget();
  const runtime = readRuntimePayload();

  if (!runtime) {
    setLogs([]);
    return applyIdleSnapshot(target);
  }

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
    getStatusFilePath(),
    "--command-file",
    getCommandFilePath(),
  ];
}

async function launchWithPowerShell(target: LaunchTarget): Promise<number> {
  const args = launchArguments(target);
  const startProcessCommand = [
    `Start-Process -FilePath '${target.commandPath.replace(/'/g, "''")}'`,
    `-WorkingDirectory '${getWorkingDirectory().replace(/'/g, "''")}'`,
    args.length ? `-ArgumentList ${args.map((arg) => `'${arg.replace(/'/g, "''")}'`).join(", ")}` : "",
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
    await sleep(180);
  }
  return !isPidAlive(pid);
}

function writeCommandFile(command: "stop"): void {
  const commandFilePath = getCommandFilePath();
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

  if (state.running && state.pid) {
    return {
      ok: true,
      message: `脚本已经在运行，PID ${state.pid}`,
      state: { ...state },
    };
  }

  const target = resolveTarget();
  if (target.kind === "missing") {
    applyIdleSnapshot(target);
    pushLocalLog("没有找到可运行的脚本后端。", "error");
    return {
      ok: false,
      message: "没有找到可运行的脚本后端。",
      state: { ...state },
    };
  }

  try {
    const statusFilePath = getStatusFilePath();
    if (existsSync(statusFilePath)) {
      unlinkSync(statusFilePath);
    }
    const commandFilePath = getCommandFilePath();
    if (existsSync(commandFilePath)) {
      unlinkSync(commandFilePath);
    }
  } catch {
    // Ignore stale status-file cleanup errors.
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
    });
    await waitForRuntimeReady(8000);
    refreshRuntimeSnapshot();
    return {
      ok: true,
      message: `已启动 ${target.label}`,
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

  const runtimeBefore = readRuntimePayload();
  const pid = state.pid ?? getRuntimePid(runtimeBefore);
  const hasLiveRuntime =
    Boolean(runtimeBefore) &&
    runtimeBefore?.phase !== "exited" &&
    (!getRuntimePid(runtimeBefore) || isPidAlive(getRuntimePid(runtimeBefore) as number));

  if (!pid && !hasLiveRuntime) {
    return {
      ok: true,
      message: "脚本未运行",
      state: { ...state },
    };
  }

  try {
    writeCommandFile("stop");
    setState({
      running: false,
      status: "退出中",
      phase: "stopping",
      updatedAt: Date.now(),
    });
    let stopped = await waitForRuntimeExit(7000);
    if (!stopped && pid && isPidAlive(pid)) {
      await stopWithPowerShell(pid);
      stopped = await waitForRuntimeExit(5000) || (await waitForProcessExit(pid, 3000));
    }
    refreshRuntimeSnapshot();
    pushLocalLog(stopped ? "脚本已关闭" : "脚本关闭请求已发送", "info");
    return {
      ok: true,
      message: stopped ? "脚本已关闭" : "脚本关闭请求已发送",
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
    title: "SoloBow",
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
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("launcher:get-snapshot", async () => ({
  state: refreshRuntimeSnapshot(),
  logs: [...logs],
}));

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
