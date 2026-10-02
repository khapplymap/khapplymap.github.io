const SPREADSHEET_ID = "1bcZ1ZzsKq7Ji_QYu9ahb_TMcZLcxowX8DWpio7ehOsI";

const WORKER_SHEET = "工讀生名單";
const TASK_SHEET = "工作任務";
const SIGNUP_SHEET = "報名紀錄";
const HOLIDAY_SHEET = "假日設定";
const PREVIEW_SHEET = "排程預覽";
const TZ = "Asia/Taipei";

function doGet(e) {
  return json_({
    success: true,
    service: "parttime-shift",
    now: now_()
  });
}

function doPost(e) {
  try {
    const data = JSON.parse(
      (e && e.postData && e.postData.contents) || "{}"
    );

    const action = String(data.action || "").trim();

    if (action === "signup") return signup_(data);
    if (action === "cancel") return cancel_(data);
    if (action === "autoPublish") {
      publishGeneralSchedules();
      return json_({ success: true, now: now_() });
    }

    if (action === "refreshPreview") {
      refreshGeneralPreview_();
      return json_({ success: true, now: now_() });
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
  const date = text_(data.date);
  const time = text_(data.time);
  const name = text_(data.name);
  const until = text_(data.until);
  const mode = text_(data.mode) || "一般";

  if (!date || !time || !name || !until) {
    return json_({
      success: false,
      error: "資料不完整"
    });
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const signupSheet = ss.getSheetByName(SIGNUP_SHEET);
  const taskSheet = ss.getSheetByName(TASK_SHEET);

  if (!signupSheet || !taskSheet) {
    return json_({
      success: false,
      error: "找不到必要分頁"
    });
  }

  const tasks = readObjects_(taskSheet);
  const candidates = tasks.filter(function(t) {
    const taskMode = text_(t["開放時間"]) ? "下午" : "一般";
    return text_(t["日期"]) === date &&
      text_(t["時間"]) === time &&
      taskMode === mode;
  });

  if (!candidates.length) {
    return json_({
      success: false,
      error: "找不到這個班次"
    });
  }

  if (mode === "一般" && isGeneralPublished_(date)) {
    return json_({
      success: false,
      error: "排程已公布，如需異動請聯絡 Jimmy 或是人資"
    });
  }

  if (mode === "下午") {
    if (!isAfternoonOpen_(date, candidates)) {
      return json_({
        success: false,
        error: "下午排程目前尚未開放"
      });
    }
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const rows = signupSheet
      .getDataRange()
      .getDisplayValues();

    const headers = rows[0].map(text_);
    const col = columns_(headers);

    let targetRow = findSignupRow_(
      rows,
      col,
      date,
      time,
      name,
      mode
    );

    if (
      targetRow > 0 &&
      text_(rows[targetRow - 1][col.scheduleStatus]) === "已公布"
    ) {
      return json_({
        success: false,
        error: "排程已公布，如需異動請聯絡 Jimmy 或是人資"
      });
    }

    const now = now_();

    let assignedSchool = "";
    let scheduleStatus = "待分派";
    let publishedAt = "";
    let place = "待分派";

    if (mode === "下午") {
      assignedSchool = assignImmediate_(
        ss,
        date,
        time,
        name,
        candidates
      );

      scheduleStatus = "已公布";
      publishedAt = now;
      place = assignedSchool;
    }

    if (targetRow > 0) {
      setCell_(signupSheet, targetRow, col.date, date);
      setCell_(signupSheet, targetRow, col.place, place);
      setCell_(signupSheet, targetRow, col.name, name);
      setCell_(signupSheet, targetRow, col.until, until);
      setCell_(signupSheet, targetRow, col.time, now);
      setCell_(signupSheet, targetRow, col.status, "已報名");
      setCell_(signupSheet, targetRow, col.cancelTime, "");
      setCell_(signupSheet, targetRow, col.shiftTime, time);
      setCell_(signupSheet, targetRow, col.assignedSchool, assignedSchool);
      setCell_(signupSheet, targetRow, col.scheduleStatus, scheduleStatus);
      setCell_(signupSheet, targetRow, col.publishedAt, publishedAt);
      setCell_(signupSheet, targetRow, col.mode, mode);

    } else {
      const newRow = new Array(headers.length).fill("");

      newRow[col.date] = date;
      newRow[col.place] = place;
      newRow[col.name] = name;
      newRow[col.until] = until;
      newRow[col.time] = now;
      newRow[col.status] = "已報名";
      newRow[col.cancelTime] = "";
      newRow[col.shiftTime] = time;
      newRow[col.assignedSchool] = assignedSchool;
      newRow[col.scheduleStatus] = scheduleStatus;
      newRow[col.publishedAt] = publishedAt;
      newRow[col.mode] = mode;

      signupSheet.appendRow(newRow);
    }

    SpreadsheetApp.flush();

    return json_({
      success: true,
      updated: targetRow > 0,
      assignedSchool: assignedSchool,
      scheduleStatus: scheduleStatus,
      mode: mode,
      now: now
    });

  } finally {
    lock.releaseLock();
  }
}

function cancel_(data) {
  const date = text_(data.date);
  const time = text_(data.time);
  const name = text_(data.name);
  const mode = text_(data.mode) || "一般";

  if (!date || !time || !name) {
    return json_({
      success: false,
      error: "資料不完整"
    });
  }

  if (mode === "下午") {
    return json_({
      success: false,
      error: "排程已公布，如需異動請聯絡 Jimmy 或是人資"
    });
  }

  if (isGeneralPublished_(date)) {
    return json_({
      success: false,
      error: "排程已公布，如需異動請聯絡 Jimmy 或是人資"
    });
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SIGNUP_SHEET);

  if (!sheet) {
    return json_({
      success: false,
      error: "找不到「報名紀錄」分頁"
    });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const rows = sheet
      .getDataRange()
      .getDisplayValues();

    const headers = rows[0].map(text_);
    const col = columns_(headers);

    const targetRow = findSignupRow_(
      rows,
      col,
      date,
      time,
      name,
      mode
    );

    if (targetRow < 0) {
      return json_({
        success: false,
        error: "找不到原本的出勤登記"
      });
    }

    const now = now_();

    setCell_(sheet, targetRow, col.status, "已取消");
    setCell_(sheet, targetRow, col.cancelTime, now);
    setCell_(sheet, targetRow, col.assignedSchool, "");
    setCell_(sheet, targetRow, col.scheduleStatus, "已取消");
    setCell_(sheet, targetRow, col.publishedAt, "");

    SpreadsheetApp.flush();

    return json_({
      success: true,
      cancelled: true,
      cancelTime: now
    });

  } finally {
    lock.releaseLock();
  }
}

function assignImmediate_(ss, date, time, name, candidates) {
  if (candidates.length === 1) {
    return text_(candidates[0]["地點"]);
  }

  const signupSheet = ss.getSheetByName(SIGNUP_SHEET);
  const workerSheet = ss.getSheetByName(WORKER_SHEET);

  const signups = readObjects_(signupSheet).filter(function(r) {
    return text_(r["日期"]) === date &&
      text_(r["班次時間"]) === time &&
      text_(r["排程類型"]) === "下午" &&
      active_(r) &&
      text_(r["指派學校"]);
  });

  const workers = readObjects_(workerSheet);
  const movable = workerMovable_(workers, name);

  return chooseSchool_(
    candidates,
    signups,
    movable,
    date + "|" + time + "|" + name
  );
}

function publishGeneralSchedules() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const signupSheet = ss.getSheetByName(SIGNUP_SHEET);
  const taskSheet = ss.getSheetByName(TASK_SHEET);
  const workerSheet = ss.getSheetByName(WORKER_SHEET);
  const previewSheet = ss.getSheetByName(PREVIEW_SHEET);

  if (!signupSheet || !taskSheet || !workerSheet) {
    return;
  }

  const tasks = readObjects_(taskSheet);
  const workers = readObjects_(workerSheet);
  const previewRows = previewSheet ? readObjects_(previewSheet) : [];
  const previewMap = {};
  previewRows.forEach(function(r) {
    const k = text_(r["日期"]) + "||" +
      text_(r["班次時間"]) + "||" +
      text_(r["姓名"]);
    previewMap[k] = text_(r["建議學校"]);
  });

  const rows = signupSheet
    .getDataRange()
    .getDisplayValues();

  if (rows.length < 2) return;

  const headers = rows[0].map(text_);
  const col = columns_(headers);

  const groups = {};

  for (let i = 1; i < rows.length; i++) {
    const r = rowObject_(headers, rows[i]);

    if (!active_(r)) continue;
    if (text_(r["排程類型"]) !== "一般") continue;
    if (text_(r["排程狀態"]) === "已公布") continue;

    const date = text_(r["日期"]);
    const time = text_(r["班次時間"]);

    if (!date || !time || !isGeneralPublished_(date)) continue;

    const key = date + "||" + time;

    if (!groups[key]) groups[key] = [];
    groups[key].push({
      rowNumber: i + 1,
      record: r
    });
  }

  Object.keys(groups).forEach(function(key) {
    const parts = key.split("||");
    const date = parts[0];
    const time = parts[1];

    const candidates = tasks.filter(function(t) {
      return text_(t["日期"]) === date &&
        text_(t["時間"]) === time &&
        !text_(t["開放時間"]);
    });

    if (!candidates.length) return;

    const people = groups[key];

    const allocated = allocateGroup_(
      candidates,
      people.map(function(p) {
        return {
          name: text_(p.record["姓名"]),
          movable: workerMovable_(
            workers,
            text_(p.record["姓名"])
          )
        };
      }),
      date + "|" + time
    );

    people.forEach(function(p) {
      const name = text_(p.record["姓名"]);
      const previewSchool = previewMap[
        date + "||" + time + "||" + name
      ];

      if (
        previewSchool &&
        candidates.some(function(t) {
          return text_(t["地點"]) === previewSchool;
        })
      ) {
        allocated[name] = previewSchool;
      }
    });

    const now = now_();

    people.forEach(function(p) {
      const name = text_(p.record["姓名"]);
      const school = allocated[name] || text_(candidates[0]["地點"]);

      setCell_(signupSheet, p.rowNumber, col.place, school);
      setCell_(signupSheet, p.rowNumber, col.assignedSchool, school);
      setCell_(signupSheet, p.rowNumber, col.scheduleStatus, "已公布");
      setCell_(signupSheet, p.rowNumber, col.publishedAt, now);
    });
  });

  SpreadsheetApp.flush();
}

function refreshGeneralPreview_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const previewSheet = ss.getSheetByName(PREVIEW_SHEET);
  const signupSheet = ss.getSheetByName(SIGNUP_SHEET);
  const taskSheet = ss.getSheetByName(TASK_SHEET);
  const workerSheet = ss.getSheetByName(WORKER_SHEET);

  if (!previewSheet || !signupSheet || !taskSheet || !workerSheet) return;

  const tomorrow = taipeiTomorrowKey_();
  const tasks = readObjects_(taskSheet);
  const workers = readObjects_(workerSheet);
  const signups = readObjects_(signupSheet).filter(function(r) {
    return text_(r["日期"]) === tomorrow &&
      text_(r["排程類型"]) === "一般" &&
      active_(r) &&
      text_(r["排程狀態"]) !== "已公布";
  });

  const groups = {};
  signups.forEach(function(r) {
    const time = text_(r["班次時間"]);
    if (!time) return;
    if (!groups[time]) groups[time] = [];
    groups[time].push(r);
  });

  const output = [];

  Object.keys(groups).sort().forEach(function(time) {
    const candidates = tasks.filter(function(t) {
      return text_(t["日期"]) === tomorrow &&
        text_(t["時間"]) === time &&
        !text_(t["開放時間"]);
    });

    if (!candidates.length) return;

    const people = groups[time].map(function(r) {
      const name = text_(r["姓名"]);
      return {
        name: name,
        movable: workerMovable_(workers, name)
      };
    });

    const allocated = allocateGroup_(
      candidates,
      people,
      tomorrow + "|" + time
    );

    people.forEach(function(p) {
      output.push([
        tomorrow,
        time,
        p.name,
        allocated[p.name] || text_(candidates[0]["地點"]),
        now_()
      ]);
    });
  });

  const lastRow = previewSheet.getLastRow();
  if (lastRow > 1) {
    previewSheet
      .getRange(2, 1, lastRow - 1, 5)
      .clearContent();
  }

  if (output.length) {
    previewSheet
      .getRange(2, 1, output.length, 5)
      .setValues(output);
  }

  SpreadsheetApp.flush();
}

function schedulerTick() {
  const parts = Utilities
    .formatDate(new Date(), TZ, "H,m")
    .split(",")
    .map(Number);

  const minutes = parts[0] * 60 + parts[1];

  if (minutes >= 18 * 60 + 15 && minutes < 18 * 60 + 30) {
    refreshGeneralPreview_();
  }

  publishGeneralSchedules();
}

function taipeiTomorrowKey_() {
  const now = taipeiNowDate_();
  const tomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1
  );

  return [
    tomorrow.getMonth() + 1,
    tomorrow.getDate()
  ].join("/");
}

function allocateGroup_(candidates, people, seed) {
  const assignments = {};
  const state = schoolState_(candidates, []);

  const ordered = people.slice().sort(function(a, b) {
    if (a.movable !== b.movable) {
      return a.movable ? -1 : 1;
    }

    return hash_(seed + "|" + a.name) -
      hash_(seed + "|" + b.name);
  });

  ordered.forEach(function(person) {
    const school = chooseFromState_(
      state,
      person.movable,
      seed + "|" + person.name
    );

    assignments[person.name] = school.name;

    school.count++;
    if (person.movable) school.movableCount++;
  });

  return assignments;
}

function chooseSchool_(candidates, existing, movable, seed) {
  const state = schoolState_(candidates, existing);
  const school = chooseFromState_(state, movable, seed);
  return school.name;
}

function schoolState_(candidates, existing) {
  return candidates.map(function(t) {
    const name = text_(t["地點"]);
    const target = Number(text_(t["人數"])) || 0;

    const assigned = existing.filter(function(r) {
      return text_(r["指派學校"]) === name;
    });

    return {
      name: name,
      target: target,
      count: assigned.length,
      movableCount: assigned.filter(function(r) {
        return text_(r["可搬運"]) === "是";
      }).length
    };
  });
}

function chooseFromState_(state, movable, seed) {
  const candidates = state.slice();

  candidates.sort(function(a, b) {
    const aLoad = a.target > 0 ? a.count / a.target : a.count;
    const bLoad = b.target > 0 ? b.count / b.target : b.count;

    if (movable) {
      const aMove = a.target > 0
        ? a.movableCount / a.target
        : a.movableCount;

      const bMove = b.target > 0
        ? b.movableCount / b.target
        : b.movableCount;

      if (aMove !== bMove) return aMove - bMove;
    }

    if (aLoad !== bLoad) return aLoad - bLoad;

    return hash_(seed + "|" + a.name) -
      hash_(seed + "|" + b.name);
  });

  return candidates[0];
}

function workerMovable_(workers, name) {
  const found = workers.find(function(w) {
    return text_(w["姓名"]) === name;
  });

  if (!found) return false;

  const v = text_(found["可搬運"]).toLowerCase();

  return ["是", "yes", "y", "1", "true", "可"].indexOf(v) >= 0;
}

function isGeneralPublished_(dateText) {
  const taskDate = parseDate_(dateText);
  if (!taskDate) return false;

  const publishDate = new Date(
    taskDate.getFullYear(),
    taskDate.getMonth(),
    taskDate.getDate() - 1,
    18,
    30,
    0
  );

  return taipeiNowDate_().getTime() >= publishDate.getTime();
}

function isAfternoonOpen_(dateText, candidates) {
  const taskDate = parseDate_(dateText);
  if (!taskDate) return false;

  if (isWeekend_(taskDate)) return false;
  if (isHoliday_(dateText)) return false;

  const openTimes = candidates
    .map(function(t) {
      return text_(t["開放時間"]);
    })
    .filter(Boolean)
    .sort();

  const openTime = openTimes[0] || "11:30";
  const p = openTime.split(":");

  const openDate = new Date(
    taskDate.getFullYear(),
    taskDate.getMonth(),
    taskDate.getDate(),
    Number(p[0]) || 0,
    Number(p[1]) || 0,
    0
  );

  return taipeiNowDate_().getTime() >= openDate.getTime();
}

function isHoliday_(dateText) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(HOLIDAY_SHEET);

  if (!sheet) return false;

  const wanted = normalizeDateKey_(dateText);

  const values = sheet
    .getRange(2, 1, Math.max(sheet.getLastRow() - 1, 0), 1)
    .getDisplayValues();

  return values.some(function(r) {
    return normalizeDateKey_(r[0]) === wanted;
  });
}

function isWeekend_(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function findSignupRow_(rows, col, date, time, name, mode) {
  for (let i = 1; i < rows.length; i++) {
    if (
      text_(rows[i][col.date]) === date &&
      text_(rows[i][col.shiftTime]) === time &&
      text_(rows[i][col.name]) === name &&
      text_(rows[i][col.mode]) === mode
    ) {
      return i + 1;
    }
  }

  return -1;
}

function columns_(headers) {
  const col = {
    date: headers.indexOf("日期"),
    place: headers.indexOf("地點"),
    name: headers.indexOf("姓名"),
    until: headers.indexOf("可出勤到幾點"),
    time: headers.indexOf("填寫時間"),
    status: headers.indexOf("狀態"),
    cancelTime: headers.indexOf("取消時間"),
    shiftTime: headers.indexOf("班次時間"),
    assignedSchool: headers.indexOf("指派學校"),
    scheduleStatus: headers.indexOf("排程狀態"),
    publishedAt: headers.indexOf("公布時間"),
    mode: headers.indexOf("排程類型")
  };

  Object.keys(col).forEach(function(key) {
    if (col[key] < 0) {
      throw new Error(
        "「報名紀錄」欄位名稱不完整：" + key
      );
    }
  });

  return col;
}

function readObjects_(sheet) {
  const values = sheet
    .getDataRange()
    .getDisplayValues();

  if (!values.length) return [];

  const headers = values[0].map(text_);

  return values.slice(1).map(function(row) {
    return rowObject_(headers, row);
  });
}

function rowObject_(headers, row) {
  const o = {};

  headers.forEach(function(h, i) {
    o[h] = text_(row[i]);
  });

  return o;
}

function active_(r) {
  const status = text_(r["狀態"]);
  return !status || status === "已報名";
}

function setCell_(sheet, row, zeroBasedColumn, value) {
  sheet
    .getRange(row, zeroBasedColumn + 1)
    .setValue(value);
}

function parseDate_(raw) {
  const s = text_(raw);
  let m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);

  if (m) {
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3])
    );
  }

  m = s.match(/^(\d{1,2})[\/-](\d{1,2})$/);

  if (m) {
    const y = Number(
      Utilities.formatDate(
        new Date(),
        TZ,
        "yyyy"
      )
    );

    return new Date(
      y,
      Number(m[1]) - 1,
      Number(m[2])
    );
  }

  return null;
}

function normalizeDateKey_(raw) {
  const d = parseDate_(raw);
  if (!d) return "";

  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("/");
}

function taipeiNowDate_() {
  const parts = Utilities
    .formatDate(
      new Date(),
      TZ,
      "yyyy,M,d,H,m,s"
    )
    .split(",")
    .map(Number);

  return new Date(
    parts[0],
    parts[1] - 1,
    parts[2],
    parts[3],
    parts[4],
    parts[5]
  );
}

function now_() {
  return Utilities.formatDate(
    new Date(),
    TZ,
    "yyyy/MM/dd HH:mm:ss"
  );
}

function text_(v) {
  return String(v == null ? "" : v).trim();
}

function hash_(s) {
  let h = 2166136261;

  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
}

function installScheduleTrigger() {
  ScriptApp
    .getProjectTriggers()
    .filter(function(t) {
      return t.getHandlerFunction() === "schedulerTick" ||
        t.getHandlerFunction() === "publishGeneralSchedules";
    })
    .forEach(function(t) {
      ScriptApp.deleteTrigger(t);
    });

  ScriptApp
    .newTrigger("schedulerTick")
    .timeBased()
    .everyMinutes(5)
    .create();

  return "已建立每 5 分鐘檢查一次的預覽／公布觸發器";
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
