/**
 * Unknown Pleasures WebGL Visualizer
 *
 * Uses GPU-accelerated rendering with:
 * - Geometry-based thick lines (quads instead of LINE_STRIP)
 * - Shader-based glow effect (post-processing blur)
 * - Prepared for future ambient haze effects
 */

export class UnknownPleasuresWebGL {
    // Propagation speed: controls how fast waves propagate between lines
    // Higher = faster propagation (1.0 = default, 0.5 = slower, 2.0 = faster)
    static PROPAGATION_SPEED = 0.7;

    // Glow intensity: controls how strong the glow effect is
    static GLOW_INTENSITY = 5.0;

    static NOISE_STRENGTH = 0.04;

    constructor() {
        this.name = 'Unknown Pleasures';
        this.contextType = 'webgl';
        this.historySize = 25;
        this.dataPoints = 96;

        this.history = [];
        this.writeIndex = 0;

        this.pLookup = new Float32Array(this.dataPoints);
        this.xLookup = new Float32Array(this.dataPoints);

        // WebGL state
        this.gl = null;
        this.lineProgram = null;
        this.glowProgram = null;
        this.quadBuffer = null;
        this.framebuffer = null;
        this.sceneTexture = null;

        // Cached values
        this._paletteColor = '';
        this._paletteRGB = null;
        this.rotationAngle = Math.PI / 6;
        this._cos = Math.cos(this.rotationAngle);
        this._sin = Math.sin(this.rotationAngle);

        // Propagation timing
        this._propagationAccum = 0;

        this.reset();
        this._precompute();
    }

    reset() {
        this.history.length = 0;
        for (let i = 0; i < this.historySize; i++) {
            this.history.push(new Float32Array(this.dataPoints));
        }
        this.writeIndex = 0;
    }

    resize(width, height) {
        if (this.gl && this.sceneTexture) {
            this._resizeFramebuffer(this.gl, width, height);
        }
    }

    destroy() {
        this.history.length = 0;
        if (this.gl) {
            if (this.lineProgram) this.gl.deleteProgram(this.lineProgram);
            if (this.glowProgram) this.gl.deleteProgram(this.glowProgram);
            if (this.quadBuffer) this.gl.deleteBuffer(this.quadBuffer);
            if (this.framebuffer) this.gl.deleteFramebuffer(this.framebuffer);
            if (this.sceneTexture) this.gl.deleteTexture(this.sceneTexture);
        }
        this.gl = null;
        this.lineProgram = null;
        this.glowProgram = null;
    }

    _precompute() {
        const pts = this.dataPoints;
        const inv = 1 / (pts - 1);
        for (let i = 0; i < pts; i++) {
            const p = Math.abs(i * inv - 0.5) * 2;
            this.pLookup[i] = 1 - p * p * p;
            this.xLookup[i] = i * inv;
        }
    }

    _initGL(gl, width, height) {
        if (this.lineProgram) return;
        this.gl = gl;

        // === LINE SHADER (draws thick colored lines as quads with AA edges) ===
        const lineVS = `
            attribute vec3 a_posEdge; // xy = position, z = edge distance (-1 to +1)
            varying float v_edge;
            
            void main() {
                gl_Position = vec4(a_posEdge.xy, 0.0, 1.0);
                v_edge = a_posEdge.z;
            }
        `;

        const lineFS = `
            precision mediump float;
            uniform vec3 u_color;
            varying float v_edge;
            
            void main() {
                // Smooth antialiasing at edges
                float edge = abs(v_edge);
                float aa = 1.0 - smoothstep(0.6, 1.0, edge);
                gl_FragColor = vec4(u_color * aa, aa);
            }
        `;

        this.lineProgram = this._createProgram(gl, lineVS, lineFS);
        if (!this.lineProgram) return;

        this.line_a_posEdge = gl.getAttribLocation(this.lineProgram, 'a_posEdge');
        this.line_u_color = gl.getUniformLocation(this.lineProgram, 'u_color');

        // === BRIGHTNESS EXTRACTION SHADER ===
        // This is KEY for bloom - extract bright pixels, blur them, add back
        const brightnessVS = `
            attribute vec2 a_position;
            varying vec2 v_uv;
            
            void main() {
                v_uv = a_position * 0.5 + 0.5;
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `;

        const brightnessFS = `
            precision mediump float;
            varying vec2 v_uv;
            uniform sampler2D u_texture;
            uniform float u_threshold;
            uniform float u_isDarkTheme;
            
            void main() {
                // Since Pass 1 now clears to transparent, the scene texture only contains the isolated lines.
                // We don't need to extract brightness by darkening the background anymore.
                // Just pass the lines through so they can be blurred.
                gl_FragColor = texture2D(u_texture, v_uv);
            }
        `;

        this.brightnessProgram = this._createProgram(gl, brightnessVS, brightnessFS);
        if (!this.brightnessProgram) return;

        this.brightness_a_position = gl.getAttribLocation(this.brightnessProgram, 'a_position');
        this.brightness_u_texture = gl.getUniformLocation(this.brightnessProgram, 'u_texture');
        this.brightness_u_threshold = gl.getUniformLocation(this.brightnessProgram, 'u_threshold');
        this.brightness_u_isDarkTheme = gl.getUniformLocation(this.brightnessProgram, 'u_isDarkTheme');

        // === BLUR SHADER (two-pass separable Gaussian) ===
        const blurVS = `
            attribute vec2 a_position;
            varying vec2 v_uv;
            
            void main() {
                v_uv = a_position * 0.5 + 0.5;
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `;

        // 9-tap Gaussian blur with small fixed steps for smooth gradients
        // Use multiple passes to extend blur radius
        const blurFS = `
            precision mediump float;
            varying vec2 v_uv;
            uniform sampler2D u_texture;
            uniform vec2 u_resolution;
            uniform vec2 u_direction;
            uniform float u_spread; // Used instead of u_radius
            
            // 9-tap Gaussian with expanding offsets
            void main() {
                // Expanding offsets for stronger glow (Thread Ripper Style)
                vec2 off1 = vec2(1.3846153846) * u_direction * u_spread;
                vec2 off2 = vec2(3.2307692308) * u_direction * u_spread;
                
                vec4 color = texture2D(u_texture, v_uv) * 0.2270270270;
                color += texture2D(u_texture, v_uv + (off1 / u_resolution)) * 0.3162162162;
                color += texture2D(u_texture, v_uv - (off1 / u_resolution)) * 0.3162162162;
                color += texture2D(u_texture, v_uv + (off2 / u_resolution)) * 0.0702702703;
                color += texture2D(u_texture, v_uv - (off2 / u_resolution)) * 0.0702702703;
                
                gl_FragColor = color;
            }
        `;

        this.blurProgram = this._createProgram(gl, blurVS, blurFS);
        if (!this.blurProgram) return;

        this.blur_a_position = gl.getAttribLocation(this.blurProgram, 'a_position');
        this.blur_u_texture = gl.getUniformLocation(this.blurProgram, 'u_texture');
        this.blur_u_resolution = gl.getUniformLocation(this.blurProgram, 'u_resolution');
        this.blur_u_direction = gl.getUniformLocation(this.blurProgram, 'u_direction');
        this.blur_u_spread = gl.getUniformLocation(this.blurProgram, 'u_spread');

        // === COMPOSITE SHADER (combines original + blurred glow) ===
        // === COMPOSITE SHADER (exact copy from Thread Ripper) ===
        const compositeFS = `
            precision mediump float;
            varying vec2 v_uv;
            uniform sampler2D u_scene;
            uniform sampler2D u_blur;
            uniform float u_glowStrength;
            uniform float u_noiseStrength;
            uniform float u_isDarkTheme; // Kept for compatibility but unused in logic below
            uniform float u_time;
            
            float rand(vec2 co) {
                return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
            }

            void main() {
                vec4 original = texture2D(u_scene, v_uv);
                vec4 blur = texture2D(u_blur, v_uv);
                
                // Additive glow on top of original lines
                vec3 rgb = original.rgb + blur.rgb * u_glowStrength;
                
                // Vignette: blur edges for depth
                float dist = distance(v_uv, vec2(0.5));
                float vignette = smoothstep(0.4, 0.8, dist);
                // We handle scaling in the final mix later to avoid breaking the HDR mapping above.
                // The rgb here is the base scene before the final exponential glow math.

                float noise = rand(v_uv * 10.0); 
                float noiseStrength = 0.06; 
                rgb += (noise - 0.5) * noiseStrength;

                // In light mode (u_isDarkTheme == 0.0), the additive glow effect naturally appears weaker 
                // against the bright background. We apply a 1.5x perceptual boost to match dark mode intensity.
                float themeBoost = mix(1.5, 1.0, u_isDarkTheme);
                // Using 1.0 - exp(-x) gives butter-smooth HDR-like falloff, eliminating harsh banding.
                // We square the intensity (gamma 2.0) to dramatically increase the "core" opacity of the glow
                // making it much more visible while preserving the smooth edges.
                vec3 rawGlow = blur.rgb * (u_glowStrength * themeBoost);
                float glowIntensity = max(rawGlow.r, max(rawGlow.g, rawGlow.b));
                
                // Boost density significantly before applying HDR curve
                float density = glowIntensity * glowIntensity * 1.5;
                float smoothGlowAlpha = 1.0 - exp(-density);
                
                // Keep the color strictly within valid premultiplied alpha bounds (rgb <= alpha)
                vec3 safeGlowRgb = glowIntensity > 0.0 ? (rawGlow / glowIntensity) * smoothGlowAlpha : vec3(0.0);
                
                // Additive over the core lines
                rgb = original.rgb + safeGlowRgb;

                // Final alpha is the line's alpha plus the glow's alpha
                float finalAlpha = clamp(original.a + smoothGlowAlpha, 0.0, 1.0);

                // Output RGB and Alpha for PREMULTIPLIED alpha blending
                gl_FragColor = vec4(rgb, finalAlpha); 
            }
        `;

        this.compositeProgram = this._createProgram(gl, blurVS, compositeFS);
        if (!this.compositeProgram) return;

        this.composite_a_position = gl.getAttribLocation(this.compositeProgram, 'a_position');
        this.composite_u_scene = gl.getUniformLocation(this.compositeProgram, 'u_scene');
        this.composite_u_blur = gl.getUniformLocation(this.compositeProgram, 'u_blur');
        this.composite_u_glowStrength = gl.getUniformLocation(this.compositeProgram, 'u_glowStrength');
        this.composite_u_noiseStrength = gl.getUniformLocation(this.compositeProgram, 'u_noiseStrength');
        this.composite_u_isDarkTheme = gl.getUniformLocation(this.compositeProgram, 'u_isDarkTheme');
        this.composite_u_time = gl.getUniformLocation(this.compositeProgram, 'u_time');

        // === FULLSCREEN QUAD BUFFER ===
        this.quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

        // === LINE GEOMETRY BUFFER (dynamic) ===
        this.lineBuffer = gl.createBuffer();

        // === FRAMEBUFFER FOR POST-PROCESSING ===
        this._createFramebuffer(gl, width, height);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    _createProgram(gl, vsSource, fsSource) {
        const vs = this._compileShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = this._compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) return null;

        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('WebGL program link failed:', gl.getProgramInfoLog(program));
            return null;
        }

        return program;
    }

    _compileShader(gl, type, source) {
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

    _createFramebuffer(gl, width, height) {
        // Framebuffer 1: Scene (lines)
        this.framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);

        this.sceneTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTexture, 0);

        // Framebuffer 2: Blur intermediate (for horizontal pass)
        this.blurFramebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFramebuffer);

        this.blurTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.blurTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // LINEAR!
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.blurTexture, 0);

        // Framebuffer 3: Blur final (for vertical pass result)
        this.blurFinalFramebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFinalFramebuffer);

        this.blurFinalTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.blurFinalTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.blurFinalTexture, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.error('Framebuffer incomplete:', status);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    _resizeFramebuffer(gl, width, height) {
        gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindTexture(gl.TEXTURE_2D, this.blurTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindTexture(gl.TEXTURE_2D, this.blurFinalTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }

    _buildPalette(color) {
        // Parse color exactly like Canvas2D version
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);

        // perceptual grayscale (same weights browsers use)
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;

        this._paletteRGB = [];
        for (let i = 0; i < this.historySize; i++) {
            const p = i / (this.historySize - 1);

            // === Saturation gradient (HSL-like) - match Canvas2D exactly ===
            const sat = 3.0 - 2 * p;
            // Clamp to 0-255 like Canvas2D does with | 0
            const rr = Math.max(0, Math.min(255, (gray + (r - gray) * sat) | 0)) / 255;
            const gg = Math.max(0, Math.min(255, (gray + (g - gray) * sat) | 0)) / 255;
            const bb = Math.max(0, Math.min(255, (gray + (b - gray) * sat) | 0)) / 255;

            this._paletteRGB.push([rr, gg, bb]);
        }

        this._paletteColor = color;
    }

    /**
     * Generate quad vertices for a thick line with proper miter joints.
     * Precomputes averaged normals at shared vertices so segments connect seamlessly.
     */
    _generateLineQuads(points, thickness, width, height) {
        if (points.length < 2) return new Float32Array(0);

        const vertices = [];
        const toClip = (x, y) => [(x / width) * 2 - 1, 1 - (y / height) * 2];
        const n = points.length;

        // Precompute per-segment normals
        const segNx = new Float32Array(n - 1);
        const segNy = new Float32Array(n - 1);
        for (let i = 0; i < n - 1; i++) {
            const dx = points[i + 1].x - points[i].x;
            const dy = points[i + 1].y - points[i].y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 0.001) {
                segNx[i] = 0;
                segNy[i] = -1;
            } else {
                segNx[i] = -dy / len;
                segNy[i] = dx / len;
            }
        }

        // Compute miter normals at each point (average of adjacent segment normals)
        const miterNx = new Float32Array(n);
        const miterNy = new Float32Array(n);
        // First point: use first segment normal
        miterNx[0] = segNx[0];
        miterNy[0] = segNy[0];
        // Last point: use last segment normal
        miterNx[n - 1] = segNx[n - 2];
        miterNy[n - 1] = segNy[n - 2];
        // Interior points: average
        for (let i = 1; i < n - 1; i++) {
            let mx = segNx[i - 1] + segNx[i];
            let my = segNy[i - 1] + segNy[i];
            const ml = Math.sqrt(mx * mx + my * my);
            if (ml < 0.001) {
                mx = segNx[i];
                my = segNy[i];
            } else {
                mx /= ml;
                my /= ml;
            }
            miterNx[i] = mx;
            miterNy[i] = my;
        }

        // Build quads using miter normals
        for (let i = 0; i < n - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];

            const [x1a, y1a] = toClip(p1.x - miterNx[i] * thickness, p1.y - miterNy[i] * thickness);
            const [x1b, y1b] = toClip(p1.x + miterNx[i] * thickness, p1.y + miterNy[i] * thickness);
            const [x2a, y2a] = toClip(p2.x - miterNx[i + 1] * thickness, p2.y - miterNy[i + 1] * thickness);
            const [x2b, y2b] = toClip(p2.x + miterNx[i + 1] * thickness, p2.y + miterNy[i + 1] * thickness);

            // Each vertex: [x, y, edge] where edge = -1 (bottom) or +1 (top)
            vertices.push(x1a, y1a, -1.0, x1b, y1b, 1.0, x2a, y2a, -1.0);
            vertices.push(x1b, y1b, 1.0, x2b, y2b, 1.0, x2a, y2a, -1.0);
        }

        return new Float32Array(vertices);
    }

    draw(ctx, canvas, analyser, dataArray, params) {
        const gl = ctx;
        const { width, height } = canvas;
        const isDark = document.documentElement.getAttribute('data-theme') !== 'white';

        // FORCE Normal blending as requested - no more screen blend tricks
        canvas.style.mixBlendMode = 'normal';

        // Initialize WebGL on first draw
        if (!this.lineProgram) {
            this._initGL(gl, width, height);
            if (!this.lineProgram) {
                console.error('WebGL init failed');
                return;
            }
        }

        // Reset if needed
        if (this.history.length === 0) {
            this.reset();
        }

        // Update history with propagation speed control
        // Higher PROPAGATION_SPEED = faster wave propagation
        this._propagationAccum += UnknownPleasuresWebGL.PROPAGATION_SPEED;
        const pts = this.dataPoints;

        if (this._propagationAccum >= 1.0) {
            this._propagationAccum -= 1.0;

            const sampleRate = analyser.context.sampleRate;
            const nyquist = sampleRate / 2;
            const targetFreq = 22000; // Visualizing up to 22kHz
            const scale = Math.min(1.0, targetFreq / nyquist);
            const len = Math.floor(dataArray.length * scale);

            const line = this.history[this.writeIndex];
            if (line) {
                for (let i = 0; i < pts; i++) {
                    line[i] = (dataArray[(this.xLookup[i] * len) | 0] / 255) * this.pLookup[i];
                }
            }
            this.writeIndex = (this.writeIndex + 1) % this.historySize;
        }

        // Update palette if color changed
        if (this._paletteColor !== params.primaryColor) {
            this._buildPalette(params.primaryColor);
        }

        // Compute size for rotated bounding box
        const rotatedW = Math.abs(width * this._cos) + Math.abs(height * this._sin);
        const rotatedH = Math.abs(width * this._sin) + Math.abs(height * this._cos);
        const size = Math.max(rotatedW, rotatedH) * 1.15;

        // === PASS 1: Scene ===
        // We render lines to a transparent texture so we can composite them properly later
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Perspective constants - extended for better corner coverage
        const horizonY = size * 0.05; // Further back (was 0.1)
        const frontY = size * 0.9; // Closer to edge (was 0.8)
        const depth = 2.0;
        const totalH = frontY - horizonY;
        const B = totalH / (1 - 1 / (1 + depth));
        const A = frontY - B;

        // Lines output premultiplied alpha (color * aa, aa).
        gl.enable(gl.BLEND);
        if (isDark) {
            // Additive premultiplied
            gl.blendFunc(gl.ONE, gl.ONE);
        } else {
            // Standard premultiplied
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        }

        gl.useProgram(this.lineProgram);

        // Draw each line (back to front)
        for (let i = this.historySize - 1; i >= 0; i--) {
            const idx = (this.writeIndex + i) % this.historySize;
            const historyLine = this.history[idx];

            const p = 1 - i / (this.historySize - 1);
            const z = 1 + p * depth;
            const scale = 1 / z;
            const y = A + B / z;

            const lw = size * scale * 1.5;
            const margin = (size - lw) * 0.5;
            const amp = 200 * scale;
            const lineWidth = Math.max(1, 8 * scale + params.kick * 3);

            // Generate line points (in rotated space, then transform to screen)
            const points = [];
            const cx = width / 2;
            const cy = height / 2;
            const cosR = this._cos;
            const sinR = this._sin;
            const offsetX = -size / 2;
            const offsetY = -size / 2;

            for (let j = 0; j < pts; j++) {
                // Position in rotated coordinate system
                const rx = margin + this.xLookup[j] * lw;
                const ry = y - historyLine[j] * amp;

                // Apply rotation and translate to screen
                const dx = rx + offsetX;
                const dy = ry + offsetY;
                const screenX = dx * cosR - dy * sinR + cx;
                const screenY = dx * sinR + dy * cosR + cy;

                points.push({ x: screenX, y: screenY });
            }

            // Generate quad geometry for thick line
            const vertices = this._generateLineQuads(points, lineWidth / 2, width, height);
            if (vertices.length === 0) continue;

            // Upload vertices
            gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);

            gl.enableVertexAttribArray(this.line_a_posEdge);
            gl.vertexAttribPointer(this.line_a_posEdge, 3, gl.FLOAT, false, 0, 0);

            // Set raw palette color
            const color = this._paletteRGB[i] || [1, 1, 1];
            gl.uniform3f(this.line_u_color, color[0], color[1], color[2]);

            // Draw (vertices.length / 3 because each vertex is [x, y, edge])
            gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 3);
        }



        // MUST DISABLE BLEND for post-processing passes so we strictly overwrite FBO contents!
        gl.disable(gl.BLEND);

        // === PASS 2: Bloom ===
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFramebuffer);
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.brightnessProgram);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
        gl.uniform1i(this.brightness_u_texture, 0);
        // NO THRESHOLD - EVERYTHING GLOWS (Thread Ripper Style)
        gl.uniform1f(this.brightness_u_threshold, 0.0);
        gl.uniform1f(this.brightness_u_isDarkTheme, isDark ? 1.0 : 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(this.brightness_a_position);
        gl.vertexAttribPointer(this.brightness_a_position, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // === PASS 3: Gaussian Blur (Ping Pong) ===
        gl.useProgram(this.blurProgram);

        // More iterations for wider, smoother glow (Thread Ripper uses 8 * 2 passes)
        // We have 2 framebuffers: blurFramebuffer (holds brightness extract), blurFinalFramebuffer (temp)
        // thread_ripper uses ping-pong. Let's adapt.

        // We start with 'blurFramebuffer' having the bright pixels.
        // We want to ping-pong between blurFramebuffer and blurFinalFramebuffer.

        const iterations = 8;
        let horizontal = true;

        for (let i = 0; i < iterations * 2; i++) {
            // Thread Ripper ping-pong: horizontal toggles each iteration
            const destFBO = horizontal ? this.blurFinalFramebuffer : this.blurFramebuffer;
            const srcTex = horizontal ? this.blurTexture : this.blurFinalTexture;

            // Thread Ripper spread: grows linearly with i (not i/2)
            // Increased by 50% from 0.375 to 0.5625 for wider glow
            const spread = 1.0 + i * 0.5625;

            gl.bindFramebuffer(gl.FRAMEBUFFER, destFBO);
            gl.viewport(0, 0, width, height);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, srcTex);
            gl.uniform1i(this.blur_u_texture, 0);
            gl.uniform2f(this.blur_u_resolution, width, height);

            gl.uniform2f(this.blur_u_direction, horizontal ? 1.0 : 0.0, horizontal ? 0.0 : 1.0);
            gl.uniform1f(this.blur_u_spread, spread);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            gl.enableVertexAttribArray(this.blur_a_position);
            gl.vertexAttribPointer(this.blur_a_position, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            horizontal = !horizontal;
        }

        // Final result is in the LAST written framebuffer.
        // iter 0 -> writes Final
        // iter 1 -> writes Blur
        // ...
        // iter 15 -> writes Blur

        // So 'blurTexture' holds the final blurred result.

        // === PASS 4: Composite ===
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);

        // Clear color for MAIN canvas
        if (params.mode !== 'blended') {
            const bg = isDark ? [0.02, 0.02, 0.02, 1] : [0.9, 0.9, 0.9, 1];
            gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
        } else if (isDark) {
            gl.clearColor(0, 0, 0, 0.4); // Dark blended
        } else {
            gl.clearColor(0.95, 0.95, 0.95, 0.4); // Light frosted
        }
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Classic normal blending for the final composite quad over the canvas background!
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        gl.useProgram(this.compositeProgram);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
        gl.uniform1i(this.composite_u_scene, 0);

        gl.activeTexture(gl.TEXTURE1);
        // Use last output: horizontal toggles, so pick the right texture (Thread Ripper pattern)
        gl.bindTexture(gl.TEXTURE_2D, horizontal ? this.blurTexture : this.blurFinalTexture);
        gl.uniform1i(this.composite_u_blur, 1);

        // Glow strength - EXACT Thread Ripper formula
        const glowBoost = 1.0 + params.kick; // Pulse with kick
        const glowStrength = UnknownPleasuresWebGL.GLOW_INTENSITY * glowBoost;

        gl.uniform1f(this.composite_u_glowStrength, glowStrength);
        gl.uniform1f(this.composite_u_noiseStrength, UnknownPleasuresWebGL.NOISE_STRENGTH);
        gl.uniform1f(this.composite_u_isDarkTheme, isDark ? 1.0 : 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(this.composite_a_position);
        gl.vertexAttribPointer(this.composite_a_position, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
}
