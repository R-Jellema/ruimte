#include "../App/Design/Galaxy.metal"

kernel void sampleGalaxy(device float4 *pixels [[buffer(0)]], constant float4 &settings [[buffer(1)]],
                         constant float4 &touch [[buffer(2)]], constant float &travel [[buffer(3)]],
                         uint index [[thread_position_in_grid]]) {
    if (index >= 1024) return;
    float2 position = (float2(index % 32, index / 32) + 0.5) * float2(320.0 / 32.0, 468.0 / 32.0);
    pixels[index] = float4(galaxy(position, half4(1), float2(320, 468), float2(160, 200),
                               settings.x, settings.w, settings.y, settings.z, touch.xy, touch.z, touch.w, travel));
}
