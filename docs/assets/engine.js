// Motor de arañas digitales.
// Arañas procedurales con 8 patas (cinemática inversa de 2 segmentos y marcha alternada)
// que caminan sobre el documento, atrapan "presas" (rectángulos de texto) y dejan
// recuadros de neón, etiquetas con efecto de decodificación, hilos y estelas.

const TAU = Math.PI * 2;

export const COLORS = {
  cyan: '#3cf0ff',
  magenta: '#ff3fd2',
  blue: '#5f72ff',
  violet: '#a98bff',
  amber: '#ffb547',
  red: '#ff4d6d',
  green: '#3dffa2',
  white: '#e8ecff',
  leg: '#b9c2ff',
};

const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace';
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=<>/\\|{}[]';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function unionRect(rects) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ------------------------------------------------------------------
// Pata: cadera fija al cuerpo, rodilla calculada con la ley de cosenos.
// ------------------------------------------------------------------
class Leg {
  constructor(spider, side, idx) {
    this.spider = spider;
    this.side = side; // -1 izquierda, 1 derecha
    this.idx = idx; // 0 delantera … 3 trasera
    const s = spider.size;
    const L = [[30, 40], [25, 33], [23, 30], [28, 39]][idx];
    this.l1 = L[0] * s;
    this.l2 = L[1] * s;
    this.angle = [0.62, 1.2, 1.95, 2.55][idx] * side; // respecto al rumbo
    this.reach = [0.86, 0.8, 0.78, 0.86][idx] * (this.l1 + this.l2);
    this.group = (idx + (side > 0 ? 1 : 0)) % 2;
    const rest = this.restPoint();
    this.foot = { ...rest };
    this.from = { ...rest };
    this.to = { ...rest };
    this.t = 1;
    this.dur = 0.14;
  }

  hip() {
    const sp = this.spider;
    const along = [4.5, 2, -0.5, -3][this.idx] * sp.size;
    const across = 2.2 * sp.size * this.side;
    const c = Math.cos(sp.heading), s = Math.sin(sp.heading);
    return { x: sp.x + c * along - s * across, y: sp.y + s * along + c * across };
  }

  restPoint(lead = 0) {
    const sp = this.spider;
    const a = sp.heading + this.angle;
    return {
      x: sp.x + Math.cos(a) * this.reach + sp.vx * lead,
      y: sp.y + Math.sin(a) * this.reach + sp.vy * lead,
    };
  }

  get stepping() {
    return this.t < 1;
  }

  update(dt, canStep) {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.dur);
      // El destino del paso se actualiza mientras la araña sigue avanzando.
      this.to = this.restPoint(this.dur * 1.4 * (1 - this.t) + 0.03);
      const e = easeInOut(this.t);
      this.foot.x = lerp(this.from.x, this.to.x, e);
      this.foot.y = lerp(this.from.y, this.to.y, e);
      return;
    }
    const rest = this.restPoint();
    const d = Math.hypot(this.foot.x - rest.x, this.foot.y - rest.y);
    const sp = this.spider;
    const hip = this.hip();
    const overstretched = Math.hypot(this.foot.x - hip.x, this.foot.y - hip.y) > (this.l1 + this.l2) * 0.98 || d > this.reach * 0.95;
    if (!canStep && !overstretched) return;
    const speed = Math.hypot(sp.vx, sp.vy);
    const threshold = speed > 8 ? this.reach * 0.36 : this.reach * 0.14;
    if (d > threshold || overstretched) {
      this.dur = clamp(0.2 - speed / 1100, 0.06, 0.2);
      this.from = { ...this.foot };
      this.to = this.restPoint(this.dur * 1.4);
      this.t = 0;
    }
  }

  knee(hip) {
    const dx = this.foot.x - hip.x, dy = this.foot.y - hip.y;
    let d = Math.hypot(dx, dy);
    const max = this.l1 + this.l2 - 0.01;
    d = clamp(d, Math.abs(this.l1 - this.l2) + 0.01, max);
    const a = Math.acos(clamp((this.l1 * this.l1 + d * d - this.l2 * this.l2) / (2 * this.l1 * d), -1, 1));
    const base = Math.atan2(dy, dx);
    // Dos soluciones: se elige la rodilla que queda más lejos del cuerpo (hacia afuera).
    const k1 = { x: hip.x + Math.cos(base + a) * this.l1, y: hip.y + Math.sin(base + a) * this.l1 };
    const k2 = { x: hip.x + Math.cos(base - a) * this.l1, y: hip.y + Math.sin(base - a) * this.l1 };
    const sp = this.spider;
    const d1 = (k1.x - sp.x) ** 2 + (k1.y - sp.y) ** 2;
    const d2 = (k2.x - sp.x) ** 2 + (k2.y - sp.y) ** 2;
    return d1 > d2 ? k1 : k2;
  }
}

// ------------------------------------------------------------------
// Araña
// ------------------------------------------------------------------
let spiderIds = 0;

class Spider {
  constructor(world, x, y, opts = {}) {
    this.world = world;
    this.id = ++spiderIds;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.heading = rand(0, TAU);
    this.size = opts.size || rand(0.78, 1.15);
    this.color = opts.color || COLORS.leg;
    this.maxSpeed = rand(250, 330) * (opts.speed || 1);
    this.state = 'wander';
    this.task = null;
    this.timer = 0;
    this.wanderPoint = null;
    this.rest = null; // punto de descanso en coordenadas de pantalla
    this.alpha = 0;
    this.carry = null;
    this.legs = [];
    for (let i = 0; i < 4; i++) {
      this.legs.push(new Leg(this, -1, i), new Leg(this, 1, i));
    }
  }

  seek(tx, ty, dt, speedFactor = 1, arrive = 70) {
    const dx = tx - this.x, dy = ty - this.y;
    const dist = Math.hypot(dx, dy);
    const desiredSpeed = this.maxSpeed * speedFactor * Math.min(1, dist / arrive);
    const dvx = (dx / (dist || 1)) * desiredSpeed - this.vx;
    const dvy = (dy / (dist || 1)) * desiredSpeed - this.vy;
    const maxForce = 900 * this.size;
    const f = Math.hypot(dvx, dvy);
    const k = f > maxForce * dt ? (maxForce * dt) / f : 1;
    this.vx += dvx * k;
    this.vy += dvy * k;
    return dist;
  }

  update(dt) {
    const w = this.world;
    this.alpha = Math.min(1, this.alpha + dt * 2.5);

    // Separación entre arañas
    for (const o of w.spiders) {
      if (o === this) continue;
      const dx = this.x - o.x, dy = this.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 2200 && d2 > 0.01) {
        const d = Math.sqrt(d2);
        this.vx += (dx / d) * 260 * dt;
        this.vy += (dy / d) * 260 * dt;
      }
    }

    switch (this.state) {
      case 'seek': {
        const t = this.task;
        const r = t.anchor();
        if (!r) { this.finishTask(); break; }
        const tx = r.x + Math.min(r.w * 0.2, 14);
        const ty = r.y + r.h / 2;
        const d = this.seek(tx, ty, dt, 1, 90);
        if (d < 10) {
          this.state = 'grab';
          this.timer = w.grabTime;
          w.onGrabbed(this, t);
        }
        break;
      }
      case 'grab': {
        const r = this.task.anchor();
        if (r) this.seek(r.x + Math.min(r.w * 0.2, 14), r.y + r.h / 2, dt, 0.25, 30);
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.carry) {
            this.state = 'carry';
          } else this.finishTask();
        }
        break;
      }
      case 'carry': {
        const p = w.screenToWorld(this.carry.to());
        const d = this.seek(p.x, p.y, dt, 1.25, 60);
        if (d < 16) {
          w.ripple(this.x, this.y, this.carry.color);
          this.carry.done = true;
          this.carry = null;
          this.finishTask();
        }
        break;
      }
      case 'summon': {
        const r = this.task.anchor();
        if (r) this.seek(r.x - 18, r.y + r.h / 2, dt, 1.2, 60);
        break;
      }
      case 'rest': {
        const p = w.screenToWorld(this.rest);
        const d = this.seek(p.x, p.y, dt, 0.7, 120);
        if (d < 4 && Math.random() < dt * 0.4) {
          // pequeño tic nervioso
          this.heading += rand(-0.4, 0.4);
        }
        break;
      }
      default: {
        // Deambular
        this.timer -= dt;
        if (!this.wanderPoint || this.timer <= 0) {
          this.wanderPoint = w.randomPoint();
          this.timer = rand(1.5, 4);
        }
        const d = this.seek(this.wanderPoint.x, this.wanderPoint.y, dt, 0.45, 80);
        if (d < 20) this.timer = 0;
      }
    }

    const speed = Math.hypot(this.vx, this.vy);
    const max = this.maxSpeed * (this.state === 'carry' ? 1.3 : 1);
    if (speed > max) {
      this.vx *= max / speed;
      this.vy *= max / speed;
    }
    // Rozamiento
    const damp = Math.pow(0.12, dt);
    if (this.state === 'grab' || this.state === 'rest') {
      this.vx *= damp;
      this.vy *= damp;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (speed > 12) {
      const target = Math.atan2(this.vy, this.vx);
      let diff = target - this.heading;
      while (diff > Math.PI) diff -= TAU;
      while (diff < -Math.PI) diff += TAU;
      this.heading += diff * Math.min(1, dt * 7);
    }

    // Marcha alternada: un grupo de patas pisa mientras el otro avanza.
    const steppingGroup = this.legs.find((l) => l.stepping)?.group;
    for (const leg of this.legs) {
      leg.update(dt, steppingGroup === undefined || steppingGroup === leg.group);
    }
    if (this.carry) this.carry.follow(this, dt);
  }

  finishTask() {
    if (this.task) this.world.release(this, this.task);
    this.task = null;
    this.state = 'wander';
    this.world.assign(this);
  }

  draw(ctx) {
    const a = this.alpha * this.world.spiderAlpha;
    if (a <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.color;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    const joints = [];
    for (const leg of this.legs) {
      const hip = leg.hip();
      const knee = leg.knee(hip);
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(knee.x, knee.y);
      ctx.lineTo(leg.foot.x, leg.foot.y);
      joints.push(knee, leg.foot);
    }
    ctx.stroke();
    for (let i = 0; i < joints.length; i++) {
      const j = joints[i];
      ctx.beginPath();
      ctx.arc(j.x, j.y, i % 2 ? 1.1 : 1.6, 0, TAU);
      ctx.fill();
    }
    // Cuerpo: abdomen + cefalotórax
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const s0 = this.size;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.heading);
    ctx.beginPath();
    ctx.ellipse(-8 * s0, 0, 7 * s0, 5 * s0, 0, 0, TAU);
    ctx.fillStyle = 'rgba(8,10,22,0.85)';
    ctx.fill();
    ctx.strokeStyle = this.color;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-14 * s0, 0);
    ctx.lineTo(-3 * s0, 0);
    ctx.globalAlpha = a * 0.5;
    ctx.stroke();
    ctx.globalAlpha = a;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(1.5 * s0, 0, 3.4 * s0, 0, TAU);
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(4 * s0, -1.6 * s0, 1.2, 1.2);
    ctx.fillRect(4 * s0, 0.6 * s0, 1.2, 1.2);
    ctx.restore();
    void c; void s;
    ctx.restore();
  }
}

// ------------------------------------------------------------------
// Efectos
// ------------------------------------------------------------------
class Box {
  constructor(world, target) {
    this.world = world;
    this.target = target;
    this.color = target.color || COLORS.cyan;
    this.age = 0;
    this.hold = world.boxHold;
    this.mark = target.mark !== false;
    this.dead = false;
  }

  update(dt) {
    this.age += dt;
    if (!this.mark && this.age > this.hold + 1.2) this.dead = true;
  }

  draw(ctx) {
    const rects = this.target.rects();
    if (!rects || !rects.length) return;
    const grow = clamp(this.age / 0.22, 0, 1);
    const k = easeOutBack(grow);
    const fade = this.age < this.hold ? 1 : Math.max(0, 1 - (this.age - this.hold) / 1.1);
    const strong = fade; // 1 = recuadro sólido, 0 = marca suave
    const solidText = this.world.solidText && rects.length === 1 && this.target.text;
    for (const r0 of rects) {
      const pad = 1.5;
      const cx = r0.x + r0.w / 2, cy = r0.y + r0.h / 2;
      const w = (r0.w + pad * 2) * (0.4 + 0.6 * k);
      const h = (r0.h + pad * 2) * k;
      const x = cx - w / 2, y = cy - h / 2;
      if (this.target.style === 'outline') {
        ctx.strokeStyle = rgba(this.color, 0.55 + 0.45 * strong);
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        continue;
      }
      const fillA = solidText ? 0.18 + 0.78 * strong : 0.16 + 0.3 * strong;
      ctx.fillStyle = rgba(this.color, fillA);
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = rgba(this.color, 0.4 + 0.5 * strong);
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      if (grow < 1) {
        ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - grow)})`;
        ctx.fillRect(x, y, w, h);
      }
      if (solidText && strong > 0.05) {
        // Texto re-escrito en monoespaciado, como en un rastreador.
        ctx.save();
        ctx.globalAlpha = strong;
        const size = Math.max(8, r0.h * 0.78);
        ctx.font = `600 ${size}px ${MONO}`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#04050b';
        const text = this.target.text;
        const m = ctx.measureText(text).width || 1;
        const sx = clamp(r0.w / m, 0.55, 1.4);
        ctx.translate(r0.x, cy + 0.5);
        ctx.scale(sx, 1);
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
    }
  }
}

class GlitchLabel {
  constructor(text, x, y, color, opts = {}) {
    this.text = text.length > 42 ? `${text.slice(0, 40)}…` : text;
    this.x = x;
    this.y = y;
    this.color = color;
    this.size = opts.size || (this.text.length < 12 ? 20 : this.text.length < 24 ? 16 : 13);
    this.age = 0;
    this.life = opts.life || 3.6;
    this.dead = false;
    this.anchor = opts.anchor || null;
  }

  update(dt) {
    this.age += dt;
    if (this.age > this.life) this.dead = true;
  }

  draw(ctx) {
    const reveal = this.age / 0.55;
    const fade = this.age > this.life - 0.8 ? (this.life - this.age) / 0.8 : 1;
    let out = '';
    for (let i = 0; i < this.text.length; i++) {
      const ch = this.text[i];
      out += i / this.text.length < reveal || ch === ' ' ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
    ctx.save();
    ctx.font = `500 ${this.size}px ${MONO}`;
    ctx.textBaseline = 'alphabetic';
    const jitter = this.age < 0.6 ? rand(-1, 1) : 0;
    ctx.globalAlpha = 0.55 * fade;
    ctx.fillStyle = COLORS.cyan;
    ctx.fillText(out, this.x - 1.2 + jitter, this.y);
    ctx.fillStyle = COLORS.magenta;
    ctx.fillText(out, this.x + 1.2 - jitter, this.y);
    ctx.globalAlpha = fade;
    ctx.fillStyle = this.color;
    ctx.fillText(out, this.x, this.y);
    ctx.restore();
  }
}

class Thread {
  constructor(from, to, color, life = 1.4) {
    this.from = from;
    this.to = to;
    this.color = color;
    this.age = 0;
    this.life = life;
    this.dead = false;
    this.sticky = life === Infinity;
  }

  update(dt) {
    this.age += dt;
    if (this.age > this.life) this.dead = true;
  }

  draw(ctx) {
    const a = this.from();
    const b = this.to();
    if (!a || !b) return;
    const t = this.sticky ? 1 : 1 - this.age / this.life;
    const grow = clamp(this.age / 0.18, 0, 1);
    ctx.save();
    ctx.strokeStyle = rgba(this.color, 0.75 * t);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(lerp(a.x, b.x, grow), lerp(a.y, b.y, grow));
    ctx.stroke();
    ctx.fillStyle = rgba(this.color, t);
    ctx.beginPath();
    ctx.arc(b.x, b.y, 1.8, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

class Carry {
  constructor(color, to) {
    this.color = color;
    this.to = to;
    this.trail = [];
    this.angle = rand(-0.6, 0.6);
    this.done = false;
    this.age = 0;
    this.dead = false;
    this.x = 0;
    this.y = 0;
  }

  follow(spider, dt) {
    this.x = spider.x - Math.cos(spider.heading) * 18;
    this.y = spider.y - Math.sin(spider.heading) * 18;
    this.angle += (spider.heading + 0.9 - this.angle) * Math.min(1, dt * 3);
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 16) this.trail.shift();
  }

  update(dt) {
    if (this.done) {
      this.age += dt;
      if (this.age > 0.5) this.dead = true;
    }
  }

  draw(ctx) {
    if (!this.trail.length) return;
    const fade = this.done ? 1 - this.age / 0.5 : 1;
    ctx.save();
    for (let i = 1; i < this.trail.length; i++) {
      const p0 = this.trail[i - 1], p1 = this.trail[i];
      ctx.strokeStyle = rgba(this.color, (i / this.trail.length) * 0.5 * fade);
      ctx.lineWidth = 8 * (i / this.trail.length);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = rgba(this.color, 0.92 * fade);
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 12;
    ctx.fillRect(-26, -5, 52, 10);
    ctx.restore();
  }
}

class Ripple {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.age = 0;
    this.dead = false;
  }
  update(dt) {
    this.age += dt;
    if (this.age > 0.7) this.dead = true;
  }
  draw(ctx) {
    const t = this.age / 0.7;
    ctx.save();
    ctx.strokeStyle = rgba(this.color, 1 - t);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 4 + t * 26, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

class Pulse {
  constructor(rects, color) {
    this.rects = rects;
    this.color = color;
    this.age = 0;
    this.dead = false;
  }
  update(dt) {
    this.age += dt;
  }
  draw(ctx) {
    const rects = typeof this.rects === 'function' ? this.rects() : this.rects;
    if (!rects?.length) return;
    const p = 0.55 + 0.45 * Math.sin(this.age * 6);
    ctx.save();
    for (const r of rects) {
      ctx.fillStyle = rgba(this.color, 0.14 + 0.1 * p);
      ctx.fillRect(r.x - 3, r.y - 2, r.w + 6, r.h + 4);
      ctx.strokeStyle = rgba(this.color, 0.6 + 0.4 * p);
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x - 2.5, r.y - 1.5, r.w + 5, r.h + 3);
    }
    ctx.restore();
  }
}

// ------------------------------------------------------------------
// Mundo
// ------------------------------------------------------------------
export class SpiderWorld {
  /**
   * @param {object} o
   * @param {HTMLElement} o.host elemento posicionado sobre el que se pinta (no hace scroll)
   * @param {() => {x:number,y:number}} o.getCamera desplazamiento actual (scroll)
   * @param {(y:number) => void} [o.setCameraY] para el auto-scroll del escaneo
   * @param {'alta'|'media'|'baja'|'apagada'} [o.intensity]
   * @param {boolean} [o.solidText] re-escribe el texto atrapado en monoespaciado
   * @param {boolean} [o.stars]
   */
  constructor({ host, getCamera = () => ({ x: 0, y: 0 }), setCameraY = null, intensity = 'alta', solidText = true, stars = true, decor = null }) {
    this.host = host;
    this.getCamera = getCamera;
    this.setCameraY = setCameraY;
    this.solidText = solidText;
    this.decor = decor;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'spider-canvas';
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '5' });
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.spiders = [];
    this.boxes = [];
    this.fx = []; // efectos en coordenadas del mundo
    this.labels = [];
    this.queue = [];
    this.claimed = new Set();
    this.done = new Set();
    this.autoScroll = false;
    this.camY = null;
    this.idleTimer = 0;
    this.spiderAlpha = 1;
    this.grabTime = 0.4;
    this.carryBudget = 0;
    this.deadline = null;
    this.boxHold = 2.6;
    this.starsOn = stars;
    this.stars = [];
    this.scan = null; // {y, active}
    this.listeners = { grab: [] };
    this.setIntensity(intensity);
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.last = performance.now();
    this.running = true;
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  on(event, fn) {
    this.listeners[event].push(fn);
  }

  setIntensity(level) {
    this.intensity = level;
    this.maxSpiders = { alta: 10, media: 6, baja: 3, apagada: 0 }[level] ?? 6;
    this.carryChance = { alta: 0.5, media: 0.3, baja: 0, apagada: 0 }[level] ?? 0.1;
    this.carryMax = { alta: 4, media: 2, baja: 0, apagada: 0 }[level] ?? 1;
    if (this.spiders.length > this.maxSpiders) this.spiders.length = this.maxSpiders;
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.stars = Array.from({ length: Math.round((this.w * this.h) / 9000) }, () => ({
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      r: Math.random() < 0.85 ? 0.7 : 1.3,
      p: Math.random() * TAU,
      s: rand(0.6, 2.2),
    }));
  }

  screenToWorld(p) {
    const c = this.getCamera();
    return { x: p.x + c.x, y: p.y + c.y };
  }

  viewRect() {
    const c = this.getCamera();
    return { x: c.x, y: c.y, w: this.w, h: this.h };
  }

  randomPoint() {
    const v = this.viewRect();
    return { x: v.x + rand(40, v.w - 40), y: v.y + rand(40, v.h - 40) };
  }

  // ---------- Arañas ----------

  spawn(n = 1, color) {
    const v = this.viewRect();
    for (let i = 0; i < n && this.spiders.length < this.maxSpiders; i++) {
      const edge = (Math.random() * 4) | 0;
      const x = edge === 0 ? v.x - 30 : edge === 1 ? v.x + v.w + 30 : v.x + rand(0, v.w);
      const y = edge === 2 ? v.y - 30 : edge === 3 ? v.y + v.h + 30 : v.y + rand(0, v.h);
      const sp = new Spider(this, x, y, { color });
      this.spiders.push(sp);
      this.assign(sp);
    }
  }

  /**
   * Manda arañas a atrapar objetivos.
   * target: {id, rects:()=>Rect[], color, text?, label?, style?, carryTo?:()=>{x,y} (pantalla)}
   */
  deploy(targets, { autoScroll = false, maxDuration = 10 } = {}) {
    this.carryBudget = this.carryMax;
    this.deadline = performance.now() / 1000 + maxDuration;
    for (const t of targets) {
      if (this.done.has(t.id) || this.queue.some((q) => q.id === t.id)) continue;
      t.anchor = () => {
        const rs = t.rects();
        return rs && rs.length ? rs[0] : null;
      };
      this.queue.push(t);
    }
    this.autoScroll = autoScroll && !!this.setCameraY;
    this.camY = null;
    if (this.maxSpiders === 0) {
      // Sin animación: solo marcas.
      for (const t of this.queue.splice(0)) this.markOnly(t);
      return;
    }
    const want = Math.min(this.maxSpiders, 2 + Math.ceil(this.queue.length / 5));
    if (this.spiders.length < want) this.spawn(want - this.spiders.length);
    for (const sp of this.spiders) if (sp.state === 'wander' || sp.state === 'rest') this.assign(sp);
  }

  markOnly(t, delay = 0) {
    const box = new Box(this, t);
    box.age = -delay;
    box.hold = 0.4;
    this.boxes.push(box);
    this.done.add(t.id);
    for (const fn of this.listeners.grab) fn(t);
  }

  assign(sp) {
    if (sp.state !== 'wander' && sp.state !== 'rest') return;
    if (!this.queue.length) return;
    const v = this.viewRect();
    let best = null, bestScore = Infinity;
    for (const t of this.queue) {
      if (this.claimed.has(t.id)) continue;
      const r = t.anchor();
      if (!r) continue;
      const inView = r.y > v.y - 80 && r.y < v.y + v.h + 120;
      const d = Math.hypot(r.x - sp.x, r.y - sp.y) + (inView ? 0 : 2000 + Math.abs(r.y - (v.y + v.h)));
      if (d < bestScore) { bestScore = d; best = t; }
    }
    if (!best) return;
    this.claimed.add(best.id);
    sp.task = best;
    sp.state = 'seek';
  }

  onGrabbed(sp, t) {
    const r = t.anchor();
    if (!r) return;
    this.boxes.push(new Box(this, t));
    this.fx.push(new Thread(() => ({ x: sp.x, y: sp.y }), () => {
      const a = t.anchor();
      return a ? { x: a.x + a.w / 2, y: a.y + a.h / 2 } : null;
    }, t.color || COLORS.cyan, sp.state === 'grab' ? this.grabTime + 1 : 1));
    if (t.label && this.labels.length < 14) {
      const lx = r.x + Math.min(r.w * 0.25, 60) + rand(-10, 30);
      const ly = r.y - rand(6, 22);
      this.labels.push(new GlitchLabel(t.label, lx, ly, t.color || COLORS.cyan));
    }
    this.ripple(r.x + 6, r.y + r.h / 2, t.color || COLORS.cyan);
    if (t.carryTo && this.carryBudget > 0 && Math.random() < this.carryChance) {
      this.carryBudget--;
      sp.carry = new Carry(t.color || COLORS.magenta, t.carryTo);
      this.fx.push(sp.carry);
    }
    if (sp.lastGrab) {
      const prev = sp.lastGrab;
      if (Math.hypot(prev.x - r.x, prev.y - r.y) < 500) {
        this.fx.push(new Thread(() => prev, () => ({ x: r.x, y: r.y + r.h / 2 }), COLORS.leg, 4));
      }
    }
    sp.lastGrab = { x: r.x, y: r.y + r.h / 2 };
    this.done.add(t.id);
    for (const fn of this.listeners.grab) fn(t);
  }

  release(sp, t) {
    this.queue = this.queue.filter((q) => q.id !== t.id);
    this.claimed.delete(t.id);
  }

  ripple(x, y, color) {
    this.fx.push(new Ripple(x, y, color));
  }

  /** Hilo desde un punto de la pantalla (p. ej. un botón del panel) hasta unos rectángulos. */
  link(screenPoint, rects, color = COLORS.cyan) {
    const pulse = new Pulse(rects, color);
    const thread = new Thread(
      () => this.screenToWorld(typeof screenPoint === 'function' ? screenPoint() : screenPoint),
      () => {
        const rs = typeof rects === 'function' ? rects() : rects;
        if (!rs?.length) return null;
        const u = unionRect(rs);
        return { x: u.x, y: u.y + Math.min(u.h, 24) / 2 };
      },
      color,
      Infinity,
    );
    this.fx.push(pulse, thread);
    return () => {
      pulse.dead = true;
      thread.dead = true;
    };
  }

  /** Llama a la araña libre más cercana para que se pose junto a algo (tarjetas de contexto). */
  summon(rects, color = COLORS.blue) {
    const target = { id: `summon-${Math.random()}`, rects: () => rects, color };
    target.anchor = () => rects[0];
    let sp = this.spiders.filter((s) => s.state === 'rest' || s.state === 'wander')
      .sort((a, b) => Math.hypot(a.x - rects[0].x, a.y - rects[0].y) - Math.hypot(b.x - rects[0].x, b.y - rects[0].y))[0];
    if (!sp && this.maxSpiders > 0) {
      this.spawn(1);
      sp = this.spiders[this.spiders.length - 1];
    }
    const pulse = new Pulse(rects, color);
    this.fx.push(pulse);
    if (sp) {
      sp.state = 'summon';
      sp.task = target;
    }
    return () => {
      pulse.dead = true;
      if (sp && sp.task === target) {
        sp.task = null;
        sp.state = 'wander';
      }
    };
  }

  clearMarks() {
    this.boxes = [];
    this.labels = [];
  }

  reset() {
    this.queue = [];
    this.claimed.clear();
    this.done.clear();
    this.boxes = [];
    this.labels = [];
    this.fx = [];
    for (const sp of this.spiders) {
      sp.state = 'wander';
      sp.task = null;
      sp.carry = null;
    }
  }

  cancelAutoScroll() {
    this.autoScroll = false;
  }

  /** Línea de escaneo horizontal (modo pantalla). progress 0..1 o null para ocultarla. */
  setScan(active) {
    this.scan = active ? { y: 0, dir: 1 } : null;
  }

  get busy() {
    return this.queue.length > 0 || this.spiders.some((s) => s.state === 'seek' || s.state === 'grab' || s.state === 'carry');
  }

  // ---------- Bucle ----------

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt, now / 1000);
    this.draw(now / 1000);
    requestAnimationFrame(this.frame);
  }

  update(dt, now = performance.now() / 1000) {
    // Si el rastreo se alarga, lo que falta se marca de golpe (en cascada).
    if (this.deadline && now > this.deadline) {
      this.deadline = null;
      const pending = this.queue.filter((t) => !this.claimed.has(t.id));
      this.queue = this.queue.filter((t) => this.claimed.has(t.id));
      pending.forEach((t, i) => this.markOnly(t, i * 0.03));
    }
    for (const sp of this.spiders) sp.update(dt);
    for (const b of this.boxes) b.update(dt);
    for (const f of this.fx) f.update(dt);
    for (const l of this.labels) l.update(dt);
    this.boxes = this.boxes.filter((b) => !b.dead);
    this.fx = this.fx.filter((f) => !f.dead);
    this.labels = this.labels.filter((l) => !l.dead);

    // Cuando no queda trabajo, las arañas se retiran a los bordes.
    if (!this.busy) {
      this.idleTimer += dt;
      if (this.idleTimer > 1.4) {
        this.spiders.forEach((sp, i) => {
          if (sp.state === 'wander') {
            sp.state = 'rest';
            const left = i % 2 === 0;
            sp.rest = { x: left ? rand(14, 40) : this.w - rand(14, 40), y: rand(60, this.h - 60) };
          }
        });
        this.autoScroll = false;
      }
    } else {
      this.idleTimer = 0;
      for (const sp of this.spiders) if (sp.state === 'rest' || sp.state === 'wander') this.assign(sp);
    }

    // Auto-scroll: la cámara sigue a las arañas hacia abajo, como en un rastreo.
    if (this.autoScroll && this.setCameraY) {
      const cam = this.getCamera();
      const active = this.spiders.filter((s) => s.task && (s.state === 'seek' || s.state === 'grab'));
      if (active.length) {
        const ys = active.map((s) => s.task.anchor()?.y ?? s.y).sort((a, b) => a - b);
        const desired = ys[Math.floor(ys.length / 2)] - this.h * 0.42;
        if (this.camY === null) this.camY = cam.y;
        const step = clamp(desired - this.camY, -380 * dt, 380 * dt);
        if (desired > this.camY + 30 || desired < this.camY - this.h * 0.5) this.camY += step;
        this.setCameraY(Math.max(0, this.camY));
      }
    }

    if (this.scan) {
      this.scan.y += dt * this.h * 0.55 * this.scan.dir;
      if (this.scan.y > this.h) { this.scan.y = this.h; this.scan.dir = -1; }
      if (this.scan.y < 0) { this.scan.y = 0; this.scan.dir = 1; }
    }
  }

  draw(t) {
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Estrellas (pantalla)
    if (this.starsOn) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const s of this.stars) {
        const a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
        ctx.fillStyle = `rgba(220,226,255,${a})`;
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }
    }

    if (this.decor === 'web') this.drawWeb(ctx, t);

    const cam = this.getCamera();
    ctx.setTransform(dpr, 0, 0, dpr, -cam.x * dpr, -cam.y * dpr);
    for (const b of this.boxes) b.draw(ctx);
    for (const f of this.fx) f.draw(ctx);
    for (const sp of this.spiders) sp.draw(ctx);
    for (const l of this.labels) l.draw(ctx);

    if (this.scan) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const y = this.scan.y;
      const g = ctx.createLinearGradient(0, y - 40, 0, y + 2);
      g.addColorStop(0, 'rgba(60,240,255,0)');
      g.addColorStop(1, 'rgba(60,240,255,0.22)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 40, this.w, 42);
      ctx.fillStyle = 'rgba(160,250,255,0.9)';
      ctx.fillRect(0, y, this.w, 1);
    }
  }

  drawWeb(ctx, t) {
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = this.w * 0.5, cy = this.h * 0.42;
    const R = Math.max(this.w, this.h) * 0.75;
    ctx.strokeStyle = 'rgba(169,139,255,0.10)';
    ctx.lineWidth = 1;
    const spokes = 18;
    ctx.beginPath();
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * TAU + 0.1;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    }
    for (let ring = 1; ring < 16; ring++) {
      const r = ring * ring * 4.2 + ring * 18;
      for (let i = 0; i <= spokes; i++) {
        const a = (i / spokes) * TAU + 0.1;
        const wob = 1 + 0.04 * Math.sin(t * 0.8 + ring + i);
        const x = cx + Math.cos(a) * r * wob, y = cy + Math.sin(a) * r * wob;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  destroy() {
    this.running = false;
    this.ro.disconnect();
    this.canvas.remove();
  }
}
