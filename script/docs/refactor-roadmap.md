# 重构路线图

## 当前结构

这个项目已经有一个比较合理的产品分层：

- `launcher/` 负责桌面壳子、进程生命周期、打包和状态展示。
- `backend/solo/luoke_macro_hotkey.py` 负责单人脚本的热键、宏执行、运行状态、提权和配置处理。
- `backend/double/luoke_macro_hotkey_double.py` 是双开版本，目前主要通过复制整份后端脚本来维护。

现在最大的矛盾不是“完全没结构”，而是“结构有了，但后端单文件职责过重，而且双开版本开始靠复制维护”。

## 重构目标

1. 保持现有功能和用户体验稳定。
2. 缩小 `luoke_macro_hotkey.py` 的体积和职责范围。
3. 消除单人版和双开版之间的复制粘贴分叉。
4. 为后续增加更多宏模式留出扩展空间。
5. 尽量不破坏现在 Electron 和 Python 之间的通信协议。

## 目标后端结构

建议逐步演进到下面这种形态：

```text
backend/
  __init__.py
  shared/
    __init__.py
    config.py
    runtime_io.py
    security.py
    windows_api.py
    macro_engine.py
    hotkeys.py
  solo/
    __init__.py
    luoke_macro_hotkey.py
  double/
    luoke_macro_hotkey_double.py
```

每层建议承担的职责：

- `shared/config.py`
  - `MacroConfig`
  - 步骤校验
  - 配置序列化
- `shared/runtime_io.py`
  - 状态文件写入
  - 命令文件读取
  - 运行时文件清理
- `shared/security.py`
  - DPAPI 加解密
  - 隐私状态检查
  - 管理员权限提升
- `shared/windows_api.py`
  - Win32 ctypes 结构体和系统调用封装
  - 激活窗口
  - 模拟按键
- `shared/macro_engine.py`
  - `run_once`
  - 睡眠中断逻辑
  - 动作调度
  - 宏执行主循环
- `shared/hotkeys.py`
  - F8/F9 状态切换
  - 键盘钩子和轮询兜底

## 分阶段路线

### 第一阶段：先抽纯逻辑

优先把低风险、纯逻辑、最不依赖 Win32 的部分抽出来：

- 默认路径计算
- 时间戳和日志时间
- JSON 原子写入
- 状态文件和命令文件读写
- `MacroConfig`
- step 规范化
- 配置序列化

这样做的原因：

- 风险最低
- 最容易验证
- 能很快减轻主文件体积
- 不会一下子把系统调用和线程逻辑搅动太多

### 第二阶段：隔离 Windows 边界

把 ctypes 结构体、`user32/shell32/kernel32/crypt32` 的调用集中到专门模块里。

这样做的收益：

- 业务逻辑和平台胶水分开
- 调试路径更短
- 出问题时更容易判断是“宏逻辑”还是“系统调用”

### 第三阶段：明确动作模型

把当前基于 `step["action"]` 的分支判断，收敛成清晰的动作模型：

- `wait`
- `wait_random`
- `tap`
- `combo`

即使继续保留 dict 配置，也建议把执行逻辑统一走一个动作分发器。

这样做的收益：

- 后续新增动作更轻松
- 参数校验更集中
- 单人版和双开版更容易共享执行逻辑

### 第四阶段：去掉双开版整文件复制

目标不是再维护两份近乎相同的大脚本，而是：

- 一份共享运行引擎
- 多份轻量的变体定义

推荐方向：

- 一个共享后端入口
- 用 `--variant solo` / `--variant double` 区分模式
- 变体模块只保留：
  - 默认步骤
  - 状态文件名
  - 命令文件名
  - 可选的说明文案

### 第五阶段：稳定 Launcher 协议

后端拆开以后，Electron 和 Python 的协议要尽量保持稳定：

- 状态 JSON 结构尽量不变
- 命令 JSON 结构尽量不变
- 启动/暂停/关闭语义保持一致

这样前端就不用被后端重构反复牵连。

## 测试策略

这个项目很多逻辑其实可以不碰真实热键、不碰真实管理员权限就先测起来。

优先适合加测试的内容：

- step 规范化
- 配置序列化
- 状态写入逻辑
- 命令文件解析
- `dry-run` 模式下的动作调度

第二批再考虑：

- launcher 的 target 解析
- launcher 的 start/stop 状态切换
- renderer 的日志过滤和快照刷新

暂时不建议一上来就做：

- 真实键盘钩子的端到端测试
- 真实键盘注入测试
- 真实提权测试

这些太重，也容易脆。

## 风险点

这次重构里最容易踩坑的地方有：

- 改坏 Electron 依赖的状态 JSON
- 改坏退出流程，留下僵尸进程
- 改坏提权时序，让启动看起来像卡死
- 去重双开版时不小心改掉动作行为

对应的控制方式：

- 保持现有状态字段尽量不变
- 每一阶段都验证 start / pause / resume / stop / close
- 保留 `dry-run`
- 先抽纯逻辑，再动系统调用层

## 第一个明确里程碑

第一阶段最值得先达成的里程碑是：

1. 把配置、路径、状态文件相关逻辑抽到共享模块。
2. 保持 `solo` 入口文件仍然可直接运行。
3. 让 `double` 后续也能逐步接入同一套共享模块。

这样能在不大改产品行为的前提下，先把后端从“超大单文件”往“可维护模块”推进一步。
