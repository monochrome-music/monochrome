export class LCDPreset {
    constructor() {
        this.name = 'LCD Pixels';
        this.gridCols = 48;

        // Auto-gain tracking
        this.maxVol = 100;
        this.volDecay = 0.995;

        // Smoothing state
        this.prevData = new Float32Array(this.gridCols).fill(0);
        this.peakData = new Float32Array(this.gridCols).fill(0);

        this.primaryColor = '#ffffff';
        this.disableShake = false;

        // WebGL grid overlay
        this.glCanvas = null;
        this.gl = null;
        this.glProgram = null;
        this.glInitialized = false;
    }

    // Initialize WebGL grid overlay
    initWebGL(width, height) {
        if (this.glInitialized) return;

        // Create overlay canvas
        this.glCanvas = document.createElement('canvas');
        this.glCanvas.width = width;
        this.glCanvas.height = height;
        this.glCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;mix-blend-mode:multiply;';

        const gl = this.glCanvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
        if (!gl) {
            console.warn('WebGL not available for grid overlay');
            return;
        }
        this.gl = gl;

        // Vertex shader (fullscreen quad)
        const vsSource = `
            attribute vec2 a_position;
            varying vec2 v_uv;
            void main() {
                v_uv = a_position * 0.5 + 0.5;
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `;

        // Fragment shader (LCD dot matrix with tilt-shift blur)
        const fsSource = `
            precision highp float;
            varying vec2 v_uv;
            uniform vec2 u_resolution;
            uniform float u_time;
            
            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }
            
            void main() {
                vec2 uv = v_uv;
                float aspect = u_resolution.x / u_resolution.y;
                
                // Skew transform
                vec2 centered = uv - 0.5;
                mat2 skewMatrix = mat2(1.0, 0.0, 0.20, 1.0);
                vec2 skewed = skewMatrix * centered + 0.5;
                
                // Perspective: shrink towards right
                float perspT = skewed.x;
                float perspScale = mix(1.0, 0.5, perspT);
                
                // Tilt-shift: focus at 25%, blur both near (left) and far (right)
                float focusPoint = 0.25;
                float distFromFocus = abs(perspT - focusPoint);
                float blurAmount = smoothstep(0.0, 0.6, distFromFocus);
                
                // Apply perspective
                vec2 pUV = skewed;
                pUV.y = (pUV.y - 0.5) * perspScale + 0.5;
                pUV.x *= aspect;
                
                // Dot matrix grid
                float cellSize = 0.0078 * perspScale;
                vec2 gridUV = pUV / cellSize;
                vec2 gv = fract(gridUV) - 0.5;
                vec2 id = floor(gridUV);
                
                float d = length(gv);
                float dotRadius = 0.35;
                
                // Dot edge with blur (pattern stays visible)
                float sharpness = mix(0.08, 0.25, blurAmount);
                float dotEdge = smoothstep(dotRadius - sharpness, dotRadius + sharpness * 0.3, d);
                
                // Per-cell noise
                float noise = hash(id);
                dotEdge *= 0.75 + noise * 0.25;
                
                // Subtle grain
                float grain = hash(uv * u_resolution + u_time) * 0.015;
                
                // Output
                float alpha = clamp(dotEdge * 0.5 + grain, 0.0, 0.5);
                gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
            }
        `;

        // Compile shaders
        const vs = this.compileShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) return;

        // Link program
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Shader program failed to link');
            return;
        }

        this.glProgram = program;

        // Create fullscreen quad
        const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        const posLoc = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        // Store uniform locations
        this.uResolution = gl.getUniformLocation(program, 'u_resolution');
        this.uTime = gl.getUniformLocation(program, 'u_time');

        gl.useProgram(program);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        this.startTime = performance.now();
        this.glInitialized = true;
    }

    compileShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    // Render WebGL grid overlay
    renderHoneycomb(width, height) {
        if (!this.gl || !this.glProgram) return;

        const gl = this.gl;

        // Resize if needed
        if (this.glCanvas.width !== width || this.glCanvas.height !== height) {
            this.glCanvas.width = width;
            this.glCanvas.height = height;
            gl.viewport(0, 0, width, height);
        }

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Pass uniforms
        gl.uniform2f(this.uResolution, width, height);
        gl.uniform1f(this.uTime, (performance.now() - this.startTime) / 1000.0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    resize() {}

    draw(ctx, canvas, analyser, dataArray, params) {
        const { width, height } = canvas;
        const { kick, primaryColor, mode } = params;

        this.primaryColor = primaryColor;
        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

        // --- Background ---
        ctx.clearRect(0, 0, width, height);
        if (mode !== 'blended') {
            ctx.fillStyle = isDark ? '#050505' : '#e6e6e6';
            ctx.fillRect(0, 0, width, height);
        }

        // --- Audio Data Processing ---
        const data = this.processAudio(dataArray);

        // --- Perspective Constants ---
        const centerX = width / 2;
        const centerY = height * 0.35;
        const startX = width * 0.05;
        const endX = width * 0.95;
        const totalW = endX - startX;
        const maxBarH = height;
        const startScale = 2.0; // Left (near) - increased
        const endScale = 0.05; // Right (far) - decreased

        // --- Apply Global Skew Transform ---
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.transform(1, -0.08, 0.2, 1, 0, 0);
        ctx.translate(-centerX, -centerY);

        // Shake on kick
        if (!this.disableShake && kick > 0.1) {
            const shake = kick * 8;
            ctx.translate((Math.random() - 0.5) * 2 * shake, (Math.random() - 0.5) * shake);
        }

        // --- Draw Bars ---
        const baseBarW = (totalW / this.gridCols) * 0.7; // Base width

        for (let c = 0; c < this.gridCols; c++) {
            const p = c / (this.gridCols - 1);

            // Simple perspective: scale goes from startScale (left) to endScale (right)
            const scale = startScale + (endScale - startScale) * p;

            // Perspective spacing: gaps decrease linearly matching the scale
            // Integral of linear scale function, normalized to 0-1
            const scaleDelta = endScale - startScale;
            const pIntegral = startScale * p + 0.5 * scaleDelta * p * p;
            const totalIntegral = startScale + 0.5 * scaleDelta; // Value at p=1
            const pPerspective = pIntegral / totalIntegral;
            const cx = startX + pPerspective * totalW;

            // Width scales with perspective
            const barW = baseBarW * scale;

            // Bar height - skip empty bars entirely
            const normVal = data[c];
            if (normVal < 0.01) continue;

            const h = normVal * maxBarH * scale;
            if (h < 1) continue;

            // Per-bar color variation
            const variation = 0.75 + Math.abs(Math.sin(c * 127.1)) * 0.25;
            ctx.fillStyle = this.adjustBrightness(primaryColor, variation);

            // Strong LCD light bleed effect
            ctx.shadowBlur = 30 + normVal * 50; // Increased glow
            ctx.shadowColor = primaryColor;
            this.drawCapsule(ctx, cx, centerY, barW, h);
        }

        ctx.restore();

        // --- WebGL grid Overlay ---
        // Initialize on first run
        if (!this.glInitialized) {
            this.initWebGL(width, height);
            // Attach WebGL canvas to same parent as main canvas
            if (this.glCanvas && canvas.parentElement) {
                canvas.parentElement.style.position = 'relative';
                canvas.parentElement.appendChild(this.glCanvas);
            }
        }

        // Render and composite grid
        this.renderHoneycomb(width, height);
    }

    // Process audio with improved dynamics
    processAudio(dataArray) {
        const result = new Float32Array(this.gridCols);
        const center = Math.floor(this.gridCols / 2);
        const totalBins = dataArray.length;
        let peakVal = 0;

        for (let i = 0; i < center; i++) {
            const p = i / (center - 1);

            // Logarithmic frequency mapping
            const minBin = 2;
            const maxBin = totalBins * 0.65;
            const startBin = Math.floor(minBin * Math.pow(maxBin / minBin, p));
            const endBin = Math.max(startBin + 1, Math.floor(minBin * Math.pow(maxBin / minBin, p + 1 / center)));

            let sum = 0,
                count = 0;
            for (let k = startBin; k < endBin && k < totalBins; k++) {
                sum += dataArray[k];
                count++;
            }
            let val = count > 0 ? sum / count : 0;

            // Pink noise compensation (boost highs)
            val *= 1 + p * 1.8;
            if (val > peakVal) peakVal = val;

            // Mirror to left/right
            const leftIdx = center - 1 - i;
            const rightIdx = center + i;

            // Smooth with asymmetric rise/fall
            const rise = 0.25;
            const fall = 0.08; // Slower fall for smoother decay

            for (const idx of [leftIdx, rightIdx]) {
                const prev = this.prevData[idx];
                const target = val;
                this.prevData[idx] = prev + (target - prev) * (target > prev ? rise : fall);
            }
        }

        // Auto-gain with more headroom
        this.maxVol = Math.max(this.maxVol * this.volDecay, peakVal, 40);
        const normFactor = 200 / this.maxVol;

        // Normalize and apply contrast curve
        for (let c = 0; c < this.gridCols; c++) {
            let v = (this.prevData[c] * normFactor) / 255;

            // Noise gate: important to scale the bars
            const gate = 0.5;
            if (v < gate) v = 0;
            else v = (v - gate) / (1 - gate);

            // Soft compression + contrast
            v = Math.pow(Math.min(1, v), 2.2);
            result[c] = v;
        }

        return result;
    }

    // Draw rounded capsule shape
    drawCapsule(ctx, cx, cy, w, h) {
        if (h < w) {
            ctx.beginPath();
            ctx.arc(cx, cy, Math.max(0.5, h / 2), 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        const halfH = h / 2;
        const r = w / 2;
        ctx.beginPath();
        ctx.arc(cx, cy - halfH + r, r, Math.PI, 0);
        ctx.lineTo(cx + r, cy + halfH - r);
        ctx.arc(cx, cy + halfH - r, r, 0, Math.PI);
        ctx.lineTo(cx - r, cy - halfH + r);
        ctx.closePath();
        ctx.fill();
    }

    // Adjust hex color brightness
    adjustBrightness(hex, factor) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const clamp = (v) => Math.min(255, Math.max(0, Math.round(v * factor)));
        return `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
    }

    destroy() {
        if (this.glCanvas) {
            this.glCanvas.remove();
            this.glCanvas = null;
        }
        if (this.gl) {
            const ext = this.gl.getExtension('WEBGL_lose_context');
            if (ext) ext.loseContext();
            this.gl = null;
        }
        this.glInitialized = false;
        this.glProgram = null;
    }
}
