class C{static PROPAGATION_SPEED=.7;static GLOW_INTENSITY=5;static NOISE_STRENGTH=.04;constructor(){this.name="Unknown Pleasures",this.contextType="webgl",this.historySize=25,this.dataPoints=96,this.history=[],this.writeIndex=0,this.pLookup=new Float32Array(this.dataPoints),this.xLookup=new Float32Array(this.dataPoints),this.gl=null,this.lineProgram=null,this.glowProgram=null,this.quadBuffer=null,this.framebuffer=null,this.sceneTexture=null,this._paletteColor="",this._paletteRGB=null,this.rotationAngle=Math.PI/6,this._cos=Math.cos(this.rotationAngle),this._sin=Math.sin(this.rotationAngle),this._propagationAccum=0,this.reset(),this._precompute()}reset(){this.history.length=0;for(let t=0;t<this.historySize;t++)this.history.push(new Float32Array(this.dataPoints));this.writeIndex=0}resize(t,o){this.gl&&this.sceneTexture&&this._resizeFramebuffer(this.gl,t,o)}destroy(){this.history.length=0,this.gl&&(this.lineProgram&&this.gl.deleteProgram(this.lineProgram),this.glowProgram&&this.gl.deleteProgram(this.glowProgram),this.quadBuffer&&this.gl.deleteBuffer(this.quadBuffer),this.framebuffer&&this.gl.deleteFramebuffer(this.framebuffer),this.sceneTexture&&this.gl.deleteTexture(this.sceneTexture)),this.gl=null,this.lineProgram=null,this.glowProgram=null}_precompute(){const t=this.dataPoints,o=1/(t-1);for(let a=0;a<t;a++){const s=Math.abs(a*o-.5)*2;this.pLookup[a]=1-s*s*s,this.xLookup[a]=a*o}}_createBuffers(){this.quadBuffer=this.gl.createBuffer(),this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.quadBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),this.gl.STATIC_DRAW),this.lineBuffer=this.gl.createBuffer();const t=this.historySize*this.dataPoints*6;this.vertexBuffer=new Float32Array(t*3)}_initGL(t,o,a){if(this.lineProgram)return;this.gl=t;const s=`
            attribute vec3 a_posEdge; // xy = position, z = edge distance (-1 to +1)
            varying float v_edge;
            
            void main() {
                gl_Position = vec4(a_posEdge.xy, 0.0, 1.0);
                v_edge = a_posEdge.z;
            }
        `,r=`
            precision mediump float;
            uniform vec3 u_color;
            varying float v_edge;
            
            void main() {
                // Smooth antialiasing at edges
                float edge = abs(v_edge);
                float aa = 1.0 - smoothstep(0.6, 1.0, edge);
                gl_FragColor = vec4(u_color * aa, aa);
            }
        `;if(this.lineProgram=this._createProgram(t,s,r),!this.lineProgram)return;this.line_a_posEdge=t.getAttribLocation(this.lineProgram,"a_posEdge"),this.line_u_color=t.getUniformLocation(this.lineProgram,"u_color");const e=`
            attribute vec2 a_position;
            varying vec2 v_uv;
            
            void main() {
                v_uv = a_position * 0.5 + 0.5;
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `,c=`
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
        `;if(this.brightnessProgram=this._createProgram(t,e,c),!this.brightnessProgram)return;this.brightness_a_position=t.getAttribLocation(this.brightnessProgram,"a_position"),this.brightness_u_texture=t.getUniformLocation(this.brightnessProgram,"u_texture"),this.brightness_u_threshold=t.getUniformLocation(this.brightnessProgram,"u_threshold"),this.brightness_u_isDarkTheme=t.getUniformLocation(this.brightnessProgram,"u_isDarkTheme");const i=`
            attribute vec2 a_position;
            varying vec2 v_uv;
            
            void main() {
                v_uv = a_position * 0.5 + 0.5;
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `,_=`
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
        `;if(this.blurProgram=this._createProgram(t,i,_),!this.blurProgram)return;this.blur_a_position=t.getAttribLocation(this.blurProgram,"a_position"),this.blur_u_texture=t.getUniformLocation(this.blurProgram,"u_texture"),this.blur_u_resolution=t.getUniformLocation(this.blurProgram,"u_resolution"),this.blur_u_direction=t.getUniformLocation(this.blurProgram,"u_direction"),this.blur_u_spread=t.getUniformLocation(this.blurProgram,"u_spread");const u=`
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
        `;this.compositeProgram=this._createProgram(t,i,u),this.compositeProgram&&(this.composite_a_position=t.getAttribLocation(this.compositeProgram,"a_position"),this.composite_u_scene=t.getUniformLocation(this.compositeProgram,"u_scene"),this.composite_u_blur=t.getUniformLocation(this.compositeProgram,"u_blur"),this.composite_u_glowStrength=t.getUniformLocation(this.compositeProgram,"u_glowStrength"),this.composite_u_noiseStrength=t.getUniformLocation(this.compositeProgram,"u_noiseStrength"),this.composite_u_isDarkTheme=t.getUniformLocation(this.compositeProgram,"u_isDarkTheme"),this.composite_u_time=t.getUniformLocation(this.compositeProgram,"u_time"),this._createBuffers(),this._createFramebuffer(t,o,a),t.enable(t.BLEND),t.blendFunc(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA))}_createProgram(t,o,a){const s=this._compileShader(t,t.VERTEX_SHADER,o),r=this._compileShader(t,t.FRAGMENT_SHADER,a);if(!s||!r)return null;const e=t.createProgram();return t.attachShader(e,s),t.attachShader(e,r),t.linkProgram(e),t.getProgramParameter(e,t.LINK_STATUS)?e:(console.error("WebGL program link failed:",t.getProgramInfoLog(e)),null)}_compileShader(t,o,a){const s=t.createShader(o);return t.shaderSource(s,a),t.compileShader(s),t.getShaderParameter(s,t.COMPILE_STATUS)?s:(console.error("Shader compile error:",t.getShaderInfoLog(s)),t.deleteShader(s),null)}_createFramebuffer(t,o,a){this.framebuffer=t.createFramebuffer(),t.bindFramebuffer(t.FRAMEBUFFER,this.framebuffer),this.sceneTexture=t.createTexture(),t.bindTexture(t.TEXTURE_2D,this.sceneTexture),t.texImage2D(t.TEXTURE_2D,0,t.RGBA,o,a,0,t.RGBA,t.UNSIGNED_BYTE,null),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,this.sceneTexture,0);const s=Math.max(1,o>>1),r=Math.max(1,a>>1);this.blurFramebuffer=t.createFramebuffer(),t.bindFramebuffer(t.FRAMEBUFFER,this.blurFramebuffer),this.blurTexture=t.createTexture(),t.bindTexture(t.TEXTURE_2D,this.blurTexture),t.texImage2D(t.TEXTURE_2D,0,t.RGBA,s,r,0,t.RGBA,t.UNSIGNED_BYTE,null),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,this.blurTexture,0),this.blurFinalFramebuffer=t.createFramebuffer(),t.bindFramebuffer(t.FRAMEBUFFER,this.blurFinalFramebuffer),this.blurFinalTexture=t.createTexture(),t.bindTexture(t.TEXTURE_2D,this.blurFinalTexture),t.texImage2D(t.TEXTURE_2D,0,t.RGBA,s,r,0,t.RGBA,t.UNSIGNED_BYTE,null),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,this.blurFinalTexture,0),t.bindFramebuffer(t.FRAMEBUFFER,null)}_resizeFramebuffer(t,o,a){const s=Math.max(1,o>>1),r=Math.max(1,a>>1);t.bindTexture(t.TEXTURE_2D,this.sceneTexture),t.texImage2D(t.TEXTURE_2D,0,t.RGBA,o,a,0,t.RGBA,t.UNSIGNED_BYTE,null),t.bindTexture(t.TEXTURE_2D,this.blurTexture),t.texImage2D(t.TEXTURE_2D,0,t.RGBA,s,r,0,t.RGBA,t.UNSIGNED_BYTE,null),t.bindTexture(t.TEXTURE_2D,this.blurFinalTexture),t.texImage2D(t.TEXTURE_2D,0,t.RGBA,s,r,0,t.RGBA,t.UNSIGNED_BYTE,null)}_buildPalette(t){const o=parseInt(t.slice(1,3),16),a=parseInt(t.slice(3,5),16),s=parseInt(t.slice(5,7),16),r=.299*o+.587*a+.114*s;this._paletteRGB=[];for(let e=0;e<this.historySize;e++){const i=3-2*(e/(this.historySize-1)),_=Math.max(0,Math.min(255,r+(o-r)*i|0))/255,u=Math.max(0,Math.min(255,r+(a-r)*i|0))/255,m=Math.max(0,Math.min(255,r+(s-r)*i|0))/255;this._paletteRGB.push([_,u,m])}this._paletteColor=t}_generateLineQuads(t,o,a,s,r,e){if(!r||!Array.isArray(t)&&!t.length||t.length<2)return 0;const c=t.length;let i=e;const _=2/a,u=2/s;for(let m=0;m<c-1;m++){const f=t[m],T=t[m+1];let B=T.x-f.x,y=T.y-f.y,I=Math.sqrt(B*B+y*y),E,p;I<.001?(E=0,p=-1):(E=-y/I,p=B/I);let U=E,N=p;if(m>0){const d=t[m-1],l=f.x-d.x,h=f.y-d.y,R=Math.sqrt(l*l+h*h);R>=.001&&(U=-h/R,N=l/R)}let P=E+U,v=p+N,D=Math.sqrt(P*P+v*v);D>.001&&(P/=D,v/=D);let w=E,G=p;if(m<c-2){const d=t[m+2],l=d.x-T.x,h=d.y-T.y,R=Math.sqrt(l*l+h*h);R>=.001&&(w=-h/R,G=l/R)}let g=E+w,A=p+G,S=Math.sqrt(g*g+A*A);S>.001&&(g/=S,A/=S);const k=(f.x-P*o)*_-1,x=1-(f.y-v*o)*u,X=(f.x+P*o)*_-1,n=1-(f.y+v*o)*u,b=(T.x-g*o)*_-1,F=1-(T.y-A*o)*u,M=(T.x+g*o)*_-1,L=1-(T.y+A*o)*u;r[i++]=k,r[i++]=x,r[i++]=-1,r[i++]=X,r[i++]=n,r[i++]=1,r[i++]=b,r[i++]=F,r[i++]=-1,r[i++]=X,r[i++]=n,r[i++]=1,r[i++]=M,r[i++]=L,r[i++]=1,r[i++]=b,r[i++]=F,r[i++]=-1}return i-e}draw(t,o,a,s,r){const e=t,{width:c,height:i}=o,_=document.documentElement.getAttribute("data-theme")!=="white";if(o.style.mixBlendMode="normal",this.lineProgram||this._initGL(e,c,i),this.history.length===0&&this.reset(),!r.paused){this._propagationAccum+=C.PROPAGATION_SPEED;const n=this.dataPoints;if(this._propagationAccum>=1){this._propagationAccum-=1;const F=a.context.sampleRate/2,L=Math.min(1,22e3/F),d=Math.floor(s.length*L),l=this.history[this.writeIndex];if(l)for(let h=0;h<n;h++)l[h]=s[this.xLookup[h]*d|0]/255*this.pLookup[h];this.writeIndex=(this.writeIndex+1)%this.historySize}}this._paletteColor!==r.primaryColor&&this._buildPalette(r.primaryColor),e.bindFramebuffer(e.FRAMEBUFFER,this.framebuffer),e.viewport(0,0,c,i),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT);const u=Math.max(Math.abs(c*this._cos)+Math.abs(i*this._sin),Math.abs(c*this._sin)+Math.abs(i*this._cos))*1.15,m=u*.05,f=u*.9,T=2,y=(f-m)/(1-1/(1+T)),I=f-y;let E=0;const p=[];this._tempPoints||(this._tempPoints=[]);const U=this._tempPoints,N=this.dataPoints,P=c/2,v=i/2,D=this._cos,w=this._sin,G=-u/2,g=-u/2;for(let n=this.historySize-1;n>=0;n--){const b=(this.writeIndex+n)%this.historySize,F=this.history[b],L=1+(1-n/(this.historySize-1))*T,d=1/L,l=I+y/L,h=u*d*1.5,R=(u-h)*.5,W=200*d,q=Math.max(1,8*d+r.kick*3);U.length=0;for(let O=0;O<N;O++){const V=R+this.xLookup[O]*h,K=l-F[O]*W,z=V+G,Y=K+g;U.push({x:z*D-Y*w+P,y:z*w+Y*D+v})}const H=this._generateLineQuads(U,q/2,c,i,this.vertexBuffer,E);H>0&&(p.push({start:E/3,count:H/3,colorIndex:n}),E+=H)}e.bindBuffer(e.ARRAY_BUFFER,this.lineBuffer),e.bufferData(e.ARRAY_BUFFER,this.vertexBuffer.subarray(0,E),e.DYNAMIC_DRAW),e.enableVertexAttribArray(this.line_a_posEdge),e.vertexAttribPointer(this.line_a_posEdge,3,e.FLOAT,!1,0,0),e.useProgram(this.lineProgram),e.enable(e.BLEND),_?e.blendFunc(e.ONE,e.ONE):e.blendFunc(e.ONE,e.ONE_MINUS_SRC_ALPHA);for(const n of p){const b=this._paletteRGB[n.colorIndex]||[1,1,1];e.uniform3f(this.line_u_color,b[0],b[1],b[2]),e.drawArrays(e.TRIANGLES,n.start,n.count)}e.disable(e.BLEND);const A=Math.max(1,c>>1),S=Math.max(1,i>>1);e.bindFramebuffer(e.FRAMEBUFFER,this.blurFramebuffer),e.viewport(0,0,A,S),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT),e.useProgram(this.brightnessProgram),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,this.sceneTexture),e.uniform1i(this.brightness_u_texture,0),e.uniform1f(this.brightness_u_threshold,0),e.uniform1f(this.brightness_u_isDarkTheme,_?1:0),e.bindBuffer(e.ARRAY_BUFFER,this.quadBuffer),e.enableVertexAttribArray(this.brightness_a_position),e.vertexAttribPointer(this.brightness_a_position,2,e.FLOAT,!1,0,0),e.drawArrays(e.TRIANGLES,0,6),e.useProgram(this.blurProgram);const k=4;let x=!0;for(let n=0;n<k*2;n++){const b=x?this.blurFinalFramebuffer:this.blurFramebuffer,F=x?this.blurTexture:this.blurFinalTexture,M=1+n*.75;e.bindFramebuffer(e.FRAMEBUFFER,b),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,F),e.uniform1i(this.blur_u_texture,0),e.uniform2f(this.blur_u_resolution,A,S),e.uniform2f(this.blur_u_direction,x?1:0,x?0:1),e.uniform1f(this.blur_u_spread,M),e.drawArrays(e.TRIANGLES,0,6),x=!x}if(e.bindFramebuffer(e.FRAMEBUFFER,null),e.viewport(0,0,c,i),r.mode!=="blended"){const n=_?[.02,.02,.02,1]:[.9,.9,.9,1];e.clearColor(n[0],n[1],n[2],n[3])}else _?e.clearColor(0,0,0,.4):e.clearColor(.95,.95,.95,.4);e.clear(e.COLOR_BUFFER_BIT),e.enable(e.BLEND),e.blendFunc(e.ONE,e.ONE_MINUS_SRC_ALPHA),e.useProgram(this.compositeProgram),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,this.sceneTexture),e.uniform1i(this.composite_u_scene,0),e.activeTexture(e.TEXTURE1),e.bindTexture(e.TEXTURE_2D,x?this.blurTexture:this.blurFinalTexture),e.uniform1i(this.composite_u_blur,1);const X=1+r.kick;e.uniform1f(this.composite_u_glowStrength,C.GLOW_INTENSITY*X),e.uniform1f(this.composite_u_noiseStrength,C.NOISE_STRENGTH),e.uniform1f(this.composite_u_isDarkTheme,_?1:0),e.uniform1f(this.composite_u_time,performance.now()/1e3),e.bindBuffer(e.ARRAY_BUFFER,this.quadBuffer),e.enableVertexAttribArray(this.composite_a_position),e.vertexAttribPointer(this.composite_a_position,2,e.FLOAT,!1,0,0),e.drawArrays(e.TRIANGLES,0,6)}}export{C as UnknownPleasuresWebGL};
