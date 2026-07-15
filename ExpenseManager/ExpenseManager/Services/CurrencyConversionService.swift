import Foundation

struct CurrencyConversionResult {
    let defaultCurrency: String
    let receiptCurrency: String
    let conversionRate: Decimal
    let convertedTotal: Decimal
}

actor CurrencyConversionService {
    private struct FrankfurterResponse: Decodable {
        let rates: [String: Decimal]
    }

    func convert(amount: Decimal?, from receiptCurrency: String?, to defaultCurrency: String, on receiptDate: Date?) async -> CurrencyConversionResult? {
        guard let amount else { return nil }

        let sourceCurrency = Self.normalizedCurrency(receiptCurrency) ?? defaultCurrency
        let targetCurrency = Self.normalizedCurrency(defaultCurrency) ?? Invoice.defaultCurrency

        guard sourceCurrency != targetCurrency else {
            return CurrencyConversionResult(
                defaultCurrency: targetCurrency,
                receiptCurrency: sourceCurrency,
                conversionRate: 1,
                convertedTotal: amount
            )
        }

        let rate = await historicalRate(from: sourceCurrency, to: targetCurrency, on: receiptDate) ?? fallbackRate(from: sourceCurrency, to: targetCurrency)
        let converted = NSDecimalNumber(decimal: amount)
            .multiplying(by: NSDecimalNumber(decimal: rate))
            .rounding(accordingToBehavior: NSDecimalNumberHandler(
                roundingMode: .plain,
                scale: 2,
                raiseOnExactness: false,
                raiseOnOverflow: false,
                raiseOnUnderflow: false,
                raiseOnDivideByZero: false
            ))
            .decimalValue

        return CurrencyConversionResult(
            defaultCurrency: targetCurrency,
            receiptCurrency: sourceCurrency,
            conversionRate: rate,
            convertedTotal: converted
        )
    }

    private func historicalRate(from sourceCurrency: String, to targetCurrency: String, on receiptDate: Date?) async -> Decimal? {
        let date = min(receiptDate ?? Date(), Date())
        let dateFormatter = DateFormatter()
        dateFormatter.calendar = Calendar(identifier: .gregorian)
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateFormatter.timeZone = TimeZone(secondsFromGMT: 0)
        dateFormatter.dateFormat = "yyyy-MM-dd"

        guard var components = URLComponents(string: "https://api.frankfurter.app/\(dateFormatter.string(from: date))") else {
            return nil
        }
        components.queryItems = [
            URLQueryItem(name: "from", value: sourceCurrency),
            URLQueryItem(name: "to", value: targetCurrency)
        ]
        guard let url = components.url else { return nil }

        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return nil
            }
            let decoded = try JSONDecoder().decode(FrankfurterResponse.self, from: data)
            return decoded.rates[targetCurrency]
        } catch {
            AppSecurity.debugLog("Currency rate fetch failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
            return nil
        }
    }

    private func fallbackRate(from sourceCurrency: String, to targetCurrency: String) -> Decimal {
        guard sourceCurrency != targetCurrency else { return 1 }
        let ratesToSGD: [String: Decimal] = [
            "SGD": 1,
            "USD": 1.35,
            "EUR": 1.46,
            "GBP": 1.71,
            "AUD": 0.89,
            "CAD": 0.99,
            "JPY": 0.0091,
            "CNY": 0.19,
            "HKD": 0.17,
            "INR": 0.016,
            "MYR": 0.29,
            "THB": 0.037,
            "IDR": 0.000083,
            "PHP": 0.023,
            "VND": 0.000053,
            "KRW": 0.00098,
            "AED": 0.37
        ]

        let sourceToSGD = ratesToSGD[sourceCurrency] ?? 1
        let targetToSGD = ratesToSGD[targetCurrency] ?? 1
        return sourceToSGD / targetToSGD
    }

    static func normalizedCurrency(_ value: String?) -> String? {
        guard let cleaned = value?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(), !cleaned.isEmpty else {
            return nil
        }
        return cleaned
    }
}
