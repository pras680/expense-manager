import BackgroundTasks
import Foundation

enum GmailBackgroundScheduler {
    static let taskIdentifier = "com.prasanna.ExpenseManager.gmailDailyScan"

    @MainActor
    static func register(store: ReceiptStore) {
        let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: taskIdentifier, using: nil) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            handle(refreshTask, store: store)
        }

        if !registered {
            AppSecurity.debugLog("Gmail background scheduler registration failed.")
        }
    }

    static func scheduleDailyScan() {
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = Calendar.current.date(byAdding: .hour, value: 24, to: Date())

        do {
            try BGTaskScheduler.shared.submit(request)
            AppSecurity.debugLog("Gmail background scheduler submitted next daily scan.")
        } catch {
            AppSecurity.debugLog("Gmail background scheduler submit failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }
    }

    static func cancelDailyScan() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: taskIdentifier)
        AppSecurity.debugLog("Gmail background scheduler cancelled daily scan.")
    }

    private static func handle(_ task: BGAppRefreshTask, store: ReceiptStore) {
        let scanTask = Task { @MainActor in
            let success = await store.runAutonomousDailyGmailScanFromBackground()
            if store.gmailDailyAgentEnabled {
                scheduleDailyScan()
            }
            task.setTaskCompleted(success: success)
        }

        task.expirationHandler = {
            scanTask.cancel()
        }
    }
}
