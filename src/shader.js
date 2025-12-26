export const vertexShaderSource = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;

out vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
`;

// Legacy single-pass shader kept as a fallback for devices/browsers
// that don't support float render targets (multi-pass bloom).
export const fragmentShaderSourceLegacy = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 outColor;

uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform vec2 u_textureSize;
uniform float u_time;

// Settings
uniform float u_curvature; // 0.0 to 1.0
uniform float u_vignette; // 0.0 to 1.0
uniform float u_scanlineIntensity; // 0.0 to 1.0
uniform float u_scanlineCount; // 240.0 to 1080.0
uniform float u_convergence; // pixels (screen-space), e.g. 0.0 to ~3.0
uniform float u_interlace; // 0.0 to 1.0
uniform float u_deinterlace; // 0.0 to 1.0
uniform float u_overscan; // 0.0 to ~0.25 (zoom-in crop)
uniform float u_border; // 0.0 to ~0.10 (inner black border width, UV)
uniform float u_geomAA; // 0.0 to 1.0 (edge AA amount)
uniform float u_maskBrightness; // 0.0 to 1.0
uniform float u_maskType; // 0.0 = Aperture, 1.0 = Shadow, 2.0 = None
uniform float u_maskSize; // 1.0 to ...
uniform float u_bloom; // 0.0 to 1.0
uniform float u_noise; // 0.0 to 1.0

// Color adjustments
uniform float u_color; // Was saturation
uniform float u_brightness;
uniform float u_contrast;
uniform float u_hue;
uniform float u_sharpness;

// Distort UVs for curvature
vec2 curve(vec2 uv) {
    uv = (uv - 0.5) * 2.0;
    uv *= 1.1;
    uv.x *= 1.0 + pow((abs(uv.y) / 5.0), 2.0) * u_curvature;
    uv.y *= 1.0 + pow((abs(uv.x) / 4.0), 2.0) * u_curvature;
    uv = (uv / 2.0) + 0.5;
    uv = uv * 0.92 + 0.04;
    return uv;
}

// Simple noise
float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

// RGB to YIQ matrix
const mat3 rgb2yiq = mat3(0.299, 0.587, 0.114, 0.595716, -0.274453, -0.321263, 0.211456, -0.522591, 0.311135);
const mat3 yiq2rgb = mat3(1.0, 0.9563, 0.6210, 1.0, -0.2721, -0.6474, 1.0, -1.1070, 1.7046);

void main() {
    vec2 uv = v_texCoord;
    
    // Apply curvature
    if (u_curvature > 0.0) {
        uv = curve(uv);
    }

    // Overscan (zoom in -> crop)
    float zoom = 1.0 + max(u_overscan, 0.0);
    uv = (uv - 0.5) / zoom + 0.5;

    // Geometry edge mask (signed distance to the [0..1] box)
    float dEdge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float edgeMask = step(0.0, dEdge);
    float aaAmt = clamp(u_geomAA, 0.0, 1.0);
    if (aaAmt > 0.0) {
        float aaW = max(fwidth(dEdge) * (1.0 + 8.0 * aaAmt), 1e-5);
        edgeMask = smoothstep(0.0, aaW, dEdge);
    }

    // Inner black border (fade in from the edge)
    float borderW = clamp(u_border, 0.0, 0.25);
    float borderMask = (borderW > 0.0) ? smoothstep(0.0, borderW, dEdge) : 1.0;

    // Cutoff outside screen
    if (edgeMask <= 0.0) {
        outColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // Sample texture
    // Interlacing/deinterlacing simulation (signal-space).
    // Drive line parity and offsets from the *input* raster so it doesn't change
    // when the canvas is resized/upscaled.
    float interlace = clamp(u_interlace, 0.0, 1.0);
    float deint = clamp(u_deinterlace, 0.0, 1.0);
    float field = mod(floor(u_time * 60.0), 2.0);
    vec2 texelIn = vec2(1.0 / max(u_textureSize.x, 1.0), 1.0 / max(u_textureSize.y, 1.0));
    float virtY = floor(v_texCoord.y * max(u_textureSize.y, 1.0));
    float parity = mod(virtY + field, 2.0);
    uv.y += (parity < 1.0 ? 0.5 : -0.5) * texelIn.y * interlace;

    // Beam misconvergence: offset in pixels relative to the *input* (u_textureSize).
    vec2 conv = vec2(u_convergence / max(u_textureSize.x, 1.0), 0.0);
    vec3 color;
    color.r = texture(u_image, uv + conv).r;
    color.g = texture(u_image, uv).g;
    color.b = texture(u_image, uv - conv).b;

    // Deinterlacing: blend with neighbor line (signal-space) to soften combing.
    if (deint > 0.0 && interlace > 0.0) {
        vec2 ny = vec2(0.0, (parity < 1.0 ? 1.0 : -1.0) * texelIn.y);
        vec3 ncol;
        ncol.r = texture(u_image, uv + ny + conv).r;
        ncol.g = texture(u_image, uv + ny).g;
        ncol.b = texture(u_image, uv + ny - conv).b;
        color = mix(color, 0.5 * (color + ncol), deint);
    }

    // Sharpness: positive = unsharp mask, negative = blur blend.
    if (u_sharpness != 0.0) {
        vec2 step = 1.0 / max(u_textureSize, vec2(1.0));
        vec3 n = texture(u_image, uv + vec2(0.0, -step.y)).rgb;
        vec3 s = texture(u_image, uv + vec2(0.0,  step.y)).rgb;
        vec3 e = texture(u_image, uv + vec2( step.x, 0.0)).rgb;
        vec3 w = texture(u_image, uv + vec2(-step.x, 0.0)).rgb;

        vec3 blurred = (n + s + e + w) * 0.25;
        if (u_sharpness > 0.0) {
            color = color + (color - blurred) * u_sharpness;
        } else {
            float amt = clamp(-u_sharpness, 0.0, 2.0) * 0.5;
            color = mix(color, blurred, amt);
        }
    }

    // Color Adjustments
    
    // Hue
    if (u_hue != 0.0) {
        vec3 yiq = rgb2yiq * color;
        float hue = atan(yiq.z, yiq.y) + u_hue;
        float chroma = sqrt(yiq.z * yiq.z + yiq.y * yiq.y);
        color = yiq2rgb * vec3(yiq.x, chroma * cos(hue), chroma * sin(hue));
    }

    // Contrast
    color = (color - 0.5) * u_contrast + 0.5;
    // Brightness
    color *= u_brightness;
    // Color (Saturation)
    vec3 gray = vec3(dot(color, vec3(0.299, 0.587, 0.114)));
    color = mix(gray, color, u_color);

    // Bloom (legacy path): avoid relying on mipmaps/LOD bias (often not present).
    if (u_bloom > 0.0) {
        vec2 stepPx = 1.0 / max(u_textureSize, vec2(1.0));
        vec3 blur = texture(u_image, uv).rgb * 0.50;
        blur += texture(u_image, uv + vec2( stepPx.x, 0.0)).rgb * 0.125;
        blur += texture(u_image, uv + vec2(-stepPx.x, 0.0)).rgb * 0.125;
        blur += texture(u_image, uv + vec2(0.0,  stepPx.y)).rgb * 0.125;
        blur += texture(u_image, uv + vec2(0.0, -stepPx.y)).rgb * 0.125;

        // Mild brightpass so bloom is driven by highlights.
        vec3 bright = max(blur - vec3(0.65), 0.0);
        color += bright * (u_bloom * 1.25);
    }

    // Scanlines
    if (u_scanlineIntensity > 0.0) {
        float scanline = sin(uv.y * u_scanlineCount * 3.14159 * 2.0);
        scanline = 0.5 + 0.5 * scanline;
        color *= 1.0 - (u_scanlineIntensity * (1.0 - scanline));
    }

    // Mask Simulation (signal-space)
    if (u_maskType < 1.5) {
        float mask = 1.0;
        vec2 virt = v_texCoord * max(u_textureSize, vec2(1.0));
        float x = virt.x / max(u_maskSize, 0.001);
        float y = virt.y / max(u_maskSize, 0.001);
        
        if (u_maskType < 0.5) { 
            // Aperture Grille (Vertical Stripes)
            // R G B R G B
            int pixel = int(mod(x, 3.0));
            if (pixel == 0) color.r *= 1.2;
            else if (pixel == 1) color.g *= 1.2;
            else color.b *= 1.2;
            
            mask = (sin(x * 3.14159 * 1.0) * 0.5 + 0.5); 
        } else {
            // Shadow Mask (Dot Triad approximation)
            float mx = mod(x, 2.0);
            float my = mod(y, 2.0);
            if ((mx < 1.0 && my < 1.0) || (mx >= 1.0 && my >= 1.0)) {
                mask = 0.5;
            }
        }
        
        color *= 1.0 - (u_maskBrightness * (1.0 - mask));
    }

    // Vignette
    if (u_vignette > 0.0) {
        float vig = uv.x * (1.0 - uv.x) * uv.y * (1.0 - uv.y) * 15.0;
        vig = pow(vig, u_vignette * 0.5);
        color *= vig;
    }

    // Noise
    if (u_noise > 0.0) {
        float n = random(uv * u_time);
        color += (n - 0.5) * u_noise * 0.1;
    }

    color *= edgeMask * borderMask;
    outColor = vec4(color, 1.0);
}
`;

// ----------------------------
// Multi-pass CRT pipeline shaders
// ----------------------------

export const sceneFragmentSource = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 outColor;

uniform sampler2D u_image;
uniform vec2 u_textureSize;

uniform float u_curvature;
uniform float u_sharpness;

uniform float u_overscan; // 0.0 to ~0.25 (zoom-in crop)
uniform float u_border; // 0.0 to ~0.10 (inner black border width, UV)
uniform float u_geomAA; // 0.0 to 1.0 (edge AA amount)

vec2 curve(vec2 uv) {
    uv = (uv - 0.5) * 2.0;
    uv *= 1.1;
    uv.x *= 1.0 + pow((abs(uv.y) / 5.0), 2.0) * u_curvature;
    uv.y *= 1.0 + pow((abs(uv.x) / 4.0), 2.0) * u_curvature;
    uv = (uv / 2.0) + 0.5;
    uv = uv * 0.92 + 0.04;
    return uv;
}

vec3 decodeInput(vec3 c) {
    // Approx sRGB decode (good enough for our use)
    return pow(max(c, 0.0), vec3(2.2));
}

void main() {
    vec2 uv = v_texCoord;
    if (u_curvature > 0.0) uv = curve(uv);

    // Overscan (zoom in -> crop)
    float zoom = 1.0 + max(u_overscan, 0.0);
    uv = (uv - 0.5) / zoom + 0.5;

    float dEdge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float edgeMask = step(0.0, dEdge);
    float aaAmt = clamp(u_geomAA, 0.0, 1.0);
    if (aaAmt > 0.0) {
        float aaW = max(fwidth(dEdge) * (1.0 + 8.0 * aaAmt), 1e-5);
        edgeMask = smoothstep(0.0, aaW, dEdge);
    }

    float borderW = clamp(u_border, 0.0, 0.25);
    float borderMask = (borderW > 0.0) ? smoothstep(0.0, borderW, dEdge) : 1.0;

    // Cutoff outside screen
    if (edgeMask <= 0.0) {
        outColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    vec3 color = decodeInput(texture(u_image, uv).rgb);

    // Sharpness (in linear): positive = unsharp mask, negative = blur blend.
    if (u_sharpness != 0.0) {
        vec2 stepPx = 1.0 / max(u_textureSize, vec2(1.0));
        vec3 n = decodeInput(texture(u_image, uv + vec2(0.0, -stepPx.y)).rgb);
        vec3 s = decodeInput(texture(u_image, uv + vec2(0.0,  stepPx.y)).rgb);
        vec3 e = decodeInput(texture(u_image, uv + vec2( stepPx.x, 0.0)).rgb);
        vec3 w = decodeInput(texture(u_image, uv + vec2(-stepPx.x, 0.0)).rgb);
        vec3 blurred = (n + s + e + w) * 0.25;
        if (u_sharpness > 0.0) {
            color = color + (color - blurred) * u_sharpness;
        } else {
            float amt = clamp(-u_sharpness, 0.0, 2.0) * 0.5;
            color = mix(color, blurred, amt);
        }
    }

    color *= edgeMask * borderMask;
    outColor = vec4(color, 1.0);
}
`;

export const bloomExtractFragmentSource = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 outColor;

uniform sampler2D u_scene;
uniform float u_bloom;

float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
    vec3 c = texture(u_scene, v_texCoord).rgb;
    // Soft knee brightpass.
    // Make threshold low enough that the control is visible on typical 0..1 SDR sources.
    float threshold = 0.55;
    float knee = 0.35;
    float v = luma(c);
    float soft = clamp((v - threshold + knee) / (2.0 * knee), 0.0, 1.0);
    float w = max(v - threshold, 0.0) + soft * soft * (2.0 * knee);
    vec3 outc = (v > 0.0) ? c * (w / max(v, 1e-6)) : vec3(0.0);
    outc *= clamp(u_bloom, 0.0, 1.0);
    outColor = vec4(outc, 1.0);
}
`;

export const blurFragmentSource = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 outColor;

uniform sampler2D u_image;
uniform vec2 u_texelStep; // (1/width, 0) or (0, 1/height)

void main() {
    // 9-tap Gaussian-ish blur (weights sum to 1)
    vec3 c = vec3(0.0);
    c += texture(u_image, v_texCoord - 4.0 * u_texelStep).rgb * 0.016216;
    c += texture(u_image, v_texCoord - 3.0 * u_texelStep).rgb * 0.054054;
    c += texture(u_image, v_texCoord - 2.0 * u_texelStep).rgb * 0.121622;
    c += texture(u_image, v_texCoord - 1.0 * u_texelStep).rgb * 0.194595;
    c += texture(u_image, v_texCoord).rgb                    * 0.227027;
    c += texture(u_image, v_texCoord + 1.0 * u_texelStep).rgb * 0.194595;
    c += texture(u_image, v_texCoord + 2.0 * u_texelStep).rgb * 0.121622;
    c += texture(u_image, v_texCoord + 3.0 * u_texelStep).rgb * 0.054054;
    c += texture(u_image, v_texCoord + 4.0 * u_texelStep).rgb * 0.016216;
    outColor = vec4(c, 1.0);
}
`;

export const compositeFragmentSource = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 outColor;

uniform sampler2D u_scene;
uniform sampler2D u_bloomTex;

uniform vec2 u_resolution;
uniform vec2 u_inputSize;
uniform float u_time;

uniform float u_interlace; // 0.0 to 1.0
uniform float u_deinterlace; // 0.0 to 1.0
uniform float u_convergence; // pixels (screen-space), e.g. 0.0 to ~3.0

uniform float u_vignette;
uniform float u_scanlineIntensity;
uniform float u_scanlineCount;
uniform float u_maskBrightness;
uniform float u_maskType;
uniform float u_maskSize;
uniform float u_bloom;
uniform float u_noise;

uniform float u_color;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_hue;

// RGB <-> YIQ for hue rotation
const mat3 rgb2yiq = mat3(
    0.299, 0.587, 0.114,
    0.595716, -0.274453, -0.321263,
    0.211456, -0.522591, 0.311135
);
const mat3 yiq2rgb = mat3(
    1.0, 0.9563, 0.6210,
    1.0, -0.2721, -0.6474,
    1.0, -1.1070, 1.7046
);

float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

vec3 encodeOutput(vec3 c) {
    return pow(max(c, 0.0), vec3(1.0/2.2));
}

float gaussian(float x, float sigma) {
    float s = max(sigma, 1e-4);
    return exp(-(x*x) / (2.0*s*s));
}

vec3 applyMask(vec3 color) {
    // Mask in screen space; u_maskSize scales the pattern.
    if (u_maskType > 1.5) return color;

    // Drive mask from the *input* raster so it's stable under upscale.
    vec2 virt = v_texCoord * max(u_inputSize, vec2(1.0));
    float px = virt.x / max(u_maskSize, 0.001);
    float py = virt.y / max(u_maskSize, 0.001);

    vec3 maskRgb = vec3(1.0);
    float maskAvg = 1.0;

    if (u_maskType < 0.5) {
        // Aperture grille triads (RGB stripes). Smooth-ish using a cosine window.
        float triad = mod(floor(px), 3.0);
        if (triad < 0.5) maskRgb = vec3(1.25, 0.85, 0.85);
        else if (triad < 1.5) maskRgb = vec3(0.85, 1.25, 0.85);
        else maskRgb = vec3(0.85, 0.85, 1.25);
        maskAvg = (1.25 + 0.85 + 0.85) / 3.0;
    } else {
        // Shadow mask-ish: alternating dots, mild per-channel variation
        float mx = mod(floor(px), 2.0);
        float my = mod(floor(py), 2.0);
        float dotOn = (mx == my) ? 1.0 : 0.65;
        maskRgb = vec3(dotOn);
        maskAvg = 0.825;
    }

    // Strength: u_maskBrightness is “strength” in UI; 0 means no mask effect.
    float strength = clamp(u_maskBrightness, 0.0, 1.0);
    vec3 applied = color * mix(vec3(1.0), maskRgb, strength);
    // Compensation to avoid overall dimming when mask is strong.
    return applied * mix(1.0, (1.0 / max(maskAvg, 1e-3)), strength);
}

void main() {
    vec2 texelOut = vec2(1.0 / max(u_resolution.x, 1.0), 1.0 / max(u_resolution.y, 1.0));
    vec2 texelIn = vec2(1.0 / max(u_inputSize.x, 1.0), 1.0 / max(u_inputSize.y, 1.0));
    vec2 uv = v_texCoord;

    // Interlacing/deinterlacing simulation (signal-space).
    float interlace = clamp(u_interlace, 0.0, 1.0);
    float deint = clamp(u_deinterlace, 0.0, 1.0);
    float field = mod(floor(u_time * 60.0), 2.0);
    float virtY = floor(v_texCoord.y * max(u_inputSize.y, 1.0));
    float parity = mod(virtY + field, 2.0);
    uv.y += (parity < 1.0 ? 0.5 : -0.5) * texelIn.y * interlace;

    // Convergence in pixels relative to the *input* (TV) resolution.
    vec2 conv = vec2(u_convergence * texelIn.x, 0.0);

    vec3 scene;
    scene.r = texture(u_scene, uv + conv).r;
    scene.g = texture(u_scene, uv).g;
    scene.b = texture(u_scene, uv - conv).b;

    vec3 bloom;
    bloom.r = texture(u_bloomTex, uv + conv).r;
    bloom.g = texture(u_bloomTex, uv).g;
    bloom.b = texture(u_bloomTex, uv - conv).b;

    if (deint > 0.0 && interlace > 0.0) {
        vec2 ny = vec2(0.0, (parity < 1.0 ? 1.0 : -1.0) * texelIn.y);

        vec3 sceneN;
        sceneN.r = texture(u_scene, uv + ny + conv).r;
        sceneN.g = texture(u_scene, uv + ny).g;
        sceneN.b = texture(u_scene, uv + ny - conv).b;

        vec3 bloomN;
        bloomN.r = texture(u_bloomTex, uv + ny + conv).r;
        bloomN.g = texture(u_bloomTex, uv + ny).g;
        bloomN.b = texture(u_bloomTex, uv + ny - conv).b;

        scene = mix(scene, 0.5 * (scene + sceneN), deint);
        bloom = mix(bloom, 0.5 * (bloom + bloomN), deint);
    }

    vec3 color = scene + bloom * (u_bloom * 1.25);

    // Scanlines: Gaussian beam centered on each scanline.
    if (u_scanlineIntensity > 0.0) {
        float lines = max(u_scanlineCount, 1.0);
        float y = v_texCoord.y * lines;
        float fracY = fract(y) - 0.5;
        // Sigma varies slightly with brightness for a more CRT-like response.
        float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
        float sigma = mix(0.18, 0.32, clamp(lum, 0.0, 1.0));
        float beam = gaussian(fracY, sigma);
        float scan = mix(1.0, beam, clamp(u_scanlineIntensity, 0.0, 1.0));
        color *= scan;
    }

    // Mask
    color = applyMask(color);

    // Vignette
    if (u_vignette > 0.0) {
        float vig = v_texCoord.x * (1.0 - v_texCoord.x) * v_texCoord.y * (1.0 - v_texCoord.y) * 15.0;
        vig = pow(vig, u_vignette * 0.5);
        color *= vig;
    }

    // Hue
    if (u_hue != 0.0) {
        vec3 yiq = rgb2yiq * color;
        float ang = atan(yiq.z, yiq.y) + u_hue;
        float chroma = sqrt(yiq.z * yiq.z + yiq.y * yiq.y);
        color = yiq2rgb * vec3(yiq.x, chroma * cos(ang), chroma * sin(ang));
    }

    // Contrast + brightness
    color = (color - 0.5) * u_contrast + 0.5;
    color *= u_brightness;

    // Saturation
    float g = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(g), color, u_color);

    // Noise
    if (u_noise > 0.0) {
        float n = random(v_texCoord * (u_time + 1.0));
        color += (n - 0.5) * u_noise * 0.06;
    }

    outColor = vec4(encodeOutput(color), 1.0);
}
`;

