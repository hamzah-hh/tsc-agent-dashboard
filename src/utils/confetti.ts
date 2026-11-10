// canvas-confetti loads on first use so it is not part of the first page load
const loadConfetti = () => import('canvas-confetti').then((m) => m.default);
import { soundFx } from './audio';

export function fireGoldenCelebration() {
  soundFx.playLevelUp();

  loadConfetti().then((confetti) => {
  // Burst 1: Gold & Warm Amber Diwali Sparkles
  confetti({
    particleCount: 80,
    spread: 70,
    origin: { y: 0.65 },
    colors: ['#F59E0B', '#FBBF24', '#FCD34D', '#10B981', '#6366F1', '#EC4899'],
    ticks: 200,
    gravity: 0.9,
    scalar: 1.1,
  });

  // Burst 2: Side cannons
  setTimeout(() => {
    confetti({
      particleCount: 50,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors: ['#F59E0B', '#FBBF24', '#34D399'],
    });
    confetti({
      particleCount: 50,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors: ['#F59E0B', '#FBBF24', '#60A5FA'],
    });
  }, 180);
  });
}

export function fireMilestoneBurst(originX = 0.5, originY = 0.5) {
  soundFx.playMilestone();
  loadConfetti().then((confetti) => confetti({
    particleCount: 35,
    spread: 60,
    origin: { x: originX, y: originY },
    colors: ['#F59E0B', '#10B981', '#818CF8'],
    ticks: 120,
    gravity: 1.1,
    scalar: 0.9,
  }));
}
