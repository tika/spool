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
    )
)


@app.function(
    image=image,
    timeout=600,
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
) -> bytes:
    """Render a video and return the MP4 bytes."""
    import tempfile

    # Install dependencies
    subprocess.run(
        ["bun", "install"],
        cwd="/app/video",
        check=True,
        capture_output=True,
    )

    # Create render script
    render_script = """
const { renderVideo } = require('@revideo/renderer');
const fs = require('fs');

const params = JSON.parse(process.argv[2]);

async function main() {
    await renderVideo({
        projectFile: '/app/video/src/project.ts',
        variables: {
            audioUrl: params.audioUrl,
            backgroundUrl: params.backgroundUrl,
            backgroundType: params.backgroundType,
            captions: params.captions,
            durationInSeconds: params.durationInSeconds,
            gradientColors: params.gradientColors || ['#1a1a2e', '#16213e'],
        },
        settings: {
            outDir: '/tmp',
            outFile: 'output.mp4',
            logProgress: true,
            puppeteer: {
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                ],
            },
        },
    });
    console.log('RENDER_COMPLETE');
}

main().catch(err => {
    console.error(err);
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
    }

    # Run render from /app/video so Node resolves @revideo/renderer from node_modules
    result = subprocess.run(
        ["node", render_script_path, json.dumps(params)],
        cwd="/app/video",
        capture_output=True,
        text=True,
    )

    print("STDOUT:", result.stdout)
    print("STDERR:", result.stderr)

    if result.returncode != 0:
        raise Exception(f"Render failed: {result.stderr}")

    # Read output file
    output_path = "/tmp/output.mp4"
    if not os.path.exists(output_path):
        raise Exception(f"Output file not found at {output_path}")

    with open(output_path, "rb") as f:
        return f.read()


@app.function(
    image=image,
    timeout=600,
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
        result = render_video.remote(
            audio_url="https://example.com/audio.mp3",
            background_url="",
            background_type="gradient",
            captions=[],
            duration_in_seconds=5,
        )
        print(f"Rendered {len(result)} bytes")
