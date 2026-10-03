const levels = (format: 'bullet' | 'decimal'): string => [0, 1, 2].map((level) => {
  const marker = format === 'bullet' ? ['•', '◦', '▪'][level] : `%${level + 1}.`;
  return `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${marker}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="${720 + level * 360}"/></w:tabs><w:ind w:left="${720 + level * 360}" w:hanging="360"/></w:pPr></w:lvl>`;
}).join('');

export const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="multilevel"/>${levels('bullet')}</w:abstractNum>
  <w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="multilevel"/>${levels('decimal')}</w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>`;
