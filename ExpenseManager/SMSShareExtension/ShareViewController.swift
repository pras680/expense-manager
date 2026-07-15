import Social
import UniformTypeIdentifiers
import UIKit

final class ShareViewController: SLComposeServiceViewController {
    private let textType = UTType.text.identifier
    private let plainTextType = UTType.plainText.identifier
    private let urlType = UTType.url.identifier
    private let fallbackTextFileType = "public.text"
    private let maxSharedTextCharacters = 8_000
    private var didStartImport = false

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        beginImportIfNeeded()
    }

    override func isContentValid() -> Bool {
        true
    }

    override func didSelectPost() {
        beginImportIfNeeded()
    }

    override func configurationItems() -> [Any]! {
        []
    }

    private func beginImportIfNeeded() {
        guard !didStartImport else { return }
        didStartImport = true
        Task { await importSharedContent() }
    }

    @MainActor
    private func importSharedContent() async {
        let extensionItems = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let sharedText = await extractSharedText(from: extensionItems)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !sharedText.isEmpty else {
            extensionContext?.completeRequest(returningItems: nil)
            return
        }

        openMainApp(with: clippedSharedText(sharedText))
    }

    private func extractSharedText(from items: [NSExtensionItem]) async -> String {
        var fragments: [String] = []

        for item in items {
            if let attributedText = item.attributedContentText?.string.trimmingCharacters(in: .whitespacesAndNewlines), !attributedText.isEmpty {
                fragments.append(attributedText)
            }

            for provider in item.attachments ?? [] {
                if let text = await loadString(from: provider, typeIdentifiers: [plainTextType, textType, fallbackTextFileType]) {
                    fragments.append(text)
                    continue
                }

                if let url = await loadURLString(from: provider) {
                    fragments.append(url)
                }
            }
        }

        if fragments.isEmpty, let composeText = contentText?.trimmingCharacters(in: .whitespacesAndNewlines), !composeText.isEmpty {
            fragments.append(composeText)
        }

        return fragments.joined(separator: "\n\n")
    }

    private func loadString(from provider: NSItemProvider, typeIdentifiers: [String]) async -> String? {
        for typeIdentifier in typeIdentifiers where provider.hasItemConformingToTypeIdentifier(typeIdentifier) {
            do {
                let item = try await provider.loadItem(forTypeIdentifier: typeIdentifier)
                if let text = item as? String {
                    return text
                }
                if let data = item as? Data, let text = String(data: data, encoding: .utf8) {
                    return text
                }
                if let url = item as? URL {
                    return try? String(contentsOf: url, encoding: .utf8)
                }
            } catch {
                debugLog("SMS share text load failed.")
            }
        }
        return nil
    }

    private func loadURLString(from provider: NSItemProvider) async -> String? {
        guard provider.hasItemConformingToTypeIdentifier(urlType) else { return nil }

        do {
            let item = try await provider.loadItem(forTypeIdentifier: urlType)
            if let url = item as? URL {
                return url.host ?? url.lastPathComponent
            }
            if let text = item as? String, let url = URL(string: text), url.scheme != nil {
                return url.host ?? url.lastPathComponent
            }
            if let text = item as? String {
                return text
            }
        } catch {
            debugLog("SMS share URL load failed.")
        }
        return nil
    }

    private func clippedSharedText(_ text: String) -> String {
        String(text.prefix(maxSharedTextCharacters))
    }

    private func debugLog(_ message: @autoclosure () -> String) {
        #if DEBUG
        print("DEBUG: \(message())")
        #endif
    }

    @MainActor
    private func openMainApp(with text: String) {
        var components = URLComponents()
        components.scheme = "expensemanager"
        components.host = "import-sms"
        components.queryItems = [URLQueryItem(name: "text", value: text)]

        guard let url = components.url else {
            extensionContext?.completeRequest(returningItems: nil)
            return
        }

        extensionContext?.open(url) { [weak self] didOpen in
            guard let self else { return }
            DispatchQueue.main.async {
                if !didOpen {
                    self.openURLThroughResponderChain(url)
                }
                self.extensionContext?.completeRequest(returningItems: nil)
            }
        }
    }

    @MainActor
    private func openURLThroughResponderChain(_ url: URL) {
        var responder: UIResponder? = self
        while let currentResponder = responder {
            if let application = currentResponder as? UIApplication {
                application.open(url)
                return
            }
            responder = currentResponder.next
        }
    }
}
