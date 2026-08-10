import SwiftUI

/// Places subviews left-to-right, wrapping to a new line when the next one
/// would overflow the proposed width.
///
/// Used by the expanded facet panels. `LazyVGrid` is the obvious
/// alternative but sizes every cell to the widest column, and these chips
/// range from "CSO" to "Chautauqua Theater Company" — most of each row
/// would be empty.
///
/// Both passes size subviews against the *container* width rather than
/// `.unspecified`, and they must keep doing so. `.unspecified` hands a
/// chip every point it asks for, so its `lineLimit(1)` `Text` never
/// truncates: a name like "AAHH African American Heritage House" at an
/// accessibility type size runs past the container and is hard-clipped by
/// the enclosing vertical `ScrollView` — cut mid-word, no ellipsis, no
/// horizontal scroll to recover it. Proposing the container width makes
/// the chip truncate inside itself instead. The two passes must also stay
/// consistent with each other; that is what keeps chips from overlapping.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(
        proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(ProposedViewSize(width: maxWidth, height: nil))
            if x > 0 && x + size.width > maxWidth {
                totalHeight += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }

        return CGSize(
            // `x` carries a trailing `+ spacing` from the last subview, so
            // the unconstrained width has to give it back.
            width: maxWidth == .infinity ? max(0, x - spacing) : maxWidth,
            height: totalHeight + rowHeight
        )
    }

    func placeSubviews(
        in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX && x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(
                at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
