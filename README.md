# Roco Kingdom Flower Farming Script

This repository contains a Windows automation tool for Roco Kingdom.

Project layout:

- `backend/`: Python backend script
- `launcher/`: Electron + React launcher and packaging project

## Requirements

- Windows 10/11 x64
- Node.js 20 LTS
- Python 3.10 x64
- Git

## Clone

```powershell
git clone https://github.com/a13662925060-tech/roco-kingdom-flower-farming-script.git
cd .\roco-kingdom-flower-farming-script
```

## Install dependencies

Install Python packaging tools:

```powershell
py -3.10 -m pip install --upgrade pip
py -3.10 -m pip install pyinstaller
```

Install launcher dependencies:

```powershell
cd .\launcher
npm ci
```

## Run in development

```powershell
cd .\launcher
npm start
```

## Build EXE

### Fast package

Best for frequent local testing.

```powershell
cd .\launcher
npm run package:portable:fast
```

Output:

```powershell
.\launcher\release\SoloBow.exe
```

### Release package

Best for a smaller final build.

```powershell
cd .\launcher
npm run package:portable
```

Output:

```powershell
.\launcher\release\SoloBow.exe
```

If you want to copy it to the project root:

```powershell
Copy-Item .\launcher\release\SoloBow.exe .\SoloBow.exe -Force
```

## Packaging optimizations

The current packaging flow includes:

- incremental TypeScript builds
- smart backend rebuilds that skip PyInstaller when backend sources are unchanged
- disabled Electron dependency rebuild during packaging
- a faster local packaging command with `compression=store`

## Troubleshooting

### `pyinstaller` not found

Run:

```powershell
py -3.10 -m pip install pyinstaller
```

### `npm` not found

Install Node.js again and reopen the terminal.

### No `exe` after cloning

That is expected. Build artifacts are not committed to the repository. Run one of the packaging commands above to generate the EXE.
