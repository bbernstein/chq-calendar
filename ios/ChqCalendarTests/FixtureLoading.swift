import Foundation

/// Anchor class used solely to locate the test bundle so fixture JSON files
/// (added under `Fixtures/`) can be loaded by name.
final class FixtureToken {}

/// Loads a JSON fixture file (without extension) from the test bundle's
/// `Fixtures/` resources, added automatically via the synchronized test
/// target folder.
func fixtureData(_ name: String) -> Data {
    guard let url = Bundle(for: FixtureToken.self).url(forResource: name, withExtension: "json") else {
        fatalError("Missing fixture: \(name).json")
    }
    guard let data = try? Data(contentsOf: url) else {
        fatalError("Unable to read fixture: \(name).json")
    }
    return data
}
