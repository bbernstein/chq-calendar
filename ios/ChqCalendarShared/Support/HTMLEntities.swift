import Foundation

nonisolated extension String {
    /// Decodes HTML entities that appear in WordPress-sourced event titles,
    /// locations, and descriptions: the common named entities (`&amp;`,
    /// `&lt;`, `&gt;`, `&quot;`, `&nbsp;`) plus any numeric character
    /// reference (`&#8217;`, `&#038;`, `&#x2019;`, ...).
    var decodingHTMLEntities: String {
        guard contains("&") else { return self }

        let namedEntities: [String: Character] = [
            "&amp;": "&",
            "&lt;": "<",
            "&gt;": ">",
            "&quot;": "\"",
            "&nbsp;": "\u{00A0}",
        ]

        var result = ""
        var remainder = Substring(self)

        while let ampersandIndex = remainder.firstIndex(of: "&") {
            result += remainder[remainder.startIndex..<ampersandIndex]

            guard let semicolonIndex = remainder[ampersandIndex...].firstIndex(of: ";") else {
                // No closing ';' — not a well-formed entity; emit the rest as-is.
                result += remainder[ampersandIndex...]
                remainder = remainder[remainder.endIndex...]
                break
            }

            let entity = remainder[ampersandIndex...semicolonIndex]
            if let namedChar = namedEntities[String(entity)] {
                result.append(namedChar)
            } else if entity.hasPrefix("&#"), let scalar = Self.numericScalar(for: entity) {
                result.append(Character(scalar))
            } else {
                // Unknown entity — leave untouched rather than mangling it.
                result += entity
            }

            remainder = remainder[remainder.index(after: semicolonIndex)...]
        }

        result += remainder
        return result
    }

    /// Parses a numeric character reference like `&#8217;` or `&#x2019;`
    /// (including the surrounding `&#...;`) into its Unicode scalar.
    private static func numericScalar(for entity: Substring) -> Unicode.Scalar? {
        var digits = entity.dropFirst(2).dropLast() // strip "&#" and ";"
        var radix = 10
        if digits.first == "x" || digits.first == "X" {
            radix = 16
            digits = digits.dropFirst()
        }
        guard let code = UInt32(digits, radix: radix) else { return nil }
        return Unicode.Scalar(code)
    }
}
