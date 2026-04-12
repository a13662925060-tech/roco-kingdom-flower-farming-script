<img width="1084" height="670" alt="脚本启动窗口" src="https://github.com/user-attachments/assets/0fc8872f-bb50-4e3a-a7ba-a46c6d36d8e2" />

## 📋 功能说明

本窗口仅用于**脚本启动**与**状态显示**，实际控制请通过键盘热键进行操作：

- **F8**：开始 / 暂停脚本
- **F9**：退出脚本

## 🛠 环境准备

请先确保本机已安装以下运行环境：

- **Node.js 20 LTS**
- **Python 3.10 x64**

## 📦 打包步骤

在项目根目录打开终端后，执行以下命令：

```bash
cd launcher
npm ci
npm run package:portable
```

打包完成后，生成的文件位置为：

```bash
launcher/release/SoloBow.exe
```
