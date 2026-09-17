"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  hue: number;
  alpha: number;
  life: number;
  maxLife: number;
}

interface Wave {
  offset: number;
  speed: number;
  amplitude: number;
  frequency: number;
  color: string;
  alpha: number;
}

export function BackgroundVideo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let particles: Particle[] = [];
    let animId = 0;
    let time = 0;

    const waves: Wave[] = [
      { offset: 0, speed: 0.0008, amplitude: 120, frequency: 0.002, color: "#8b5cf6", alpha: 0.12 },
      { offset: 0.4, speed: 0.0005, amplitude: 160, frequency: 0.003, color: "#3b82f6", alpha: 0.08 },
      { offset: 0.7, speed: 0.0006, amplitude: 100, frequency: 0.0015, color: "#10b981", alpha: 0.06 },
    ];

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }

    function createParticle(): Particle {
      const hue = 240 + Math.random() * 60;
      const life = 180 + Math.random() * 300;
      return {
        x: Math.random() * canvas!.width,
        y: Math.random() * canvas!.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -(Math.random() * 0.5 + 0.1),
        size: Math.random() * 2.5 + 0.5,
        hue,
        alpha: 0,
        life: 0,
        maxLife: life,
      };
    }

    function drawWaves(t: number) {
      const w = canvas!.width;
      const h = canvas!.height;

      for (const wave of waves) {
        ctx!.save();
        ctx!.globalAlpha = wave.alpha;
        ctx!.beginPath();
        for (let x = 0; x <= w; x += 2) {
          const y =
            h * 0.5 +
            Math.sin(x * wave.frequency + t * wave.speed + wave.offset * Math.PI * 2) * wave.amplitude;
          if (x === 0) ctx!.moveTo(x, y);
          else ctx!.lineTo(x, y);
        }
        ctx!.lineTo(w, h);
        ctx!.lineTo(0, h);
        ctx!.closePath();

        const grad = ctx!.createLinearGradient(0, h * 0.3, 0, h);
        grad.addColorStop(0, wave.color);
        grad.addColorStop(1, "transparent");
        ctx!.fillStyle = grad;
        ctx!.fill();
        ctx!.restore();
      }
    }

    function drawParticles() {
      for (const p of particles) {
        const progress = p.life / p.maxLife;
        p.alpha = progress < 0.15 ? progress / 0.15 : progress > 0.7 ? (1 - progress) / 0.3 : 1;

        ctx!.save();
        ctx!.globalAlpha = p.alpha * 0.5;
        ctx!.fillStyle = `hsl(${p.hue}, 70%, 65%)`;
        ctx!.shadowColor = `hsl(${p.hue}, 70%, 65%)`;
        ctx!.shadowBlur = p.size * 3;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.restore();
      }
    }

    function loop() {
      time++;
      const w = canvas!.width;
      const h = canvas!.height;

      ctx!.clearRect(0, 0, w, h);

      const baseGrad = ctx!.createRadialGradient(w * 0.35, h * 0.45, 0, w * 0.5, h * 0.5, Math.max(w, h));
      baseGrad.addColorStop(0, "rgba(30, 25, 50, 0.3)");
      baseGrad.addColorStop(1, "rgba(8, 6, 16, 1)");
      ctx!.fillStyle = baseGrad;
      ctx!.fillRect(0, 0, w, h);

      drawWaves(time);

      if (particles.length < 60 && Math.random() < 0.4) {
        particles.push(createParticle());
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life++;
        if (p.life >= p.maxLife || p.y < -20) particles.splice(i, 1);
      }
      drawParticles();

      animId = requestAnimationFrame(loop);
    }

    resize();
    window.addEventListener("resize", resize);
    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 -z-10" />;
}
