const u=`
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`,g=`
  precision highp float;
  uniform sampler2D u_texture;
  uniform vec2 u_resolution;
  uniform float u_offset;
  varying vec2 v_texCoord;

  void main() {
    highp vec2 texelSize = 1.0 / u_resolution;
    highp vec4 color = vec4(0.0);

    color += texture2D(u_texture, v_texCoord + vec2(-u_offset, -u_offset) * texelSize);
    color += texture2D(u_texture, v_texCoord + vec2(u_offset, -u_offset) * texelSize);
    color += texture2D(u_texture, v_texCoord + vec2(-u_offset, u_offset) * texelSize);
    color += texture2D(u_texture, v_texCoord + vec2(u_offset, u_offset) * texelSize);

    gl_FragColor = color * 0.25;
  }
`,d=`
  precision highp float;
  uniform sampler2D u_texture1;
  uniform sampler2D u_texture2;
  uniform float u_blend;
  varying vec2 v_texCoord;

  void main() {
    vec4 color1 = texture2D(u_texture1, v_texCoord);
    vec4 color2 = texture2D(u_texture2, v_texCoord);
    gl_FragColor = mix(color1, color2, u_blend);
  }
`,_=`
  precision highp float;
  uniform sampler2D u_texture;
  uniform vec3 u_tintColor;
  uniform float u_tintIntensity;
  varying vec2 v_texCoord;

  void main() {
    vec4 color = texture2D(u_texture, v_texCoord);
    float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));

    // darkMask: 1.0 for black, 0.0 for luma >= 0.5
    float darkMask = 1.0 - smoothstep(0.0, 0.5, luma);

    // Blend dark areas toward tint color
    color.rgb = mix(color.rgb, u_tintColor, darkMask * u_tintIntensity);

    gl_FragColor = color;
  }
`,x=`
  precision highp float;
  uniform sampler2D u_texture;
  uniform float u_time;
  uniform float u_intensity;
  varying vec2 v_texCoord;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    vec2 uv = v_texCoord;
    float t = u_time * 0.05;

    vec2 center = uv - 0.5;
    float centerWeight = 1.0 - smoothstep(0.0, 0.7, length(center));

    // Large-scale movement (slow, big blobs)
    float n1 = snoise(uv * 0.35 + vec2(t, t * 0.7));
    float n2 = snoise(uv * 0.35 + vec2(-t * 0.8, t * 0.5) + vec2(50.0, 50.0));

    // Medium-scale detail (adds organic movement)
    float n3 = snoise(uv * 0.9 + vec2(t * 1.2, -t) + vec2(100.0, 0.0));
    float n4 = snoise(uv * 0.9 + vec2(-t, t * 1.1) + vec2(0.0, 100.0));

    // Combine two octaves
    vec2 warp = vec2(
      n1 * 0.65 + n3 * 0.35,
      n2 * 0.65 + n4 * 0.35
    ) * centerWeight;

    vec2 warpedUV = uv + warp * u_intensity;
    warpedUV = clamp(warpedUV, 0.0, 1.0);

    gl_FragColor = texture2D(u_texture, warpedUV);
  }
`,b=`
  precision highp float;
  uniform sampler2D u_texture;
  uniform float u_saturation;
  uniform float u_dithering;
  uniform float u_time;
  uniform float u_scale;
  uniform vec2 u_resolution;
  varying vec2 v_texCoord;

  highp float hash(highp vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec2 uv = (v_texCoord - 0.5) / u_scale + 0.5;
    uv = clamp(uv, 0.0, 1.0);

    vec4 color = texture2D(u_texture, uv);

    vec2 center = v_texCoord - 0.5;
    float vignette = 1.0 - dot(center, center) * 0.3;
    color.rgb *= vignette;

    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(gray), color.rgb, u_saturation);

    highp vec2 pixelPos = floor(v_texCoord * u_resolution);
    highp float noise = hash(vec3(pixelPos, floor(u_time * 60.0)));
    color.rgb += (noise - 0.5) * u_dithering;

    gl_FragColor = color;
  }
`;class p{canvas;gl;halfFloatExt=null;halfFloatLinearExt=null;blurProgram;blendProgram;tintProgram;warpProgram;outputProgram;positionBuffer;texCoordBuffer;sourceTexture;blurFBO1;blurFBO2;currentAlbumFBO;nextAlbumFBO;warpFBO;animationId=null;lastFrameTime=0;accumulatedTime=0;isPlaying=!1;isTransitioning=!1;transitionStartTime=0;_transitionDuration;_warpIntensity;_blurPasses;_animationSpeed;_targetAnimationSpeed;_saturation;_tintColor;_tintIntensity;_dithering;_scale;hasImage=!1;attribs;uniforms;constructor(e,r={}){this.canvas=e;const t=e.getContext("webgl",{preserveDrawingBuffer:!0});if(!t)throw new Error("WebGL not supported");this.gl=t,this.halfFloatExt=t.getExtension("OES_texture_half_float"),this.halfFloatLinearExt=t.getExtension("OES_texture_half_float_linear"),this._warpIntensity=r.warpIntensity??1,this._blurPasses=r.blurPasses??8,this._animationSpeed=r.animationSpeed??1,this._targetAnimationSpeed=this._animationSpeed,this._transitionDuration=r.transitionDuration??1e3,this._saturation=r.saturation??1.5,this._tintColor=r.tintColor??[.157,.157,.235],this._tintIntensity=r.tintIntensity??.15,this._dithering=r.dithering??.008,this._scale=r.scale??1,this.blurProgram=this.createProgram(u,g),this.blendProgram=this.createProgram(u,d),this.tintProgram=this.createProgram(u,_),this.warpProgram=this.createProgram(u,x),this.outputProgram=this.createProgram(u,b),this.attribs={position:t.getAttribLocation(this.blurProgram,"a_position"),texCoord:t.getAttribLocation(this.blurProgram,"a_texCoord")},this.uniforms={blur:{resolution:t.getUniformLocation(this.blurProgram,"u_resolution"),texture:t.getUniformLocation(this.blurProgram,"u_texture"),offset:t.getUniformLocation(this.blurProgram,"u_offset")},blend:{texture1:t.getUniformLocation(this.blendProgram,"u_texture1"),texture2:t.getUniformLocation(this.blendProgram,"u_texture2"),blend:t.getUniformLocation(this.blendProgram,"u_blend")},warp:{texture:t.getUniformLocation(this.warpProgram,"u_texture"),time:t.getUniformLocation(this.warpProgram,"u_time"),intensity:t.getUniformLocation(this.warpProgram,"u_intensity")},tint:{texture:t.getUniformLocation(this.tintProgram,"u_texture"),tintColor:t.getUniformLocation(this.tintProgram,"u_tintColor"),tintIntensity:t.getUniformLocation(this.tintProgram,"u_tintIntensity")},output:{texture:t.getUniformLocation(this.outputProgram,"u_texture"),saturation:t.getUniformLocation(this.outputProgram,"u_saturation"),dithering:t.getUniformLocation(this.outputProgram,"u_dithering"),time:t.getUniformLocation(this.outputProgram,"u_time"),scale:t.getUniformLocation(this.outputProgram,"u_scale"),resolution:t.getUniformLocation(this.outputProgram,"u_resolution")}},this.positionBuffer=this.createBuffer(new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1])),this.texCoordBuffer=this.createBuffer(new Float32Array([0,0,1,0,0,1,0,1,1,0,1,1])),this.sourceTexture=this.createTexture(),this.blurFBO1=this.createFramebuffer(128,128,!0),this.blurFBO2=this.createFramebuffer(128,128,!0),this.currentAlbumFBO=this.createFramebuffer(128,128,!0),this.nextAlbumFBO=this.createFramebuffer(128,128,!0),this.warpFBO=this.createFramebuffer(1,1,!0),this.resize()}get warpIntensity(){return this._warpIntensity}set warpIntensity(e){this._warpIntensity=Math.max(0,Math.min(1,e))}get blurPasses(){return this._blurPasses}set blurPasses(e){const r=Math.max(1,Math.min(40,Math.floor(e)));r!==this._blurPasses&&(this._blurPasses=r,this.hasImage&&this.reblurCurrentImage())}get animationSpeed(){return this._targetAnimationSpeed}set animationSpeed(e){this._targetAnimationSpeed=Math.max(.1,Math.min(5,e))}get transitionDuration(){return this._transitionDuration}set transitionDuration(e){this._transitionDuration=Math.max(0,Math.min(5e3,e))}get saturation(){return this._saturation}set saturation(e){this._saturation=Math.max(0,Math.min(3,e))}get tintColor(){return this._tintColor}set tintColor(e){const r=e.map(i=>Math.max(0,Math.min(1,i)));r.some((i,o)=>i!==this._tintColor[o])&&(this._tintColor=r,this.hasImage&&this.reblurCurrentImage())}get tintIntensity(){return this._tintIntensity}set tintIntensity(e){const r=Math.max(0,Math.min(1,e));r!==this._tintIntensity&&(this._tintIntensity=r,this.hasImage&&this.reblurCurrentImage())}get dithering(){return this._dithering}set dithering(e){this._dithering=Math.max(0,Math.min(.1,e))}get scale(){return this._scale}set scale(e){this._scale=Math.max(.01,Math.min(4,e))}setOptions(e){e.warpIntensity!==void 0&&(this.warpIntensity=e.warpIntensity),e.blurPasses!==void 0&&(this.blurPasses=e.blurPasses),e.animationSpeed!==void 0&&(this.animationSpeed=e.animationSpeed),e.transitionDuration!==void 0&&(this.transitionDuration=e.transitionDuration),e.saturation!==void 0&&(this.saturation=e.saturation),e.tintColor!==void 0&&(this.tintColor=e.tintColor),e.tintIntensity!==void 0&&(this.tintIntensity=e.tintIntensity),e.dithering!==void 0&&(this.dithering=e.dithering),e.scale!==void 0&&(this.scale=e.scale)}getOptions(){return{warpIntensity:this._warpIntensity,blurPasses:this._blurPasses,animationSpeed:this._targetAnimationSpeed,transitionDuration:this._transitionDuration,saturation:this._saturation,tintColor:this._tintColor,tintIntensity:this._tintIntensity,dithering:this._dithering,scale:this._scale}}loadImage(e){return new Promise((r,t)=>{const i=new Image;i.crossOrigin="anonymous",i.onload=()=>{this.gl.bindTexture(this.gl.TEXTURE_2D,this.sourceTexture),this.gl.texImage2D(this.gl.TEXTURE_2D,0,this.gl.RGBA,this.gl.RGBA,this.gl.UNSIGNED_BYTE,i),this.processNewImage(),r()},i.onerror=()=>t(new Error(`Failed to load image: ${e}`)),i.src=e})}loadImageElement(e){this.gl.bindTexture(this.gl.TEXTURE_2D,this.sourceTexture),this.gl.texImage2D(this.gl.TEXTURE_2D,0,this.gl.RGBA,this.gl.RGBA,this.gl.UNSIGNED_BYTE,e),this.processNewImage()}loadImageData(e,r,t){this.gl.bindTexture(this.gl.TEXTURE_2D,this.sourceTexture),this.gl.texImage2D(this.gl.TEXTURE_2D,0,this.gl.RGBA,r,t,0,this.gl.RGBA,this.gl.UNSIGNED_BYTE,e instanceof Uint8ClampedArray?new Uint8Array(e.buffer):e),this.processNewImage()}loadFromImageData(e){this.loadImageData(e.data,e.width,e.height)}async loadBlob(e){const r=await createImageBitmap(e);this.loadImageElement(r),r.close()}loadBase64(e){const r=e.startsWith("data:")?e:`data:image/png;base64,${e}`;return this.loadImage(r)}async loadArrayBuffer(e,r="image/png"){const t=new Blob([e],{type:r});return this.loadBlob(t)}loadGradient(e,r=135){const i=document.createElement("canvas");i.width=512,i.height=512;const o=i.getContext("2d");if(!o)return;const a=r*Math.PI/180,n=512/2-Math.cos(a)*512,s=512/2-Math.sin(a)*512,l=512/2+Math.cos(a)*512,m=512/2+Math.sin(a)*512,h=o.createLinearGradient(n,s,l,m);e.forEach((f,c)=>{h.addColorStop(c/(e.length-1),f)}),o.fillStyle=h,o.fillRect(0,0,512,512),this.loadImageElement(i)}processNewImage(){[this.currentAlbumFBO,this.nextAlbumFBO]=[this.nextAlbumFBO,this.currentAlbumFBO],this.blurSourceInto(this.nextAlbumFBO),this.hasImage=!0,this.isTransitioning=!0,this.transitionStartTime=performance.now()}reblurCurrentImage(){this.blurSourceInto(this.nextAlbumFBO)}blurSourceInto(e){const r=this.gl;r.useProgram(this.tintProgram),this.setupAttributes(),r.bindFramebuffer(r.FRAMEBUFFER,this.blurFBO1.framebuffer),r.viewport(0,0,128,128),r.activeTexture(r.TEXTURE0),r.bindTexture(r.TEXTURE_2D,this.sourceTexture),r.uniform1i(this.uniforms.tint.texture,0),r.uniform3fv(this.uniforms.tint.tintColor,this._tintColor),r.uniform1f(this.uniforms.tint.tintIntensity,this._tintIntensity),r.drawArrays(r.TRIANGLES,0,6),r.useProgram(this.blurProgram),this.setupAttributes(),r.uniform2f(this.uniforms.blur.resolution,128,128),r.uniform1i(this.uniforms.blur.texture,0);let t=this.blurFBO1,i=this.blurFBO2;for(let o=0;o<this._blurPasses;o++)r.bindFramebuffer(r.FRAMEBUFFER,i.framebuffer),r.viewport(0,0,128,128),r.bindTexture(r.TEXTURE_2D,t.texture),r.uniform1f(this.uniforms.blur.offset,o+.5),r.drawArrays(r.TRIANGLES,0,6),[t,i]=[i,t];r.bindFramebuffer(r.FRAMEBUFFER,e.framebuffer),r.viewport(0,0,128,128),r.bindTexture(r.TEXTURE_2D,t.texture),r.uniform1f(this.uniforms.blur.offset,0),r.drawArrays(r.TRIANGLES,0,6)}resize(){const e=this.canvas.width,r=this.canvas.height;this.warpFBO&&this.deleteFramebuffer(this.warpFBO),this.warpFBO=this.createFramebuffer(e,r,!0)}start(){this.isPlaying||(this.isPlaying=!0,this.lastFrameTime=performance.now(),requestAnimationFrame(this.renderLoop))}stop(){this.isPlaying=!1,this.animationId!==null&&(cancelAnimationFrame(this.animationId),this.animationId=null)}renderFrame(e){const r=performance.now();if(e!==void 0)this.render(e,r);else{const t=(r-this.lastFrameTime)/1e3;this.lastFrameTime=r,this._animationSpeed+=(this._targetAnimationSpeed-this._animationSpeed)*.05,this.accumulatedTime+=t*this._animationSpeed,this.render(this.accumulatedTime,r)}}dispose(){this.stop();const e=this.gl;e.deleteProgram(this.blurProgram),e.deleteProgram(this.blendProgram),e.deleteProgram(this.tintProgram),e.deleteProgram(this.warpProgram),e.deleteProgram(this.outputProgram),e.deleteBuffer(this.positionBuffer),e.deleteBuffer(this.texCoordBuffer),e.deleteTexture(this.sourceTexture),this.deleteFramebuffer(this.blurFBO1),this.deleteFramebuffer(this.blurFBO2),this.deleteFramebuffer(this.currentAlbumFBO),this.deleteFramebuffer(this.nextAlbumFBO),this.deleteFramebuffer(this.warpFBO)}renderLoop=e=>{if(!this.isPlaying)return;const r=(e-this.lastFrameTime)/1e3;this.lastFrameTime=e,this._animationSpeed+=(this._targetAnimationSpeed-this._animationSpeed)*.05,this.accumulatedTime+=r*this._animationSpeed,this.render(this.accumulatedTime,e),this.animationId=requestAnimationFrame(this.renderLoop)};render(e,r=performance.now()){const t=this.gl,i=this.canvas.width,o=this.canvas.height;let a=1;if(this.isTransitioning){const s=r-this.transitionStartTime;a=Math.min(1,s/this._transitionDuration),a>=1&&(this.isTransitioning=!1)}let n;this.isTransitioning&&a<1?(t.useProgram(this.blendProgram),this.setupAttributes(),t.bindFramebuffer(t.FRAMEBUFFER,this.blurFBO1.framebuffer),t.viewport(0,0,128,128),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,this.currentAlbumFBO.texture),t.uniform1i(this.uniforms.blend.texture1,0),t.activeTexture(t.TEXTURE1),t.bindTexture(t.TEXTURE_2D,this.nextAlbumFBO.texture),t.uniform1i(this.uniforms.blend.texture2,1),t.uniform1f(this.uniforms.blend.blend,a),t.drawArrays(t.TRIANGLES,0,6),n=this.blurFBO1.texture,t.useProgram(this.warpProgram),this.setupAttributes(),t.bindFramebuffer(t.FRAMEBUFFER,this.warpFBO.framebuffer),t.viewport(0,0,i,o),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,n),t.uniform1i(this.uniforms.warp.texture,0),t.uniform1f(this.uniforms.warp.time,e),t.uniform1f(this.uniforms.warp.intensity,this._warpIntensity),t.drawArrays(t.TRIANGLES,0,6),t.useProgram(this.outputProgram),this.setupAttributes(),t.bindFramebuffer(t.FRAMEBUFFER,null),t.viewport(0,0,i,o),t.bindTexture(t.TEXTURE_2D,this.warpFBO.texture),t.uniform1i(this.uniforms.output.texture,0),t.uniform1f(this.uniforms.output.saturation,this._saturation),t.uniform1f(this.uniforms.output.dithering,this._dithering),t.uniform1f(this.uniforms.output.time,e),t.uniform1f(this.uniforms.output.scale,this._scale),t.uniform2f(this.uniforms.output.resolution,i,o),t.drawArrays(t.TRIANGLES,0,6)):(t.useProgram(this.warpProgram),this.setupAttributes(),t.bindFramebuffer(t.FRAMEBUFFER,this.warpFBO.framebuffer),t.viewport(0,0,i,o),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,this.nextAlbumFBO.texture),t.uniform1i(this.uniforms.warp.texture,0),t.uniform1f(this.uniforms.warp.time,e),t.uniform1f(this.uniforms.warp.intensity,this._warpIntensity),t.drawArrays(t.TRIANGLES,0,6),t.useProgram(this.outputProgram),this.setupAttributes(),t.bindFramebuffer(t.FRAMEBUFFER,null),t.viewport(0,0,i,o),t.bindTexture(t.TEXTURE_2D,this.warpFBO.texture),t.uniform1i(this.uniforms.output.texture,0),t.uniform1f(this.uniforms.output.saturation,this._saturation),t.uniform1f(this.uniforms.output.dithering,this._dithering),t.uniform1f(this.uniforms.output.time,e),t.uniform1f(this.uniforms.output.scale,this._scale),t.uniform2f(this.uniforms.output.resolution,i,o),t.drawArrays(t.TRIANGLES,0,6))}setupAttributes(){const e=this.gl;e.bindBuffer(e.ARRAY_BUFFER,this.positionBuffer),e.enableVertexAttribArray(this.attribs.position),e.vertexAttribPointer(this.attribs.position,2,e.FLOAT,!1,0,0),e.bindBuffer(e.ARRAY_BUFFER,this.texCoordBuffer),e.enableVertexAttribArray(this.attribs.texCoord),e.vertexAttribPointer(this.attribs.texCoord,2,e.FLOAT,!1,0,0)}createShader(e,r){const t=this.gl,i=t.createShader(e);if(!i)throw new Error("Failed to create shader");if(t.shaderSource(i,r),t.compileShader(i),!t.getShaderParameter(i,t.COMPILE_STATUS)){const o=t.getShaderInfoLog(i);throw t.deleteShader(i),new Error(`Shader compile error: ${o}`)}return i}createProgram(e,r){const t=this.gl,i=this.createShader(t.VERTEX_SHADER,e),o=this.createShader(t.FRAGMENT_SHADER,r),a=t.createProgram();if(!a)throw new Error("Failed to create program");if(t.attachShader(a,i),t.attachShader(a,o),t.linkProgram(a),!t.getProgramParameter(a,t.LINK_STATUS)){const n=t.getProgramInfoLog(a);throw t.deleteProgram(a),new Error(`Program link error: ${n}`)}return t.deleteShader(i),t.deleteShader(o),a}createBuffer(e){const r=this.gl,t=r.createBuffer();if(!t)throw new Error("Failed to create buffer");return r.bindBuffer(r.ARRAY_BUFFER,t),r.bufferData(r.ARRAY_BUFFER,e,r.STATIC_DRAW),t}createTexture(){const e=this.gl,r=e.createTexture();if(!r)throw new Error("Failed to create texture");return e.bindTexture(e.TEXTURE_2D,r),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),r}createFramebuffer(e,r,t=!1){const i=this.gl,o=this.createTexture(),n=t&&this.halfFloatExt&&this.halfFloatLinearExt?this.halfFloatExt.HALF_FLOAT_OES:i.UNSIGNED_BYTE;i.texImage2D(i.TEXTURE_2D,0,i.RGBA,e,r,0,i.RGBA,n,null);const s=i.createFramebuffer();if(!s)throw new Error("Failed to create framebuffer");return i.bindFramebuffer(i.FRAMEBUFFER,s),i.framebufferTexture2D(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,o,0),{framebuffer:s,texture:o}}deleteFramebuffer(e){this.gl.deleteFramebuffer(e.framebuffer),this.gl.deleteTexture(e.texture)}}export{p as Kawarp,p as default};
