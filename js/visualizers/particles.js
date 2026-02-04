export class ParticlesPreset {
    constructor() {
        this.name = 'Particles';
        this.particles = [];
        this.particleCount = 180;
    }

    resize(_width, _height) {
        // Particles don't need explicit resize logic unless we want to respawn them,
        // but current logic handles boundaries in draw loop.
    }

    destroy() {
        // No cleanup needed
    }

    draw(ctx, canvas, analyser, dataArray, params) {
        const { width, height } = canvas;
        const { kick, intensity, primaryColor, mode } = params;
        const sensitivity = params.sensitivity || 1.0;
        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

        // Clear background
        ctx.clearRect(0, 0, width, height);

        if (mode !== 'blended') {
            ctx.fillStyle = isDark ? '#050505' : '#e6e6e6';
            ctx.fillRect(0, 0, width, height);
        }

        // Manage particle count
        if (this.particles.length !== this.particleCount) {
            this.particles = [];
            for (let i = 0; i < this.particleCount; i++) {
                this.particles.push({
                    x: Math.random() * width,
                    y: Math.random() * height,
                    vx: (Math.random() - 0.5) * 2,
                    vy: (Math.random() - 0.5) * 2,
                    baseSize: Math.random() * 3 + 1,
                });
            }
        }

        ctx.save();

        // Shake
        let shakeX = 0;
        let shakeY = 0;
        if (kick > 0.1) {
            const shakeAmt = kick * 8 * sensitivity;
            shakeX = (Math.random() - 0.5) * shakeAmt;
            shakeY = (Math.random() - 0.5) * shakeAmt;
        }
        ctx.translate(shakeX, shakeY);

        ctx.fillStyle = primaryColor;
        ctx.strokeStyle = primaryColor;

        const maxDist = 150 + intensity * 50 + kick * 50 * sensitivity;
        const maxDistSq = maxDist * maxDist;

        for (let i = 0; i < this.particles.length; i++) {
            let p = this.particles[i];

            const speedMult = 1 + intensity * 2 + kick * 8 * sensitivity;
            p.x += p.vx * speedMult;
            p.y += p.vy * speedMult;

            if (kick > 0.3) {
                p.x += (Math.random() - 0.5) * kick * 2 * sensitivity;
                p.y += (Math.random() - 0.5) * kick * 2 * sensitivity;
            }

            if (p.x < 0) p.x = width;
            if (p.x > width) p.x = 0;
            if (p.y < 0) p.y = height;
            if (p.y > height) p.y = 0;

            const size = p.baseSize * (1 + intensity * 0.5 + kick * 0.8 * sensitivity);
            ctx.globalAlpha = 0.4 + intensity * 0.2 + kick * 0.15 * sensitivity;
            ctx.beginPath();
            ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
            ctx.fill();

            for (let j = i + 1; j < this.particles.length; j++) {
                const p2 = this.particles[j];
                const dx = p.x - p2.x;
                const dy = p.y - p2.y;

                if (Math.abs(dx) > maxDist) continue;

                const distSq = dx * dx + dy * dy;

                if (distSq < maxDistSq) {
                    const dist = Math.sqrt(distSq);
                    ctx.beginPath();
                    ctx.lineWidth = (1 - dist / maxDist) * (1 + kick * 1.5 * sensitivity);
                    ctx.globalAlpha = (1 - dist / maxDist) * (0.3 + intensity * 0.2 + kick * 0.3 * sensitivity);
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                }
            }
        }
        ctx.restore();
    }
}
