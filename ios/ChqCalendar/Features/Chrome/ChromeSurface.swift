import SwiftUI

/// The one place the app's floating-chrome material and shape are defined.
///
/// Liquid Glass (`glassEffect`, `GlassEffectContainer`) is an iOS 26 API and
/// this app's deployment target is 18.0, so chrome ships on
/// `.regularMaterial` in a capsule. That is a temporary state, and this
/// modifier exists so it is a *cheap* temporary state: when the floor moves
/// to 26, glass is adopted by editing this function behind an `@available`
/// check, and not one call site changes.
///
/// Nothing else in the app should reach for a chrome material directly.
extension View {
    func chromeSurface() -> some View {
        self
            .background(.regularMaterial, in: Capsule())
            .overlay(
                Capsule().strokeBorder(.separator.opacity(0.6), lineWidth: 0.5))
            .shadow(color: .black.opacity(0.14), radius: 10, y: 4)
    }
}
