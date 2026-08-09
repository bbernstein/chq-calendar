import AppIntents
import SwiftUI

/// The About sheet, reached from the calendar toolbar. Its job is to carry
/// the unaffiliated disclaimer somewhere a user (and an App Review reviewer)
/// can always find it, plus the version and the legal links.
struct AboutView: View {
    let model: AppModel

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("CHQ Calendar")
                            .font(.headline)
                        Text(AboutInfo.versionString())
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }

                Section {
                    Text(AboutInfo.disclaimer)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section {
                    SiriTipView(intent: NextEventsIntent())
                    ForEach(AboutInfo.siriPhrases) { item in
                        Text("“\(item.phrase)”")
                            .font(.callout)
                    }
                    ShortcutsLink()
                } header: {
                    Text("Ask Siri")
                } footer: {
                    Text("Siri also understands “CHQ” and “CHQ Calendar” as the app's name.")
                }

                Section {
                    Picker("Default reminder", selection: defaultReminderPresetBinding) {
                        ForEach(ReminderPreset.allCases, id: \.rawValue) { preset in
                            Text(preset.label).tag(preset)
                        }
                    }
                } header: {
                    Text("Reminders")
                } footer: {
                    Text("Applies to events you star from now on.")
                }

                Section {
                    ForEach(AboutInfo.links) { link in
                        SwiftUI.Link(destination: link.url) {
                            HStack {
                                Text(link.title)
                                Spacer()
                                Image(systemName: "arrow.up.right.square")
                                    .foregroundStyle(.tertiary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("About")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    /// Reads/writes `model.reminderSettings.defaultPreset` through
    /// `setDefaultReminderPreset`, which both persists the change and
    /// re-syncs `reminderCenter` — a plain `Binding` over the stored
    /// property alone would persist nothing.
    private var defaultReminderPresetBinding: Binding<ReminderPreset> {
        Binding(
            get: { model.reminderSettings.defaultPreset },
            set: { model.setDefaultReminderPreset($0) }
        )
    }
}
