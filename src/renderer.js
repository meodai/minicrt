import {
    vertexShaderSource,
    fragmentShaderSourceLegacy,
    sceneFragmentSource,
    bloomExtractFragmentSource,
    blurFragmentSource,
    compositeFragmentSource,
} from './shader.js';

export class Renderer {
    constructor(canvas, frameElement) {
        this.canvas = canvas;
        this.frameElement = frameElement;
        this.gl = canvas.getContext('webgl2');
        if (!this.gl) {
            console.error('WebGL 2 not supported');
            return;
        }

        this.program = null; // legacy single-pass
        this.programs = null; // multi-pass
        this.texture = null;
        this.scene = null;
        this.bloom = null;
        this.source = null; // Image or Video element
        this.isVideo = false;
        this.animationId = null;

        this.supportsMultipass = false;

        // Overlay Configuration (x, y, width, height in % of the image)
        this.overlaySettings = {
          c1084: {
            src: "c1084sbedroom_noglare.png",
            x: 0.11,
            y: 0.16,
            width: 0.8,
            height: 0.7,
          },
          sonypvm: {
            src: "sonypvmoffice_noglare.png",
            x: 0,
            y: 0.13,
            width: 1,
            height: 0.7,
          },
        };

        // Default settings
        this.settings = {
            tvResolution: 'source', // 'source' | '240p' | '480i' | 'vga'
            scaling: 'nearest', // 'nearest' | 'default' | 'bilinear' | 'bicubic'
            frame: 'none', // 'none' or 'c1084'
            curvature: 0.2,
            vignette: 0.5,
            scanlineIntensity: 0.3,
            scanlineCount: 480.0,
            convergence: 0.0,
            interlace: 0.0,
            deinterlace: 0.0,
            overscan: 0.0,
            border: 0.0,
            geomAA: 0.0,
            maskBrightness: 0.5,
            maskType: 0.0, // 0: Aperture, 1: Shadow, 2: None
            maskSize: 1.0,
            bloom: 0.4,
            noise: 0.1,
            color: 1.0, // Was saturation
            brightness: 1.0,
            contrast: 1.0,
            hue: 0.0,
            sharpness: 0.0
        };

        // Track previous frame selection separately because the settings panel
        // mutates `this.settings` before calling `updateSettings()`.
        this.lastFrame = this.settings.frame;

        // Preprocess/resample canvas for "TV resolution" input.
        this.preprocessCanvas = document.createElement('canvas');
        this.preprocessCtx = this.preprocessCanvas.getContext('2d', { alpha: false });

        // Track current upload dimensions so uniforms can use the processed size.
        this.uploadWidth = 1;
        this.uploadHeight = 1;

        // Track current sampling mode for source texture.
        this.sourceSampling = 'linear';

        this.init();
    }

    init() {
        const gl = this.gl;

        this.supportsMultipass = this.detectMultipassSupport();

        // Create Shader Programs
        const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexShaderSource);
        const legacyFs = this.createShader(gl.FRAGMENT_SHADER, fragmentShaderSourceLegacy);
        this.program = this.createProgram(vertexShader, legacyFs);

        if (this.supportsMultipass) {
            this.programs = this.createMultipassPrograms(vertexShader);
        }

        // Look up locations
        // Attribute locations are consistent across programs.
        this.positionLocation = gl.getAttribLocation(this.program, 'a_position');
        this.texCoordLocation = gl.getAttribLocation(this.program, 'a_texCoord');

        // Create Buffers (Full screen quad)
        const positions = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
            -1,  1,
             1, -1,
             1,  1,
        ]);
        const texCoords = new Float32Array([
            // Standard UVs (no flip). We flip DOM uploads instead.
            0, 0,
            1, 0,
            0, 1,
            0, 1,
            1, 0,
            1, 1,
        ]);

        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        const texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

        // Create VAO
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        gl.enableVertexAttribArray(this.positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

        gl.enableVertexAttribArray(this.texCoordLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 0, 0);

        // Create Texture
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        // Initial resize
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    detectMultipassSupport() {
        const gl = this.gl;
        // We need float/half-float color attachments for a clean linear bloom pipeline.
        // EXT_color_buffer_float is widely supported in modern browsers.
        const extColorBufferFloat = gl.getExtension('EXT_color_buffer_float');
        // Linear filtering of float textures can be gated behind this extension.
        gl.getExtension('OES_texture_float_linear');
        gl.getExtension('OES_texture_half_float_linear');
        return !!extColorBufferFloat;
    }

    createMultipassPrograms(vertexShader) {
        const gl = this.gl;
        const compile = (fsSource) => this.createShader(gl.FRAGMENT_SHADER, fsSource);

        const sceneFs = compile(sceneFragmentSource);
        const bloomExtractFs = compile(bloomExtractFragmentSource);
        const blurFs = compile(blurFragmentSource);
        const compositeFs = compile(compositeFragmentSource);

        const sceneProgram = this.createProgram(vertexShader, sceneFs);
        const bloomExtractProgram = this.createProgram(vertexShader, bloomExtractFs);
        const blurProgram = this.createProgram(vertexShader, blurFs);
        const compositeProgram = this.createProgram(vertexShader, compositeFs);

        return {
            sceneProgram,
            bloomExtractProgram,
            blurProgram,
            compositeProgram,
            sceneLocs: this.getSceneUniformLocations(sceneProgram),
            bloomExtractLocs: this.getBloomExtractUniformLocations(bloomExtractProgram),
            blurLocs: this.getBlurUniformLocations(blurProgram),
            compositeLocs: this.getCompositeUniformLocations(compositeProgram),
        };
    }

    getSceneUniformLocations(program) {
        const gl = this.gl;
        return {
            u_image: gl.getUniformLocation(program, 'u_image'),
            u_textureSize: gl.getUniformLocation(program, 'u_textureSize'),
            u_curvature: gl.getUniformLocation(program, 'u_curvature'),
            u_sharpness: gl.getUniformLocation(program, 'u_sharpness'),
            u_overscan: gl.getUniformLocation(program, 'u_overscan'),
            u_border: gl.getUniformLocation(program, 'u_border'),
            u_geomAA: gl.getUniformLocation(program, 'u_geomAA'),
        };
    }

    getBloomExtractUniformLocations(program) {
        const gl = this.gl;
        return {
            u_scene: gl.getUniformLocation(program, 'u_scene'),
            u_bloom: gl.getUniformLocation(program, 'u_bloom'),
        };
    }

    getBlurUniformLocations(program) {
        const gl = this.gl;
        return {
            u_image: gl.getUniformLocation(program, 'u_image'),
            u_texelStep: gl.getUniformLocation(program, 'u_texelStep'),
        };
    }

    getCompositeUniformLocations(program) {
        const gl = this.gl;
        return {
            u_scene: gl.getUniformLocation(program, 'u_scene'),
            u_bloomTex: gl.getUniformLocation(program, 'u_bloomTex'),
            u_resolution: gl.getUniformLocation(program, 'u_resolution'),
            u_inputSize: gl.getUniformLocation(program, 'u_inputSize'),
            u_time: gl.getUniformLocation(program, 'u_time'),

            u_interlace: gl.getUniformLocation(program, 'u_interlace'),
            u_deinterlace: gl.getUniformLocation(program, 'u_deinterlace'),

            u_convergence: gl.getUniformLocation(program, 'u_convergence'),

            u_vignette: gl.getUniformLocation(program, 'u_vignette'),
            u_scanlineIntensity: gl.getUniformLocation(program, 'u_scanlineIntensity'),
            u_scanlineCount: gl.getUniformLocation(program, 'u_scanlineCount'),
            u_maskBrightness: gl.getUniformLocation(program, 'u_maskBrightness'),
            u_maskType: gl.getUniformLocation(program, 'u_maskType'),
            u_maskSize: gl.getUniformLocation(program, 'u_maskSize'),
            u_bloom: gl.getUniformLocation(program, 'u_bloom'),
            u_noise: gl.getUniformLocation(program, 'u_noise'),

            u_color: gl.getUniformLocation(program, 'u_color'),
            u_brightness: gl.getUniformLocation(program, 'u_brightness'),
            u_contrast: gl.getUniformLocation(program, 'u_contrast'),
            u_hue: gl.getUniformLocation(program, 'u_hue'),
        };
    }

    ensureRenderTargets() {
        if (!this.supportsMultipass || !this.programs) return;

        const gl = this.gl;
        const w = gl.canvas.width;
        const h = gl.canvas.height;
        if (!w || !h) return;

        // Scene at full res
        if (!this.scene || this.scene.width !== w || this.scene.height !== h) {
            this.scene = this.createRenderTarget(w, h, { filter: gl.LINEAR });
        }

        // Bloom at half res
        const bw = Math.max(1, Math.floor(w / 2));
        const bh = Math.max(1, Math.floor(h / 2));
        if (!this.bloom || this.bloom.width !== bw || this.bloom.height !== bh) {
            this.bloom = {
                a: this.createRenderTarget(bw, bh, { filter: gl.LINEAR }),
                b: this.createRenderTarget(bw, bh, { filter: gl.LINEAR }),
                width: bw,
                height: bh,
            };
        }
    }

    createRenderTarget(width, height, { filter }) {
        const gl = this.gl;

        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

        // Prefer half-float.
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA16F,
            width,
            height,
            0,
            gl.RGBA,
            gl.HALF_FLOAT,
            null
        );

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            // If we can't create a valid framebuffer, disable multipass.
            console.warn('Multipass framebuffer incomplete; falling back to single-pass.');
            this.supportsMultipass = false;
            this.programs = null;
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return { texture: null, fbo: null, width, height };
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { texture: tex, fbo, width, height };
    }

    createShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    createProgram(vs, fs) {
        const gl = this.gl;
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error(gl.getProgramInfoLog(program));
            return null;
        }
        return program;
    }

    getSourceDimensions() {
        const src = this.source;
        if (!src) return { width: 1, height: 1 };

        // Prefer intrinsic dimensions (not CSS/layout dimensions).
        const w = src.videoWidth || src.naturalWidth || src.width || 1;
        const h = src.videoHeight || src.naturalHeight || src.height || 1;
        return { width: w, height: h };
    }

    getUploadDimensions() {
        const { width: srcW, height: srcH } = this.getSourceDimensions();

        const mode = this.settings.tvResolution || 'source';
        if (mode === '240p') return { width: 320, height: 240 };
        // Use square-pixel 4:3 for "480i" so the image never stretches.
        if (mode === '480i') return { width: 640, height: 480 };
        if (mode === 'vga') return { width: 640, height: 480 };
        return { width: srcW, height: srcH };
    }

    getUploadSource() {
        const src = this.source;
        const { width: srcW, height: srcH } = this.getSourceDimensions();

        const mode = this.settings.tvResolution || 'source';
        if (mode === 'source' || !this.preprocessCtx) {
            return { source: src, width: srcW, height: srcH };
        }

        // If metadata isn't ready yet, avoid resampling for now.
        if (srcW <= 1 || srcH <= 1) {
            return { source: src, width: srcW, height: srcH };
        }

        // Target "TV" input resolutions.
        const { width: targetW, height: targetH } = this.getUploadDimensions();

        if (this.preprocessCanvas.width !== targetW) this.preprocessCanvas.width = targetW;
        if (this.preprocessCanvas.height !== targetH) this.preprocessCanvas.height = targetH;

        const ctx = this.preprocessCtx;
        const scaling = this.settings.scaling || 'default';
        if (scaling === 'nearest') {
            ctx.imageSmoothingEnabled = false;
        } else {
            ctx.imageSmoothingEnabled = true;
            // Hint quality if supported by the browser.
            if ('imageSmoothingQuality' in ctx) {
                if (scaling === 'bilinear') ctx.imageSmoothingQuality = 'low';
                else if (scaling === 'bicubic') ctx.imageSmoothingQuality = 'high';
                // 'default' => leave as-is (browser default)
            }
        }
        ctx.clearRect(0, 0, targetW, targetH);

        // Fit source into target while preserving aspect ratio (object-fit: contain).
        const scale = Math.min(targetW / srcW, targetH / srcH);
        const drawW = Math.max(1, Math.floor(srcW * scale));
        const drawH = Math.max(1, Math.floor(srcH * scale));
        const dx = Math.floor((targetW - drawW) / 2);
        const dy = Math.floor((targetH - drawH) / 2);
        ctx.drawImage(src, dx, dy, drawW, drawH);

        return { source: this.preprocessCanvas, width: targetW, height: targetH };
    }

    setSource(source) {
        this.source = source;
        this.isVideo = source.tagName === 'VIDEO';
        
        this.resize();

        if (this.isVideo) {
            source.play();
            this.startLoop();
        } else {
            this.render(); // Render once for image
        }
    }

    updateSettings(newSettings) {
        const oldFrame = this.lastFrame;
        // Mutate in place so external references (e.g. SettingsPanel) stay valid.
        Object.assign(this.settings, newSettings);
        this.lastFrame = this.settings.frame;
        
        // Handle Frame Update
        if (this.settings.frame !== 'none') {
            const config = this.overlaySettings[this.settings.frame];
            const filename = config ? config.src : `frame-${this.settings.frame}.png`;
            const newSrc = `/${filename}`;
            
            // Only update src if it changed or if it's empty (initial load)
            if (this.settings.frame !== oldFrame || !this.frameElement.getAttribute('src')) {
                this.frameElement.src = newSrc;
                this.frameElement.onload = () => this.resize();
            }
            this.frameElement.style.display = 'block';
        } else {
            this.frameElement.style.display = 'none';
            if (oldFrame !== 'none') this.resize();
        }

        if (!this.isVideo) this.render();
    }

    resize() {
        const gl = this.gl;
        const dpr = window.devicePixelRatio || 1;
        
        // Use parent container dimensions
        const container = this.canvas.parentElement;
        const containerW = container.clientWidth;
        const containerH = container.clientHeight;

        if (this.settings.frame !== 'none' && this.overlaySettings[this.settings.frame]) {
            // --- Framed Mode ---
            const frameImg = this.frameElement;
            if (!frameImg.naturalWidth) return; // Not loaded yet

            const config = this.overlaySettings[this.settings.frame];
            
            // Calculate rendered image dimensions (object-fit: contain)
            const imgRatio = frameImg.naturalWidth / frameImg.naturalHeight;
            const containerRatio = containerW / containerH;
            
            let renderW, renderH;
            let offsetX, offsetY;

            if (containerRatio > imgRatio) {
                // Pillarbox (limited by height)
                renderH = containerH;
                renderW = containerH * imgRatio;
                offsetX = (containerW - renderW) / 2;
                offsetY = 0;
            } else {
                // Letterbox (limited by width)
                renderW = containerW;
                renderH = containerW / imgRatio;
                offsetX = 0;
                offsetY = (containerH - renderH) / 2;
            }

            // Apply Config to position canvas (The available screen area)
            const screenLeft = offsetX + (renderW * config.x);
            const screenTop = offsetY + (renderH * config.y);
            const screenW = renderW * config.width;
            const screenH = renderH * config.height;

            let finalW = screenW;
            let finalH = screenH;
            let finalLeft = screenLeft;
            let finalTop = screenTop;

            // Fit content inside the screen area (Object Fit: Contain)
            if (this.source) {
                const { width: srcWidth, height: srcHeight } = this.getUploadDimensions();
                
                if (srcWidth && srcHeight) {
                    const srcRatio = srcWidth / srcHeight;
                    const screenRatio = screenW / screenH;

                    if (screenRatio > srcRatio) {
                        // Screen is wider than content -> Pillarbox inside screen
                        finalW = screenH * srcRatio;
                        finalLeft = screenLeft + (screenW - finalW) / 2;
                    } else {
                        // Screen is taller than content -> Letterbox inside screen
                        finalH = screenW / srcRatio;
                        finalTop = screenTop + (screenH - finalH) / 2;
                    }
                }
            }

            this.canvas.style.position = 'absolute';
            this.canvas.style.left = `${finalLeft}px`;
            this.canvas.style.top = `${finalTop}px`;
            this.canvas.style.width = `${finalW}px`;
            this.canvas.style.height = `${finalH}px`;
            this.canvas.style.transform = 'none';
            this.canvas.style.maxWidth = 'none';
            this.canvas.style.maxHeight = 'none';

            this.canvas.width = finalW * dpr;
            this.canvas.height = finalH * dpr;

        } else {
            // --- Standard Mode (No Frame) ---
            // Reset any positioning from framed mode.
            this.canvas.style.position = 'relative';
            this.canvas.style.left = '';
            this.canvas.style.top = '';
            this.canvas.style.right = '';
            this.canvas.style.bottom = '';
            this.canvas.style.transform = 'none';
            this.canvas.style.maxWidth = '100%';
            this.canvas.style.maxHeight = '100%';
            
            let width = containerW;
            let height = containerH;

            if (this.source) {
                const { width: srcWidth, height: srcHeight } = this.getUploadDimensions();
                
                if (srcWidth && srcHeight) {
                    const srcRatio = srcWidth / srcHeight;
                    const containerRatio = width / height;

                    if (containerRatio > srcRatio) {
                        width = height * srcRatio;
                    } else {
                        height = width / srcRatio;
                    }
                }
            }

            this.canvas.width = width * dpr;
            this.canvas.height = height * dpr;
            this.canvas.style.width = `${width}px`;
            this.canvas.style.height = `${height}px`;
        }
        
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        this.ensureRenderTargets();
        if (!this.isVideo && this.source) this.render();
    }

    startLoop() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
        const loop = (time) => {
            this.render(time);
            this.animationId = requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    render(time = 0) {
        const gl = this.gl;
        if (!this.source) return;

        gl.bindVertexArray(this.vao);

        // Update source texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);

        // Source texture filtering: controls how the (possibly downscaled) signal is
        // sampled when up/down-scaled to the output canvas.
        const scaling = this.settings.scaling || 'default';
        const wantNearest = (scaling === 'nearest');
        const nextSampling = wantNearest ? 'nearest' : 'linear';
        if (this.sourceSampling !== nextSampling) {
            const filter = wantNearest ? gl.NEAREST : gl.LINEAR;
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
            this.sourceSampling = nextSampling;
        }

        // Standardize orientation: keep quad UVs unflipped, and flip DOM-source
        // uploads at upload time so multi-pass doesn't alternate orientation.
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

        const upload = this.getUploadSource();
        this.uploadWidth = upload.width;
        this.uploadHeight = upload.height;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, upload.source);

        if (this.supportsMultipass && this.programs && this.scene?.texture && this.bloom?.a?.texture) {
            this.renderMultipass(time);
        } else {
            this.renderLegacy(time);
        }
    }

    renderLegacy(time) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.useProgram(this.program);

        const uImage = gl.getUniformLocation(this.program, 'u_image');
        const uResolution = gl.getUniformLocation(this.program, 'u_resolution');
        const uTextureSize = gl.getUniformLocation(this.program, 'u_textureSize');
        const uTime = gl.getUniformLocation(this.program, 'u_time');

        gl.uniform1i(uImage, 0);
        gl.uniform2f(uResolution, gl.canvas.width, gl.canvas.height);
        gl.uniform2f(
            uTextureSize,
            this.uploadWidth,
            this.uploadHeight
        );
        gl.uniform1f(uTime, time * 0.001);

        gl.uniform1f(gl.getUniformLocation(this.program, 'u_curvature'), this.settings.curvature);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_vignette'), this.settings.vignette);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_scanlineIntensity'), this.settings.scanlineIntensity);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_scanlineCount'), this.settings.scanlineCount);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_convergence'), this.settings.convergence);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_interlace'), this.settings.interlace);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_deinterlace'), this.settings.deinterlace);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_overscan'), this.settings.overscan);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_border'), this.settings.border);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_geomAA'), this.settings.geomAA);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_maskBrightness'), this.settings.maskBrightness);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_maskType'), this.settings.maskType);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_maskSize'), this.settings.maskSize);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_bloom'), this.settings.bloom);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_noise'), this.settings.noise);

        gl.uniform1f(gl.getUniformLocation(this.program, 'u_color'), this.settings.color);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_brightness'), this.settings.brightness);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_contrast'), this.settings.contrast);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_hue'), this.settings.hue);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_sharpness'), this.settings.sharpness);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    renderMultipass(time) {
        const gl = this.gl;
        const {
            sceneProgram,
            bloomExtractProgram,
            blurProgram,
            compositeProgram,
            sceneLocs,
            bloomExtractLocs,
            blurLocs,
            compositeLocs,
        } = this.programs;

        const srcW = this.uploadWidth || 1;
        const srcH = this.uploadHeight || 1;
        const t = time * 0.001;

        // Pass 1: scene (linear)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
        gl.viewport(0, 0, this.scene.width, this.scene.height);
        gl.useProgram(sceneProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(sceneLocs.u_image, 0);
        gl.uniform2f(sceneLocs.u_textureSize, srcW, srcH);
        gl.uniform1f(sceneLocs.u_curvature, this.settings.curvature);
        gl.uniform1f(sceneLocs.u_sharpness, this.settings.sharpness);
        gl.uniform1f(sceneLocs.u_overscan, this.settings.overscan);
        gl.uniform1f(sceneLocs.u_border, this.settings.border);
        gl.uniform1f(sceneLocs.u_geomAA, this.settings.geomAA);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Pass 2: bloom extract (half-res)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloom.a.fbo);
        gl.viewport(0, 0, this.bloom.width, this.bloom.height);
        gl.useProgram(bloomExtractProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.scene.texture);
        gl.uniform1i(bloomExtractLocs.u_scene, 0);
        gl.uniform1f(bloomExtractLocs.u_bloom, this.settings.bloom);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Pass 3: blur horizontal
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloom.b.fbo);
        gl.viewport(0, 0, this.bloom.width, this.bloom.height);
        gl.useProgram(blurProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.bloom.a.texture);
        gl.uniform1i(blurLocs.u_image, 0);
        gl.uniform2f(blurLocs.u_texelStep, 1.0 / this.bloom.width, 0.0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Pass 4: blur vertical
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloom.a.fbo);
        gl.viewport(0, 0, this.bloom.width, this.bloom.height);
        gl.useProgram(blurProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.bloom.b.texture);
        gl.uniform1i(blurLocs.u_image, 0);
        gl.uniform2f(blurLocs.u_texelStep, 0.0, 1.0 / this.bloom.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Pass 5: composite to screen
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.useProgram(compositeProgram);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.scene.texture);
        gl.uniform1i(compositeLocs.u_scene, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.bloom.a.texture);
        gl.uniform1i(compositeLocs.u_bloomTex, 1);

        gl.uniform2f(compositeLocs.u_resolution, gl.canvas.width, gl.canvas.height);
        gl.uniform2f(compositeLocs.u_inputSize, this.uploadWidth, this.uploadHeight);
        gl.uniform1f(compositeLocs.u_time, t);

        gl.uniform1f(compositeLocs.u_interlace, this.settings.interlace);
        gl.uniform1f(compositeLocs.u_deinterlace, this.settings.deinterlace);

        gl.uniform1f(compositeLocs.u_convergence, this.settings.convergence);

        gl.uniform1f(compositeLocs.u_vignette, this.settings.vignette);
        gl.uniform1f(compositeLocs.u_scanlineIntensity, this.settings.scanlineIntensity);
        gl.uniform1f(compositeLocs.u_scanlineCount, this.settings.scanlineCount);
        gl.uniform1f(compositeLocs.u_maskBrightness, this.settings.maskBrightness);
        gl.uniform1f(compositeLocs.u_maskType, this.settings.maskType);
        gl.uniform1f(compositeLocs.u_maskSize, this.settings.maskSize);
        gl.uniform1f(compositeLocs.u_bloom, this.settings.bloom);
        gl.uniform1f(compositeLocs.u_noise, this.settings.noise);
        gl.uniform1f(compositeLocs.u_color, this.settings.color);
        gl.uniform1f(compositeLocs.u_brightness, this.settings.brightness);
        gl.uniform1f(compositeLocs.u_contrast, this.settings.contrast);
        gl.uniform1f(compositeLocs.u_hue, this.settings.hue);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
}
