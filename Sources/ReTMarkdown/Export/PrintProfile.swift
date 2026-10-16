import AppKit

@MainActor enum PrintProfile {
    static let paperSize = NSSize(width: 595.276, height: 841.890)
    static let margin: CGFloat = 56.693

    static func makePrintInfo(savingTo url: URL) -> NSPrintInfo {
        // A fresh dictionary avoids inheriting a user's scale, page range,
        // headers, selected printer or previous document's print settings.
        let info = NSPrintInfo(dictionary: [:])
        info.orientation = .portrait
        info.paperSize = paperSize
        info.topMargin = margin; info.bottomMargin = margin
        info.leftMargin = margin; info.rightMargin = margin
        info.scalingFactor = 1
        info.isHorizontallyCentered = false; info.isVerticallyCentered = false
        info.horizontalPagination = .automatic; info.verticalPagination = .automatic
        info.jobDisposition = .save
        info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = url
        info.dictionary()[NSPrintInfo.AttributeKey.headerAndFooter] = false
        info.dictionary()[NSPrintInfo.AttributeKey.allPages] = true
        return info
    }
}
