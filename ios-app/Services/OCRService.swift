import Foundation
import Vision

#if canImport(UIKit)
import UIKit
typealias OCRImage = UIImage
#elseif canImport(AppKit)
import AppKit
typealias OCRImage = NSImage
extension NSImage {
    var cgImage: CGImage? {
        var rect = CGRect(origin: .zero, size: self.size)
        return self.cgImage(forProposedRect: &rect, context: nil, hints: nil)
    }

    func jpegData(compressionQuality: CGFloat) -> Data? {
        guard let tiffData = self.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiffData) else {
            return nil
        }

        return bitmap.representation(using: .jpeg, properties: [.compressionFactor: compressionQuality])
    }
}
#endif

actor OCRService {
    func recognizeText(from image: OCRImage) async throws -> String {
        guard let cgImage = image.cgImage else { return "" }
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            do {
                try handler.perform([request])
                continuation.resume()
            } catch {
                continuation.resume(throwing: error)
            }
        }

        let observations = request.results ?? []
        let lines = observations.compactMap { obs -> String? in
            return obs.topCandidates(1).first?.string
        }
        return lines.joined(separator: "\n")
    }
}
