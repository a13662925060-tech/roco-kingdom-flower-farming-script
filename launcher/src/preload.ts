import { contextBridge, ipcRenderer } from "electron";

type LaunchKind = "exe" | "python" | "missing";
type LogLevel = "info" | "success" | "warn" | "error";

type HotkeyInfo = {
  key: string;
  description: string;
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

type LogEntry = {
  id: number;
  level: LogLevel;
  message: string;
  time: string;
  cycle?: number;
};

type Snapshot = {
  state: LauncherState;
  logs: LogEntry[];
};

type ActionResult = {
  ok: boolean;
  message: string;
  state: LauncherState;
};

contextBridge.exposeInMainWorld("launcherApi", {
  getSnapshot: (): Promise<Snapshot> => ipcRenderer.invoke("launcher:get-snapshot"),
  start: (): Promise<ActionResult> => ipcRenderer.invoke("launcher:start"),
  stop: (): Promise<ActionResult> => ipcRenderer.invoke("launcher:stop"),
  refreshNow: (): Promise<Snapshot> => ipcRenderer.invoke("launcher:refresh-now"),
  onSnapshot: (callback: (snapshot: Snapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: Snapshot): void => {
      callback(snapshot);
    };
    ipcRenderer.on("launcher:snapshot", listener);
    return () => {
      ipcRenderer.removeListener("launcher:snapshot", listener);
    };
  },
});
