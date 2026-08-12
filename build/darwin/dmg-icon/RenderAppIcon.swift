// Renders the icon macOS itself draws for an .app bundle into an .iconset.
//
// The disk image has to wear the app's icon, and there is no file in the build
// that holds it: `appicon.icon` is a composition, and the two things actool
// makes from it disagree. The legacy .icns it writes honours the document's
// background fill; the live icon the system draws out of Assets.car does not --
// a composition compiled with a pure red background still renders on the
// system's dark gradient. So the only honest source for "what this app's icon
// looks like" is to ask the system for it, which is what this does.
//
// Needs a GUI session: NSWorkspace draws through the window server.

import AppKit

// argv: <app bundle> <output .iconset directory>
let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    FileHandle.standardError.write(Data("usage: RenderAppIcon <app bundle> <output .iconset>\n".utf8))
    exit(2)
}

// Resolved against the working directory before asking: NSWorkspace answers a
// path it cannot find with the generic document icon rather than with an error,
// so a relative path here would have produced a blank sheet of paper and no
// complaint from any step after it.
let bundle = URL(fileURLWithPath: arguments[1]).standardizedFileURL
guard FileManager.default.fileExists(atPath: bundle.path) else {
    FileHandle.standardError.write(Data("no bundle at \(bundle.path)\n".utf8))
    exit(1)
}

let icon = NSWorkspace.shared.icon(forFile: bundle.path)
let iconset = URL(fileURLWithPath: arguments[2], isDirectory: true)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

// The names iconutil expects. Every size is drawn rather than scaled from one
// of them, because the icon carries a representation per size and the small
// ones are not the large one shrunk.
let sizes: [(name: String, pixels: Int)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32),
    ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256),
    ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]

for (name, pixels) in sizes {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ) else {
        FileHandle.standardError.write(Data("cannot allocate a \(pixels)px bitmap\n".utf8))
        exit(1)
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    icon.draw(in: NSRect(x: 0, y: 0, width: pixels, height: pixels))
    NSGraphicsContext.restoreGraphicsState()

    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        FileHandle.standardError.write(Data("cannot encode \(name)\n".utf8))
        exit(1)
    }
    try png.write(to: iconset.appendingPathComponent("\(name).png"))
}
