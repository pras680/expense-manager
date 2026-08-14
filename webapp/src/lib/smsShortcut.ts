// Builds a downloadable .shortcut file (Apple's WFWorkflow plist format) that
// pre-fills the "Get Contents of URL" call to receive-sms with this user's own
// token — so household members import one file instead of typing out a URL,
// method, two headers and a JSON body by hand.
//
// This is a best-effort, hand-authored plist against Apple's undocumented
// Shortcuts schema (there's no public spec, no way to validate it here beyond
// well-formed XML) — the shape below follows the pattern used by publicly
// shared "forward SMS to a webhook" shortcuts. If it fails to import or the
// automation misfires, the manual instructions below it are the fallback.
//
// Because this file isn't signed via Apple's iCloud sharing service, iOS
// treats it as "untrusted": the first attempt to open it just fails silently,
// which is what surfaces the "Allow Untrusted Shortcuts" toggle in
// Settings -> Shortcuts (only for a few minutes) — the caller needs to enable
// that once, then import again.
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function headerField(key: string, value: string): string {
  return `
            <dict>
              <key>WFItemType</key>
              <integer>0</integer>
              <key>WFKey</key>
              <dict>
                <key>Value</key>
                <dict>
                  <key>string</key>
                  <string>${escapeXml(key)}</string>
                </dict>
                <key>WFSerializationType</key>
                <string>WFTextTokenString</string>
              </dict>
              <key>WFValue</key>
              <dict>
                <key>Value</key>
                <dict>
                  <key>string</key>
                  <string>${escapeXml(value)}</string>
                </dict>
                <key>WFSerializationType</key>
                <string>WFTextTokenString</string>
              </dict>
            </dict>`
}

export function buildSmsShortcutPlist(receiveSmsUrl: string, token: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowClientVersion</key>
  <string>1122.4</string>
  <key>WFWorkflowMinimumClientVersion</key>
  <integer>900</integer>
  <key>WFWorkflowIcon</key>
  <dict>
    <key>WFWorkflowIconStartColor</key>
    <integer>4271458815</integer>
    <key>WFWorkflowIconGlyphNumber</key>
    <integer>59511</integer>
  </dict>
  <key>WFWorkflowImportQuestions</key>
  <array/>
  <key>WFWorkflowTypes</key>
  <array>
    <string>NCWidget</string>
    <string>WatchKit</string>
  </array>
  <key>WFWorkflowActions</key>
  <array>
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.downloadurl</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFURL</key>
        <string>${escapeXml(receiveSmsUrl)}</string>
        <key>WFHTTPMethod</key>
        <string>POST</string>
        <key>WFHTTPBodyType</key>
        <string>JSON</string>
        <key>WFJSONValues</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>
              <dict>
                <key>WFItemType</key>
                <integer>0</integer>
                <key>WFKey</key>
                <dict>
                  <key>Value</key>
                  <dict>
                    <key>string</key>
                    <string>body</string>
                  </dict>
                  <key>WFSerializationType</key>
                  <string>WFTextTokenString</string>
                </dict>
                <key>WFValue</key>
                <dict>
                  <key>Value</key>
                  <dict>
                    <key>string</key>
                    <string>￼</string>
                    <key>attachmentsByRange</key>
                    <dict>
                      <key>{0, 1}</key>
                      <dict>
                        <key>Type</key>
                        <string>ExtensionInput</string>
                      </dict>
                    </dict>
                  </dict>
                  <key>WFSerializationType</key>
                  <string>WFTextTokenString</string>
                </dict>
              </dict>
            </array>
          </dict>
          <key>WFSerializationType</key>
          <string>WFDictionaryFieldValue</string>
        </dict>
        <key>WFHTTPHeaders</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>${headerField('Content-Type', 'application/json')}${headerField('x-sms-ingest-secret', token)}
            </array>
          </dict>
          <key>WFSerializationType</key>
          <string>WFDictionaryFieldValue</string>
        </dict>
      </dict>
    </dict>
  </array>
  <key>WFWorkflowInputContentItemClasses</key>
  <array>
    <string>WFStringContentItem</string>
    <string>WFTextContentItem</string>
  </array>
  <key>WFWorkflowName</key>
  <string>SMS Import</string>
</dict>
</plist>
`
}

export function downloadSmsShortcut(receiveSmsUrl: string, token: string) {
  const plist = buildSmsShortcutPlist(receiveSmsUrl, token)
  const blob = new Blob([plist], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'sms-import.shortcut'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
