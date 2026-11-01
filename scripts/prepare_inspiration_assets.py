"""从只读归档构建公开视觉参考；必须在含FFmpeg的媒体容器内运行。"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

# 坐标以原件像素为准；旧宣传文案、品牌栏和经营指标不进入衍生图。
RECIPES = [
    ("首屏人物构图", "创作界面", "crop=340:290:1610:370", "暖色背景中人物面向镜头，柔和补光，产品置于前景，镜头缓慢推进，保持画面简洁。"),
    ("内容团队工作室", "用户场景", "null", "内容团队在摄影棚协作，桌面有剪辑设备和摄影器材，镜头横向移动记录创作过程。"),
    ("知识连接示意", "功能灵感", "crop=1450:610:25:25", "用抽象连接线展示创意、资料和脚本之间的关系，以清晰的节点和缓慢镜头移动组织画面。"),
    ("爆款风格复刻", "功能灵感", "crop=1480:610:16:16", "分析已授权参考视频的镜头节奏、配色与字幕风格，围绕自己的主题设计新分镜，保留清晰开场和自然转场。"),
    ("分镜脚本构思", "功能灵感", "crop=1470:620:18:15", "在明亮工作室整理分镜脚本，画面从人物讨论切换到脚本细节，按开场、展开、收束组织镜头。"),
    ("人物口播场景", "功能灵感", "crop=1480:630:15:10", "人物在明亮室内自然口播，目光朝向镜头，柔和背景虚化，穿插已确认商品细节特写。"),
    ("图表视觉构图", "功能灵感", "crop=790:220:155:440", "用简洁的线条和网格呈现数据变化的视觉构图；具体数值只使用实际采集记录，不展示预设增长结果。"),
    ("个人创作空间", "用户场景", "null", "个人创作者在小型工作室拍摄，环形灯柔和补光，桌面整洁，镜头从工作全景推进至人物讲述。"),
    ("商品创作工作室", "用户场景", "null", "商家在有自然光的工作室整理商品资料，展示产品外观与真实使用场景，镜头交替呈现人物与商品细节。"),
    ("生成输入区构图", "创作界面", "crop=820:130:310:166,drawbox=x=338:y=72:w=482:h=52:color=0x171620:t=fill", "创作流程采用清晰的分区，先整理参考和主题，再确认规格与分镜，用顺序镜头表现制作过程。"),
    ("多场景分镜构图", "功能灵感", "crop=1470:630:18:15", "将产品展示、日常使用和节日主题拆成独立分镜，统一光线与配色，按节奏衔接各个场景。"),
    ("护肤产品展示", "商品构图", "crop=760:1200:250:590", "人物在淡绿色背景前展示护肤产品，前景摆放商品，柔和灯光突出瓶身质感，仅使用已确认的产品信息。"),
    ("家电场景展示", "商品构图", "crop=1050:1410:100:650", "明亮居家环境中展示家电，人物自然示范使用过程，开场展示整体外观，再切换操作细节。"),
    ("喜糖节日构图", "商品构图", "crop=800:1220:240:650", "红色节日场景中展示食品包装，暖光突出包装纹理，人物讲述已确认的口味和规格，穿插近景。"),
    ("节日食品展示", "商品构图", "crop=650:880:280:790", "暖色节日场景展示食品与包装，镜头从整齐摆放的商品缓慢移到细节，人物自然介绍。"),
    ("运动鞋商品展示", "商品构图", "crop=600:1280:240:730", "人物手持运动鞋，室内暖光，先拍整体外观再切换鞋面、鞋底与鞋带特写，用自然动作展示穿搭场景。"),
    ("鞋履商品近景", "商品构图", "crop=600:1280:240:730", "人物在暖色室内展示鞋履商品，镜头聚焦外观和鞋底细节，背景保持简洁，只讲述已确认的特点。"),
    ("剪辑工作区构图", "创作界面", "crop=2140:1240:380:66", "展示从预览到时间轴编辑的制作步骤，按画面、声音和字幕分别检查，再播放确认完整内容。"),
    ("独立创作者封面", "用户场景", "crop=1340:650:18:60", "以插画风呈现独立创作者的工作空间，温暖灯光、摄影设备与剪辑屏幕，镜头缓慢平移。"),
    ("分析屏幕构图", "功能灵感", "crop=500:190:355:325,drawbox=x=160:y=0:w=270:h=65:color=0x101f2a:t=fill", "深色屏幕上用清晰线条展示内容表现分析，画面保留对比关系，所有数值由实际采集数据提供。"),
    ("脚本工作区封面", "功能灵感", "crop=1330:650:20:90", "用深色工作区呈现脚本构思过程，镜头从整体桌面推进至分镜结构，突出条理清晰的创作步骤。"),
    ("人物风格封面", "功能灵感", "crop=1340:650:18:90", "用多种人物构图探索口播风格，保持统一光线，选择取得使用权的人物素材并组织自然讲述。"),
    ("剪辑风格封面", "功能灵感", "null", "剪辑师在工作室查看多个分镜，屏幕光与室内暖光平衡，镜头跟随操作从全景移向细节。"),
    ("商家创作封面", "用户场景", "null", "商家在工作台整理商品，摄影器材与实物自然摆放，柔和日光，突出商品细节和创作过程。"),
    ("内容机构封面", "用户场景", "null", "内容团队在摄影棚共同检查素材，摄影机、监视器和人物形成层次，镜头横向移动展示协作。"),
    ("分镜模板封面", "功能灵感", "crop=1330:610:20:120", "用统一的色彩和清晰分镜设计产品内容，分别呈现开箱、使用和细节镜头，保持节奏一致。"),
    ("资料连接封面", "功能灵感", "crop=1240:600:80:130", "用抽象光线与连接节点表现创作资料的整理和检索，深色背景，柔和紫色光，镜头缓慢推进。"),
    ("拍摄设备口播", "人物出镜", "null", "人物手持拍摄设备自然口播，浅色背景，柔和灯光，穿插设备外观和握持方式特写。"),
    ("数码设备口播", "人物出镜", "null", "人物在浅色背景中展示小型数码设备，先面向镜头讲述，再切换到实物细节，光线柔和。"),
    ("简洁产品口播", "人物出镜", "null", "人物在简洁背景前展示小型产品，自然站姿与柔和补光，镜头从中景推进至产品特写。"),
    ("食品包装口播", "人物出镜", "null", "人物在明亮环境中手持食品包装，展示包装和真实食品细节，动作自然，镜头保持稳定。"),
    ("瓶装商品口播", "人物出镜", "null", "人物在暖色室内展示瓶装商品，交替拍摄人物讲述和商品外观，保持自然表情与柔和光线。"),
    ("生活记录自拍", "人物出镜", "null", "人物在明亮室内用手机记录生活，柔和日光与简洁背景，镜头自然移动，突出轻松的生活氛围。"),
    ("日用品细节展示", "人物出镜", "null", "人物展示日用品，前景细节清楚，背景自然虚化，镜头由中景切换到手部和产品细节。"),
    ("护肤商品口播", "人物出镜", "null", "人物在浅灰背景前手持护肤商品，柔和灯光，镜头稳定，先展示瓶身再自然讲述产品信息。"),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--root", required=True)
    args = parser.parse_args()
    archive, root = Path(args.archive), Path(args.root)
    originals = json.loads((archive / "assets.json").read_text())
    assert len(originals) == len(RECIPES) == 35
    output = root / "apps/web/public/inspiration"
    output.mkdir(exist_ok=True)
    catalog = []
    for number, (source, recipe) in enumerate(zip(originals, RECIPES), 1):
        original = archive / source["path"]
        assert hashlib.sha256(original.read_bytes()).hexdigest() == source["sha256"], source["path"]
        title, category, crop, prompt = recipe
        identifier = f"ref-{number:02}"
        image = output / f"{identifier}.webp"
        transform = f"{crop},scale=w='min(1100,iw)':h='min(1100,ih)':force_original_aspect_ratio=decrease,format=yuv420p"
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(original),
                        "-vf", transform, "-frames:v", "1", "-c:v", "libwebp", "-quality", "82", str(image)], check=True)
        info = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "json", str(image)]))["streams"][0]
        catalog.append(dict(id=identifier, title=title, category=category, src=f"/inspiration/{image.name}",
                            width=info["width"], height=info["height"], prompt=prompt,
                            source=source["path"], sourceSha256=source["sha256"],
                            transform=transform, sha256=hashlib.sha256(image.read_bytes()).hexdigest(),
                            bytes=image.stat().st_size, usage="视觉参考；非实际任务结果"))
    (root / "apps/web/src/lib/inspirationAssets.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n")
    print(f"已处理{len(catalog)}张；原件{sum(r['bytes'] for r in originals)}字节；衍生图{sum(r['bytes'] for r in catalog)}字节")


if __name__ == "__main__":
    main()
