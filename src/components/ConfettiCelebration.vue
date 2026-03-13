<script setup lang="ts">
/**
 * ConfettiCelebration.vue
 * Full-screen confetti burst for milestone celebrations.
 * Also supports a 'sparkle' mode — calcium-imaging–inspired tiny twinkling stars.
 * Uses a canvas for smooth 60fps animation with physics-based particles.
 *
 * Usage: call trigger() or trigger('gold') to fire a confetti burst.
 *        call sparkle() to fire a calcium-imaging shimmer effect.
 * Exposed via defineExpose so parent can call confettiRef.trigger() or .sparkle().
 */
import { ref, onMounted, onUnmounted } from 'vue';

const canvasRef = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;
let animFrame = 0;
let particles: Particle[] = [];
let sparkles: Sparkle[] = [];

// Color palettes for different milestone types
const PALETTES: Record<string, string[]> = {
  default: ['#00c8ff', '#CE93D8', '#7fff88', '#ffd700', '#ff6b8a', '#4a9eff', '#ff9500'],
  gold:    ['#ffd700', '#ffea70', '#ffa500', '#fff4b0', '#e6c200', '#ffcc00', '#fff8dc'],
  purple:  ['#CE93D8', '#AB47BC', '#9C27B0', '#E1BEE7', '#7B1FA2', '#BA68C8', '#D500F9'],
  cyan:    ['#00c8ff', '#00e5ff', '#4dd0e1', '#80deea', '#00acc1', '#26c6da', '#b2ebf2'],
  rainbow: ['#ff0000', '#ff7700', '#ffff00', '#00ff00', '#0077ff', '#8800ff', '#ff00ff'],
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  color: string;
  rotation: number;
  rotSpeed: number;
  gravity: number;
  drag: number;
  opacity: number;
  fadeRate: number;
  shape: 'rect' | 'circle' | 'star';
}

function createParticles(count: number, palette: string[]) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const cx = canvas.width / 2;
  const cy = canvas.height * 0.35;

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 12 + 4;
    const shapes: Particle['shape'][] = ['rect', 'rect', 'rect', 'circle', 'star'];
    particles.push({
      x: cx + (Math.random() - 0.5) * 200,
      y: cy + (Math.random() - 0.5) * 100,
      vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 4,
      vy: Math.sin(angle) * speed - Math.random() * 6 - 2,
      w: Math.random() * 8 + 4,
      h: Math.random() * 6 + 3,
      color: palette[Math.floor(Math.random() * palette.length)],
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.3,
      gravity: 0.12 + Math.random() * 0.06,
      drag: 0.98 + Math.random() * 0.015,
      opacity: 1,
      fadeRate: 0.003 + Math.random() * 0.004,
      shape: shapes[Math.floor(Math.random() * shapes.length)],
    });
  }
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const method = i === 0 ? 'moveTo' : 'lineTo';
    ctx[method](x + r * Math.cos(angle), y + r * Math.sin(angle));
  }
  ctx.closePath();
  ctx.fill();
}

/* animate() removed — animateSparkles() handles both confetti and sparkles */

function resizeCanvas() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

// ── Sparkle mode — calcium-imaging–inspired twinkling stars ─────────────────

interface Sparkle {
  x: number;
  y: number;
  r: number;       // radius
  phase: number;    // twinkle phase offset
  speed: number;    // twinkle speed
  life: number;     // 0→1→0 lifecycle
  lifeSpeed: number;
  color: string;
  maxOpacity: number;
}

const SPARKLE_COLORS = [
  '#00e5ff', '#80deea', '#b2ebf2', '#ffffff', '#CE93D8',
  '#e0f7fa', '#4dd0e1', '#a7ffeb', '#b9f6ca', '#fff9c4',
];

function createSparkles(count: number) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  for (let i = 0; i < count; i++) {
    sparkles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 2 + 0.5,
      phase: Math.random() * Math.PI * 2,
      speed: 0.02 + Math.random() * 0.04,
      life: 0,
      lifeSpeed: 0.005 + Math.random() * 0.008,
      color: SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)],
      maxOpacity: 0.4 + Math.random() * 0.6,
    });
  }
}

function animateSparkles() {
  if (!ctx || !canvasRef.value) return;
  const canvas = canvasRef.value;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let alive = false;
  for (const s of sparkles) {
    s.life += s.lifeSpeed;
    if (s.life > 2) continue; // dead
    alive = true;

    // Bell curve: fade in 0→1, fade out 1→2
    const envelope = s.life <= 1 ? s.life : 2 - s.life;
    // Twinkle: rapid sin oscillation on top of envelope
    const twinkle = 0.5 + 0.5 * Math.sin(s.phase + s.life * 60 * s.speed);
    const alpha = envelope * twinkle * s.maxOpacity;

    if (alpha <= 0.01) continue;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Glow
    ctx.shadowColor = s.color;
    ctx.shadowBlur = s.r * 4;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();

    // Bright center
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * 0.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Also render confetti particles if any
  for (const p of particles) {
    if (p.opacity <= 0) continue;
    alive = true;
    p.vy += p.gravity;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.x += p.vx;
    p.y += p.vy;
    p.rotation += p.rotSpeed;
    if (p.y > canvas.height * 0.5) p.opacity -= p.fadeRate * 2;
    if (p.y > canvas.height + 50) { p.opacity = 0; continue; }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.globalAlpha = Math.max(0, p.opacity);
    ctx.fillStyle = p.color;
    if (p.shape === 'circle') {
      ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill();
    } else if (p.shape === 'star') {
      drawStar(ctx, 0, 0, p.w / 2);
    } else {
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
    ctx.restore();
  }

  if (alive) {
    animFrame = requestAnimationFrame(animateSparkles);
  } else {
    sparkles = [];
    particles = [];
    animFrame = 0;
  }
}

/**
 * Fire a calcium-imaging sparkle shimmer — tiny twinkling stars across the screen.
 * @param intensity - particle count multiplier (1 = subtle, 2 = medium, 3 = dramatic)
 */
function sparkle(intensity: number = 1) {
  resizeCanvas();
  const count = Math.round(120 * intensity);
  createSparkles(count);
  if (!animFrame) {
    animFrame = requestAnimationFrame(animateSparkles);
  }
}

/**
 * Fire a confetti burst.
 * @param palette - color palette name: 'default', 'gold', 'purple', 'cyan', 'rainbow'
 * @param intensity - particle count multiplier (1 = normal, 2 = big, 3 = epic)
 */
function trigger(palette: string = 'default', intensity: number = 1) {
  resizeCanvas();
  const colors = PALETTES[palette] || PALETTES.default;
  const count = Math.round(80 * intensity);
  createParticles(count, colors);
  if (!animFrame) {
    animFrame = requestAnimationFrame(animateSparkles);
  }
}

onMounted(() => {
  const canvas = canvasRef.value;
  if (canvas) {
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
  }
});

onUnmounted(() => {
  cancelAnimationFrame(animFrame);
  window.removeEventListener('resize', resizeCanvas);
});

defineExpose({ trigger, sparkle });
</script>

<template>
  <Teleport to="body">
    <canvas
      ref="canvasRef"
      class="nge-confetti-canvas"
    />
  </Teleport>
</template>

<style scoped>
.nge-confetti-canvas {
  position: fixed;
  inset: 0;
  z-index: 99999;
  pointer-events: none;
  width: 100vw;
  height: 100vh;
}
</style>
