import Foundation

actor PaymentMappingService {
    let supabaseUrl: URL
    let supabaseAnonKey: String

    init(supabaseUrl: String, supabaseAnonKey: String) {
        self.supabaseUrl = URL(string: supabaseUrl)!
        self.supabaseAnonKey = supabaseAnonKey
    }

    // Query payment_methods table for a matching last_digits
    func findPaymentMethodId(lastDigits: String) async throws -> UUID? {
        guard var components = URLComponents(url: supabaseUrl.appendingPathComponent("/rest/v1/payment_methods"), resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.queryItems = [URLQueryItem(name: "last_digits", value: "eq.\(lastDigits)")]
        guard let url = components.url else {
            return nil
        }

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let (d, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            return nil
        }

        if let arr = try JSONSerialization.jsonObject(with: d, options: []) as? [[String: Any]], let first = arr.first, let idStr = first["id"] as? String, let uuid = UUID(uuidString: idStr) {
            return uuid
        }
        return nil
    }
}
