import modal
import subprocess
import json
import os

app = modal.App("unscroll-video-render")

# Create image with Node.js, bun, ffmpeg, and chromium
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(
        "curl",
        "unzip",
        "ffmpeg",
        "chromium",
        "fonts-liberation",
        "libnss3",
        "libatk1.0-0",
        "libatk-bridge2.0-0",
        "libcups2",
        "libdrm2",
        "libxkbcommon0",
        "libxcomposite1",
        "libxdamage1",
        "libxrandr2",
        "libgbm1",
        "libasound2",
    )
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
        "curl -fsSL https://bun.sh/install | bash",
        "ln -s /root/.bun/bin/bun /usr/local/bin/bun",
    )
    .env({
        "PUPPETEER_SKIP_CHROMIUM_DOWNLOAD": "true",
        "PUPPETEER_EXECUTABLE_PATH": "/usr/bin/chromium",
    })
    .pip_install("fastapi[standard]")
    .add_local_dir(
        "../video",
        remote_path="/app/video",
        ignore=lambda path: "node_modules" in str(path) or ".git" in str(path),
        copy=True,  # required to run bun install after; files baked into image
    )
    .run_commands("cd /app/video && bun install")
)


@app.function(
    image=image,
    timeout=900,  # 15 min - bun install + render can be slow
    memory=16384,
    cpu=4,
)
def render_video(
    audio_url: str,
    background_url: str,
    background_type: str,
    captions: list,
    duration_in_seconds: float,
    gradient_colors: list | None = None,
    hook: str | None = None,
    pattern_interrupts: list | None = None,
) -> bytes:
    """Render a video and return the MP4 bytes."""
    print("[render] Starting video render", flush=True)
    print(f"[render] duration={duration_in_seconds}s captions={len(captions)} pattern_interrupts={len(pattern_interrupts or [])}", flush=True)

    # Create render script with progress logging (deps pre-installed in image)
    render_script = """
const { renderVideo } = require('@revideo/renderer');
const fs = require('fs');

const params = JSON.parse(process.argv[2]);

let lastLoggedPct = -1;
async function main() {
    console.log('[render] Starting Revideo render...');
    await renderVideo({
        projectFile: '/app/video/src/project.ts',
        variables: {
            audioUrl: params.audioUrl,
            backgroundUrl: params.backgroundUrl,
            backgroundType: params.backgroundType,
            captions: params.captions,
            durationInSeconds: params.durationInSeconds,
            gradientColors: params.gradientColors || ['#1a1a2e', '#16213e'],
            hook: params.hook,
            patternInterrupts: params.patternInterrupts || [],
        },
        settings: {
            outDir: '/tmp',
            outFile: 'output.mp4',
            logProgress: true,
            progressCallback: (workerId, progress) => {
                const pct = Math.floor(progress * 10) * 10;
                if (pct > lastLoggedPct) {
                    lastLoggedPct = pct;
                    console.log('[render] Progress: ' + pct + '%');
                }
            },
            puppeteer: {
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                ],
            },
        },
    });
    console.log('[render] RENDER_COMPLETE');
}

main().catch(err => {
    console.error('[render] ERROR:', err);
    process.exit(1);
});
"""

    render_script_path = "/app/video/render.js"
    with open(render_script_path, "w") as f:
        f.write(render_script)

    params = {
        "audioUrl": audio_url,
        "backgroundUrl": background_url,
        "backgroundType": background_type,
        "captions": captions,
        "durationInSeconds": duration_in_seconds,
        "gradientColors": gradient_colors or ["#1a1a2e", "#16213e"],
        "hook": hook,
        "patternInterrupts": pattern_interrupts or [],
    }

    # Run render - stream stdout/stderr to Modal logs (no capture)
    print("[render] Starting Node render process...", flush=True)
    result = subprocess.run(
        ["node", render_script_path, json.dumps(params)],
        cwd="/app/video",
        capture_output=False,  # stream to Modal logs in real time
        text=True,
    )

    if result.returncode != 0:
        raise Exception(f"Render process exited with code {result.returncode}")

    output_path = "/tmp/output.mp4"
    if not os.path.exists(output_path):
        raise Exception(f"Output file not found at {output_path}")

    size = os.path.getsize(output_path)
    print(f"[render] Done. Output size: {size} bytes", flush=True)

    with open(output_path, "rb") as f:
        return f.read()


@app.function(
    image=image,
    timeout=900,
    memory=16384,
    cpu=4,
)
@modal.fastapi_endpoint(method="POST")
def render_video_endpoint(data: dict) -> dict:
    """HTTP endpoint for rendering videos."""
    try:
        video_bytes = render_video.local(
            audio_url=data["audioUrl"],
            background_url=data["backgroundUrl"],
            background_type=data["backgroundType"],
            captions=data.get("captions", []),
            duration_in_seconds=data["durationInSeconds"],
            gradient_colors=data.get("gradientColors"),
            hook=data.get("hook"),
            pattern_interrupts=data.get("patternInterrupts"),
        )

        # Return base64 encoded video or upload to S3
        import base64
        return {
            "success": True,
            "videoBase64": base64.b64encode(video_bytes).decode("utf-8"),
            "size": len(video_bytes),
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
        }


# For local testing
if __name__ == "__main__":
    with app.run():
        # Use real audio URL and sample captions for testing
        result = render_video.remote(
            audio_url="https://unscroll-assets.s3.us-east-2.amazonaws.com/render-assets/19a1ec6e-f8cb-4f48-b028-d98e6537ad73/audio.mp3",
            background_url="",
            background_type="gradient",
            captions=[
                {"word": "Hello", "startTime": 0.0, "endTime": 0.5},
                {"word": "world", "startTime": 0.5, "endTime": 1.0},
                {"word": "this", "startTime": 1.0, "endTime": 1.3},
                {"word": "is", "startTime": 1.3, "endTime": 1.5},
                {"word": "a", "startTime": 1.5, "endTime": 1.6},
                {"word": "test", "startTime": 1.6, "endTime": 2.0},
            ],
            duration_in_seconds=5,
        )
        print(f"Rendered {len(result)} bytes")
