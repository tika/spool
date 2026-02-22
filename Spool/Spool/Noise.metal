//
//  Noise.metal
//  Spool
//
//  Created by Tika on 22/02/2026.
//

#include <metal_stdlib>
using namespace metal;

[[ stitchable ]] half4 grainNoise(float2 position, half4 color, float opacity) {
    float2 p = floor(position);
    float n = fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
    half grain = half(n - 0.5) * half(opacity);
    return half4(color.rgb + grain, color.a);
}
