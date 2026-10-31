"""构建时优先安装随交付打包的固定公开模型与许可证；运行期不下载。"""
import hashlib
from pathlib import Path
import urllib.request

ROOT = "https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/human_segmentation_pphumanseg/"
MODEL = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/human_segmentation_pphumanseg/human_segmentation_pphumanseg_2023mar.onnx"
EXPECTED = "552d8a984054e59b5d773d24b9b12022b22046ceb2bbc4c9aaeaceb36a9ddf24"
LICENSE_SHA256 = "d9cf3b547fa4232fb9285f2db52e909f10f00781aaf64a6d0bb90c55149f1363"
assets = Path(__file__).with_name("model-assets")
directory = Path("/opt/shopro-models")
directory.mkdir(exist_ok=True)
if (assets / "person.onnx").is_file():
    data = (assets / "person.onnx").read_bytes()
else:
    with urllib.request.urlopen(MODEL, timeout=60) as response:
        data = response.read(6163939)
if len(data) != 6163938 or hashlib.sha256(data).hexdigest() != EXPECTED:
    raise RuntimeError("公开人物分割模型字节或摘要与固定版本不一致")
(directory / "person.onnx").write_bytes(data)
if (assets / "LICENSE").is_file():
    license_bytes = (assets / "LICENSE").read_bytes()
else:
    with urllib.request.urlopen(ROOT + "LICENSE", timeout=30) as response:
        license_bytes = response.read(100000)
if hashlib.sha256(license_bytes).hexdigest() != LICENSE_SHA256:
    raise RuntimeError("人物分割模型许可证摘要与固定版本不一致")
license_text = license_bytes.decode("utf-8")
(directory / "LICENSE").write_text(license_text, encoding="utf-8")
(directory / "NOTICE").write_text(
    "PPHumanSeg, OpenCV Zoo / PaddleHub. Model SHA256: " + EXPECTED + "\n"
    "Copyright (C) 2021 Shenzhen Institute of Artificial Intelligence and Robotics for Society.\n"
    "https://github.com/opencv/opencv_zoo/tree/main/models/human_segmentation_pphumanseg\n",
    encoding="utf-8")
