"""测试用OOXML检查器：只读ZIP/XML，不执行表格公式或外部引用。"""
import io
import json
import sys
import xml.etree.ElementTree as ET
import zipfile


def read_workbook(data):
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    relation = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        links = {node.attrib["Id"]: node.attrib["Target"] for node in
                 ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = ["".join(node.itertext()) for node in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
        sheets = {}
        for sheet in workbook.findall("s:sheets/s:sheet", ns):
            path = links[sheet.attrib[relation]]
            path = path.lstrip("/") if path.startswith("/") else "xl/" + path
            root = ET.fromstring(archive.read(path))
            rows = []
            for row in root.findall("s:sheetData/s:row", ns):
                cells = []
                for cell in row.findall("s:c", ns):
                    if cell.find("s:f", ns) is not None:
                        raise ValueError("导出包含公式")
                    column = 0
                    for char in cell.attrib["r"]:
                        if not char.isalpha():
                            break
                        column = column * 26 + ord(char) - 64
                    while len(cells) < column:
                        cells.append(None)
                    kind = cell.attrib.get("t")
                    raw = cell.findtext("s:v", None, ns)
                    value = raw
                    if kind == "inlineStr":
                        value = "".join(node.text or "" for node in cell.findall(".//s:t", ns))
                    elif kind == "s":
                        value = shared[int(raw)]
                    elif kind == "b":
                        value = raw == "1"
                    elif raw is not None and kind not in ("str", "e"):
                        value = float(raw)
                    cells[column - 1] = value
                rows.append(cells)
            sheets[sheet.attrib["name"]] = rows
        return sheets


if __name__ == "__main__":
    print(json.dumps(read_workbook(sys.stdin.buffer.read()), ensure_ascii=False))
