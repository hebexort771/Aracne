// Mover la rueda del mouse sobre otra aplicación para que las arañas bajen la página solas.
// Usa @jitsi/robotjs (binarios ya compilados para Mac, Windows y Linux/X11).
import { createRequire } from 'node:module';
import { screen, systemPreferences } from 'electron';

const require = createRequire(import.meta.url);
let robot = null;
let loadError = null;
let prompted = false;

function load() {
  if (robot || loadError) return robot;
  try {
    robot = require('@jitsi/robotjs');
    robot.setMouseDelay?.(0);
  } catch (err) {
    loadError = err;
    console.warn('robotjs no disponible:', err.message);
  }
  return robot;
}

function isWayland() {
  return process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || (!!process.env.WAYLAND_DISPLAY && !process.env.DISPLAY));
}

/**
 * ¿Pueden las arañas bajar la página de otra aplicación?
 * @param {boolean} ask en Mac, muestra el aviso del sistema para dar permiso de Accesibilidad (una vez por sesión)
 */
export function inputStatus(ask = false) {
  if (isWayland()) return { ok: false, reason: 'wayland' };
  if (!load()) return { ok: false, reason: 'unavailable', detail: String(loadError?.message || '') };
  if (process.platform === 'darwin') {
    let trusted = systemPreferences.isTrustedAccessibilityClient(false);
    if (!trusted && ask && !prompted) {
      prompted = true;
      trusted = systemPreferences.isTrustedAccessibilityClient(true);
    }
    if (!trusted) return { ok: false, reason: 'permission' };
  }
  return { ok: true };
}

// Cada sistema mide la rueda distinto: Mac en píxeles, Windows en "muescas" de 120 y X11 en clics.
// La capa calibra cuántos píxeles baja cada unidad con la primera vuelta de página.
export function unitPx() {
  if (process.platform === 'darwin') return 1;
  if (process.platform === 'win32') return 100;
  return 60;
}

function toNative(p) {
  // Mac usa puntos (igual que Electron); Windows y Linux, píxeles físicos.
  if (process.platform === 'darwin' || !screen.dipToScreenPoint) return p;
  try {
    return screen.dipToScreenPoint(p);
  } catch {
    return p;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Gira la rueda hacia abajo `units` unidades del sistema (píxeles en Mac, muescas en Windows,
 * clics en Linux) sobre el punto `at` (coordenadas de pantalla, DIP). `region` (DIP) evita
 * mover el puntero si ya está encima del documento.
 */
export async function scrollDown({ at, region, units }) {
  const st = inputStatus();
  if (!st.ok) return st;
  const cursor = screen.getCursorScreenPoint();
  const inside = region && cursor.x >= region.x && cursor.x <= region.x + region.width && cursor.y >= region.y && cursor.y <= region.y + region.height;
  let restore = null;
  try {
    if (!inside && at) {
      restore = robot.getMousePos();
      const p = toNative({ x: Math.round(at.x), y: Math.round(at.y) });
      robot.moveMouse(p.x, p.y);
      await sleep(30);
    }
    const total = Math.max(1, Math.round(units));
    // En pasos cortos: se ve como un desplazamiento suave y las apps lo aceptan mejor.
    const steps = process.platform === 'darwin' ? Math.min(8, Math.max(2, Math.ceil(total / 120))) : total;
    let sent = 0;
    for (let i = 0; i < steps; i++) {
      const part = Math.round((total * (i + 1)) / steps) - sent;
      if (part <= 0) continue;
      robot.scrollMouse(0, -(process.platform === 'win32' ? part * 120 : part));
      sent += part;
      await sleep(process.platform === 'darwin' ? 16 : 22);
    }
    if (restore) {
      await sleep(30);
      robot.moveMouse(restore.x, restore.y);
    }
    return { ok: true, units: sent };
  } catch (err) {
    return { ok: false, reason: 'error', detail: err.message };
  }
}
