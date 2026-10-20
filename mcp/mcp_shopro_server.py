import base64
import logging
import os
from typing import Optional
import uuid
from mcp.server.fastmcp import FastMCP
from backend_client import call_backend, request_token

logger = logging.getLogger("shopro-mcp")
mcp = FastMCP("Shopro AI", stateless_http=True)


async def text(prompt):
    result = await call_backend("text-generation", {
        "messages": [{"role": "user", "content": prompt}], "stream": False,
    })
    return result["choices"][0]["message"]["content"]


@mcp.tool()
async def extract_product_highlights(product_info: str):
    return await call_backend("ai-assistant", {"action": "generate_selling_points", "product_name": product_info})


@mcp.tool()
async def generate_marketing_script(product_highlights: str, target_audience: str,
                                    platform: str = "TikTok", language: str = "Chinese"):
    return {"script": await text(f"用{language}为{platform}创作带货脚本，受众：{target_audience}。"
                                f"包含钩子、痛点、产品、CTA。卖点：{product_highlights}")}


@mcp.tool()
async def translate_marketing_script(script: str, target_language: str):
    return {"script": await text(f"将以下营销脚本翻译为{target_language}，保留分镜：\n{script}")}


@mcp.tool()
async def synthesize_voice_tts(text: str, voice_id: str = "fnlp/MOSS-TTSD-v0.5:alex",
                               speed: float = 1.0, volume: float = 0.9):
    if speed != 1.0 or volume != 0.9:
        raise ValueError("当前语音服务不支持自定义速度与音量")
    audio = await call_backend("siliconflow-audio", {"input": text, "voice": voice_id},
                               query="?action=tts", binary=True)
    return {"audio_base64": base64.b64encode(audio).decode(), "content_type": "audio/mpeg"}


@mcp.tool()
async def enhance_prompt(prompt: str):
    return {"enhanced_prompt": await text(f"将以下描述扩展为商品短视频镜头提示词：{prompt}")}


@mcp.tool()
async def submit_video_generation(prompt: str, request_key: str, duration: int = 5,
                                  resolution: str = "720p", ratio: str = "16:9",
                                  first_frame_url: Optional[str] = None, watermark: bool = False):
    """request_key 使用 UUID；同一请求重试必须复用，业务服务只扣一次积分。"""
    uuid.UUID(request_key)
    if watermark:
        raise ValueError("当前队列不支持自定义水印参数")
    result = await call_backend("video-jobs", {
        "action": "create", "provider": "ArkSeedance", "request_key": request_key,
        "input": {"prompt": prompt, "title": prompt[:30], "duration": duration,
                  "resolution": resolution, "ratio": ratio, "first_frame": first_frame_url},
    })
    return result["job"]


@mcp.tool()
async def query_video_status(request_id: str):
    return (await call_backend("video-jobs", {"action": "query", "job_id": request_id}))["job"]


if __name__ == "__main__":
    token = os.environ.get("SUPABASE_USER_JWT")
    if not token:
        raise RuntimeError("stdio 模式需要 SUPABASE_USER_JWT；HTTP 模式请运行 http_server.py")
    request_token.set(token)
    mcp.run(transport="stdio")
