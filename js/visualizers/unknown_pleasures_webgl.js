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
    // Lower = subtler glow (0.5 = subtle, 1.0 = normal, 2.0 = strong)
    static GLOW_INTENSITY = 0.7;

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

        // === LINE SHADER (draws thick colored lines as quads) ===
        const lineVS = `
            attribute vec2 a_position;
            
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `;

        const lineFS = `
            precision mediump float;
            uniform vec3 u_color;
            
            void main() {
                gl_FragColor = vec4(u_color, 1.0);
            }
        `;

        this.lineProgram = this._createProgram(gl, lineVS, lineFS);
        if (!this.lineProgram) return;

        this.line_a_position = gl.getAttribLocation(this.lineProgram, 'a_position');
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
                vec4 color = texture2D(u_texture, v_uv);
                
                float contribution;
                float outputMult;
                
                if (u_isDarkTheme > 0.5) {
                    // Dark mode: use brightness (bright lines on dark background)
                    float brightness = max(color.r, max(color.g, color.b));
                    contribution = max(0.0, brightness - u_threshold) / (1.0 - u_threshold);
                    outputMult = 0.75;
                } else {
                    // Light mode: use saturation (colored lines on gray background)
                    float maxC = max(color.r, max(color.g, color.b));
                    float minC = min(color.r, min(color.g, color.b));
                    float saturation = maxC > 0.0 ? (maxC - minC) / maxC : 0.0;
                    // Lower threshold to capture more of the line, boost output
                    contribution = max(0.0, saturation - 0.15) / 0.85;
                    // Boost contribution with power curve for stronger glow
                    contribution = pow(contribution, 0.7);
                    outputMult = 1.5;
                }
                
                // Output the glowing parts
                gl_FragColor = vec4(color.rgb * contribution * outputMult, 1.0);
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
            uniform float u_radius;
            
            void main() {
                vec2 texelSize = 1.0 / u_resolution;
                // Fixed small step (1.5 pixels) for smooth gradient
                // Multiple passes will extend the blur
                vec2 step = u_direction * texelSize * 1.5;
                
                // 9-tap Gaussian weights (sum = 1.0)
                vec4 result = 
                    texture2D(u_texture, v_uv - 4.0 * step) * 0.0162 +
                    texture2D(u_texture, v_uv - 3.0 * step) * 0.0540 +
                    texture2D(u_texture, v_uv - 2.0 * step) * 0.1216 +
                    texture2D(u_texture, v_uv - 1.0 * step) * 0.1945 +
                    texture2D(u_texture, v_uv)              * 0.2270 +
                    texture2D(u_texture, v_uv + 1.0 * step) * 0.1945 +
                    texture2D(u_texture, v_uv + 2.0 * step) * 0.1216 +
                    texture2D(u_texture, v_uv + 3.0 * step) * 0.0540 +
                    texture2D(u_texture, v_uv + 4.0 * step) * 0.0162;
                
                gl_FragColor = result;
            }
        `;

        this.blurProgram = this._createProgram(gl, blurVS, blurFS);
        if (!this.blurProgram) return;

        this.blur_a_position = gl.getAttribLocation(this.blurProgram, 'a_position');
        this.blur_u_texture = gl.getUniformLocation(this.blurProgram, 'u_texture');
        this.blur_u_resolution = gl.getUniformLocation(this.blurProgram, 'u_resolution');
        this.blur_u_direction = gl.getUniformLocation(this.blurProgram, 'u_direction');
        this.blur_u_radius = gl.getUniformLocation(this.blurProgram, 'u_radius');

        // === COMPOSITE SHADER (combines original + blurred glow) ===
        const compositeFS = `
            precision mediump float;
            varying vec2 v_uv;
            uniform sampler2D u_scene;
            uniform sampler2D u_blur;
            uniform float u_glowStrength;
            uniform float u_isDarkTheme;
            
            void main() {
                vec4 original = texture2D(u_scene, v_uv);
                vec4 blur = texture2D(u_blur, v_uv);
                
                vec3 finalColor;
                
                if (u_isDarkTheme > 0.5) {
                    // Dark mode: additive glow (adds brightness to dark background)
                    vec3 glow = blur.rgb * u_glowStrength;
                    finalColor = original.rgb + glow;
                } else {
                    // Light mode: TINT toward glow color instead of adding
                    // This shifts the gray background toward the line color
                    float glowIntensity = max(blur.r, max(blur.g, blur.b));
                    float tintStrength = glowIntensity * u_glowStrength * 0.8; // Boosted from 0.4
                    // Mix original with glow color based on intensity
                    vec3 glowColor = blur.rgb / max(glowIntensity, 0.001); // Normalize to get pure color
                    finalColor = mix(original.rgb, glowColor, tintStrength);
                }
                
                // Preserve alpha from scene (needed for semi-transparent backgrounds)
                gl_FragColor = vec4(finalColor, original.a);
            }
        `;

        this.compositeProgram = this._createProgram(gl, blurVS, compositeFS);
        if (!this.compositeProgram) return;

        this.composite_a_position = gl.getAttribLocation(this.compositeProgram, 'a_position');
        this.composite_u_scene = gl.getUniformLocation(this.compositeProgram, 'u_scene');
        this.composite_u_blur = gl.getUniformLocation(this.compositeProgram, 'u_blur');
        this.composite_u_glowStrength = gl.getUniformLocation(this.compositeProgram, 'u_glowStrength');
        this.composite_u_isDarkTheme = gl.getUniformLocation(this.compositeProgram, 'u_isDarkTheme');

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
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
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
     * Generate quad vertices for a thick line segment with round joints
     * Returns triangles for each segment + circles at joints
     */
    _generateLineQuads(points, thickness, width, height) {
        const vertices = [];

        // Convert to clip space helper
        const toClip = (x, y) => [(x / width) * 2 - 1, 1 - (y / height) * 2];

        // Generate circle at a point (for round joints/caps)
        const addCircle = (px, py, radius, segments = 8) => {
            const [cx, cy] = toClip(px, py);
            const rw = (radius / width) * 2;
            const rh = (radius / height) * 2;

            for (let s = 0; s < segments; s++) {
                const a1 = (s / segments) * Math.PI * 2;
                const a2 = ((s + 1) / segments) * Math.PI * 2;

                vertices.push(cx, cy);
                vertices.push(cx + Math.cos(a1) * rw, cy + Math.sin(a1) * rh);
                vertices.push(cx + Math.cos(a2) * rw, cy + Math.sin(a2) * rh);
            }
        };

        // Add start cap
        if (points.length > 0) {
            addCircle(points[0].x, points[0].y, thickness);
        }

        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];

            // Direction vector
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 0.001) continue;

            // Perpendicular (normal) vector
            const nx = (-dy / len) * thickness;
            const ny = (dx / len) * thickness;

            const [x1a, y1a] = toClip(p1.x - nx, p1.y - ny);
            const [x1b, y1b] = toClip(p1.x + nx, p1.y + ny);
            const [x2a, y2a] = toClip(p2.x - nx, p2.y - ny);
            const [x2b, y2b] = toClip(p2.x + nx, p2.y + ny);

            // Triangle 1
            vertices.push(x1a, y1a, x1b, y1b, x2a, y2a);
            // Triangle 2
            vertices.push(x1b, y1b, x2b, y2b, x2a, y2a);

            // Add round joint at p2 (connection point)
            addCircle(p2.x, p2.y, thickness);
        }

        return new Float32Array(vertices);
    }

    draw(ctx, canvas, analyser, dataArray, params) {
        const gl = ctx;
        const { width, height } = canvas;
        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

        // Set CSS blend mode based on mode and theme
        // Solid: normal (opaque background)
        // Blended + Dark: screen (black=transparent, bright=visible)
        // Blended + Light: normal (semi-transparent background overlay)
        if (params.mode === 'blended' && isDark) {
            canvas.style.mixBlendMode = 'screen';
        } else {
            canvas.style.mixBlendMode = 'normal';
        }

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

            const len = dataArray.length | 0;
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

        // === PASS 1: Render lines to framebuffer ===
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, width, height);

        // Clear color based on mode and theme
        // Solid: dark/light solid background
        // Blended + Dark (screen): black (black=transparent in screen blend)
        // Blended + Light: semi-transparent light (album art shows through)
        if (params.mode !== 'blended') {
            const bg = isDark ? [0.02, 0.02, 0.02, 1] : [0.9, 0.9, 0.9, 1];
            gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
        } else if (isDark) {
            // Dark: black for screen blend (black=transparent)
            gl.clearColor(0, 0, 0, 1);
        } else {
            // Light: semi-transparent white overlay (frosted glass effect)
            gl.clearColor(0.92, 0.92, 0.92, 0.85);
        }
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Perspective constants - extended for better corner coverage
        const horizonY = size * 0.05; // Further back (was 0.1)
        const frontY = size * 0.9; // Closer to edge (was 0.8)
        const depth = 2.0;
        const totalH = frontY - horizonY;
        const B = totalH / (1 - 1 / (1 + depth));
        const A = frontY - B;

        // Enable blending for anti-aliased edges and proper alpha
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

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

            gl.enableVertexAttribArray(this.line_a_position);
            gl.vertexAttribPointer(this.line_a_position, 2, gl.FLOAT, false, 0, 0);

            // Set color
            const color = this._paletteRGB[i] || [1, 1, 1];
            gl.uniform3f(this.line_u_color, color[0], color[1], color[2]);

            // Draw
            gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
        }

        // === PASS 2: Extract bright pixels ===
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFramebuffer);
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.brightnessProgram);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
        gl.uniform1i(this.brightness_u_texture, 0);
        gl.uniform1f(this.brightness_u_threshold, 0.1); // Low threshold for dark mode
        gl.uniform1f(this.brightness_u_isDarkTheme, isDark ? 1.0 : 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(this.brightness_a_position);
        gl.vertexAttribPointer(this.brightness_a_position, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // === PASS 3: Horizontal Gaussian blur ===
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFinalFramebuffer);
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.blurProgram);

        // Multiple blur passes with increasing step sizes for smooth wide blur
        // This prevents banding by using overlapping samples
        const numPasses = 3;
        for (let pass = 0; pass < numPasses; pass++) {
            const stepMultiplier = Math.pow(2, pass); // 1, 2, 4

            // Horizontal blur
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFinalFramebuffer);
            gl.viewport(0, 0, width, height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.blurTexture);
            gl.uniform1i(this.blur_u_texture, 0);
            gl.uniform2f(this.blur_u_resolution, width, height);
            gl.uniform2f(this.blur_u_direction, stepMultiplier, 0.0); // Horizontal with scaled step
            gl.uniform1f(this.blur_u_radius, 32.0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            gl.enableVertexAttribArray(this.blur_a_position);
            gl.vertexAttribPointer(this.blur_a_position, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Vertical blur
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFramebuffer);
            gl.viewport(0, 0, width, height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.blurFinalTexture);
            gl.uniform1i(this.blur_u_texture, 0);
            gl.uniform2f(this.blur_u_direction, 0.0, stepMultiplier); // Vertical with scaled step

            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        // === PASS 4: Composite original + blur ===
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);

        // Clear color based on mode and theme
        // Solid: opaque background
        // Blended + Dark: black (for screen blend)
        // Blended + Light: transparent (composite has the semi-transparent background in it)
        if (params.mode !== 'blended') {
            const bg = isDark ? [0.02, 0.02, 0.02, 1] : [0.9, 0.9, 0.9, 1];
            gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
        } else if (isDark) {
            gl.clearColor(0, 0, 0, 1);
        } else {
            // Light blended: composite will output semi-transparent, clear is transparent
            gl.clearColor(0, 0, 0, 0);
        }
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Blending for final composite
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.useProgram(this.compositeProgram);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
        gl.uniform1i(this.composite_u_scene, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.blurTexture); // V-blur result
        gl.uniform1i(this.composite_u_blur, 1);

        // Glow strength reacts to kick, scaled by GLOW_INTENSITY
        const baseGlow = 1.8 + params.kick * 2.5;
        const glowStrength = baseGlow * UnknownPleasuresWebGL.GLOW_INTENSITY;
        gl.uniform1f(this.composite_u_glowStrength, glowStrength);
        gl.uniform1f(this.composite_u_isDarkTheme, isDark ? 1.0 : 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(this.composite_a_position);
        gl.vertexAttribPointer(this.composite_a_position, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
}
