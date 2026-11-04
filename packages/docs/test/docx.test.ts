import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractDocxText, isZip } from "../src";

/** 手工拼一个最小的 docx（zip + word/document.xml），不依赖任何 Word 生成库 */
async function makeDocx(bodyXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${bodyXml}</w:body></w:document>`);
  return zip.generateAsync({ type: "uint8array" });
}

const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;

describe("extractDocxText", () => {
  it("段落换行；表格单元格以制表符分隔；实体被还原", async () => {
    const body =
      p("一、提单要求") +
      p("提单须注明 &quot;FREIGHT PREPAID&quot; &amp; 清洁") +
      `<w:tbl><w:tr><w:tc>${p("项目")}</w:tc><w:tc>${p("要求")}</w:tc></w:tr><w:tr><w:tc>${p("发票")}</w:tc><w:tc>${p("须含合同号 &#x4E2D;&#25991;")}</w:tc></w:tr></w:tbl>`;
    const r = await extractDocxText(await makeDocx(body));
    expect(r.kind).toBe("docx");
    expect(r.text.split("\n")).toEqual(["一、提单要求", '提单须注明 "FREIGHT PREPAID" & 清洁', "项目\t要求", "发票\t须含合同号 中文"]);
    expect(r.chars).toBeGreaterThan(20);
    expect(r.needsOcr).toBe(false);
  });

  it("软换行与制表符", async () => {
    const r = await extractDocxText(await makeDocx('<w:p><w:r><w:t>A</w:t><w:br/><w:t>B</w:t><w:tab/><w:t>C</w:t></w:r></w:p>'));
    expect(r.text).toBe("A\nB\tC");
  });

  it("不会把标签当文字，也不会展开外部实体", async () => {
    const r = await extractDocxText(await makeDocx(p("x &xxe; &#0; &#xFFFFFFFF; end")));
    expect(r.text).toBe("x &xxe; &#0; &#xFFFFFFFF; end"); // 未知/非法实体原样保留
  });

  it("损坏文件、不是 Word 的 zip、空文档给出明确错误", async () => {
    await expect(extractDocxText(new TextEncoder().encode("not a zip"))).rejects.toMatchObject({ code: "doc.docxInvalid" });
    const other = new JSZip();
    other.file("hello.txt", "hi");
    await expect(extractDocxText(await other.generateAsync({ type: "uint8array" }))).rejects.toMatchObject({ code: "doc.docxInvalid" });
    await expect(extractDocxText(await makeDocx("<w:p></w:p>"))).rejects.toMatchObject({ code: "doc.empty" });
  });

  it("isZip 按文件头判断", async () => {
    expect(isZip(await makeDocx(p("a")))).toBe(true);
    expect(isZip(new TextEncoder().encode("%PDF-1.7"))).toBe(false);
  });
});
