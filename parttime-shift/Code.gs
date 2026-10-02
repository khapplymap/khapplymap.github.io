const SPREADSHEET_ID = "1bcZ1ZzsKq7Ji_QYu9ahb_TMcZLcxowX8DWpio7ehOsI";
const SIGNUP_SHEET = "報名紀錄";

function doGet(e) {
  return json_({
    success: true,
    service: "parttime-shift",
    now: new Date().toISOString()
  });
}

function doPost(e) {
  try {
    const data = JSON.parse(
      (e && e.postData && e.postData.contents) || "{}"
    );

    const action = String(data.action || "").trim();

    if (action === "signup") {
      return signup_(data);
    }

    if (action === "cancel") {
      return cancel_(data);
    }

    return json_({
      success: false,
      error: "不支援的操作"
    });

  } catch (err) {
    return json_({
      success: false,
      error: String(
        err && err.message ? err.message : err
      )
    });
  }
}

function signup_(data) {
  const date = String(data.date || "").trim();
  const place = String(data.place || "").trim();
  const name = String(data.name || "").trim();
  const until = String(data.until || "").trim();

  if (!date || !place || !name || !until) {
    return json_({
      success: false,
      error: "資料不完整"
    });
  }

  const sheet = getSignupSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const rows = sheet.getDataRange().getDisplayValues();
    const headers = rows[0].map(function(v) {
      return String(v).trim();
    });

    const col = columns_(headers);

    let targetRow = findRow_(
      rows,
      col,
      date,
      place,
      name
    );

    const now = now_();

    if (targetRow > 0) {
      sheet
        .getRange(targetRow, col.until + 1)
        .setValue(until);

      sheet
        .getRange(targetRow, col.time + 1)
        .setValue(now);

      sheet
        .getRange(targetRow, col.status + 1)
        .setValue("已報名");

      sheet
        .getRange(targetRow, col.cancelTime + 1)
        .clearContent();

    } else {
      const newRow =
        new Array(headers.length).fill("");

      newRow[col.date] = date;
      newRow[col.place] = place;
      newRow[col.name] = name;
      newRow[col.until] = until;
      newRow[col.time] = now;
      newRow[col.status] = "已報名";
      newRow[col.cancelTime] = "";

      sheet.appendRow(newRow);
    }

    SpreadsheetApp.flush();

    return json_({
      success: true,
      updated: targetRow > 0,
      status: "已報名",
      date: date,
      place: place,
      name: name,
      until: until,
      now: now
    });

  } finally {
    lock.releaseLock();
  }
}

function cancel_(data) {
  const date = String(data.date || "").trim();
  const place = String(data.place || "").trim();
  const name = String(data.name || "").trim();

  if (!date || !place || !name) {
    return json_({
      success: false,
      error: "資料不完整"
    });
  }

  if (isToday_(date)) {
    return json_({
      success: false,
      error: "工作當天無法自行取消，請聯絡正職人員"
    });
  }

  const sheet = getSignupSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const rows = sheet.getDataRange().getDisplayValues();
    const headers = rows[0].map(function(v) {
      return String(v).trim();
    });

    const col = columns_(headers);

    const targetRow = findRow_(
      rows,
      col,
      date,
      place,
      name
    );

    if (targetRow < 0) {
      return json_({
        success: false,
        error: "找不到原本的出勤登記"
      });
    }

    const now = now_();

    sheet
      .getRange(targetRow, col.status + 1)
      .setValue("已取消");

    sheet
      .getRange(targetRow, col.cancelTime + 1)
      .setValue(now);

    SpreadsheetApp.flush();

    return json_({
      success: true,
      cancelled: true,
      date: date,
      place: place,
      name: name,
      cancelTime: now
    });

  } finally {
    lock.releaseLock();
  }
}

function getSignupSheet_() {
  const ss =
    SpreadsheetApp.openById(SPREADSHEET_ID);

  const sheet =
    ss.getSheetByName(SIGNUP_SHEET);

  if (!sheet) {
    throw new Error(
      "找不到「報名紀錄」分頁"
    );
  }

  return sheet;
}

function columns_(headers) {
  const col = {
    date: headers.indexOf("日期"),
    place: headers.indexOf("地點"),
    name: headers.indexOf("姓名"),
    until: headers.indexOf("可出勤到幾點"),
    time: headers.indexOf("填寫時間"),
    status: headers.indexOf("狀態"),
    cancelTime: headers.indexOf("取消時間")
  };

  Object.keys(col).forEach(function(key) {
    if (col[key] < 0) {
      throw new Error(
        "「報名紀錄」欄位名稱不完整"
      );
    }
  });

  return col;
}

function findRow_(
  rows,
  col,
  date,
  place,
  name
) {
  for (let i = 1; i < rows.length; i++) {
    const rowDate =
      String(rows[i][col.date] || "").trim();

    const rowPlace =
      String(rows[i][col.place] || "").trim();

    const rowName =
      String(rows[i][col.name] || "").trim();

    if (
      rowDate === date &&
      rowPlace === place &&
      rowName === name
    ) {
      return i + 1;
    }
  }

  return -1;
}

function isToday_(dateText) {
  const parts =
    String(dateText || "")
      .trim()
      .split(/[\/-]/);

  if (parts.length < 2) {
    return false;
  }

  const now = new Date();

  const month =
    parts.length === 2
      ? Number(parts[0])
      : Number(parts[1]);

  const day =
    parts.length === 2
      ? Number(parts[1])
      : Number(parts[2]);

  const tz = "Asia/Taipei";

  const todayMonth =
    Number(
      Utilities.formatDate(
        now,
        tz,
        "M"
      )
    );

  const todayDay =
    Number(
      Utilities.formatDate(
        now,
        tz,
        "d"
      )
    );

  return (
    month === todayMonth &&
    day === todayDay
  );
}

function now_() {
  return Utilities.formatDate(
    new Date(),
    "Asia/Taipei",
    "yyyy/MM/dd HH:mm:ss"
  );
}

function json_(obj) {
  return ContentService
    .createTextOutput(
      JSON.stringify(obj)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );
}
