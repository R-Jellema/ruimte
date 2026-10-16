// Adapted from React Bits Galaxy, Copyright (c) 2026 David Haz.
// https://github.com/DavidHDev/react-bits/tree/main/src/ts-default/Backgrounds/Galaxy
// License: App/Resources/react-bits-license.txt (MIT + Commons Clause).
#include <metal_stdlib>
using namespace metal;

static float galaxyHash(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

static float galaxyTriangle(float x) {
    return abs(fract(x) * 2.0 - 1.0);
}

static float galaxyPulse(float x) {
    return 1.0 - smoothstep(0.0, 1.0, abs(2.0 * fract(x) - 1.0));
}

static float2 galaxyRotate(float2 p, float angle) {
    float cosine = cos(angle);
    float sine = sin(angle);
    return float2(cosine * p.x + sine * p.y, -sine * p.x + cosine * p.y);
}

static float3 galaxyColor(float seed, bool dark) {
    int index = min(int(seed * 3.0), 2);
    if (index == 0) return float3(1.0);
    if (dark) return index == 1 ? float3(191, 227, 255) / 255.0 : float3(143, 184, 255) / 255.0;
    return index == 1 ? float3(255, 217, 163) / 255.0 : float3(168, 200, 255) / 255.0;
}

static float galaxyStar(float2 uv, float flare, float2 radial, float boost, float invReach) {
    float stretch = 1.0 + boost * 5.0;
    float along = dot(uv, radial);
    float squash = 1.0 - 1.0 / (stretch * stretch);
    float distance = sqrt(max(dot(uv, uv) - squash * along * along, 0.0));
    float brightness = (0.015 / pow(stretch, 0.6)) / max(distance, 0.00001);
    float rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
    brightness += rays * flare * 0.3;
    uv = float2(uv.x - uv.y, uv.x + uv.y) * 0.7071;
    rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
    brightness += rays * 0.09 * flare;
    brightness *= 1.0 - smoothstep(0.2, 1.0, distance * invReach);
    brightness *= mix(1.0, 1.0 - smoothstep(0.55, 1.0, length(uv) * invReach), min(boost * 4.0, 1.0));
    return brightness;
}

static float3 galaxyLayer(float2 uv, float2 radial, float time, float gloss, float boost, bool dark,
                           float2 repelAt, float pushCells, float spread) {
    float3 color = 0;
    float2 cell = fract(uv) - 0.5;
    float2 id = floor(uv);
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            float2 offset = float2(x, y);
            float2 starID = id + offset;
            float seed = galaxyHash(starID);
            float size = fract(seed * 345.32);
            float flare = smoothstep(0.9, 1.0, size) * galaxyTriangle(gloss / (3.0 * seed + 1.0));
            float2 pad = float2(galaxyPulse(seed * 34.0 + time / 10.0), galaxyPulse(seed * 38.0 + time / 30.0)) - 0.5;
            float2 away = starID + 0.5 + pad - repelAt;
            float distance = length(away);
            float q = distance * spread;
            float cells = pushCells * exp(-q * q);
            float moved = cells * rsqrt(1.0 + cells * cells * 2.78);
            float2 shift = away * (moved / max(distance, 0.0001));
            float invReach = 1.0 / (1.0 - moved);
            float star = galaxyStar(cell - offset - pad - shift, flare, radial, boost, invReach);
            float twinkle = mix(1.0, galaxyPulse(time + seed * 6.2831) + 0.5, 0.3);
            color += star * twinkle * size * galaxyColor(galaxyHash(starID + 7.0), dark);
        }
    }
    return color;
}

[[ stitchable ]] half4 galaxy(float2 position, half4 source, float2 size, float2 center,
                              float time, float density, float dark, float motion, float2 touch,
                              float touchStrength, float touchBoost, float touchTravel) {
    float height = max(size.y, 1.0);
    float2 uv = float2(position.x - center.x, center.y - position.y) / height;
    float2 repelAt = galaxyRotate(float2(touch.x - center.x, center.y - touch.y) / height, time * 0.1);
    float2 radial = length(uv) > 0.0001 ? normalize(uv) : float2(1, 0);
    float angle = time * 0.1;
    uv = galaxyRotate(uv, angle);
    radial = galaxyRotate(radial, angle);

    float intro = motion > 0.5 ? min(time / 2.2, 1.0) : 1.0;
    float boost = max(1.4 * pow(1.0 - intro, 2.0), touchBoost);
    float elapsedIntro = min(time, 2.2);
    float introTravel = 1.4 * (elapsedIntro - elapsedIntro * elapsedIntro / 2.2
                        + elapsedIntro * elapsedIntro * elapsedIntro / (3.0 * 2.2 * 2.2));
    float depthOffset = time * 0.05 + (introTravel + touchTravel) * 0.7;
    float3 color = 0;
    for (int layer = 0; layer < 4; layer++) {
        float fraction = float(layer) / 4.0;
        float depth = fract(fraction + depthOffset);
        float scale = mix(20.0 * density, 0.5 * density, depth);
        float fade = depth * (1.0 - smoothstep(0.9, 1.0, depth));
        color += galaxyLayer(uv * scale + fraction * 453.32, radial, time, time * 0.05, boost, dark > 0.5,
                             repelAt * scale + fraction * 453.32, 0.1 * touchStrength * scale, 1.0 / (scale * 0.24)) * fade;
    }
    float reveal = min(1.0, intro / 0.35);
    color *= reveal * reveal * (3.0 - 2.0 * reveal);

    // Coverage follows radiance, matching the desktop's fix for dark halos on light surfaces.
    float energy = max(max(color.r, color.g), color.b);
    float3 tint = color / max(energy, 0.0001);
    float alpha = min(energy * smoothstep(0.0, 0.3, length(color)), 1.0);
    return half4(half3(tint * alpha), half(alpha)) * source.a;
}
