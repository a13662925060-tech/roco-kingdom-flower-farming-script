# 新人接手 10 分钟速读版

## 一句话定位

这是一个 Windows 专用的洛克王国脚本项目：Electron 负责启动器界面、状态展示和打包，Python 负责真正的热键监听、窗口聚焦、按键注入、管理员提权和运行日志。

## 先记住这 5 件事

1. 真正的业务复杂度在 Python 后端，不在前端 UI。
2. 现在有 3 个模式：`solo`、`double`、`doubleLaugh`。
3. 三个模式入口已经很薄，公共逻辑主要在 `backend/shared/`。
4. launcher 和 backend 通过 `%LOCALAPPDATA%\LuokeMacroHotkey` 里的 JSON 文件通信。
5. 这个项目能跑，但核心文件还偏大，改动前要先分清层级。

## 最应该先看的文件

- `docs/project-handoff.md`
  完整交接说明，时间够的话先读它。
- `launcher/src/main.ts`
  Electron 主进程，负责启动、停止、模式路由、状态轮询和打包后路径识别。
- `launcher/src/renderer.tsx`
  前端界面，负责模式选择、启动按钮、状态卡片和日志展示。
- `backend/shared/luoke_macro.py`
  后端主运行引擎，负责 Win32、热键、宏执行、提权、日志和状态。
- `backend/shared/config.py`
  配置和步骤校验。
- `backend/shared/runtime_io.py`
  状态文件、命令文件和日志写入。
- `backend/solo/luoke_macro_hotkey.py`
- `backend/double/luoke_macro_hotkey_double.py`
- `backend/doubleLaugh/luoke_macro_hotkey_double_laugh.py`
  三个模式入口，只放默认步骤和文件名。

## 当前运行流程

用户在 launcher 中选择模式并点击“启动脚本”后：

1. `launcher/src/main.ts` 根据当前模式找到对应 backend。
2. 打包环境下优先运行内置 exe。
3. 开发环境下回退到 Python 脚本入口。
4. 通过 PowerShell `Start-Process -Verb RunAs` 请求管理员权限。
5. launcher 把状态文件和命令文件路径作为参数传给 backend。
6. backend 启动后写状态 JSON，并监听 F8/F9。
7. launcher 轮询状态 JSON，把状态和日志显示到界面。

## 模式怎么接进去的

launcher 里有一份模式配置：

- `solo`
  小号单人鞠躬模式
- `double`
  双人鞠躬跳模式
- `doubleLaugh`
  双人大笑模式

每个模式都有：

- 展示名称
- 状态文件名
- 命令文件名
- 源码模式入口脚本
- 打包后的 backend exe 名称
- 打包后的 backend 目录名

新增模式时，不要只改 UI。至少要同步检查：

- `launcher/src/main.ts`
- `launcher/src/renderer.tsx`
- `launcher/src/preload.ts`
- `launcher/package.json`
- `launcher/build-backend-if-needed.cjs`
- 新模式自己的 PyInstaller spec
- 新模式自己的 `backend/<variant>/...py`

## Launcher 与 Backend 的协议

通信靠两个文件：

- 状态文件：backend 写，launcher 读
- 命令文件：launcher 写，backend 读

常见状态字段包括：

- `pid`
- `started_at_ms`
- `updated_at_ms`
- `phase`
- `status_label`
- `running`
- `cycle`
- `focus_class`
- `target_hwnd`
- `logs`

常见命令字段包括：

- `command`
- `issued_at_ms`

当前命令主要是：

- `f9`
- `stop`

改协议字段前，一定要同时看 `backend/shared/runtime_io.py` 和 `launcher/src/main.ts`。

## 打包怎么做

在 `launcher/` 目录执行：

```powershell
npm run package:folder
```

这个命令会：

1. 编译 Electron 主进程和渲染层。
2. 检查三个 Python backend 是否需要重新 PyInstaller 打包。
3. 把 Electron、前端资源、三个 backend exe 和 `_internal` 资源打进 zip。

最终分享包在：

```text
launcher/release/
```

注意：打包成功只说明产物生成了，不代表热键、提权、窗口聚焦在目标机器上都验证过。

## 当前主要问题

### 1. 两个核心文件仍然太重

- `backend/shared/luoke_macro.py` 约 1000 行
- `launcher/src/main.ts` 约 845 行

它们分别是后端和 launcher 的复杂度中心，未来最值得拆。

### 2. 没有真正的自动化测试

目前主要靠：

- TypeScript 编译
- Electron build
- Python `py_compile`
- 手动运行和按热键验证

这对热键、提权、进程控制来说还不够。

### 3. 协议还偏隐式

状态 JSON 和命令 JSON 已经可用，但没有独立协议文档。字段变化很容易让前后端理解不一致。

### 4. 命名还有历史残留

产品现在叫“洛克刷花脚本”，但部分包名、描述、appId、spec 命名和文档仍有 `SoloBow` 阶段的遗留。

### 5. Windows 环境依赖强

后端依赖：

- Win32 API
- 管理员权限
- PowerShell
- 前台窗口
- 键盘钩子和按键注入

所以很多问题只能在 Windows 机器上完整复现。

## 改代码前的判断

先问自己 4 个问题：

1. 这是 UI 问题、launcher 进程问题，还是 backend 宏行为问题？
2. 这个改动是所有模式共用，还是只属于某一个模式？
3. 是否会影响状态 JSON 或命令 JSON？
4. 是否需要重新打包验证？

如果是所有模式共用，优先改 `backend/shared/`。

如果只是动作序列不同，优先改对应模式入口。

如果涉及启动、停止、模式切换、打包路径，优先改 `launcher/src/main.ts`。

## 最小验证清单

源码级修改后至少跑：

```powershell
cd launcher
npx tsc --project tsconfig.json --noEmit
npm run build
```

后端修改后在仓库根目录跑：

```powershell
py -3 -m py_compile backend/shared/config.py backend/shared/runtime_io.py backend/shared/luoke_macro.py backend/solo/luoke_macro_hotkey.py backend/double/luoke_macro_hotkey_double.py backend/doubleLaugh/luoke_macro_hotkey_double_laugh.py
```

打包相关修改后跑：

```powershell
cd launcher
npm run package:folder
```

手动验证重点：

- launcher 能打开
- 三个模式能切换
- 启动按钮能启动后端
- F8 能启动和暂停
- F9 能退出
- 前端日志能刷新
- 游戏窗口不应异常隐藏或闪烁

## 推荐接手顺序

1. 先读这份速读版。
2. 再读 `docs/project-handoff.md`。
3. 看 `launcher/src/main.ts` 的模式配置和 start/stop 流程。
4. 看 `backend/shared/luoke_macro.py` 的 `run_luoke_macro(...)`。
5. 看三个模式入口的默认步骤。
6. 最后再看 UI 和打包配置。

## 下一步最值得做

优先级建议：

1. 给 `backend/shared/config.py` 和 `runtime_io.py` 补测试。
2. 把 `backend/shared/luoke_macro.py` 继续拆成 Win32、提权、宏执行、热键模块。
3. 把 `launcher/src/main.ts` 拆出模式配置、状态轮询、进程控制。
4. 写一份正式的 launcher/backend JSON 协议文档。
5. 清理 `SoloBow` 历史命名和 README。

## 交接结论

这个项目不是坏项目。它已经能运行、能打包、三模式也统一到了同一个 launcher。

真正的问题是：核心复杂度还没拆干净，测试和协议文档还没跟上。

接手时最安全的策略是：保持现有行为稳定，先补文档和小测试，再逐步拆核心文件。
