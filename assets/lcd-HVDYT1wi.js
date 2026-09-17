class D{constructor(){this.name="LCD Pixels",this.gridCols=48,this.maxVol=100,this.volDecay=.995,this.prevData=new Float32Array(this.gridCols).fill(0),this.peakData=new Float32Array(this.gridCols).fill(0),this.primaryColor="#ffffff",this.disableShake=!1,this.glCanvas=null,this.gl=null,this.glProgram=null,this.glInitialized=!1}initWebGL(e,a){if(this.glInitialized)return;this.glCanvas=document.createElement("canvas"),this.glCanvas.width=e,this.glCanvas.height=a,this.glCanvas.style.cssText="position:absolute;top:0;left:0;pointer-events:none;mix-blend-mode:multiply;";const t=this.glCanvas.getContext("webgl",{alpha:!0,premultipliedAlpha:!1});if(!t){console.warn("WebGL not available for grid overlay");return}this.gl=t;const o=`
            attribute vec2 a_position;
            varying vec2 v_uv;
            void main() {
                v_uv = a_position * 0.5 + 0.5;
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `,n=`
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
        `,s=this.compileShader(t,t.VERTEX_SHADER,o),r=this.compileShader(t,t.FRAGMENT_SHADER,n);if(!s||!r)return;const i=t.createProgram();if(t.attachShader(i,s),t.attachShader(i,r),t.linkProgram(i),!t.getProgramParameter(i,t.LINK_STATUS)){console.error("Shader program failed to link");return}this.glProgram=i;const c=new Float32Array([-1,-1,1,-1,-1,1,1,1]),C=t.createBuffer();t.bindBuffer(t.ARRAY_BUFFER,C),t.bufferData(t.ARRAY_BUFFER,c,t.STATIC_DRAW);const S=t.getAttribLocation(i,"a_position");t.enableVertexAttribArray(S),t.vertexAttribPointer(S,2,t.FLOAT,!1,0,0),this.uResolution=t.getUniformLocation(i,"u_resolution"),this.uTime=t.getUniformLocation(i,"u_time"),t.useProgram(i),t.enable(t.BLEND),t.blendFunc(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA),this.startTime=performance.now(),this.glInitialized=!0}compileShader(e,a,t){const o=e.createShader(a);return e.shaderSource(o,t),e.compileShader(o),e.getShaderParameter(o,e.COMPILE_STATUS)?o:(console.error("Shader compile error:",e.getShaderInfoLog(o)),e.deleteShader(o),null)}renderHoneycomb(e,a){if(!this.gl||!this.glProgram)return;const t=this.gl;(this.glCanvas.width!==e||this.glCanvas.height!==a)&&(this.glCanvas.width=e,this.glCanvas.height=a,t.viewport(0,0,e,a)),t.clearColor(0,0,0,0),t.clear(t.COLOR_BUFFER_BIT),t.uniform2f(this.uResolution,e,a),t.uniform1f(this.uTime,(performance.now()-this.startTime)/1e3),t.drawArrays(t.TRIANGLE_STRIP,0,4)}resize(){}draw(e,a,t,o,n){const{width:s,height:r}=a,{kick:i,primaryColor:c,mode:C}=n;this.primaryColor=c;const S=document.documentElement.getAttribute("data-theme")!=="white";e.clearRect(0,0,s,r),C!=="blended"&&(e.fillStyle=S?"#050505":"#e6e6e6",e.fillRect(0,0,s,r));const l=this.processAudio(o,t),h=s/2,f=r*.35,A=s*.05,g=s*.95-A,M=r,p=2,m=.05;if(e.save(),e.translate(h,f),e.transform(1,-.08,.2,1,0,0),e.translate(-h,-f),!this.disableShake&&i>.1){const d=i*8;e.translate((Math.random()-.5)*2*d,(Math.random()-.5)*d)}const v=g/this.gridCols*.7;for(let d=0;d<this.gridCols;d++){const b=d/(this.gridCols-1),P=p+(m-p)*b,w=m-p,u=p*b+.5*w*b*b,_=p+.5*w,R=u/_,E=A+R*g,y=v*P,F=l[d];if(F<.01)continue;const T=F*M*P;if(T<1)continue;const L=.75+Math.abs(Math.sin(d*127.1))*.25;e.fillStyle=this.adjustBrightness(c,L),e.shadowBlur=30+F*50,e.shadowColor=c,this.drawCapsule(e,E,f,y,T)}e.restore(),this.glInitialized||(this.initWebGL(s,r),this.glCanvas&&a.parentElement&&a.parentElement.appendChild(this.glCanvas)),this.renderHoneycomb(s,r)}processAudio(e,a){const t=new Float32Array(this.gridCols),o=Math.floor(this.gridCols/2),n=e.length;let s=0;const i=(a?.context?.sampleRate||48e3)/(n*2),c=40,C=22e3;for(let l=0;l<o;l++){const h=l/(o-1),f=c*Math.pow(C/c,h),A=(l+1)/(o-1),I=c*Math.pow(C/c,A),g=Math.max(1,Math.floor(f/i)),M=Math.max(g+1,Math.floor(I/i));let p=0,m=0;for(let u=g;u<M&&u<n;u++)p+=e[u],m++;let v=m>0?p/m:0;m===0&&g<n&&(v=e[g]),v*=1+h*1.8,v>s&&(s=v);const d=o-1-l,b=o+l,P=.25,w=.08;for(const u of[d,b]){const _=this.prevData[u],R=v;this.prevData[u]=_+(R-_)*(R>_?P:w)}}this.maxVol=Math.max(this.maxVol*this.volDecay,s,40);const S=200/this.maxVol;for(let l=0;l<this.gridCols;l++){let h=this.prevData[l]*S/255;const f=.5;h<f?h=0:h=(h-f)/(1-f),h=Math.pow(Math.min(1,h),2.2),t[l]=h}return t}drawCapsule(e,a,t,o,n){if(n<o){e.beginPath(),e.arc(a,t,Math.max(.5,n/2),0,Math.PI*2),e.fill();return}const s=n/2,r=o/2;e.beginPath(),e.arc(a,t-s+r,r,Math.PI,0),e.lineTo(a+r,t+s-r),e.arc(a,t+s-r,r,0,Math.PI),e.lineTo(a-r,t-s+r),e.closePath(),e.fill()}adjustBrightness(e,a){const t=parseInt(e.slice(1,3),16),o=parseInt(e.slice(3,5),16),n=parseInt(e.slice(5,7),16),s=r=>Math.min(255,Math.max(0,Math.round(r*a)));return`rgb(${s(t)},${s(o)},${s(n)})`}destroy(){if(this.glCanvas&&(this.glCanvas.remove(),this.glCanvas=null),this.gl){const e=this.gl.getExtension("WEBGL_lose_context");e&&e.loseContext(),this.gl=null}this.glInitialized=!1,this.glProgram=null}}export{D as LCDPreset};
