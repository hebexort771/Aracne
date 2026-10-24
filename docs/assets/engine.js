// Motor de arañas digitales.
// Arañas procedurales con 8 patas (cinemática inversa de 2 segmentos y marcha alternada)
// que bajan colgadas de un hilo, leen el texto renglón por renglón, atrapan "presas"
// (rectángulos de texto) y dejan recuadros de neón, palabras decodificadas, telarañas,
// huellas, etiquetas con efecto glitch y paquetes de datos que vuelan hacia el panel.

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
  leg: '#c3cbff',
};

const ACCENTS = [COLORS.cyan, COLORS.magenta, COLORS.violet, COLORS.green, COLORS.blue, COLORS.amber];
const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace';
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=<>/\\|{}[]';
const FREE = new Set(['wander', 'read']);

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const glyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

const rgbCache = new Map();
function hexToRgb(hex) {
  let v = rgbCache.get(hex);
  if (v) return v;
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  rgbCache.set(hex, v);
  return v;
}
function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a < 0 ? 0 : a > 1 ? 1 : a})`;
}

function unionRect(rects) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function scramble(text, reveal) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    out += i / text.length < reveal || ch === ' ' ? ch : glyph();
  }
  return out;
}

/** Texto monoespaciado ajustado al ancho de un rectángulo. */
function fitText(ctx, text, r, color, weight = 600) {
  const size = Math.max(7, r.h * 0.78);
  ctx.font = `${weight} ${size}px ${MONO}`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  const m = ctx.measureText(text).width || 1;
  const sx = clamp(r.w / m, 0.45, 1.5);
  ctx.save();
  ctx.translate(r.x, r.y + r.h / 2 + 0.5);
  ctx.scale(sx, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
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

  restPoint(lead = 0, k = 1) {
    const sp = this.spider;
    const a = sp.heading + this.angle;
    return {
      x: sp.x + Math.cos(a) * this.reach * k + sp.vx * lead,
      y: sp.y + Math.sin(a) * this.reach * k + sp.vy * lead,
    };
  }

  get stepping() {
    return this.t < 1;
  }

  /** Colgando de un hilo: patas recogidas que se mueven en el aire. */
  dangle(time) {
    const wob = Math.sin(time * 14 + this.idx * 1.7 + this.side) * 0.12;
    const sp = this.spider;
    const a = sp.heading + this.angle * (0.8 + wob);
    this.foot.x = sp.x + Math.cos(a) * this.reach * 0.58;
    this.foot.y = sp.y + Math.sin(a) * this.reach * 0.58;
    this.t = 1;
  }

  update(dt, canStep) {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.dur);
      // El destino del paso se actualiza mientras la araña sigue avanzando.
      this.to = this.restPoint(this.dur * 1.4 * (1 - this.t) + 0.03);
      const e = easeInOut(this.t);
      this.foot.x = lerp(this.from.x, this.to.x, e);
      this.foot.y = lerp(this.from.y, this.to.y, e);
      if (this.t >= 1) this.spider.world.footprint(this.foot.x, this.foot.y, this.spider.accent);
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
    this.heading = opts.heading ?? rand(0, TAU);
    this.size = opts.size || rand(0.78, 1.12);
    this.color = opts.color || COLORS.leg;
    this.accent = opts.accent || ACCENTS[this.id % ACCENTS.length];
    this.maxSpeed = rand(250, 330) * (opts.speed || 1);
    this.readSpeed = rand(230, 330);
    this.state = 'wander';
    this.task = null;
    this.timer = rand(0.2, 0.6);
    this.wanderAngle = rand(-1, 1);
    this.alpha = 0;
    this.carry = null;
    this.line = null; // renglón que está leyendo
    this.prevLine = null;
    this.phase = 'approach';
    this.slow = 0;
    this.flash = 0;
    this.flashColor = this.accent;
    this.tag = null; // {text, age}
    this.anchor = { x, y }; // punto donde está pegado su hilo de seda
    this.travel = 0;
    this.dead = false;
    this.legs = [];
    for (let i = 0; i < 4; i++) {
      this.legs.push(new Leg(this, -1, i), new Leg(this, 1, i));
    }
  }

  get free() {
    return FREE.has(this.state);
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

  /** Deambular orgánico (sin quedarse quieta): un punto que se mueve en un círculo delante de ella. */
  wander(dt, speedFactor = 0.5) {
    const w = this.world;
    const v = w.usableRect();
    this.wanderAngle = clamp(this.wanderAngle + rand(-1, 1) * 4 * dt, -1.4, 1.4);
    const ahead = 70, radius = 46;
    const hx = this.x + Math.cos(this.heading) * ahead;
    const hy = this.y + Math.sin(this.heading) * ahead;
    let tx = hx + Math.cos(this.heading + this.wanderAngle) * radius;
    let ty = hy + Math.sin(this.heading + this.wanderAngle) * radius;
    const m = 70;
    if (tx < v.x + m || tx > v.x + v.w - m || ty < v.y + m || ty > v.y + v.h - m) {
      tx = lerp(tx, v.x + v.w / 2, 0.55);
      ty = lerp(ty, v.y + v.h / 2, 0.55);
      this.wanderAngle *= 0.6;
    }
    // Durante el escaneo de pantalla siguen la línea de luz.
    if (w.scan) ty = lerp(ty, v.y + w.scan.y, 0.35);
    this.seek(tx, ty, dt, speedFactor, 1);
  }

  update(dt, time) {
    const w = this.world;
    this.alpha = Math.min(1, this.alpha + dt * 2.5);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.slow = Math.max(0, this.slow - dt);
    if (this.tag) this.tag.age += dt;

    if (this.state === 'drop' || this.state === 'leave') {
      this.updateHanging(dt, time);
      return;
    }

    // Separación entre arañas
    for (const o of w.spiders) {
      if (o === this || o.state === 'drop' || o.state === 'leave') continue;
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
        if (r) this.seek(r.x + Math.min(r.w * 0.2, 14) + Math.sin(time * 30) * 2, r.y + r.h / 2, dt, 0.25, 30);
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.carry) this.state = 'carry';
          else this.finishTask();
        }
        break;
      }
      case 'carry': {
        const p = w.screenToWorld(this.carry.to());
        const d = this.seek(p.x, p.y, dt, 1.25, 60);
        if (d < 16) {
          w.ripple(this.x, this.y, this.carry.color);
          w.emit('arrive', this.task);
          this.carry.done = true;
          this.carry = null;
          this.finishTask();
        }
        break;
      }
      case 'summon': {
        // Se pasea de un lado a otro junto a lo que señala (no se queda quieta).
        const r = this.task.anchor();
        if (r) {
          this.timer += dt;
          const span = clamp(r.w, 30, 180) + 30;
          const tx = r.x - 16 + (0.5 - 0.5 * Math.cos(this.timer * 1.5)) * span;
          this.seek(tx, r.y + r.h / 2, dt, 0.8, 30);
        }
        break;
      }
      case 'read':
        this.updateReading(dt);
        break;
      default: {
        this.timer -= dt;
        if (this.timer <= 0) {
          this.timer = rand(0.9, 2.2);
          if (w.findWork(this)) break;
        }
        this.wander(dt, w.reader ? 0.62 : 0.5);
      }
    }

    const speed = Math.hypot(this.vx, this.vy);
    const max = this.maxSpeed * (this.state === 'carry' ? 1.3 : 1);
    if (speed > max) {
      this.vx *= max / speed;
      this.vy *= max / speed;
    }
    if (this.state === 'grab') {
      const damp = Math.pow(0.12, dt);
      this.vx *= damp;
      this.vy *= damp;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.travel += speed * dt;
    if (speed > 12) {
      const target = Math.atan2(this.vy, this.vx);
      let diff = target - this.heading;
      while (diff > Math.PI) diff -= TAU;
      while (diff < -Math.PI) diff += TAU;
      this.heading += diff * Math.min(1, dt * 7);
    }

    // Hilo de seda: cada cierto trecho lo pega al suelo y deja un tramo de telaraña.
    if (this.travel > 150) this.attachSilk();

    // Marcha alternada: un grupo de patas pisa mientras el otro avanza.
    const steppingGroup = this.legs.find((l) => l.stepping)?.group;
    for (const leg of this.legs) {
      leg.update(dt, steppingGroup === undefined || steppingGroup === leg.group);
    }
    if (this.carry) this.carry.follow(this, dt);
  }

  attachSilk() {
    const tail = this.tail();
    this.world.silk(this.anchor, tail, this.accent);
    this.anchor = tail;
    this.travel = 0;
  }

  tail() {
    return { x: this.x - Math.cos(this.heading) * 13 * this.size, y: this.y - Math.sin(this.heading) * 13 * this.size };
  }

  updateHanging(dt, time) {
    const w = this.world;
    if (this.state === 'drop') {
      // Baja en coordenadas de pantalla: aunque hagas scroll, la ves colgando dentro de la vista.
      const cam = w.getCamera();
      if (this.delay > 0) {
        this.delay -= dt;
        this.y = cam.y + this.dropS;
        this.threadTop = cam.y - 4;
        for (const leg of this.legs) leg.dangle(time);
        return;
      }
      const d = this.landS - this.dropS;
      this.vy = Math.max(60, Math.min(900, d * 5));
      this.dropS += this.vy * dt;
      this.y = cam.y + this.dropS;
      this.threadTop = cam.y - 4;
      this.x += Math.sin(time * 2 + this.id) * 6 * dt;
      this.heading = lerp(this.heading, Math.PI / 2, Math.min(1, dt * 4));
      if (d < 3) {
        this.state = 'wander';
        this.vx = rand(-40, 40);
        this.vy = 60;
        this.anchor = { x: this.x, y: this.threadTop };
        w.silk({ x: this.x, y: this.threadTop }, { x: this.x, y: this.y }, this.accent, 2.2);
        this.anchor = this.tail();
        w.ripple(this.x, this.y, this.accent);
        this.timer = rand(0.05, 0.3);
        if (this.pendingSummon) {
          this.task = this.pendingSummon;
          this.pendingSummon = null;
          this.state = 'summon';
          this.timer = 0;
        }
      }
    } else {
      this.vy = -lerp(160, 520, clamp((this.threadBottom - this.y) / 200, 0, 1));
      this.y += this.vy * dt;
      this.heading = lerp(this.heading, -Math.PI / 2, Math.min(1, dt * 4));
      if (this.y < this.threadTop - 40) this.dead = true;
    }
    for (const leg of this.legs) leg.dangle(time);
  }

  // ---------- Lectura renglón por renglón ----------

  startLine(L) {
    this.state = 'read';
    this.line = L;
    this.phase = 'approach';
    this.words = null;
    this.wordIdx = 0;
    this.latentHere = null;
    this.trail = null;
    this.readT = 0;
  }

  updateReading(dt) {
    const w = this.world;
    const L = this.line;
    if (!L || L.gone) {
      this.endLine(false);
      return;
    }
    this.readT += dt;
    const cy = L.y + L.h / 2;
    const xEnd = Math.min(L.x + L.w, w.usableRight());
    if (this.phase === 'approach') {
      const d = this.seek(L.x - 4, cy, dt, 1.15, 40);
      if (this.readT > 4) {
        this.endLine(false);
        return;
      }
      if (d < 16) {
        this.phase = 'sweep';
        this.sweepX = Math.max(L.x, Math.min(this.x, L.x + 10));
        this.words = L.words ? L.words() : [];
        this.wordIdx = 0;
        this.latentHere = w.latentOn(L);
        this.trail = w.startTrail(this, L);
        this.attachSilk();
      }
      return;
    }
    // Avanza por el renglón a velocidad de lectura; frena un poco al atrapar algo.
    const spd = this.readSpeed * (this.slow > 0 ? 0.3 : 1) * (L.loud ? 1 : 1.35);
    this.sweepX += spd * dt;
    const dvx = spd + (this.sweepX - this.x) * 5;
    const dvy = (cy - this.y) * 9;
    const k = Math.min(1, dt * 12);
    this.vx = lerp(this.vx, dvx, k);
    this.vy = lerp(this.vy, dvy, k);
    const head = this.x + Math.cos(this.heading) * 9 * this.size;
    if (this.trail) this.trail.x1 = clamp(head, L.x, xEnd);
    // Palabras que va pasando
    if (this.words) {
      while (this.wordIdx < this.words.length) {
        const wd = this.words[this.wordIdx];
        if (wd.x + wd.w * 0.45 > head) break;
        this.wordIdx++;
        if (wd.x + wd.w <= xEnd + 2) w.onWord(this, wd, L);
      }
    }
    // Hallazgos escondidos en este renglón
    if (this.latentHere?.length) {
      while (this.latentHere.length && this.latentHere[0].rx <= head) {
        const t = this.latentHere.shift().t;
        if (w.reveal(t, this)) this.slow = 0.32;
      }
    }
    if (this.sweepX >= xEnd + 2) this.endLine(true);
  }

  endLine(completed, next = true) {
    const w = this.world;
    const L = this.line;
    if (this.trail) this.trail.done = true;
    this.trail = null;
    if (L) w.finishLine(this, L, completed);
    this.prevLine = completed ? L : null;
    this.line = null;
    this.state = 'wander';
    this.timer = rand(0.4, 1.2);
    if (next && w.findWork(this)) this.timer = 0;
  }

  finishTask() {
    if (this.task) this.world.release(this, this.task);
    this.task = null;
    this.state = 'wander';
    this.timer = 0;
    this.world.findWork(this);
  }

  draw(ctx, time) {
    const w = this.world;
    const a = this.alpha * w.spiderAlpha;
    if (a <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = a;

    // Hilo del que cuelga (al bajar o al irse)
    if (this.state === 'drop' || this.state === 'leave') {
      ctx.strokeStyle = rgba(COLORS.white, 0.55);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(this.x, this.threadTop);
      ctx.lineTo(this.x, this.y - 6 * this.size);
      ctx.stroke();
    } else if (w.level.silk && this.anchor) {
      // Seda que va soltando
      const tail = this.tail();
      ctx.strokeStyle = rgba(this.accent, 0.22);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(this.anchor.x, this.anchor.y);
      ctx.lineTo(tail.x, tail.y);
      ctx.stroke();
    }

    // Haz de lectura (como un escáner) delante de la cabeza
    if (this.state === 'read' && this.phase === 'sweep' && this.line) {
      const L = this.line;
      const hx = this.x + Math.cos(this.heading) * 9 * this.size;
      const g = ctx.createLinearGradient(hx, 0, hx + 46, 0);
      g.addColorStop(0, rgba(this.accent, 0.32));
      g.addColorStop(1, rgba(this.accent, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(hx, this.y - 2);
      ctx.lineTo(hx + 46, L.y - 3);
      ctx.lineTo(hx + 46, L.y + L.h + 3);
      ctx.lineTo(hx, this.y + 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgba(this.accent, 0.9);
      ctx.fillRect(hx + 1, L.y - 2, 1.5, L.h + 4);
    }

    // Patas: fémur más grueso, tibia fina
    const joints = [];
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    const knees = [];
    for (const leg of this.legs) {
      const hip = leg.hip();
      const knee = leg.knee(hip);
      knees.push(knee);
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(knee.x, knee.y);
    }
    ctx.stroke();
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    this.legs.forEach((leg, i) => {
      ctx.moveTo(knees[i].x, knees[i].y);
      ctx.lineTo(leg.foot.x, leg.foot.y);
      joints.push(knees[i], leg.foot);
    });
    ctx.stroke();
    ctx.fillStyle = this.color;
    for (let i = 0; i < joints.length; i++) {
      const j = joints[i];
      ctx.beginPath();
      ctx.arc(j.x, j.y, i % 2 ? 1 : 1.5, 0, TAU);
      ctx.fill();
    }

    // Cuerpo
    const s0 = this.size;
    const glow = this.flash > 0 ? this.flashColor : this.accent;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.heading);
    // Abdomen con marca que late
    const breathe = 1 + 0.05 * Math.sin(time * 5 + this.id);
    ctx.beginPath();
    ctx.ellipse(-8.5 * s0, 0, 7.4 * s0 * breathe, 5.3 * s0 * breathe, 0, 0, TAU);
    ctx.fillStyle = 'rgba(7,9,20,0.92)';
    ctx.fill();
    ctx.strokeStyle = rgba(glow, 0.95);
    ctx.lineWidth = 1;
    ctx.stroke();
    const pulse = 0.55 + 0.45 * Math.sin(time * 4 + this.id * 2);
    ctx.fillStyle = rgba(glow, 0.35 + 0.5 * pulse);
    ctx.beginPath();
    ctx.moveTo(-4.5 * s0, 0);
    ctx.lineTo(-8.5 * s0, -2.2 * s0);
    ctx.lineTo(-12.5 * s0, 0);
    ctx.lineTo(-8.5 * s0, 2.2 * s0);
    ctx.closePath();
    ctx.fill();
    // Cefalotórax brillante
    ctx.shadowColor = glow;
    ctx.shadowBlur = 8 + this.flash * 16;
    ctx.beginPath();
    ctx.ellipse(1.8 * s0, 0, 3.9 * s0, 3.3 * s0, 0, 0, TAU);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.shadowBlur = 0;
    // Ojos
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(4.4 * s0, -1.7 * s0, 1.3, 1.3);
    ctx.fillRect(4.4 * s0, 0.5 * s0, 1.3, 1.3);
    ctx.fillStyle = 'rgba(4,5,12,.9)';
    ctx.fillRect(3.2 * s0, -0.4 * s0, 0.9, 0.9);
    ctx.restore();

    // Lo que está leyendo, en monoespaciado sobre su cabeza
    if (this.tag && w.level.tags && this.id % 2 === 0 && this.tag.age < 1.4) {
      const t = this.tag;
      const fade = t.age > 1 ? 1 - (t.age - 1) / 0.4 : 1;
      const txt = scramble(`› ${t.text}`, t.age / 0.18);
      ctx.font = `600 10px ${MONO}`;
      ctx.textBaseline = 'alphabetic';
      const x = this.x + 10, y = this.y - 16 * s0;
      ctx.globalAlpha = a * 0.5 * fade;
      ctx.fillStyle = COLORS.magenta;
      ctx.fillText(txt, x + 0.8, y);
      ctx.fillStyle = COLORS.cyan;
      ctx.fillText(txt, x - 0.8, y);
      ctx.globalAlpha = a * 0.9 * fade;
      ctx.fillStyle = this.accent;
      ctx.fillText(txt, x, y);
    }
    ctx.restore();
  }
}

// ------------------------------------------------------------------
// Efectos
// ------------------------------------------------------------------
class Box {
  constructor(world, target, opts = {}) {
    this.world = world;
    this.target = target;
    this.color = target.color || COLORS.cyan;
    this.age = 0;
    this.hold = opts.hold ?? (target.style === 'decode' ? 1.8 : world.boxHold);
    this.mark = target.mark !== false && target.style !== 'decode';
    this.dead = false;
  }

  update(dt) {
    this.age += dt;
    if (!this.mark && this.age > this.hold + 1.2) this.dead = true;
  }

  draw(ctx) {
    if (this.age < 0) return;
    const rects = this.target.rects();
    if (!rects || !rects.length) return;
    const grow = clamp(this.age / 0.22, 0, 1);
    const k = easeOutBack(grow);
    const strong = this.age < this.hold ? 1 : Math.max(0, 1 - (this.age - this.hold) / 1.1); // 1 = sólido, 0 = marca suave
    const style = this.target.style;
    const solidText = this.world.solidText && rects.length === 1 && this.target.text && style !== 'outline' && style !== 'underline';
    for (const r0 of rects) {
      if (style === 'underline') {
        const g = easeOut(clamp(this.age / 0.4, 0, 1));
        const y = r0.y + r0.h - 0.5;
        if (strong > 0.02) {
          ctx.fillStyle = rgba(this.color, 0.14 * strong);
          ctx.fillRect(r0.x - 1, r0.y, r0.w * g + 2, r0.h);
        }
        ctx.fillStyle = rgba(this.color, 0.55 + 0.45 * strong);
        ctx.fillRect(r0.x, y - 0.75, r0.w * g, 1.5);
        continue;
      }
      const pad = 1.5;
      const cx = r0.x + r0.w / 2, cy = r0.y + r0.h / 2;
      const w = (r0.w + pad * 2) * (0.4 + 0.6 * k);
      const h = (r0.h + pad * 2) * k;
      const x = cx - w / 2, y = cy - h / 2;
      if (style === 'outline') {
        ctx.strokeStyle = rgba(this.color, 0.55 + 0.45 * strong);
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        continue;
      }
      const fade = this.mark ? 1 : strong;
      const fillA = (solidText ? 0.18 + 0.78 * strong : 0.16 + 0.3 * strong) * fade;
      if (fillA < 0.01) continue;
      ctx.fillStyle = rgba(this.color, fillA);
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = rgba(this.color, (0.4 + 0.5 * strong) * fade);
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      if (grow < 1) {
        ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - grow)})`;
        ctx.fillRect(x, y, w, h);
      }
      // Esquinas tipo visor
      if (strong > 0.3 && r0.w > 24) {
        ctx.strokeStyle = rgba(this.color, strong);
        ctx.beginPath();
        const c = 5;
        ctx.moveTo(x - 2, y + c); ctx.lineTo(x - 2, y - 2); ctx.lineTo(x + c, y - 2);
        ctx.moveTo(x + w + 2 - c, y + h + 2); ctx.lineTo(x + w + 2, y + h + 2); ctx.lineTo(x + w + 2, y + h + 2 - c);
        ctx.stroke();
      }
      if (solidText && strong > 0.05) {
        // Texto re-escrito en monoespaciado, como en un rastreador (se decodifica al aparecer).
        ctx.save();
        ctx.globalAlpha = strong;
        fitText(ctx, scramble(this.target.text, this.age / 0.35), r0, '#04050b');
        ctx.restore();
      }
    }
  }
}

/** Palabra que una araña acaba de leer: se enciende y se decodifica un instante. */
class WordFlash {
  constructor(word, color, mode) {
    this.r = { x: word.x, y: word.y, w: word.w, h: word.h };
    this.text = word.text;
    this.color = color;
    this.mode = mode;
    this.age = 0;
    this.life = mode === 'box' ? 0.9 : 0.55;
    this.dead = false;
  }
  update(dt) {
    this.age += dt;
    if (this.age > this.life) this.dead = true;
  }
  draw(ctx) {
    const t = this.age;
    const env = t < 0.05 ? t / 0.05 : t < 0.32 ? 1 : 1 - (t - 0.32) / (this.life - 0.32);
    if (env <= 0) return;
    const r = this.r;
    if (this.mode === 'box') {
      ctx.fillStyle = rgba(this.color, 0.88 * env);
      ctx.fillRect(r.x - 1.5, r.y - 0.5, r.w + 3, r.h + 1);
      ctx.save();
      ctx.globalAlpha = env;
      fitText(ctx, t < 0.16 ? scramble(this.text, t / 0.16) : this.text, r, '#04050b');
      ctx.restore();
    } else {
      ctx.strokeStyle = rgba(this.color, 0.8 * env);
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x - 1, r.y - 0.5, r.w + 2, r.h + 1);
    }
  }
}

/** Estela de lectura: subrayado brillante del tramo ya leído. */
class ReadTrail {
  constructor(L, color, loud) {
    this.L = L;
    this.color = color;
    this.loud = loud;
    this.x1 = L.x;
    this.done = false;
    this.age = 0;
    this.dead = false;
  }
  update(dt) {
    if (this.done) {
      this.age += dt;
      if (this.age > (this.loud ? 1.8 : 1)) this.dead = true;
    }
  }
  draw(ctx) {
    const L = this.L;
    const w = this.x1 - L.x;
    if (w <= 1) return;
    const fade = this.done ? 1 - this.age / (this.loud ? 1.8 : 1) : 1;
    const y = L.y + L.h + 0.5;
    const g = ctx.createLinearGradient(L.x, 0, this.x1, 0);
    g.addColorStop(0, rgba(this.color, 0));
    g.addColorStop(Math.max(0, 1 - 160 / w), rgba(this.color, 0.25 * fade));
    g.addColorStop(1, rgba(this.color, 0.95 * fade));
    ctx.fillStyle = g;
    ctx.fillRect(L.x, y - 0.6, w, 1.3);
    if (this.loud) {
      ctx.fillStyle = rgba(this.color, 0.07 * fade);
      ctx.fillRect(L.x, L.y - 1, w, L.h + 2);
    }
  }
}

/** Tramo de telaraña con caída y un brillo que lo recorre. */
class Silk {
  constructor(a, b, color, life = 7) {
    this.a = { x: a.x, y: a.y };
    this.b = { x: b.x, y: b.y };
    this.color = color;
    this.age = 0;
    this.life = life;
    this.dead = false;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    this.sag = Math.min(18, len * 0.07);
  }
  update(dt) {
    this.age += dt;
    if (this.age > this.life) this.dead = true;
  }
  draw(ctx) {
    const f = 1 - this.age / this.life;
    const { a, b } = this;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + this.sag;
    ctx.strokeStyle = rgba(this.color, 0.2 * f);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(mx, my, b.x, b.y);
    ctx.stroke();
    const t = (this.age * 0.8) % 1.6;
    if (t < 1) {
      const u = 1 - t;
      const x = u * u * a.x + 2 * u * t * mx + t * t * b.x;
      const y = u * u * a.y + 2 * u * t * my + t * t * b.y;
      ctx.fillStyle = rgba(COLORS.white, 0.7 * f);
      ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
    }
  }
}

/** Telaraña permanente entre hallazgos (se desvanece despacio). */
class WebStrand extends Silk {
  constructor(a, b, color) {
    super(a, b, color, 16);
  }
  draw(ctx) {
    const f = Math.min(1, (1 - this.age / this.life) * 1.6);
    const { a, b } = this;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + this.sag;
    ctx.strokeStyle = rgba(this.color, 0.38 * f);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(mx, my, b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = rgba(this.color, 0.8 * f);
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6, 0, TAU);
      ctx.fill();
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
  }

  update(dt) {
    this.age += dt;
    if (this.age > this.life) this.dead = true;
  }

  draw(ctx) {
    const reveal = this.age / 0.55;
    const fade = this.age > this.life - 0.8 ? (this.life - this.age) / 0.8 : 1;
    const out = scramble(this.text, reveal);
    ctx.save();
    ctx.font = `500 ${this.size}px ${MONO}`;
    ctx.textBaseline = 'alphabetic';
    const jitter = this.age < 0.6 ? rand(-1, 1) : 0;
    // Corte horizontal tipo glitch durante la aparición
    const slice = this.age < 0.5 && Math.random() < 0.3 ? rand(-6, 6) : 0;
    ctx.globalAlpha = 0.55 * fade;
    ctx.fillStyle = COLORS.cyan;
    ctx.fillText(out, this.x - 1.2 + jitter + slice, this.y);
    ctx.fillStyle = COLORS.magenta;
    ctx.fillText(out, this.x + 1.2 - jitter, this.y);
    ctx.globalAlpha = fade;
    ctx.fillStyle = this.color;
    ctx.fillText(out, this.x, this.y);
    ctx.restore();
  }
}

/** Barras de interferencia alrededor de lo que se atrapa. */
class GlitchBars {
  constructor(r, color) {
    this.bars = Array.from({ length: 4 + ((Math.random() * 3) | 0) }, () => ({
      x: r.x + rand(-30, r.w * 0.7),
      y: r.y + rand(-10, r.h + 8),
      w: rand(18, Math.max(30, r.w * 0.8)),
      h: rand(1, 3.5),
      c: Math.random() < 0.5 ? COLORS.cyan : Math.random() < 0.5 ? COLORS.magenta : color,
    }));
    this.age = 0;
    this.dead = false;
  }
  update(dt) {
    this.age += dt;
    if (this.age > 0.32) this.dead = true;
  }
  draw(ctx) {
    for (const b of this.bars) {
      if (Math.random() < 0.35) continue;
      ctx.fillStyle = rgba(b.c, 0.75 * (1 - this.age / 0.32));
      ctx.fillRect(b.x + rand(-4, 4), b.y, b.w, b.h);
    }
  }
}

/** Letras que se desprenden de lo leído y flotan hacia arriba. */
class Glyph {
  constructor(x, y, ch, color) {
    this.x = x;
    this.y = y;
    this.ch = ch;
    this.color = color;
    this.vy = -rand(16, 42);
    this.vx = rand(-8, 8);
    this.age = 0;
    this.life = rand(0.5, 0.9);
    this.dead = false;
  }
  update(dt) {
    this.age += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (Math.random() < 0.2) this.ch = glyph();
    if (this.age > this.life) this.dead = true;
  }
  draw(ctx) {
    const f = 1 - this.age / this.life;
    ctx.font = `600 10px ${MONO}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = rgba(COLORS.magenta, 0.5 * f);
    ctx.fillText(this.ch, this.x + 1, this.y);
    ctx.fillStyle = rgba(this.color, f);
    ctx.fillText(this.ch, this.x, this.y);
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
    if (this.sticky) {
      // Pulso de datos que viaja por el hilo
      const p = (this.age * 1.2) % 1;
      ctx.fillStyle = rgba(COLORS.white, 0.9);
      ctx.fillRect(lerp(a.x, b.x, p) - 1, lerp(a.y, b.y, p) - 1, 2, 2);
    }
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

/** Paquete de datos que vuela de un hallazgo al panel (en coordenadas de pantalla). */
class Packet {
  constructor(world, from, to, color, target) {
    this.world = world;
    this.from = from;
    this.to = to;
    this.color = color;
    this.target = target;
    this.age = 0;
    this.dur = rand(0.65, 0.95);
    this.dead = false;
    this.lift = rand(60, 160);
    this.trail = [];
  }
  update(dt) {
    this.age += dt;
    if (this.age >= this.dur) {
      this.dead = true;
      this.world.emit('arrive', this.target);
    }
  }
  pos(t) {
    const b = this.to();
    const a = this.from;
    const cx = (a.x + b.x) / 2, cy = Math.min(a.y, b.y) - this.lift;
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y };
  }
  draw(ctx) {
    const t = easeInOut(clamp(this.age / this.dur, 0, 1));
    const p = this.pos(t);
    this.trail.push(p);
    if (this.trail.length > 12) this.trail.shift();
    for (let i = 1; i < this.trail.length; i++) {
      ctx.strokeStyle = rgba(this.color, (i / this.trail.length) * 0.7);
      ctx.lineWidth = 3 * (i / this.trail.length);
      ctx.beginPath();
      ctx.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
      ctx.lineTo(this.trail[i].x, this.trail[i].y);
      ctx.stroke();
    }
    ctx.fillStyle = COLORS.white;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    ctx.strokeStyle = rgba(this.color, 0.9);
    ctx.strokeRect(p.x - 4.5, p.y - 4.5, 9, 9);
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
    if (t < 0.5) {
      ctx.strokeStyle = rgba(COLORS.white, 0.6 * (1 - t * 2));
      ctx.beginPath();
      ctx.arc(this.x, this.y, 2 + t * 12, 0, TAU);
      ctx.stroke();
    }
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
const LEVELS = {
  alta: { spiders: 9, carryChance: 0.5, carryMax: 4, word: 'box', glyphs: 0.32, prints: true, tags: true, silk: true, packets: true },
  media: { spiders: 6, carryChance: 0.3, carryMax: 2, word: 'outline', glyphs: 0.12, prints: true, tags: false, silk: true, packets: true },
  baja: { spiders: 3, carryChance: 0, carryMax: 0, word: 'none', glyphs: 0, prints: false, tags: false, silk: false, packets: false },
  apagada: { spiders: 0, carryChance: 0, carryMax: 0, word: 'none', glyphs: 0, prints: false, tags: false, silk: false, packets: false },
};

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
    this.under = []; // efectos bajo las arañas: estelas, palabras, seda
    this.silks = [];
    this.prints = [];
    this.labels = [];
    this.packets = []; // en coordenadas de pantalla
    this.queue = [];
    this.claimed = new Set();
    this.done = new Set();
    this.latent = [];
    this.autoScroll = false;
    this.camY = null;
    this.spiderAlpha = 1;
    this.grabTime = 0.4;
    this.carryBudget = 0;
    this.deadline = null;
    this.boxHold = 2.6;
    this.starsOn = stars;
    this.stars = [];
    this.scan = null; // {y, dir}
    this.listeners = { grab: [], arrive: [], word: [] };
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.active = true;
    this.patrol = true;
    this.reader = null;
    this.lines = [];
    this.lineMap = new Map();
    this.linesAt = -1;
    this.linesCam = null;
    this.lineClaims = new Map();
    this.readAt = new Map();
    this.everRead = new Set();
    this.wordsRead = 0;
    this.totalWords = 0;
    this.found = 0;
    this.lastPacket = 0;
    this.time = 0;
    this.latentCheck = 0;
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
    (this.listeners[event] ||= []).push(fn);
  }

  emit(event, payload) {
    for (const fn of this.listeners[event] || []) fn(payload);
  }

  setIntensity(level) {
    this.intensity = level;
    const L = LEVELS[level] || LEVELS.media;
    this.level = L;
    this.maxSpiders = L.spiders;
    this.carryChance = L.carryChance;
    this.carryMax = L.carryMax;
    if (this.spiders.length > this.maxSpiders) {
      for (const sp of this.spiders.slice(this.maxSpiders)) this.sendAway(sp);
    }
    if (this.maxSpiders === 0) this.flushLatent();
    this.topUp();
  }

  /** Deja de soltar arañas (o vuelve a soltarlas). Las que están se van trepando por su hilo. */
  setActive(on) {
    this.active = !!on;
    if (!this.active) {
      for (const t of this.queue.splice(0)) if (!this.done.has(t.id)) this.markOnly(t);
      this.claimed.clear();
      this.flushLatent();
      this.autoScroll = false;
      for (const sp of this.spiders) this.sendAway(sp);
    } else {
      this.topUp(true);
    }
  }

  /** Lectura continua del texto visible después del escaneo. */
  setPatrol(on) {
    this.patrol = !!on;
    if (!this.patrol) {
      for (const sp of this.spiders) if (sp.state === 'read') sp.endLine(false, false);
      this.flushLatent();
    }
    this.topUp();
  }

  setInsets(insets) {
    this.insets = { top: 0, right: 0, bottom: 0, left: 0, ...insets };
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
    this.linesAt = -1;
  }

  screenToWorld(p) {
    const c = this.getCamera();
    return { x: p.x + c.x, y: p.y + c.y };
  }

  worldToScreen(p) {
    const c = this.getCamera();
    return { x: p.x - c.x, y: p.y - c.y };
  }

  viewRect() {
    const c = this.getCamera();
    return { x: c.x, y: c.y, w: this.w, h: this.h };
  }

  /** Parte visible donde las arañas pueden andar (sin lo que tapan paneles flotantes). */
  usableRect() {
    const v = this.viewRect();
    const i = this.insets;
    return { x: v.x + i.left, y: v.y + i.top, w: Math.max(80, v.w - i.left - i.right), h: Math.max(80, v.h - i.top - i.bottom) };
  }

  usableRight() {
    const u = this.usableRect();
    return u.x + u.w - 8;
  }

  randomPoint() {
    const v = this.usableRect();
    return { x: v.x + rand(40, v.w - 40), y: v.y + rand(40, v.h - 40) };
  }

  get stats() {
    return {
      spiders: this.spiders.filter((s) => !s.dead && s.state !== 'leave').length,
      reading: this.spiders.filter((s) => s.state === 'read').length,
      wordsRead: this.wordsRead,
      totalWords: this.totalWords,
      progress: this.totalWords ? Math.min(1, this.wordsRead / this.totalWords) : 0,
      found: this.found,
      active: this.active,
    };
  }

  // ---------- Arañas ----------

  spawn(n = 1, color) {
    if (!this.active) return;
    const u = this.usableRect();
    for (let i = 0; i < n && this.liveCount() < this.maxSpiders; i++) {
      const x = u.x + rand(40, u.w - 40);
      const sp = new Spider(this, x, u.y - 30 - rand(0, 40), { color, heading: Math.PI / 2 });
      this.startDrop(sp, i * 0.12); // bajan escalonadas
      this.spiders.push(sp);
    }
  }

  startDrop(sp, delay = 0) {
    const cam = this.getCamera();
    const u = this.usableRect();
    sp.state = 'drop';
    sp.x = u.x + rand(40, u.w - 40);
    sp.dropS = this.insets.top - rand(30, 70);
    sp.landS = this.insets.top + rand(u.h * 0.12, u.h * 0.78);
    sp.y = cam.y + sp.dropS;
    sp.vx = 0;
    sp.vy = 0;
    sp.delay = delay;
    sp.threadTop = cam.y - 4;
    sp.heading = Math.PI / 2;
    sp.anchor = { x: sp.x, y: sp.y };
  }

  liveCount() {
    return this.spiders.filter((s) => s.state !== 'leave').length;
  }

  /** Mantiene la cantidad de arañas que corresponde. */
  topUp(force = false) {
    if (!this.active || this.maxSpiders === 0) return;
    const want = this.reader && this.patrol ? this.maxSpiders : force ? Math.min(this.maxSpiders, 4) : 0;
    const n = want - this.liveCount();
    if (n > 0) this.spawn(n);
  }

  sendAway(sp) {
    if (sp.state === 'leave') return;
    if (sp.state === 'read') sp.endLine(false, false);
    if (sp.task) this.release(sp, sp.task);
    sp.task = null;
    sp.carry = null;
    sp.state = 'leave';
    sp.threadTop = this.viewRect().y - 10;
    sp.threadBottom = sp.y;
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
    if (this.maxSpiders === 0 || !this.active) {
      // Sin animación: solo marcas.
      for (const t of this.queue.splice(0)) this.markOnly(t);
      return;
    }
    const want = Math.min(this.maxSpiders, 2 + Math.ceil(this.queue.length / 5));
    if (this.liveCount() < want) this.spawn(want - this.liveCount());
    for (const sp of this.spiders) if (sp.free) this.assign(sp);
  }

  /** Objetivos que se revelan cuando una araña lee el renglón donde están. */
  addLatent(targets) {
    for (const t of targets) {
      if (this.done.has(t.id)) continue;
      t.anchor = () => {
        const rs = t.rects();
        return rs && rs.length ? rs[0] : null;
      };
      t.seenAt = null;
      this.latent.push(t);
    }
    if (this.maxSpiders === 0 || !this.active || !this.patrol) this.flushLatent();
  }

  flushLatent() {
    const list = this.latent.splice(0);
    list.forEach((t, i) => !this.done.has(t.id) && this.markOnly(t, i * 0.01));
  }

  markOnly(t, delay = 0) {
    if (this.done.has(t.id)) return;
    const box = new Box(this, t, { hold: 0.4 });
    box.age = -delay;
    this.boxes.push(box);
    this.done.add(t.id);
    this.found++;
    this.emit('grab', t);
  }

  /** Busca algo que hacer: primero las presas pendientes, después leer. */
  findWork(sp) {
    if (this.assign(sp)) return true;
    if (sp.state === 'read') return true;
    const L = this.pickLine(sp);
    if (L) {
      this.claimLine(sp, L);
      sp.startLine(L);
      return true;
    }
    return false;
  }

  assign(sp) {
    if (!sp.free) return false;
    if (!this.queue.length) return false;
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
    if (!best) return false;
    if (sp.state === 'read') sp.endLine(false, false);
    this.claimed.add(best.id);
    sp.task = best;
    sp.state = 'seek';
    return true;
  }

  onGrabbed(sp, t) {
    const r = t.anchor();
    if (!r) return;
    this.capture(sp, t, r, { thread: true });
    if (t.carryTo && this.carryBudget > 0 && Math.random() < this.carryChance) {
      this.carryBudget--;
      sp.carry = new Carry(t.color || COLORS.magenta, t.carryTo);
      this.fx.push(sp.carry);
    } else this.sendPacket(r, t);
  }

  /** Revela un objetivo escondido cuando la araña lo lee. */
  reveal(t, sp) {
    if (this.done.has(t.id)) return false;
    const r = t.anchor();
    if (!r) return false;
    this.latent = this.latent.filter((x) => x !== t);
    this.capture(sp, t, r, { thread: false });
    this.sendPacket(r, t);
    return true;
  }

  capture(sp, t, r, { thread }) {
    const color = t.color || COLORS.cyan;
    this.boxes.push(new Box(this, t));
    if (thread) {
      this.fx.push(new Thread(() => ({ x: sp.x, y: sp.y }), () => {
        const a = t.anchor();
        return a ? { x: a.x + a.w / 2, y: a.y + a.h / 2 } : null;
      }, color, this.grabTime + 1));
    }
    if (t.label && this.labels.length < 14) {
      const lx = r.x + Math.min(r.w * 0.25, 60) + rand(-10, 30);
      const ly = r.y - rand(6, 22);
      this.labels.push(new GlitchLabel(t.label, lx, ly, color, { size: t.labelSize }));
    }
    this.ripple(r.x + 6, r.y + r.h / 2, color);
    if (this.level.word !== 'none') this.fx.push(new GlitchBars(r, color));
    sp.flash = 1;
    sp.flashColor = color;
    if (sp.lastGrab) {
      const prev = sp.lastGrab;
      if (Math.hypot(prev.x - r.x, prev.y - r.y) < 520) this.addSilk(new WebStrand(prev, { x: r.x, y: r.y + r.h / 2 }, color));
    }
    sp.lastGrab = { x: r.x, y: r.y + r.h / 2 };
    this.done.add(t.id);
    this.found++;
    this.emit('grab', t);
  }

  sendPacket(r, t) {
    if (!t.carryTo || !this.level.packets || this.packets.length > 24) return;
    if (this.time - this.lastPacket < 0.12) return;
    this.lastPacket = this.time;
    this.packets.push(new Packet(this, this.worldToScreen({ x: r.x + r.w / 2, y: r.y + r.h / 2 }), t.carryTo, t.color || COLORS.cyan, t));
  }

  release(sp, t) {
    this.queue = this.queue.filter((q) => q.id !== t.id);
    this.claimed.delete(t.id);
  }

  ripple(x, y, color) {
    this.fx.push(new Ripple(x, y, color));
  }

  footprint(x, y, color) {
    if (!this.level.prints || this.prints.length > 420) return;
    this.prints.push({ x, y, color, age: 0 });
  }

  silk(a, b, color, life) {
    if (!this.level.silk) return;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 4) return;
    this.addSilk(new Silk(a, b, color, life));
  }

  addSilk(s) {
    this.silks.push(s);
    if (this.silks.length > 160) this.silks.splice(0, this.silks.length - 160);
  }

  // ---------- Lectura ----------

  /**
   * Documento que las arañas leen sin parar: debe tener readingLines(view) → [{key, block, idx, x, y, w, h, start, end, words()}]
   * y wordCount().
   */
  setReader(reader) {
    for (const sp of this.spiders) if (sp.state === 'read') sp.endLine(false, false);
    this.reader = reader || null;
    this.lines = [];
    this.lineMap = new Map();
    this.linesAt = -1;
    this.lineClaims.clear();
    this.readAt.clear();
    this.everRead.clear();
    this.wordsRead = 0;
    this.found = 0;
    this.totalWords = reader?.wordCount ? reader.wordCount() : 0;
    this.topUp();
  }

  refreshLines(force = false) {
    if (!this.reader) return;
    const cam = this.getCamera();
    const moved = !this.linesCam || Math.abs(cam.y - this.linesCam.y) > 30 || Math.abs(cam.x - this.linesCam.x) > 30;
    if (!force && this.linesAt >= 0 && this.time - this.linesAt < (moved ? 0.15 : 0.6)) return;
    this.linesAt = this.time;
    this.linesCam = cam;
    let lines = [];
    try {
      lines = this.reader.readingLines(this.viewRect()) || [];
    } catch (err) {
      console.warn('readingLines', err);
    }
    this.lines = lines;
    const map = new Map();
    for (const L of lines) map.set(L.key, L);
    // Renglones que salieron de la vista: las arañas los abandonan.
    for (const [key, L] of this.lineMap) {
      const now = map.get(key);
      if (!now) L.gone = true;
      else if (Math.abs(now.y - L.y) > 4 || Math.abs(now.x - L.x) > 4) L.gone = true; // cambió la maquetación
      else map.set(key, L); // conserva el objeto que ya usan las arañas
    }
    this.lineMap = map;
    this.lines = [...map.values()];
  }

  pickLine(sp) {
    if (!this.reader || !this.patrol || !this.active) return null;
    this.refreshLines();
    const u = this.usableRect();
    const right = this.usableRight();
    const prev = sp.prevLine;
    let best = null, bestScore = Infinity;
    const others = this.spiders.filter((o) => o !== sp && o.state === 'read' && o.line);
    for (const L of this.lines) {
      if (L.gone || this.lineClaims.has(L.key)) continue;
      if (L.y < u.y + 2 || L.y + L.h > u.y + u.h - 2) continue;
      if (L.x > right - 30 || L.x + L.w < u.x + 10) continue;
      const last = this.readAt.get(L.key);
      const fresh = !this.everRead.has(L.key);
      const age = last === undefined ? Infinity : this.time - last;
      if (!fresh && age < 14) continue;
      let score = Math.abs(L.y - sp.y) * 1.1 + Math.abs(L.x - sp.x) * 0.4 + rand(0, 140);
      if (fresh) score -= 2500;
      else score -= Math.min(age, 60) * 10;
      if (prev && L.block === prev.block && L.idx === prev.idx + 1) score -= 4000; // sigue el párrafo
      for (const o of others) if (Math.abs(o.line.y - L.y) < 60 && L.x < o.line.x + o.line.w && L.x + L.w > o.line.x) score += 700;
      if (score < bestScore) {
        bestScore = score;
        best = L;
      }
    }
    if (best && this.everRead.has(best.key) && Math.random() < 0.3) return null; // a veces exploran en vez de releer
    return best;
  }

  claimLine(sp, L) {
    this.lineClaims.set(L.key, sp);
    L.loud = !this.everRead.has(L.key);
  }

  finishLine(sp, L, completed) {
    if (this.lineClaims.get(L.key) === sp) this.lineClaims.delete(L.key);
    if (completed) {
      this.readAt.set(L.key, this.time);
      this.everRead.add(L.key);
    }
  }

  startTrail(sp, L) {
    const t = new ReadTrail(L, sp.accent, L.loud);
    this.under.push(t);
    return t;
  }

  latentOn(L) {
    if (!this.latent.length) return [];
    const out = [];
    for (const t of this.latent) {
      if (L.start !== undefined && t.pos !== undefined && (t.pos < L.start || t.pos >= L.end)) continue;
      const r = t.anchor();
      if (!r) continue;
      const cy = r.y + r.h / 2;
      if (cy < L.y - 1 || cy > L.y + L.h + 1 || r.x + r.w < L.x - 2 || r.x > L.x + L.w + 2) continue;
      out.push({ t, rx: r.x + 4 });
    }
    return out.sort((a, b) => a.rx - b.rx);
  }

  onWord(sp, word, L) {
    if (L.loud) {
      this.wordsRead++;
      const mode = this.level.word;
      if (mode !== 'none' && word.w > 2) this.under.push(new WordFlash(word, sp.accent, mode));
      if (Math.random() < this.level.glyphs) {
        const ch = word.text[(Math.random() * word.text.length) | 0] || glyph();
        this.fx.push(new Glyph(word.x + rand(0, word.w), word.y, ch.toUpperCase(), sp.accent));
      }
    } else if (Math.random() < this.level.glyphs * 0.25) {
      this.fx.push(new Glyph(word.x + rand(0, word.w), word.y, glyph(), sp.accent));
    }
    if (word.text.length > 2) sp.tag = { text: word.text.replace(/[^\p{L}\p{N}%$€.,:/@-]/gu, '').slice(0, 22), age: 0 };
    this.emit('word', word);
  }

  /** Objetivos escondidos que llevan rato a la vista sin que nadie los lea: se marcan igual. */
  checkLatent() {
    if (!this.latent.length) return;
    const v = this.viewRect();
    const timeout = this.liveCount() ? 7 : 0;
    const due = [];
    for (const t of this.latent) {
      const r = t.anchor();
      const inView = r && r.y + r.h > v.y && r.y < v.y + v.h;
      if (!inView) {
        t.seenAt = null;
        continue;
      }
      if (t.seenAt === null) t.seenAt = this.time;
      if (this.time - t.seenAt >= timeout) due.push(t);
    }
    if (!due.length) return;
    const set = new Set(due);
    this.latent = this.latent.filter((t) => !set.has(t));
    due.forEach((t, i) => this.markOnly(t, i * 0.04));
  }

  /** Llama a la araña libre más cercana para que se pose junto a algo (tarjetas de contexto). */
  summon(rects, color = COLORS.blue) {
    const target = { id: `summon-${Math.random()}`, rects: () => rects, color };
    target.anchor = () => rects[0];
    let sp = this.spiders.filter((s) => s.free)
      .sort((a, b) => Math.hypot(a.x - rects[0].x, a.y - rects[0].y) - Math.hypot(b.x - rects[0].x, b.y - rects[0].y))[0];
    if (!sp && this.maxSpiders > 0 && this.active) {
      this.spawn(1);
      sp = this.spiders[this.spiders.length - 1];
    }
    const pulse = new Pulse(rects, color);
    this.fx.push(pulse);
    if (sp) {
      if (sp.state === 'read') sp.endLine(false, false);
      if (sp.state === 'drop') {
        sp.pendingSummon = target;
        sp.landS = clamp(rects[0].y - this.getCamera().y, 30, sp.landS);
      } else {
        sp.state = 'summon';
        sp.timer = 0;
        sp.task = target;
      }
    }
    return () => {
      pulse.dead = true;
      if (!sp) return;
      if (sp.pendingSummon === target) sp.pendingSummon = null;
      if (sp.task === target) {
        sp.task = null;
        if (sp.state === 'summon') {
          sp.state = 'wander';
          sp.timer = 0.2;
        }
      }
    };
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

  clearMarks() {
    this.boxes = [];
    this.labels = [];
    this.under = this.under.filter((u) => u instanceof ReadTrail && !u.done);
    this.silks = [];
  }

  reset() {
    this.queue = [];
    this.claimed.clear();
    this.done.clear();
    this.latent = [];
    this.boxes = [];
    this.labels = [];
    this.fx = [];
    this.under = [];
    this.silks = [];
    this.packets = [];
    this.prints = [];
    this.found = 0;
    for (const sp of this.spiders) {
      if (sp.state === 'read') sp.endLine(false, false);
      if (sp.state === 'leave' || sp.state === 'drop') continue;
      sp.state = 'wander';
      sp.task = null;
      sp.carry = null;
      sp.lastGrab = null;
      sp.anchor = sp.tail();
    }
    this.lineClaims.clear();
  }

  cancelAutoScroll() {
    this.autoScroll = false;
  }

  /** Línea de escaneo horizontal (modo pantalla). */
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
    this.time += dt;
    // Si el rastreo se alarga, lo que falta se marca de golpe (en cascada).
    if (this.deadline && now > this.deadline) {
      this.deadline = null;
      const pending = this.queue.filter((t) => !this.claimed.has(t.id));
      this.queue = this.queue.filter((t) => this.claimed.has(t.id));
      pending.forEach((t, i) => this.markOnly(t, i * 0.03));
    }
    if (this.reader) this.refreshLines();

    // Las arañas que se quedaron muy lejos de la vista (porque bajaste rápido) vuelven colgadas de un hilo.
    const v = this.viewRect();
    for (const sp of this.spiders) {
      if (!sp.free || !this.active) continue;
      const far = sp.y < v.y - v.h * 0.5 || sp.y > v.y + v.h * 1.5 || sp.x < v.x - 200 || sp.x > v.x + v.w + 200;
      if (far) {
        if (sp.state === 'read') sp.endLine(false, false);
        this.startDrop(sp, rand(0, 0.5));
        for (const leg of sp.legs) leg.dangle(now);
      }
    }

    for (const sp of this.spiders) sp.update(dt, now);
    this.spiders = this.spiders.filter((s) => !s.dead);
    for (const b of this.boxes) b.update(dt);
    for (const f of this.fx) f.update(dt);
    for (const f of this.under) f.update(dt);
    for (const s of this.silks) s.update(dt);
    for (const l of this.labels) l.update(dt);
    for (const p of this.packets) p.update(dt);
    for (const p of this.prints) p.age += dt;
    this.boxes = this.boxes.filter((b) => !b.dead);
    this.fx = this.fx.filter((f) => !f.dead);
    this.under = this.under.filter((f) => !f.dead);
    this.silks = this.silks.filter((s) => !s.dead);
    this.labels = this.labels.filter((l) => !l.dead);
    this.packets = this.packets.filter((p) => !p.dead);
    if (this.prints.length && this.prints[0].age > 0.55) this.prints = this.prints.filter((p) => p.age < 0.55);

    if (this.busy) {
      for (const sp of this.spiders) if (sp.free) this.assign(sp);
    } else {
      this.autoScroll = false;
    }

    this.latentCheck -= dt;
    if (this.latentCheck <= 0) {
      this.latentCheck = 0.5;
      this.checkLatent();
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
    for (const s of this.silks) s.draw(ctx);
    for (const b of this.boxes) b.draw(ctx);
    for (const f of this.under) f.draw(ctx);
    if (this.prints.length) {
      for (const p of this.prints) {
        const a = 0.5 * (1 - p.age / 0.55);
        if (a <= 0) continue;
        ctx.fillStyle = rgba(p.color, a);
        ctx.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6);
      }
    }
    for (const f of this.fx) f.draw(ctx);
    for (const sp of this.spiders) sp.draw(ctx, t);
    for (const l of this.labels) l.draw(ctx);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const p of this.packets) p.draw(ctx);

    if (this.scan) {
      const y = this.scan.y;
      const g = ctx.createLinearGradient(0, y - 40, 0, y + 2);
      g.addColorStop(0, 'rgba(60,240,255,0)');
      g.addColorStop(1, 'rgba(60,240,255,0.22)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 40, this.w, 42);
      ctx.fillStyle = 'rgba(160,250,255,0.9)';
      ctx.fillRect(0, y, this.w, 1);
      // Lecturas falsas de datos sobre la línea
      ctx.font = `600 10px ${MONO}`;
      ctx.fillStyle = 'rgba(160,250,255,0.55)';
      for (let i = 0; i < 6; i++) {
        const x = ((t * 37 + i * 211) % this.w);
        ctx.fillText(`${glyph()}${glyph()}${(Math.random() * 99) | 0}`, x, y - 6);
      }
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
