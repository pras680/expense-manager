import SwiftUI
import CoreText

/// Registers the bundled Archivo font files with Core Text so `AppFont` can resolve them.
enum AppFonts {
    private static var didRegister = false

    static func registerIfNeeded() {
        guard !didRegister else { return }
        didRegister = true
        for name in ["Archivo-Regular", "Archivo-SemiBold", "Archivo-ExtraBold"] {
            guard let url = Bundle.main.url(forResource: name, withExtension: "ttf") else { continue }
            var error: Unmanaged<CFError>?
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
        }
    }
}

/// "Modernist" — flat, architectural design tokens matching the Claude Design redesign:
/// sharp corners, Archivo type, one accent, ruled grid layout, flush-left labels.
enum AppTheme {
    // Ground
    static let bg = Color(hex: 0xF3F2F2)
    static let surface = Color(hex: 0xEAE9E9)
    static let text = Color(hex: 0x201E1D)
    static let divider = Color(hex: 0x201E1D).opacity(0.4)

    // Accent
    static let accent = Color(hex: 0xEC3013)
    static let accent600 = Color(hex: 0xDD2B0F)
    static let accent700 = Color(hex: 0xAE1800)
    static let accent100 = Color(hex: 0xFFF2EF)

    // Neutral ramp
    static let neutral600 = Color(hex: 0x7D7979)
    static let neutral700 = Color(hex: 0x605D5D)
    // 0.65 (not the mockup's original 0.55) so secondary/caption text clears WCAG AA (4.5:1)
    // against both `bg` and `surface` — 0.55 measured ~3.6:1, a real readability regression.
    static let textMuted = text.opacity(0.65)

    // Spacing scale
    static let space1: CGFloat = 4
    static let space2: CGFloat = 8
    static let space3: CGFloat = 12
    static let space4: CGFloat = 16
    static let space6: CGFloat = 24
    static let space8: CGFloat = 32

    // Radius — zero on purpose, the system never rounds a corner.
    static let radius: CGFloat = 0

    /// Strong 2px rule, the system's primary sectioning device.
    static let ruleWidth: CGFloat = 2
    static let hairline: CGFloat = 1
}

enum AppFont {
    private static func custom(_ name: String, _ size: CGFloat) -> Font {
        .custom(name, size: size)
    }

    static func heading(_ size: CGFloat) -> Font { custom("ArchivoRoman-ExtraBold", size) }
    static func semibold(_ size: CGFloat) -> Font { custom("ArchivoRoman-SemiBold", size) }
    static func body(_ size: CGFloat) -> Font { custom("ArchivoRoman-Regular", size) }

    static let largeTitle = heading(26)
    static let title = heading(20)
    static let title2 = heading(17)
    static let headline = semibold(15)
    static let body15 = body(15)
    static let subhead = body(13)
    static let caption = semibold(11)
    static let microLabel = semibold(11)
}

extension Color {
    init(hex: UInt32) {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8) & 0xFF) / 255
        let b = Double(hex & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}

// MARK: - Reusable flat components

/// A section rule: strong 2px horizontal divider.
struct RuleLine: View {
    var body: some View {
        Rectangle()
            .fill(AppTheme.divider)
            .frame(height: AppTheme.ruleWidth)
    }
}

/// An uppercase micro-label, e.g. section eyebrow text.
struct SectionLabel: View {
    let text: String
    var color: Color = AppTheme.neutral700

    var body: some View {
        Text(text.uppercased())
            .font(AppFont.microLabel)
            .tracking(0.8)
            .foregroundStyle(color)
    }
}

/// Lays out its rows/cells as a ruled grid: hairline dividers show through 1pt gaps,
/// content sits on `AppTheme.surface`. Mirrors the mockup's `background:var(--color-divider)` +
/// `gap:1px` grid technique.
struct RuledStack<Content: View>: View {
    var spacing: CGFloat = 1
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: spacing) {
            content
        }
        .background(AppTheme.divider)
    }
}

struct RuledRow<Content: View>: View {
    var content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(AppTheme.surface)
    }
}

enum TagStyle {
    case solid
    case outline
}

struct TagView: View {
    let text: String
    var style: TagStyle = .outline

    var body: some View {
        Text(text)
            .font(AppFont.caption)
            .tracking(0.3)
            .padding(.horizontal, AppTheme.space3)
            .padding(.vertical, AppTheme.space2 - 2)
            // `accent` on `bg`/`surface` measures ~3.8:1 — fine for a 1px border, too low for
            // small caption text, so outline-style labels use the darker `accent700` instead.
            .foregroundStyle(style == .solid ? AppTheme.bg : AppTheme.accent700)
            .background(style == .solid ? AppTheme.accent : Color.clear)
            .overlay(
                Rectangle().stroke(AppTheme.accent, lineWidth: style == .outline ? 1 : 0)
            )
    }
}

/// Flat primary button: solid accent fill, sharp corners, heading weight, flush-left label
/// when the button spans full width.
struct FlatPrimaryButtonStyle: ButtonStyle {
    var fullWidth = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(AppFont.headline)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .padding(.vertical, AppTheme.space3)
            .padding(.horizontal, AppTheme.space4)
            .foregroundStyle(AppTheme.bg)
            .background(configuration.isPressed ? AppTheme.accent700 : AppTheme.accent)
    }
}

/// Flat secondary button: outline only.
struct FlatSecondaryButtonStyle: ButtonStyle {
    var fullWidth = true
    var tint: Color = AppTheme.text

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(AppFont.headline)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .padding(.vertical, AppTheme.space3)
            .padding(.horizontal, AppTheme.space4)
            .foregroundStyle(tint)
            .background(configuration.isPressed ? tint.opacity(0.12) : Color.clear)
            .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
    }
}

/// A flat, bordered field wrapper: uppercase micro-label above a sharp-cornered input box.
struct FlatField<Content: View>: View {
    let label: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(AppFont.subhead)
                .foregroundStyle(AppTheme.textMuted)
            content
                .font(AppFont.body15)
                .foregroundStyle(AppTheme.text)
                .tint(AppTheme.accent700)
                .padding(.horizontal, AppTheme.space3 - 2)
                .padding(.vertical, AppTheme.space2 + 2)
                .background(AppTheme.surface)
                .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
        }
    }
}

/// A flush-left "Back" link styled like the mockup's report drill-down back button.
struct BackLink: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 13, weight: .heavy))
                Text(title)
                    .font(AppFont.caption)
            }
            .foregroundStyle(AppTheme.accent700)
        }
        .buttonStyle(.plain)
    }
}

/// A ruled stat cell: uppercase label over a bold figure, used for the Total Spend /
/// This Month / Receipts style summary blocks throughout the app.
struct StatCell: View {
    let title: String
    let value: String
    var valueSize: CGFloat = 18

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.space1) {
            SectionLabel(text: title)
            Text(value)
                .font(AppFont.heading(valueSize))
                .foregroundStyle(AppTheme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(AppTheme.space3 + 2)
        .background(AppTheme.surface)
    }
}

extension View {
    /// Strips List's default row chrome so custom flat rows can control their own spacing.
    func plainRow(horizontalPadding: CGFloat = AppTheme.space4) -> some View {
        self
            .listRowInsets(EdgeInsets(top: 0, leading: horizontalPadding, bottom: 0, trailing: horizontalPadding))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }
}
