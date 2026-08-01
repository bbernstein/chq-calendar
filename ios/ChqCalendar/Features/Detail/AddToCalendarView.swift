import EventKit
import EventKitUI
import SwiftUI
import UIKit

/// Sheet content that requests write-only Calendar access before presenting
/// the system event-edit UI. Owns the single `EKEventStore` used both for
/// the access request and the `EKEventEditViewController` — EventKit
/// requires the same store instance for both, or the controller won't see
/// the access that was just granted.
struct AddToCalendarView: View {
    let event: Event

    @Environment(\.dismiss) private var dismiss
    @State private var store = EKEventStore()
    @State private var authorization: Authorization = .checking

    private enum Authorization {
        case checking
        case granted
        case denied
    }

    var body: some View {
        Group {
            switch authorization {
            case .checking:
                ProgressView("Requesting calendar access…")
            case .granted:
                EventEditControllerRepresentable(event: event, store: store, onFinish: { dismiss() })
                    .ignoresSafeArea()
            case .denied:
                deniedView
            }
        }
        .task {
            await requestAccess()
        }
    }

    private var deniedView: some View {
        VStack(spacing: 16) {
            Image(systemName: "calendar.badge.exclamationmark")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text("Calendar access is off — enable it in Settings")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal)
            if let settingsURL = URL(string: UIApplication.openSettingsURLString) {
                Link("Open Settings", destination: settingsURL)
            }
            Button("Cancel") { dismiss() }
                .padding(.top, 4)
        }
        .padding()
    }

    private func requestAccess() async {
        do {
            let granted = try await store.requestWriteOnlyAccessToEvents()
            authorization = granted ? .granted : .denied
        } catch {
            authorization = .denied
        }
    }
}

/// `UIViewControllerRepresentable` wrapping `EKEventEditViewController`,
/// prefilled from `event`. The delegate dismisses the sheet (via
/// `onFinish`) once the user saves, cancels, or deletes.
private struct EventEditControllerRepresentable: UIViewControllerRepresentable {
    let event: Event
    let store: EKEventStore
    let onFinish: () -> Void

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let controller = EKEventEditViewController()
        controller.eventStore = store
        controller.event = makeEKEvent()
        controller.editViewDelegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: EKEventEditViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onFinish: onFinish)
    }

    private func makeEKEvent() -> EKEvent {
        let ekEvent = EKEvent(eventStore: store)
        ekEvent.title = event.title
        ekEvent.startDate = event.start
        ekEvent.endDate = event.end == event.start ? event.start.addingTimeInterval(3600) : event.end
        ekEvent.timeZone = ChqTime.zone
        ekEvent.location = event.displayLocation

        var notes = event.details ?? ""
        if let pageURL = event.pageURL {
            if !notes.isEmpty {
                notes += "\n\n"
            }
            notes += pageURL.absoluteString
        }
        ekEvent.notes = notes.isEmpty ? nil : notes

        return ekEvent
    }

    final class Coordinator: NSObject, EKEventEditViewDelegate {
        let onFinish: () -> Void

        init(onFinish: @escaping () -> Void) {
            self.onFinish = onFinish
        }

        func eventEditViewController(
            _ controller: EKEventEditViewController,
            didCompleteWith action: EKEventEditViewAction
        ) {
            controller.dismiss(animated: true) {
                self.onFinish()
            }
        }
    }
}
