import React, { useEffect, useRef } from 'react';

export const FestiveAura: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Particle definition: soft warm golden/amber bokeh motes
    interface Particle {
      x: number;
      y: number;
      radius: number;
      vx: number;
      vy: number;
      alpha: number;
      targetAlpha: number;
      color: string;
      pulseSpeed: number;
    }

    const colors = [
      'rgba(245, 158, 11, ', // amber-500
      'rgba(251, 191, 36, ', // amber-400
      'rgba(217, 119, 6, ',  // amber-600
      'rgba(249, 115, 22, ', // orange-500
      'rgba(99, 102, 241, ', // subtle indigo complement
    ];

    const particleCount = Math.min(32, Math.floor(window.innerWidth / 45));
    const particles: Particle[] = [];

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 2.8 + 1,
        vx: (Math.random() - 0.5) * 0.25,
        vy: -Math.random() * 0.35 - 0.1, // gently floating upwards like festive embers
        alpha: Math.random() * 0.4 + 0.1,
        targetAlpha: Math.random() * 0.5 + 0.1,
        color: colors[Math.floor(Math.random() * colors.length)],
        pulseSpeed: Math.random() * 0.015 + 0.005,
      });
    }

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;

        // Wrap around boundaries
        if (p.y < -10) {
          p.y = height + 10;
          p.x = Math.random() * width;
        }
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;

        // Pulsing alpha
        p.alpha += (p.targetAlpha - p.alpha) * p.pulseSpeed;
        if (Math.abs(p.targetAlpha - p.alpha) < 0.05) {
          p.targetAlpha = Math.random() * 0.55 + 0.1;
        }

        // Draw glowing ember
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 3.5);
        gradient.addColorStop(0, `${p.color}${p.alpha})`);
        gradient.addColorStop(0.4, `${p.color}${p.alpha * 0.4})`);
        gradient.addColorStop(1, `${p.color}0)`);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
      {/* Top Aurora Ambient Light Pools */}
      <div className="absolute -top-[25%] left-[5%] w-[65vw] h-[55vw] rounded-full bg-gradient-to-br from-amber-500/10 via-amber-600/5 to-transparent blur-[120px] dark:from-amber-400/8 dark:via-amber-500/4 dark:to-transparent" />
      <div className="absolute top-[35%] -right-[15%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-bl from-indigo-500/8 via-purple-500/5 to-transparent blur-[120px] dark:from-indigo-600/10 dark:via-purple-600/5 dark:to-transparent" />
      <div className="absolute -bottom-[20%] left-[20%] w-[55vw] h-[55vw] rounded-full bg-gradient-to-tr from-amber-500/8 via-orange-500/4 to-transparent blur-[120px]" />

      {/* Subtle Festive Geometric Dot Lattice */}
      <div className="absolute inset-0 bg-[radial-gradient(rgba(245,158,11,0.12)_1px,transparent_1px)] [background-size:28px_28px] opacity-40 dark:opacity-30" />

      {/* Dynamic Golden Embers Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-70 dark:opacity-90" />
    </div>
  );
};
