import Foundation
import SwiftUI

#if canImport(UIKit)
import UIKit
 typealias ScannerImage = UIImage

struct DocumentScanner: UIViewControllerRepresentable {
    typealias Completion = (Result<[ScannerImage], Error>) -> Void
    var completion: Completion

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        picker.modalPresentationStyle = .fullScreen
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let parent: DocumentScanner
        init(parent: DocumentScanner) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage {
                picker.dismiss(animated: true) {
                    self.parent.completion(.success([image]))
                }
            } else {
                picker.dismiss(animated: true) {
                    self.parent.completion(.failure(NSError(domain: "Scanner", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unable to capture image"])))
                }
            }
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            picker.dismiss(animated: true) {
                self.parent.completion(.failure(NSError(domain: "Scanner", code: 1, userInfo: [NSLocalizedDescriptionKey: "User cancelled"])))
            }
        }
    }
}

#elseif canImport(AppKit)
import AppKit
 typealias ScannerImage = NSImage

struct DocumentScanner: View {
    typealias Completion = (Result<[ScannerImage], Error>) -> Void
    var completion: Completion

    var body: some View {
        Text("Scanning not available on this platform")
            .onAppear {
                DispatchQueue.main.async {
                    self.completion(Result<[ScannerImage], Error>.failure(NSError(domain: "Scanner", code: 2, userInfo: [NSLocalizedDescriptionKey: "Document scanning not supported on this platform"])))
                }
            }
    }
}

#else

typealias ScannerImage = Any

struct DocumentScanner: View {
    typealias Completion = (Result<[ScannerImage], Error>) -> Void
    var completion: Completion

    var body: some View {
        Text("Scanning not available on this platform")
            .onAppear {
                DispatchQueue.main.async {
                    self.completion(Result<[ScannerImage], Error>.failure(NSError(domain: "Scanner", code: 2, userInfo: [NSLocalizedDescriptionKey: "Document scanning not supported on this platform"])))
                }
            }
    }
}

#endif
