// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import Cocoa

// The extension that puts XCIII in the system's «Поделиться».
//
// It is deliberately the thinnest thing that can work: it takes the link and
// the title the sharing app handed over, opens `xciii://share?…` and finishes.
// It shows nothing, asks nothing and never touches the network.
//
// That is not laziness. An app extension is a separate, sandboxed process: to
// draw a list of boards here it would need the app's address and token, which
// means a shared container (App Group) and a provisioning profile from a
// developer team — a lot of machinery guarding a dialog the app can draw
// itself, in a window it already knows how to open. Opening a URL is the one
// thing an extension may do with none of that.
//
// The other half is share.go and docs/sources.md §24.
@objc(ShareViewController)
final class ShareViewController: NSViewController {
    // Type identifiers as strings rather than through UniformTypeIdentifiers:
    // the framework is newer than the deployment target this app builds for,
    // and these two constants have not changed since they were introduced.
    private static let urlType = "public.url"
    private static let textType = "public.plain-text"

    override func loadView() {
        // A share extension is a view controller whether it has anything to
        // show or not. This one is never really seen: the window that asks the
        // question is the app's own, and this view exists only because the
        // system insists on loading one.
        view = NSView(frame: .zero)
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        handOff()
    }

    private func handOff() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem else {
            finish()
            return
        }
        // The page title as the sharing app wrote it. Safari sends it here
        // rather than as an attachment, which is why it is read off the item.
        let title = item.attributedTitle?.string ?? item.attributedContentText?.string ?? ""

        guard let provider = item.attachments?.first(where: {
            $0.hasItemConformingToTypeIdentifier(Self.urlType) ||
            $0.hasItemConformingToTypeIdentifier(Self.textType)
        }) else {
            // Nothing we can carry: a card made of nothing would be worse than
            // the sheet simply closing.
            finish()
            return
        }

        let wantsURL = provider.hasItemConformingToTypeIdentifier(Self.urlType)
        provider.loadItem(forTypeIdentifier: wantsURL ? Self.urlType : Self.textType) { [weak self] value, _ in
            let shared = Self.stringOf(value)
            DispatchQueue.main.async {
                self?.open(url: wantsURL ? shared : "", text: wantsURL ? "" : shared, title: title)
            }
        }
    }

    // stringOf unwraps whatever the sharing app decided to send. A URL arrives
    // as an NSURL, text as a String, and either can arrive as Data — the
    // provider promises the type, not the class.
    private static func stringOf(_ value: NSSecureCoding?) -> String {
        switch value {
        case let url as URL:
            return url.absoluteString
        case let text as String:
            return text
        case let data as Data:
            return String(data: data, encoding: .utf8) ?? ""
        default:
            return ""
        }
    }

    private func open(url: String, text: String, title: String) {
        var components = URLComponents()
        components.scheme = "xciii"
        components.host = "share"
        components.queryItems = [
            URLQueryItem(name: "url", value: url),
            URLQueryItem(name: "title", value: title),
            URLQueryItem(name: "text", value: text),
        ].filter { ($0.value ?? "").isEmpty == false }

        if !(components.queryItems ?? []).isEmpty, let opened = components.url {
            NSWorkspace.shared.open(opened)
        }
        finish()
    }

    private func finish() {
        // Always completed, and never with an error: the sheet has to go away
        // whatever happened, and what did happen is said by the app's own
        // window opening — or not.
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
