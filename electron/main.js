// Aracne — proceso principal.
// Vive en la bandeja del sistema / barra de menú. Con el atajo (Ctrl/⌘ + Shift + Espacio)
// toma una captura de la pantalla y abre encima la capa de arañas. También tiene una
// ventana de lector para documentos completos (web, PDF, Word, imágenes).
import {
  app, BrowserWindow, protocol, net, ipcMain, globalShortcut, Tray, Menu, nativeImage,
  screen, desktopCapturer, shell, dialog, clipboard, systemPreferences,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSettings, publicSettings, updateSettings, getSetting, setSecret } from './settings.js';
import { aiStatus, listModels, complete } from './ai.js';
import { checkSource } from './sources.js';
import { loadMemory, listMemory, addMemory, removeMemory, clearMemory } from './memory.js';
import { loadWeb, fetchImage, normalizeUrl } from './web.js';
import { inputStatus, scrollDown, unitPx } from './input.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ASSETS = path.join(__dirname, 'assets');
const DEV_URL = process.env.ARACNE_DEV_URL || null;
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

if (process.env.ARACNE_USER_DATA) app.setPath('userData', process.env.ARACNE_USER_DATA);
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let lector = null;
let overlay = null;
let overlayReady = false;
let overlayActive = false;
let overlayState = 'hidden'; // hidden | scanning | docked
let overlayDisplay = null;
let captureMode = null; // protect: la capa no sale en la captura · hide: se oculta un instante
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tray = null;
let registeredShortcut = null;
const pendingFiles = [];
const allowedPaths = new Set();

// ---------------------------------------------------------------- utilidades

function pageUrl(page) {
  return DEV_URL ? `${DEV_URL}/${page}` : `app://aracne/${page}`;
}

export function shortcutLabel(accel = getSetting('shortcut')) {
  if (!accel) return '';
  return accel
    .split('+')
    .map((k) => {
      if (k === 'CommandOrControl' || k === 'CmdOrCtrl') return isMac ? '⌘' : 'Ctrl';
      if (k === 'Shift') return isMac ? '⇧' : 'Shift';
      if (k === 'Alt' || k === 'Option') return isMac ? '⌥' : 'Alt';
      if (k === 'Control' || k === 'Ctrl') return isMac ? '⌃' : 'Ctrl';
      if (k === 'Space') return 'Espacio';
      return k;
    })
    .join(isMac ? '' : ' + ');
}

function broadcast(channel, payload) {
  for (const w of [lector, overlay]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

function secureWebContents(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://') && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });
}

function filePathFromArgs(argv) {
  return argv.slice(1).find((a) => !a.startsWith('-') && /\.(pdf|docx|txt|md|html?|png|jpe?g|webp|gif|bmp)$/i.test(a) && fs.existsSync(a));
}

// ---------------------------------------------------------------- ventanas

function createLector() {
  if (lector && !lector.isDestroyed()) {
    if (lector.isMinimized()) lector.restore();
    lector.show();
    lector.focus();
    return lector;
  }
  lector = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 920,
    minHeight: 620,
    show: false,
    title: 'Aracne',
    backgroundColor: '#05060b',
    // Mac: barra integrada; Windows: botones de ventana sobre la barra; Linux: marco normal del sistema.
    titleBarStyle: isMac ? 'hiddenInset' : process.platform === 'win32' ? 'hidden' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    titleBarOverlay: process.platform === 'win32' ? { color: '#07080f', symbolColor: '#c9cfe6', height: 48 } : undefined,
    autoHideMenuBar: true,
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  secureWebContents(lector);
  lector.loadURL(pageUrl('lector.html'));
  lector.once('ready-to-show', () => {
    lector.show();
    if (isMac) app.dock?.show();
  });
  lector.on('closed', () => {
    lector = null;
    if (isMac) app.dock?.hide();
  });
  return lector;
}

function createOverlay() {
  overlay = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    backgroundColor: '#00000000',
    title: 'Aracne',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  secureWebContents(overlay);
  overlay.loadURL(pageUrl('overlay.html'));
  overlay.on('closed', () => {
    overlay = null;
    overlayReady = false;
    overlayActive = false;
    overlayState = 'hidden';
  });
}

// ---------------------------------------------------------------- captura + capa

async function captureDisplay(display) {
  const scale = display.scaleFactor || 1;
  const size = { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const src = sources.find((s) => s.display_id === String(display.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) return null;
  return src.thumbnail;
}

async function openOverlay(testImagePath = null) {
  if (!overlay || overlay.isDestroyed()) createOverlay();
  if (isMac && !testImagePath) {
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status === 'denied' || status === 'restricted') {
      showPermissionHelp();
      return;
    }
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  let img = null;
  try {
    img = testImagePath ? nativeImage.createFromPath(testImagePath) : await captureDisplay(display);
  } catch (err) {
    console.error('Captura fallida', err);
  }
  if (!img || img.isEmpty()) {
    showPermissionHelp();
    return;
  }
  if (isMac && !testImagePath && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
    showPermissionHelp();
    return;
  }
  const jpeg = img.toJPEG(92);
  const { width, height } = img.getSize();
  overlayDisplay = display;
  overlay.setIgnoreMouseEvents(false);
  if (!isLinux) overlay.setOpacity(1);
  overlay.setBounds(display.bounds);
  const payload = {
    image: new Uint8Array(jpeg),
    width,
    height,
    scale: width / display.bounds.width,
    bounds: display.bounds,
    settings: publicSettings(),
    shortcut: shortcutLabel(),
    input: testImagePath ? { ok: false, reason: 'test' } : { ...inputStatus(false), unitPx: unitPx() },
  };
  const send = () => {
    overlay.webContents.send('overlay:open', payload);
    overlay.show();
    overlay.focus();
    if (isMac) app.focus({ steal: true });
    overlayActive = true;
    overlayState = 'scanning';
  };
  if (overlayReady) send();
  else overlay.webContents.once('did-finish-load', () => setTimeout(send, 50));
}

function closeOverlay() {
  if (!overlay || overlayState !== 'scanning') return;
  overlay.webContents.send('overlay:close');
  // Por si la animación de salida no responde.
  setTimeout(() => {
    if (overlayState === 'scanning') hideOverlay();
  }, 15000);
}

function hideOverlay() {
  if (overlay && !overlay.isDestroyed() && overlay.isVisible()) overlay.hide();
  overlayActive = false;
  overlayState = 'hidden';
}

function toggleOverlay() {
  // Mientras escanean, el atajo las manda de vuelta al agujero; si no, empieza un escaneo nuevo.
  if (overlayState === 'scanning') closeOverlay();
  else openOverlay();
}

/** La capa se encoge a una burbujita (o al panel) para que sigas leyendo en tu aplicación. */
function setDock(mode) {
  if (!overlay || overlay.isDestroyed()) return;
  const display = overlayDisplay || screen.getPrimaryDisplay();
  if (mode === 'full') {
    overlay.setBounds(display.bounds);
    overlayState = 'scanning';
    return;
  }
  const wa = display.workArea;
  const wasDocked = overlayState === 'docked';
  overlayState = 'docked';
  overlayActive = false;
  overlay.setIgnoreMouseEvents(false);
  if (mode === 'bubble') overlay.setBounds({ x: wa.x + wa.width - 92, y: wa.y + Math.round(wa.height * 0.4), width: 84, height: 84 });
  else overlay.setBounds({ x: wa.x + wa.width - 508, y: wa.y + 10, width: 500, height: wa.height - 20 });
  if (!wasDocked) {
    // Devuelve el foco a la aplicación donde estabas leyendo.
    if (isMac) {
      app.hide();
      setTimeout(() => overlay && !overlay.isDestroyed() && overlay.showInactive(), 60);
    } else overlay.blur();
  }
}

/** ¿Salió la capa en la captura? (marcas de color en la esquina, o captura toda negra) */
function overlayInCapture(img, display) {
  try {
    const scale = display.scaleFactor || 1;
    const crop = img.crop({ x: 0, y: 0, width: Math.ceil(16 * scale), height: Math.ceil(8 * scale) });
    const bmp = crop.toBitmap();
    const w = crop.getSize().width;
    const px = (x, y) => {
      const i = (Math.round(y * scale) * w + Math.round(x * scale)) * 4;
      return [bmp[i], bmp[i + 1], bmp[i + 2]];
    };
    const m = px(3, 3), g = px(11, 3);
    if (m[0] > 190 && m[1] < 70 && m[2] > 190 && g[0] < 70 && g[1] > 190 && g[2] < 70) return true;
    const small = img.resize({ width: 64 });
    const b = small.toBitmap();
    let sum = 0, sq = 0;
    const n = b.length / 4;
    for (let i = 0; i < b.length; i += 4) {
      const l = (b[i] + b[i + 1] + b[i + 2]) / 3;
      sum += l;
      sq += l * l;
    }
    const mean = sum / n;
    return mean < 6 && Math.sqrt(Math.max(0, sq / n - mean * mean)) < 3;
  } catch {
    return false;
  }
}

/** Captura lo que hay debajo de la capa (para leer la página siguiente). */
async function captureUnderOverlay() {
  const display = overlayDisplay || screen.getPrimaryDisplay();
  let img = null;
  if (captureMode !== 'hide' && !isLinux) {
    try {
      // Solo durante la captura: así tus grabaciones de pantalla sí muestran a las arañas.
      overlay.setContentProtection(true);
      img = await captureDisplay(display);
    } catch (err) {
      console.warn('captura protegida', err);
    } finally {
      overlay.setContentProtection(false);
    }
    if (img && !img.isEmpty() && !overlayInCapture(img, display)) captureMode = 'protect';
    else {
      captureMode = 'hide';
      img = null;
    }
  }
  if (!img) {
    if (isLinux) overlay.hide();
    else overlay.setOpacity(0);
    await sleep(230); // que la ventana de abajo termine de pintarse
    try {
      img = await captureDisplay(display);
    } finally {
      if (isLinux) {
        overlay.show();
        overlay.focus();
      } else overlay.setOpacity(1);
    }
  }
  if (!img || img.isEmpty()) return null;
  const { width, height } = img.getSize();
  return { image: new Uint8Array(img.toJPEG(90)), width, height, scale: width / display.bounds.width, mode: captureMode };
}

function showPermissionHelp() {
  const w = createLector();
  const send = () => w.webContents.send('lector:permission');
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send);
  else send();
}

// ---------------------------------------------------------------- atajo, bandeja, inicio

function registerShortcut(accel) {
  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut);
    registeredShortcut = null;
  }
  if (!accel) return { ok: true };
  try {
    const ok = globalShortcut.register(accel, toggleOverlay);
    if (ok) registeredShortcut = accel;
    return ok ? { ok: true } : { ok: false, error: 'Esa combinación ya la usa otra aplicación.' };
  } catch (err) {
    return { ok: false, error: `Combinación no válida: ${err.message}` };
  }
}

function trayImage() {
  if (isMac) {
    const img = nativeImage.createFromPath(path.join(ASSETS, 'trayTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
}

function buildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: `Activar arañas  (${shortcutLabel()})`, click: () => openOverlay() },
    { label: 'Abrir el lector', click: () => createLector() },
    { type: 'separator' },
    { label: 'Ajustes…', click: () => { const w = createLector(); const s = () => w.webContents.send('lector:settings'); if (w.webContents.isLoading()) w.webContents.once('did-finish-load', s); else s(); } },
    { label: 'Abrir al iniciar sesión', type: 'checkbox', checked: !!getSetting('openAtLogin'), click: (item) => { updateSettings({ openAtLogin: item.checked }); applyLoginItem(); broadcast('settings:changed', publicSettings()); } },
    { type: 'separator' },
    { label: 'Salir de Aracne', role: 'quit' },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`Aracne — ${shortcutLabel()} para activar las arañas`);
}

function createTray() {
  tray = new Tray(trayImage());
  buildTrayMenu();
  if (!isMac) tray.on('click', () => createLector());
}

function applyLoginItem() {
  const enabled = !!getSetting('openAtLogin');
  if (process.platform === 'linux') {
    const dir = path.join(os.homedir(), '.config', 'autostart');
    const file = path.join(dir, 'aracne.desktop');
    try {
      if (enabled) {
        fs.mkdirSync(dir, { recursive: true });
        const exec = process.env.APPIMAGE || process.execPath;
        fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Aracne\nExec="${exec}" --hidden\nX-GNOME-Autostart-enabled=true\n`);
      } else if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (err) {
      console.error('Autostart', err);
    }
    return;
  }
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    shortcut: getSetting('shortcut'),
    shortcutLabel: shortcutLabel(),
    shortcutOk: !!registeredShortcut,
    screenPermission: isMac ? systemPreferences.getMediaAccessStatus('screen') : 'granted',
  }));

  ipcMain.handle('settings:get', () => publicSettings());
  ipcMain.handle('settings:set', (_e, patch) => {
    let shortcutResult = { ok: true };
    if (patch.shortcut !== undefined && patch.shortcut !== getSetting('shortcut')) {
      const previous = getSetting('shortcut');
      shortcutResult = registerShortcut(patch.shortcut);
      if (!shortcutResult.ok) {
        registerShortcut(previous);
        delete patch.shortcut;
      }
    }
    const s = updateSettings(patch);
    if (patch.openAtLogin !== undefined) applyLoginItem();
    buildTrayMenu();
    broadcast('settings:changed', s);
    return { settings: s, shortcut: shortcutResult, shortcutLabel: shortcutLabel() };
  });

  ipcMain.handle('ai:status', () => aiStatus());
  ipcMain.handle('ai:models', (_e, provider) => listModels(provider));
  ipcMain.handle('ai:setKey', (_e, provider, key) => {
    setSecret(provider, (key || '').trim());
    const s = publicSettings();
    broadcast('settings:changed', s);
    return s;
  });
  ipcMain.handle('ai:complete', (_e, req) => complete(req));

  ipcMain.handle('sources:check', (_e, item) => checkSource(item));

  ipcMain.handle('web:load', (_e, url) => loadWeb(url));
  ipcMain.handle('image:fetch', (_e, url) => fetchImage(url));

  ipcMain.handle('file:open', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Documentos', extensions: ['pdf', 'docx', 'txt', 'md', 'html', 'htm', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      ],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return readAllowed(res.filePaths[0], true);
  });
  ipcMain.handle('file:read', (_e, p) => readAllowed(p, false));
  ipcMain.handle('file:pending', () => pendingFiles.splice(0).map((p) => readAllowed(p, true)).filter(Boolean));

  ipcMain.handle('file:save', async (e, { defaultName, data, filters }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), defaultName), filters });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, typeof data === 'string' ? data : Buffer.from(data));
    return res.filePath;
  });

  ipcMain.handle('clipboard:write', (_e, { text, html }) => {
    clipboard.write({ text: text || '', html: html || undefined });
    return true;
  });

  ipcMain.handle('shell:open', (_e, url) => {
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
    return true;
  });
  ipcMain.handle('shell:reveal', (_e, p) => {
    if (p && fs.existsSync(p)) shell.showItemInFolder(p);
  });

  ipcMain.handle('capture:rect', async (e, rect) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = { x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
    let img = await win.webContents.capturePage(r);
    const { width } = img.getSize();
    if (width > 1600) img = img.resize({ width: 1600, quality: 'best' });
    return { mime: 'image/jpeg', data: img.toJPEG(90).toString('base64') };
  });

  ipcMain.handle('memory:list', () => listMemory());
  ipcMain.handle('memory:add', (_e, entry) => (getSetting('rememberReading') ? addMemory(entry) : listMemory()));
  ipcMain.handle('memory:remove', (_e, id) => removeMemory(id));
  ipcMain.handle('memory:clear', () => {
    clearMemory();
    return [];
  });

  ipcMain.on('overlay:ready', () => {
    overlayReady = true;
  });
  ipcMain.handle('overlay:hide', () => hideOverlay());
  ipcMain.handle('overlay:open-lector', (_e, doc) => {
    hideOverlay();
    const w = createLector();
    if (doc) {
      const send = () => w.webContents.send('lector:open-doc', doc);
      if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send);
      else send();
    }
  });
  ipcMain.handle('overlay:activate', () => openOverlay());
  ipcMain.handle('overlay:capture', () => captureUnderOverlay());
  ipcMain.handle('overlay:input', (_e, ask) => inputStatus(!!ask));
  ipcMain.handle('overlay:dock', (_e, mode) => setDock(mode));
  ipcMain.handle('overlay:scroll', async (_e, { region, units }) => {
    if (!overlay || overlay.isDestroyed()) return { ok: false, reason: 'closed' };
    const b = (overlayDisplay || screen.getPrimaryDisplay()).bounds;
    const r = { x: b.x + region.x, y: b.y + region.y, width: region.w, height: region.h };
    // La capa deja pasar la rueda a la ventana de abajo mientras tanto.
    overlay.setIgnoreMouseEvents(true);
    try {
      return await scrollDown({ at: { x: r.x + r.width / 2, y: r.y + r.height / 2 }, region: r, units });
    } finally {
      setTimeout(() => overlay && !overlay.isDestroyed() && overlayState === 'scanning' && overlay.setIgnoreMouseEvents(false), 80);
    }
  });

  ipcMain.handle('perm:open-screen-settings', () => {
    if (isMac) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  });
  ipcMain.handle('perm:open-accessibility', () => {
    if (isMac) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  });
  ipcMain.handle('app:relaunch', () => {
    app.relaunch();
    app.exit(0);
  });
}

function readAllowed(p, approve) {
  if (!p) return null;
  const full = path.resolve(p);
  if (approve) allowedPaths.add(full);
  if (!allowedPaths.has(full)) throw new Error('Archivo no autorizado.');
  const data = fs.readFileSync(full);
  return { name: path.basename(full), path: full, data: new Uint8Array(data) };
}

function openPathInLector(p) {
  allowedPaths.add(path.resolve(p));
  const w = createLector();
  const send = () => w.webContents.send('lector:open-path', path.resolve(p));
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send);
  else send();
}

// ---------------------------------------------------------------- arranque

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const file = filePathFromArgs(argv);
    if (file) openPathInLector(file);
    else createLector();
  });

  app.on('open-file', (e, p) => {
    e.preventDefault();
    if (app.isReady()) openPathInLector(p);
    else pendingFiles.push(p);
  });

  app.whenReady().then(() => {
    protocol.handle('app', (req) => {
      const url = new URL(req.url);
      let p = decodeURIComponent(url.pathname);
      if (p === '/' || p === '') p = '/lector.html';
      const file = path.normalize(path.join(DIST, p));
      if (!file.startsWith(DIST)) return new Response('Prohibido', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });

    loadSettings();
    loadMemory();
    registerIpc();
    createTray();
    createOverlay();
    const sc = registerShortcut(getSetting('shortcut'));
    if (!sc.ok) console.warn('Atajo no disponible:', sc.error);
    applyLoginItem();

    const hidden = process.argv.includes('--hidden');
    const fileArg = filePathFromArgs(process.argv);
    if (fileArg) openPathInLector(fileArg);
    else if (!hidden) createLector();
    else if (isMac) app.dock?.hide();

    for (const p of pendingFiles.splice(0)) openPathInLector(p);

    const testShot = process.env.ARACNE_TEST_SCREENSHOT;
    if (testShot) setTimeout(() => openOverlay(testShot), 1500);
    // Pruebas: activa la capa con una captura real después de N ms.
    const testActivate = Number(process.env.ARACNE_TEST_ACTIVATE || 0);
    if (testActivate) setTimeout(() => openOverlay(), testActivate);

    app.on('activate', () => createLector());
  });

  app.on('window-all-closed', () => {
    // Aracne sigue en la bandeja: no se cierra al cerrar ventanas.
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
}

export { normalizeUrl };
