export function plain(html: string): string {
  return html.replace(/<br\s*\/?\s*>|<\/(?:p|div|li)>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code)
      return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""
    }).split("\n").map(line => line.trim()).filter(Boolean).join("\n")
}
export function block(html: string, tag: string, attribute: RegExp): string | null {
  const opening = new RegExp(`<${tag}\\b[^>]*>`, "gi")
  for (const match of html.matchAll(opening)) {
    if (!attribute.test(match[0])) continue
    const start = match.index! + match[0].length
    const tags = new RegExp(`</?${tag}\\b[^>]*>`, "gi"); tags.lastIndex = start
    let depth = 1, token: RegExpExecArray | null
    while ((token = tags.exec(html))) {
      depth += token[0].startsWith("</") ? -1 : 1
      if (!depth) return html.slice(start, token.index)
    }
    return null
  }
  return null
}
export const classMatch = (name: string) => new RegExp(`class=["'](?:[^"']*\\s)?${name}(?:\\s[^"']*)?["']`, "i")
export function blocks(html: string, tag: string, attribute: RegExp): string[] {
  const result: string[] = []
  for (const match of html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))) {
    if (attribute.test(match[0])) {
      const content = block(html.slice(match.index!), tag, attribute)
      if (content !== null) result.push(content)
    }
  }
  return result
}
