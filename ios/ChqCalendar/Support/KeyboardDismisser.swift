import UIKit

/// Resigns first responder app-wide, putting the keyboard away while
/// leaving the search field and its text intact.
///
/// Deliberately *not* the `dismissSearch` environment action: that tears
/// down the whole search interaction and clears the term. We want the
/// opposite — the search stays applied, the keyboard just stops covering
/// the filter bar.
///
/// A UIKit escape hatch because `@FocusState` cannot be bound to the
/// system `.searchable` field. Confined to `Support/` and called only from
/// views, so `AppModel` and `Domain/` stay UIKit-free and host-free in
/// tests.
@MainActor
enum KeyboardDismisser {
    static func dismiss() {
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil
        )
    }
}
