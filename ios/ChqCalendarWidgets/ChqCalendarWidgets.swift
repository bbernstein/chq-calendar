import SwiftUI
import WidgetKit

/// The extension's single entry point: both real widgets shipped for #179.
/// See `NextUpWidget.swift`/`StarredWidget.swift` for their configurations
/// and `WidgetDataSource.swift` for the shared cache-reading logic behind
/// both.
@main
struct ChqCalendarWidgetBundle: WidgetBundle {
    var body: some Widget {
        NextUpWidget()
        StarredWidget()
    }
}
