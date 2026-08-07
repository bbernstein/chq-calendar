import MapKit
import SwiftUI

/// The grounds map (#182): every `VenueAtlas` building plotted as a marker
/// over the Chautauqua grounds, with a tap-to-select sheet showing what's
/// coming up there.
///
/// **No user-location APIs anywhere in this file** (App Store 4.2
/// resubmission constraint) — no CoreLocation import, no user-location dot,
/// no "center on me" control. The map is centered on the grounds by
/// default and recentered only by an explicit venue selection (a marker tap
/// or a `chqcal://map/<venue>` deep link/`EventDetailView` "Show on Map").
/// `CLLocationCoordinate2D`/`MKCoordinateRegion` below come from `MapKit`,
/// which this view needs anyway to render the map itself — they carry no
/// location-*services* dependency on their own.
struct GroundsMapView: View {
    @Bindable var model: AppModel

    /// Switches the tab shell to the Events tab — "Show all events here"
    /// applies the venue filter, then hands off here so the user actually
    /// sees the filtered list. Mirrors `MyDayView.switchToEvents`; `RootTabView`
    /// supplies the real implementation the same way it does there.
    var switchToEvents: () -> Void = {}

    /// `RootTabView`'s `selectedTab`, threaded down read-only (task 18, fix
    /// round 1). `.sheet` is a window-level presentation, not scoped to
    /// whichever tab is visually frontmost — and because the `TabView` keeps
    /// every tab's content alive across switches (task 16), `selectedVenueID`
    /// below survives a tab switch too, so without this the venue sheet keeps
    /// floating over whatever tab (or pushed detail view) the user lands on
    /// next, reachable via any of the several ways `RootTabView` changes
    /// `selectedTab` without a tap ever reaching this view's sheet UI at all
    /// (a `chqcal://` deep link, a notification tap, a widget, an App
    /// Intent, Spotlight) — see `onChange(of: selectedTab)` below, which is
    /// what actually clears it.
    var selectedTab: AppTab

    @State private var cameraPosition: MapCameraPosition = .region(Self.region(center: VenueAtlas.groundsCenter, spanMeters: 1200))
    @State private var selectedVenueID: String?

    private var selectedVenue: VenueLocation? {
        guard let selectedVenueID else { return nil }
        return VenueAtlas.all.first { $0.id == selectedVenueID }
    }

    var body: some View {
        Map(position: $cameraPosition, selection: $selectedVenueID) {
            ForEach(VenueAtlas.all) { venue in
                Marker(venue.name, coordinate: venue.coordinate)
                    .tag(venue.id)
            }
        }
        .mapControls {
            MapCompass()
            MapScaleView()
        }
        .sheet(isPresented: isSheetPresented) {
            if let selectedVenue {
                venueSheet(for: selectedVenue)
                    .presentationDetents([.height(220), .medium])
                    .presentationBackgroundInteraction(.enabled)
                    .presentationDragIndicator(.visible)
            }
        }
        .task { focusOnPendingVenueIfNeeded() }
        .onChange(of: model.mapFocusVenue) { _, _ in focusOnPendingVenueIfNeeded() }
        // Fix round 1 (task 18 review): leaving the Map tab by any route —
        // not just "Show all events here" — must dismiss this sheet too.
        // Empirically confirmed via a `chqcal://` deep link switch while the
        // sheet was open: without this, the sheet kept floating over the
        // newly selected tab's content (even over a pushed
        // `EventDetailView`), because `selectedVenueID` is `@State` here and
        // this view is never torn down by the tab switch itself.
        .onChange(of: selectedTab) { _, newTab in
            guard newTab != .map else { return }
            selectedVenueID = nil
        }
    }

    // MARK: - Sheet presentation

    /// Bridges the `String?` marker-selection binding `Map` needs to a
    /// plain `Bool` for `.sheet(isPresented:)`. Setting it to `false` (a
    /// swipe-to-dismiss) clears `selectedVenueID` too, so the marker
    /// deselects along with the sheet rather than staying highlighted with
    /// nothing shown for it.
    private var isSheetPresented: Binding<Bool> {
        Binding(
            get: { selectedVenueID != nil },
            set: { isPresented in
                if !isPresented { selectedVenueID = nil }
            })
    }

    @ViewBuilder
    private func venueSheet(for venue: VenueLocation) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(venue.name)
                .font(.title3.bold())

            let upcoming = MapVenueEvents.upcomingEvents(
                at: venue, events: model.snapshot?.events ?? [], now: model.now(), limit: 3)

            if upcoming.isEmpty {
                Text("No upcoming events here.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(upcoming) { event in
                        upcomingEventRow(event)
                    }
                }
            }

            Spacer(minLength: 0)

            HStack(spacing: 12) {
                Button("Show all events here") {
                    model.selectVenueExclusively(venue)
                    selectedVenueID = nil
                    switchToEvents()
                }
                .buttonStyle(.bordered)

                if let directionsURL = Self.walkingDirectionsURL(to: venue) {
                    Link(destination: directionsURL) {
                        Label("Walking Directions", systemImage: "figure.walk")
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        }
        .padding()
    }

    private func upcomingEventRow(_ event: Event) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 0) {
                // The day label (not just the time) matters here because a
                // recurring series like a weekly discussion hosted at the
                // same venue and time every week — e.g. "CHQ Dialogues" at
                // Episcopal Cottage, Fridays at 3:30 PM — would otherwise
                // show as what looks like the same event duplicated three
                // times in this limit-3 list, with nothing to tell the three
                // Fridays apart.
                Text(ChqTime.compactDayLabel(for: event.start))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(ChqTime.timeString(for: event.start))
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
            }
            .frame(width: 64, alignment: .leading)
            Text(event.title)
                .font(.subheadline)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
    }

    // MARK: - Deep-link / detail-view focus

    /// Consumes `model.mapFocusVenue` (set by `RootTabView`'s deep-link
    /// routing, or by `EventDetailView`'s "Show on Map" via
    /// `pendingDeepLink = .map(venue:)`): resolves it against `VenueAtlas`,
    /// centers the camera and selects that marker, then always clears the
    /// field back to `nil` — including when the venue string doesn't
    /// resolve, so an unrecognized venue quietly leaves the map at whatever
    /// it was already showing instead of leaving a stale request queued.
    private func focusOnPendingVenueIfNeeded() {
        guard let requested = model.mapFocusVenue else { return }
        defer { model.mapFocusVenue = nil }
        guard let venue = VenueAtlas.location(for: requested) else { return }
        selectedVenueID = venue.id
        withAnimation {
            cameraPosition = .region(Self.region(center: (venue.latitude, venue.longitude), spanMeters: 700))
        }
    }

    // MARK: - Geometry helpers

    private static func region(center: (latitude: Double, longitude: Double), spanMeters: Double) -> MKCoordinateRegion {
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: center.latitude, longitude: center.longitude),
            latitudinalMeters: spanMeters,
            longitudinalMeters: spanMeters)
    }

    /// `https://maps.apple.com/?daddr=<lat>,<lon>&dirflg=w` — opens Apple
    /// Maps with walking (`w`) directions to `venue`, with no origin
    /// (`saddr`) specified. Apple Maps fills the origin in from wherever it
    /// has permission to determine the user's location itself; this app
    /// never asks for or reads that location, so there is nothing for this
    /// link to pass along even if it wanted to.
    private static func walkingDirectionsURL(to venue: VenueLocation) -> URL? {
        URL(string: "https://maps.apple.com/?daddr=\(venue.latitude),\(venue.longitude)&dirflg=w")
    }
}

private extension VenueLocation {
    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}
