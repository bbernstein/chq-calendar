import SwiftUI

/// The About sheet, reached from the calendar toolbar. Its job is to carry
/// the unaffiliated disclaimer somewhere a user (and an App Review reviewer)
/// can always find it, plus the version and the legal links.
struct AboutView: View {
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
}
