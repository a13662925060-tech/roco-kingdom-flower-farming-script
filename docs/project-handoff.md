# 项目交接说明

## 项目定位

这个仓库是一个 Windows 专用的洛克王国脚本项目，产品形态是：

- Electron launcher 负责界面、启动、停止、状态展示和打包。
- Python backend 负责热键、窗口聚焦、按键注入、管理员提权、私有配置和运行状态写入。
- 三个模式 `solo`、`double`、`doubleLaugh` 现在都已经接到同一个 launcher 里。

当前项目已经从“多个大脚本平行发展”推进到了“共享引擎 + 多变体入口”的阶段，但还没有彻底完成模块化，所以它的可运行性和可维护性之间仍然存在明显张力。

## 当前结构

### 1. Launcher 层

- `launcher/src/main.ts`
  这是桌面端真正的控制中心。它负责：
  - 模式选择
  - 启动目标解析
  - 管理员提权启动
  - 运行状态轮询
  - 停止流程
  - 运行日志快照广播
  - 打包产物路径识别
- `launcher/src/renderer.tsx`
  负责固定尺寸窗口内的 UI、模式选择、启动按钮和日志显示。
- `launcher/src/preload.ts`
  提供渲染层可用的 IPC 接口。
- `launcher/styles.css`
  承担全部桌面界面样式。

### 2. Backend 共享层

- `backend/shared/config.py`
  负责配置结构、步骤规范化和 step 校验。
- `backend/shared/runtime_io.py`
  负责 LocalAppData 路径、状态文件、命令文件、原子写入和日志附加。
- `backend/shared/luoke_macro.py`
  负责：
  - Win32 API 调用
  - 模拟按键
  - 窗口前置
  - DPAPI 配置读写
  - 管理员权限提升
  - 热键钩子和轮询兜底
  - 宏线程与命令监听线程
  - 运行状态维护
  - stdout/stderr 重定向到前端日志

### 3. 变体入口层

- `backend/solo/luoke_macro_hotkey.py`
  小号单人鞠躬模式入口
- `backend/double/luoke_macro_hotkey_double.py`
  双人鞠躬跳模式入口
- `backend/doubleLaugh/luoke_macro_hotkey_double_laugh.py`
  双人大笑模式入口

这三个入口现在都很薄，主要只负责：

- 设定默认步骤
- 指定状态文件名和命令文件名
- 调用共享的 `run_luoke_macro(...)`

这说明“抽共享”的方向已经正确，但共享层还没有进一步拆分。

## 运行链路

### 1. 启动阶段

用户在 launcher 里选择模式并点击“启动脚本”后：

1. `launcher/src/main.ts` 根据模式解析目标后端。
2. 优先使用打包后的 backend exe。
3. 如果是源码模式，就回退到 Python 脚本入口。
4. 启动时通过 PowerShell `Start-Process -Verb RunAs` 请求管理员权限。
5. 启动参数中把 `status-file` 和 `command-file` 路径传给 backend。

### 2. 运行阶段

backend 启动后：

1. 初始化状态 JSON。
2. 启动宏线程。
3. 启动命令监听线程。
4. 安装 F8/F9 热键处理。
5. 把标准输出和错误输出重定向到运行状态日志。

launcher 则每隔一段时间轮询状态 JSON，并刷新 UI。

### 3. 交互协议

launcher 和 backend 目前使用两个 JSON 文件协作：

- 状态文件：backend 写，launcher 读
- 命令文件：launcher 写，backend 读

这个方案现在能用，但仍属于“代码约定优先、文档契约偏弱”的状态。

## 打包链路

打包主要在 `launcher/` 下完成：

- `build-backend-if-needed.cjs`
  负责检查共享层和各模式入口是否变更，并决定是否重打三个 backend exe
- `SoloBowBackend.spec`
- `DoubleBowBackend.spec`
- `DoubleLaughBowBackend.spec`
  负责 PyInstaller 后端构建
- `package.json`
  负责 Electron 构建、资源复制和最终 zip 产物

当前可分享产物已经可以打成 zip，并包含：

- 主程序 exe
- Electron 运行时资源
- 三个 backend exe 及其 `_internal` 目录

## 项目当前的优点

- 分层方向是对的，launcher 和 backend 的边界已经形成。
- 多模式已经接到统一界面里，而不是继续分裂成多个独立启动器。
- `backend/shared/config.py` 和 `backend/shared/runtime_io.py` 已经把最适合先抽的纯逻辑抽出来了。
- 三个模式入口已经明显变薄，后续继续收敛到共享运行引擎的成本下降了。
- 打包链路已经从“只支持单一模式”推进到“三模式可分发”。

## 当前的主要问题、缺陷和缺点

### 1. 共享核心文件仍然过重

最明显的问题仍然是：

- `backend/shared/luoke_macro.py` 约 1000 行
- `launcher/src/main.ts` 约 845 行

这两个文件都同时承担了太多职责。结果是：

- 改动一点功能，影响面很大
- 阅读成本很高
- 新接手的人不容易快速定位问题
- 回归验证只能靠人工经验

这是当前最核心的维护风险。

### 2. 自动化测试仍然缺失

目前仓库里没有真正成型的测试层。现有验证方式主要还是：

- `npx tsc --noEmit`
- `npm run build`
- `py -3 -m py_compile ...`
- 手工点界面、手工按 F8/F9

这对于一个包含热键、提权、进程控制、状态轮询和打包的项目来说，保护力度明显不够。

### 3. 文档和真实现状没有完全同步

目前文档层存在几个交接痛点：

- 根目录 `README.md` 还很短，而且更接近早期版本说明
- 计划文档写了很多“应该怎么做”，但没有一份完整的“现在已经是什么样了”的交接文档
- 当前产品名已经变成“洛克刷花脚本”，但仓库、描述、appId、历史命名里仍残留 `SoloBow`

这会让接手者在“旧命名”和“现命名”之间来回切换。

### 4. 命名和打包元信息仍然存在历史包袱

虽然主程序名已经改成中文，但下面这些地方还残留旧产品阶段的信息：

- `launcher/package.json` 里的 `description`
- `appId`
- 仓库中的 spec 文件命名
- `.gitignore` 里的旧 exe 和旧 spec 规则

这类问题不一定会立刻导致功能错误，但会显著拉低交接和维护体验。

### 5. 文件协议仍然偏“隐式”

状态 JSON 和命令 JSON 已经是一个稳定机制，但它们的问题在于：

- 结构没有单独的契约文档
- 字段语义更多是通过代码阅读得到
- launcher 与 backend 都各自持有一份协议理解

这会让未来改字段或加字段时更容易出隐性兼容问题。

### 6. Windows 专用且依赖管理员提权，迁移和测试成本高

项目深度依赖：

- Win32 API
- 前台窗口操作
- 模拟按键
- 管理员权限提升
- PowerShell 启动与结束流程

这意味着：

- 几乎无法在非 Windows 环境里完整验证
- 自动化测试很难做成真正端到端
- 出问题时更依赖本机环境和人工复现

### 7. 构建和历史产物容易混淆

仓库里既有源码目录，又有若干构建相关目录和历史打包痕迹，例如：

- `launcher/artifacts/backend/`
- `launcher/build_backend_*`
- `backend/doubleLaugh/build_pyinstaller/`

虽然其中一部分已在 `.gitignore` 中处理，但对第一次接手的人来说，仍然很容易分不清哪些是源码，哪些是构建产物，哪些是历史遗留。

### 8. 编码与终端显示问题还没有彻底解决

源文件大体已经在往 UTF-8 统一，但 Windows 终端仍然可能出现：

- 中文乱码
- emoji 输出失败
- PowerShell / Python / 编辑器 显示不一致

这不会总是影响产品功能，但会直接影响交接阅读体验和问题排查效率。

## 当前最适合交接时提前说明的事

### 1. 这是一个“能跑，但不宜大幅盲改”的项目

接手的人如果不了解结构，最容易犯的错误是：

- 直接在 `backend/shared/luoke_macro.py` 里做大改
- 直接在 `launcher/src/main.ts` 里边看边修
- 没有先理解协议就去改状态字段

这个项目更适合“先划层、再局部改”，不适合上来就重写。

### 2. 所有模式都应优先改共享层

现在三个模式入口已经足够薄，后续如果有公共行为变更，优先去改：

- `backend/shared/config.py`
- `backend/shared/runtime_io.py`
- `backend/shared/luoke_macro.py`

不要再回到“某个模式单独改一份逻辑”的方向。

### 3. 任何涉及状态字段、日志字段、命令文件的改动，都要同时看 launcher 和 backend

这是目前最典型的联动点，也是最容易出现“代码都能跑，但界面状态不对”的区域。

### 4. 打包成功不等于运行一定没问题

这个项目的打包验证只能证明：

- Electron 包能生成
- backend exe 能被带进去

但仍然不能替代：

- 管理员提权验证
- 热键验证
- 实际游戏窗口聚焦验证
- F8/F9 行为验证

## 推荐的交接顺序

如果让一个新同事接手，推荐顺序是：

1. 先读本文件。
2. 再读 `docs/priority-improvements.md`。
3. 再读 `docs/refactor-roadmap.md`。
4. 然后看 `launcher/src/main.ts`，理解启动和停止链路。
5. 再看 `backend/shared/luoke_macro.py`，理解 backend 主流程。
6. 最后再看三个模式入口文件。

这样进入状态最快，也最不容易被局部细节带偏。

## 建议的下阶段改进方向

如果交接后还会继续维护，这几个方向最值得优先推进：

1. 给 `config.py`、`runtime_io.py` 和 step 规范化补最小测试集。
2. 继续拆 `backend/shared/luoke_macro.py`，至少拆出：
   - Win32 调用层
   - 安全/提权层
   - 宏执行层
   - 热键处理层
3. 继续拆 `launcher/src/main.ts`，至少拆出：
   - variant 配置与 target 解析
   - runtime 轮询与状态归并
   - start/stop 进程控制
4. 清理命名遗留，把产品名、包名、描述、appId、忽略规则同步好。
5. 把 launcher/backend JSON 协议独立写成一份短文档。

## 交接结论

这个项目已经不是“混乱不可控”的状态，而是“方向正确、但重构尚未收口”的状态。

它的优点是：

- 功能已经成型
- 多模式已经统一
- 打包链路可用
- 共享层已经开始建立

它的主要问题是：

- 核心文件仍然过大
- 测试缺位
- 文档与命名未完全同步
- Windows/管理员权限/热键特性让维护成本天然偏高

所以最合适的交接结论不是“推翻重来”，而是：

- 保持现有产品行为稳定
- 围绕共享层继续拆
- 先补文档和小测试
- 再做更深的结构性重构
