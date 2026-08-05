import SwiftUI

/// Full detail screen for a single event: hero image (when present), title
/// with cancellation/reschedule badge, labeled metadata rows, description,
/// category chips, related Chautauquan Daily article links, and actions
/// (favorite, share, add to calendar, open on chq.org).
struct EventDetailView: View {
    let event: Event
    let model: AppModel

    @Environment(\.openURL) private var openURL
    @State private var isAddToCalendarPresented = false

    private var isFavorite: Bool { model.favorites.contains(event.id) }
    private var articleLinks: [ArticleLink] { model.articleLinks(for: event.id) }
    private var visibleCategories: [String] {
        event.categoryNames.filter { !$0.hasPrefix("Week ") }
    }

    var body: some View {
        ScrollViewReader { scrollProxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                if let imageURL = event.imageURL {
                    heroImage(imageURL)
                }

                VStack(alignment: .leading, spacing: 12) {
                    titleSection

                    VStack(alignment: .leading, spacing: 10) {
                        detailRow(icon: "clock") {
                            Text(timeRangeText)
                        }

                        if event.displayLocation != nil || event.venueAddress != nil {
                            detailRow(icon: "mappin.and.ellipse") {
                                VStack(alignment: .leading, spacing: 2) {
                                    if let location = event.displayLocation {
                                        Text(DisplayNames.location(location))
                                    }
                                    if let address = event.venueAddress {
                                        Text(address)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }

                        if let presenter = event.presenter {
                            detailRow(icon: "person") {
                                Text(presenter)
                            }
                        }

                        if let cost = event.cost {
                            detailRow(icon: "ticket") {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(cost)
                                    if GatePassPolicy.includesGeneralAdmission(event) {
                                        Text("General admission included with a Gate Pass")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }

                    if !visibleCategories.isEmpty {
                        categoryChips
                    }

                    if let details = event.details, !details.isEmpty {
                        descriptionSection(details)
                    }

                    if !articleLinks.isEmpty {
                        articleLinksSection
                            .id(Self.articleLinksAnchor)
                    }

                    actionButtons
                }
                .padding(.horizontal)
            }
            .padding(.bottom, 24)
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent }
        .sheet(isPresented: $isAddToCalendarPresented) {
            AddToCalendarView(event: event)
        }
        #if DEBUG
        // MARK: UI-test hooks (DEBUG only)
        // Consumes the flag `CalendarView.applyUITestHooks` sets for
        // `-uitest-show-add-to-calendar`. Both `onAppear` and `onChange` are
        // wired so this fires regardless of whether the flag flips before or
        // after this view mounts. Separately, `-uitest-scroll-to-articles` (used
        // alongside `-uitest-select-linked-event`) scrolls to the
        // article-links section after a brief settle delay — `xcrun simctl`
        // can't synthesize the swipe a real verification pass would use, so
        // this is what makes that section's live rendering
        // screenshot-checkable. It's a separate launch argument (rather than
        // firing for every linked-event launch) so a plain
        // `-uitest-select-linked-event` launch still lands at the top of the
        // detail view. Compiles out of Release builds entirely.
        .onAppear(perform: presentAddToCalendarIfNeeded)
        .onChange(of: model.uiTestShowAddToCalendar) { _, _ in presentAddToCalendarIfNeeded() }
        .task {
            guard isUITestScrollingToArticles, !articleLinks.isEmpty else { return }
            try? await Task.sleep(for: .milliseconds(600))
            withAnimation { scrollProxy.scrollTo(Self.articleLinksAnchor, anchor: .top) }
        }
        #endif
        }
    }

    /// Anchor id for `articleLinksSection`, used by the DEBUG-only
    /// auto-scroll hook below (`isUITestScrollingToArticles`) — declared
    /// unconditionally since it's referenced from the always-compiled
    /// `.id(Self.articleLinksAnchor)` in `body`.
    private static let articleLinksAnchor = "article-links"

    #if DEBUG
    private var isUITestScrollingToArticles: Bool {
        ProcessInfo.processInfo.arguments.contains("-uitest-scroll-to-articles")
    }

    private func presentAddToCalendarIfNeeded() {
        if model.uiTestShowAddToCalendar {
            model.uiTestShowAddToCalendar = false
            isAddToCalendarPresented = true
        }
    }
    #endif

    // MARK: - Sections

    private func heroImage(_ url: URL) -> some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                image
                    .resizable()
                    .scaledToFill()
            case .failure:
                imageFailurePlaceholder
            case .empty:
                ProgressView()
                    .frame(maxWidth: .infinity)
            @unknown default:
                imageFailurePlaceholder
            }
        }
        .frame(maxWidth: .infinity, maxHeight: 220)
        .clipped()
    }

    /// Shown when `AsyncImage` finishes with `.failure` (broken/404 URL,
    /// decode error) — a static placeholder so the row reads as "finished,
    /// no image" rather than hanging on an indefinite spinner.
    private var imageFailurePlaceholder: some View {
        Rectangle()
            .fill(.quaternary)
            .overlay {
                Image(systemName: "photo")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
            }
    }

    private var titleSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(event.title)
                .font(.largeTitle.bold())
                .strikethrough(event.status == .cancelled)
                .foregroundStyle(event.status == .cancelled ? .secondary : .primary)

            statusBadge
        }
    }

    @ViewBuilder
    private var statusBadge: some View {
        switch event.status {
        case .cancelled:
            badge("Cancelled", color: .red)
        case .rescheduled:
            badge("Rescheduled", color: .orange)
        case .scheduled:
            EmptyView()
        }
    }

    private func badge(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color, in: Capsule())
    }

    private var categoryChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(visibleCategories, id: \.self) { category in
                    Text(DisplayNames.category(category))
                        .font(.caption.weight(.medium))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(.secondary.opacity(0.15), in: Capsule())
                }
            }
        }
    }

    private func descriptionSection(_ details: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(paragraphs(of: details).enumerated()), id: \.offset) { _, paragraph in
                Text(paragraph)
                    .font(.body)
                    .textSelection(.enabled)
            }
        }
    }

    private var articleLinksSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("In the Chautauquan Daily")
                .font(.headline)

            VStack(alignment: .leading, spacing: 12) {
                ForEach(articleLinks, id: \.url) { link in
                    Link(destination: link.url) {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: "newspaper")
                                .foregroundStyle(.secondary)
                                .frame(width: 24)

                            VStack(alignment: .leading, spacing: 2) {
                                Text(link.title)
                                    .font(.body)
                                    .foregroundStyle(.primary)
                                    .multilineTextAlignment(.leading)
                                Text("\(link.kind.rawValue) · \(formattedPubDate(link.pubDate))")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            Spacer(minLength: 0)
                        }
                    }
                }
            }
        }
    }

    private var actionButtons: some View {
        VStack(spacing: 10) {
            Button {
                isAddToCalendarPresented = true
            } label: {
                Label("Add to Calendar", systemImage: "calendar.badge.plus")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)

            if let pageURL = event.pageURL {
                Button {
                    openURL(pageURL)
                } label: {
                    Text("Open on chq.org")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(.top, 8)
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                model.toggleFavorite(event.id)
            } label: {
                Image(systemName: isFavorite ? "star.fill" : "star")
                    .foregroundStyle(isFavorite ? .yellow : .primary)
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            ShareLink(item: event.pageURL ?? Self.fallbackShareURL)
        }
    }

    // MARK: - Formatting helpers

    private var timeRangeText: String {
        let day = ChqTime.dayTitle(for: event.start)
        let startTime = ChqTime.timeString(for: event.start)
        if event.end == event.start {
            return "\(day) · \(startTime)"
        }
        let endTime = ChqTime.timeString(for: event.end)
        return "\(day) · \(startTime) – \(endTime)"
    }

    private func paragraphs(of details: String) -> [String] {
        details
            .components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    private static let fallbackShareURL = URL(string: "https://www.chqcal.org")!

    private static let pubDateInputFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = ChqTime.zone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let pubDateOutputFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = ChqTime.zone
        formatter.dateFormat = "MMM d"
        return formatter
    }()

    private func formattedPubDate(_ raw: String) -> String {
        guard let date = Self.pubDateInputFormatter.date(from: raw) else { return raw }
        return Self.pubDateOutputFormatter.string(from: date)
    }

    @ViewBuilder
    private func detailRow<Content: View>(
        icon: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(.secondary)
                .frame(width: 24)
            content()
            Spacer(minLength: 0)
        }
    }
}
