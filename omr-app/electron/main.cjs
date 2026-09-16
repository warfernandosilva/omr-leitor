const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');

// userData persistente (provas/resultados SQLite) — não usar temp volátil
// cache separado em temp para evitar "Unable to create cache" em Program Files
try {
  const cacheDir = path.join(os.tmpdir(), 'omr-electron-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  app.setPath('cache', cacheDir);
} catch {}
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');

let backendProc = null;
const BACKEND_PORT = process.env.OMR_BACKEND_PORT || 8010;
const BACKEND_HOST = '127.0.0.1';
const BACKEND_DIR = path.resolve(__dirname, '../../omr-backend');

function waitForBackend(timeoutMs = 20000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const req = http.get(`http://${BACKEND_HOST}:${BACKEND_PORT}/api/health`, (res) => {
        if (res.statusCode === 200) return resolve(true);
        retry();
      });
      req.on('error', retry);
      req.end();
      function retry() {
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tick, 800);
      }
    };
    tick();
  });
}

function startBackend() {
  // se já está rodando (start-omr.bat), não spawnar outro
  http.get(`http://${BACKEND_HOST}:${BACKEND_PORT}/api/health`, (res) => {
    if (res.statusCode === 200) return;
    spawnBackend();
  }).on('error', spawnBackend);
}

function spawnBackend() {
  // DB persistente para o .exe: %APPDATA%/OMR Correcao/omr.db (não dentro do resources read-only)
  const dbPath = path.join(app.getPath('userData'), 'omr.db');
  try { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); } catch {}
  const backendEnv = { ...process.env, PYTHONUNBUFFERED: '1', OMR_DB_PATH: dbPath };

  // em produção empacotado, usa o .exe do PyInstaller em resources/backend
  if (app.isPackaged) {
    const exeCandidates = [
      path.join(process.resourcesPath, 'backend', 'main.exe'),
      path.join(process.resourcesPath, 'backend', 'main'),
    ];
    for (const exe of exeCandidates) {
      if (fs.existsSync(exe)) {
        const logPath = path.join(path.dirname(dbPath), 'backend-electron.log');
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });
        const proc = spawn(exe, [], { env: backendEnv });
        let stderr = '';
        proc.stdout.on('data', (d) => logStream.write(d));
        proc.stderr.on('data', (d) => { stderr += d.toString(); logStream.write(d); });
        proc.on('exit', (code) => {
          logStream.end();
          if (code !== 0) dialog.showErrorBox('Backend encerrou', `Código ${code}\n${stderr.slice(-800)}\n\nLog: ${logPath}`);
        });
        backendProc = proc;
        return;
      }
    }
    dialog.showErrorBox('Backend não empacotado', 'Execute: cd omr-backend && build-backend-exe.bat\nOu rode em modo dev com iniciar-desktop.bat');
    return;
  }
  const candidates = ['python', 'python3', 'py'];
  let lastErr = '';
  const trySpawn = (idx) => {
    if (idx >= candidates.length) {
      dialog.showErrorBox('Backend falhou', `Nenhum Python encontrado ou erro ao iniciar.\nÚltimo erro: ${lastErr}\n\nInstale Python 3.10+ e: pip install -r requirements.txt\nOu rode manualmente: cd omr-backend && python main.py`);
      return;
    }
    const cmd = candidates[idx];
    // log em arquivo para diagnóstico (no userData quando empacotado)
    const logPath = app.isPackaged ? path.join(path.dirname(dbPath), 'backend-electron.log') : path.join(BACKEND_DIR, 'backend-electron.log');
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const proc = spawn(cmd, ['main.py'], { cwd: BACKEND_DIR, env: backendEnv });
    let stderr = '';
    proc.stdout.on('data', (d) => logStream.write(d));
    proc.stderr.on('data', (d) => { stderr += d.toString(); logStream.write(d); lastErr = stderr.slice(-500); });
    proc.on('error', (e) => { lastErr = e.message; logStream.end(); trySpawn(idx + 1); });
    proc.on('exit', (code) => {
      logStream.end();
      if (code !== 0) {
        // tenta próximo python, senão mostra erro
        if (idx + 1 < candidates.length) trySpawn(idx + 1);
        else dialog.showErrorBox('Backend encerrou', `Código ${code}\n${lastErr.slice(-800)}\n\nLog: ${logPath}\nTente: cd omr-backend && python main.py`);
      }
    });
    backendProc = proc;
    // se em 3s ainda não respondeu e stderr tem traceback, mostra
    setTimeout(async () => {
      const ok = await waitForBackend(3000);
      if (!ok && stderr.includes('Traceback')) {
        dialog.showErrorBox('Backend erro', stderr.slice(-1200));
      }
    }, 3500);
  };
  trySpawn(0);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 860, show: false,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  const devUrl = process.env.ELECTRON_START_URL || 'http://localhost:5173';
  const isDev = !!process.env.ELECTRON_START_URL || !app.isPackaged;

  const load = async () => {
    // backend já está sendo iniciado em paralelo; aguarda
    const ok = await waitForBackend(20000);
    if (!ok) {
      dialog.showMessageBox(win, { type: 'warning', title: 'Backend', message: 'Backend não respondeu em 20s.\n\nTente manualmente:\n  cd omr-backend\n  pip install -r requirements.txt\n  python main.py\n\nLog: omr-backend/backend-electron.log' });
    }
    if (isDev) {
      win.loadURL(devUrl);
    } else {
      win.loadFile(path.join(__dirname, '../dist/index.html'));
    }
    win.once('ready-to-show', () => win.show());
  };
  load();
  // abre DevTools em caso de erro de página para diagnóstico no celular/desktop
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    dialog.showErrorBox('Falha ao carregar', `${desc} (${code})\n${url}\n\nSe for http://localhost:5173, rode: cd omr-app && npm run dev`);
  });
}

app.whenReady().then(() => {
  startBackend();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (backendProc) try { backendProc.kill(); } catch {}
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { if (backendProc) try { backendProc.kill(); } catch {} });
