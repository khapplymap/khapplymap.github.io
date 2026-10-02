const SPREADSHEET_ID = "1bcZ1ZzsKq7Ji_QYu9ahb_TMcZLcxowX8DWpio7ehOsI";
const SIGNUP_SHEET = "報名紀錄";

function doGet(e) {
  return json_({ success: true, service: "parttime-shift", now: new Date().toISOString() });
}

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const action = String(data.action || "").trim();

    if (action !== "signup") {
      return json_({ success: false, error: "不支援的操作" });
    }

    const date = String(data.date || "").trim();
    const place = String(data.place || "").trim();
    const name = String(data.name || "").trim();
    const until = String(data.until || "").trim();

    if (!date || !place || !name || !until) {
      return json_({ success: false, error: "資料不完整" });
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SIGNUP_SHEET);
    if (!sheet) return json_({ success: false, error: "找不到「報名紀錄」分頁" });

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const values = sheet.getDataRange().getDisplayValues();
      if (!values.length) {
        sheet.getRange(1, 1, 1, 5).setValues([["日期","地點","姓名","可出勤到幾點","填寫時間"]]);
      }

      const rows = sheet.getDataRange().getDisplayValues();
      const headers = rows[0].map(v => String(v).trim());
      const col = {
        date: headers.indexOf("日期"),
        place: headers.indexOf("地點"),
        name: headers.indexOf("姓名"),
        until: headers.indexOf("可出勤到幾點"),
        time: headers.indexOf("填寫時間")
      };

      if (Object.values(col).some(i => i < 0)) {
        return json_({ success: false, error: "「報名紀錄」欄位名稱不完整" });
      }

      let targetRow = -1;
      for (let i = 1; i < rows.length; i++) {
        if (
          String(rows[i][col.date] || "").trim() === date &&
          String(rows[i][col.place] || "").trim() === place &&
          String(rows[i][col.name] || "").trim() === name
        ) {
          targetRow = i + 1;
          break;
        }
      }

      const now = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy/MM/dd HH:mm:ss");

      if (targetRow > 0) {
        sheet.getRange(targetRow, col.until + 1).setValue(until);
        sheet.getRange(targetRow, col.time + 1).setValue(now);
      } else {
        const newRow = new Array(headers.length).fill("");
        newRow[col.date] = date;
        newRow[col.place] = place;
        newRow[col.name] = name;
        newRow[col.until] = until;
        newRow[col.time] = now;
        sheet.appendRow(newRow);
      }

      SpreadsheetApp.flush();
      return json_({ success: true, updated: targetRow > 0, date, place, name, until, now });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ success: false, error: String(err && err.message ? err.message : err) });
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
