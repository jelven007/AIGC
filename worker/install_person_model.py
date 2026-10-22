"""镜像构建时获取公开模型并验证固定字节摘要；运行期不下载模型。"""
import hashlib
from pathlib import Path
import urllib.request

ROOT = "https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/human_segmentation_pphumanseg/"
MODEL = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/human_segmentation_pphumanseg/human_segmentation_pphumanseg_2023mar.onnx"
EXPECTED = "552d8a984054e59b5d773d24b9b12022b22046ceb2bbc4c9aaeaceb36a9ddf24"
directory = Path("/opt/shopro-models")
directory.mkdir(exist_ok=True)
with urllib.request.urlopen(MODEL, timeout=60) as response:
    data = response.read(6163939)
if len(data) != 6163938 or hashlib.sha256(data).hexdigest() != EXPECTED:
    raise RuntimeError("公开人物分割模型字节或摘要与固定版本不一致")
(directory / "person.onnx").write_bytes(data)
with urllib.request.urlopen(ROOT + "LICENSE", timeout=30) as response:
    license_text = response.read(100000).decode("utf-8")
if "Apache License" not in license_text or "2.0" not in license_text:
    raise RuntimeError("人物分割模型许可证未获取")
(directory / "LICENSE").write_text(license_text, encoding="utf-8")
(directory / "NOTICE").write_text(
    "PPHumanSeg, OpenCV Zoo / PaddleHub. Model SHA256: " + EXPECTED + "\n"
    "Copyright (C) 2021 Shenzhen Institute of Artificial Intelligence and Robotics for Society.\n"
    "https://github.com/opencv/opencv_zoo/tree/main/models/human_segmentation_pphumanseg\n",
    encoding="utf-8")
