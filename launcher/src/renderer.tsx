import React, { startTransition, useDeferredValue, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

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

type PendingAction = "start" | "stop" | null;

declare global {
  interface Window {
    launcherApi: {
      getSnapshot: () => Promise<Snapshot>;
      start: () => Promise<ActionResult>;
      stop: () => Promise<ActionResult>;
      refreshNow: () => Promise<Snapshot>;
      onSnapshot: (callback: (snapshot: Snapshot) => void) => () => void;
    };
  }
}

const emptyState: LauncherState = {
  running: false,
  status: "等待启动",
  targetLabel: "脚本后端",
  targetPath: "",
  pid: null,
  startedAt: null,
  updatedAt: null,
  launchKind: "missing",
  cycle: 0,
  phase: "idle",
  hint: "先启动脚本，再切换到目标窗口后按 F8。",
  hotkeys: [],
};

const emptySnapshot: Snapshot = {
  state: emptyState,
  logs: [],
};

const hiddenLogFragments = [
  "按下 F8 开始时，会记录当前选中的前台窗口。",
  "请先用鼠标选中需要运行脚本的窗口，再按 F8 执行。",
  "F8：开始/暂停，F9：退出脚本",
];

function isBackendActive(state: LauncherState): boolean {
  return state.pid !== null && state.phase !== "exited" && state.phase !== "missing";
}

function getStatusHeadline(state: LauncherState): string {
  if (state.launchKind === "missing") {
    return "未找到脚本";
  }
  if (state.running) {
    return "运行中";
  }
  if (state.phase === "paused") {
    return "已暂停";
  }
  if (state.phase === "launching") {
    return "启动中";
  }
  if (state.phase === "exited") {
    return "已退出";
  }
  if (state.phase === "waiting_hotkey" || state.phase === "starting") {
    return "已启动";
  }
  return state.status || "等待启动";
}

function getStartLabel(state: LauncherState, isStarting: boolean): string {
  const backendActive = isBackendActive(state);

  if (state.launchKind === "missing") {
    return "未找到脚本";
  }
  if (isStarting) {
    return backendActive ? "关闭中..." : "启动中...";
  }
  if (backendActive) {
    return "关闭脚本";
  }
  if (state.phase === "launching") {
    return "启动中...";
  }
  return "启动脚本";
}

function getButtonLabel(state: LauncherState, pendingAction: PendingAction): string {
  if (pendingAction === "stop") {
    return "关闭中...";
  }
  if (pendingAction === "start") {
    return "启动中...";
  }
  return getStartLabel(state, false);
}

function makeOptimisticState(state: LauncherState, pendingAction: PendingAction): LauncherState {
  if (pendingAction === "start") {
    return {
      ...state,
      running: false,
      phase: "launching",
      status: "启动中",
      cycle: 0,
      updatedAt: Date.now(),
    };
  }

  if (pendingAction === "stop") {
    return {
      ...state,
      running: false,
      phase: "stopping",
      status: "退出中",
      updatedAt: Date.now(),
    };
  }

  return state;
}

function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const deferredLogs = useDeferredValue(snapshot.logs);
  const state = snapshot.state;
  const logs = deferredLogs
    .filter((entry) => !hiddenLogFragments.some((text) => entry.message.includes(text)))
    .slice(0, 20);
  const statusHeadline = getStatusHeadline(state);
  const backendActive = isBackendActive(state);

  useEffect(() => {
    let alive = true;

    const applySnapshot = (next: Snapshot): void => {
      if (!alive) {
        return;
      }
      startTransition(() => {
        setSnapshot(next);
      });
    };

    void window.launcherApi.getSnapshot().then(applySnapshot);
    const unsubscribe = window.launcherApi.onSnapshot(applySnapshot);

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  async function handleStart(): Promise<void> {
    if (pendingAction || state.launchKind === "missing") {
      return;
    }

    const action: PendingAction = backendActive ? "stop" : "start";
    setPendingAction(action);
    setSnapshot((current) => ({
      ...current,
      state: makeOptimisticState(current.state, action),
    }));

    try {
      let result: ActionResult;
      if (backendActive) {
        result = await window.launcherApi.stop();
      } else {
        result = await window.launcherApi.start();
      }
      setSnapshot((current) => ({
        ...current,
        state: result.state,
      }));
      const nextSnapshot = await window.launcherApi.refreshNow();
      setSnapshot(nextSnapshot);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <main className="app-shell">
      <section className="dashboard">
        <article className="card">
          <p className="eyebrow">Roco Kingdom Solo Bow Script</p>
          <h1 className="card-title">洛克王国单人鞠躬脚本</h1>
          <p className="card-subtitle">
            这个窗口只负责启动脚本和显示状态。真正的开始、暂停和退出，仍然通过键盘热键来控制。
          </p>

          <div className="steps">
            <div className="step-item">
              <span className="step-index">01</span>
              <div>
                <p className="step-title">先点启动脚本</p>
                <p className="step-copy">先让脚本进入待命状态。</p>
              </div>
            </div>
            <div className="step-item">
              <span className="step-index">02</span>
              <div>
                <p className="step-title">再选中目标窗口</p>
                <p className="step-copy">用鼠标点一下你要运行脚本的窗口。</p>
              </div>
            </div>
            <div className="step-item">
              <span className="step-index">03</span>
              <div>
                <p className="step-title">最后用热键控制</p>
                <p className="step-copy">F8 开始或暂停，F9 退出。</p>
              </div>
            </div>
          </div>

          <div className="button-wrap">
            <button
              className="start-button"
              disabled={pendingAction !== null || state.launchKind === "missing"}
              onClick={() => {
                void handleStart();
              }}
              type="button"
            >
              {getButtonLabel(state, pendingAction)}
            </button>
          </div>
        </article>

        <article className="card card--status">
          <div>
            <p className="eyebrow">Runtime</p>
            <h2 className="card-title">运行状态</h2>
          </div>

          <div className="status-grid">
            <div className="status-meta">
              <span className="status-meta-label">当前状态</span>
              <strong className="status-meta-value status-meta-value--small">{statusHeadline}</strong>
            </div>
            <div className="status-meta">
              <span className="status-meta-label">运行轮数</span>
              <strong className="status-meta-value">{state.cycle}</strong>
            </div>
          </div>

          <section className="log-block">
            <h3 className="log-title">日志</h3>
            <div className="log-panel">
              {logs.length ? (
                <div className="log-list">
                  {logs.map((entry) => (
                    <div className="log-row" key={entry.id}>
                      <div className="log-row-top">
                        <span className={`log-level log-level--${entry.level}`}></span>
                        <span className="log-time">{entry.time}</span>
                        {typeof entry.cycle === "number" && entry.cycle > 0 ? (
                          <span className="log-cycle">第 {entry.cycle} 轮</span>
                        ) : null}
                      </div>
                      <p className="log-message">{entry.message}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="log-empty">启动后这里会显示脚本状态和轮数变化。</div>
              )}
            </div>
          </section>
        </article>
      </section>
    </main>
  );
}

const container = document.getElementById("root");

if (!container) {
  throw new Error("Missing React root container.");
}

createRoot(container).render(<App />);
