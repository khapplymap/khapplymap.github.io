"use client";

import { useEffect, useMemo, useState } from "react";

const SHEET_ID = "1bcZ1ZzsKq7Ji_QYu9ahb_TMcZLcxowX8DWpio7ehOsI";
const API_ENDPOINT = "https://script.google.com/macros/s/AKfycbzUSzoGVLRCaqBjE4B8Hbmy-viUuYW7pQSB5mlRaxj-pkE96y8W6K3uls2djftrCKrSBg/exec";

type Row = Record<string, string>;
type Task = Row;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

async function readSheet(sheetName: string): Promise<Row[]> {
  const url =
    "https://docs.google.com/spreadsheets/d/" +
    SHEET_ID +
    "/gviz/tq?tqx=out:json&sheet=" +
    encodeURIComponent(sheetName) +
    "&_=" +
    Date.now();

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("無法讀取 " + sheetName);

  const text = await response.text();
  const match = text.match(/setResponse\((.*)\);?\s*$/s);
  if (!match) throw new Error("Google Sheet 回傳格式錯誤");

  const data = JSON.parse(match[1]);
  const headers = (data.table.cols || []).map((col: any) => clean(col.label));

  return (data.table.rows || []).map((row: any) => {
    const result: Row = {};
    headers.forEach((header: string, index: number) => {
      const cell = row.c?.[index];
      result[header] = clean(cell?.f ?? cell?.v ?? "");
    });
    return result;
  });
}

function taskKey(row: Row) {
  return clean(row["日期"]) + "||" + clean(row["地點"]);
}

export default function ParttimeShiftPage() {
  const [workers, setWorkers] = useState<string[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [signups, setSignups] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<Record<number, { name: string; until: string }>>({});
  const [sending, setSending] = useState<number | null>(null);

  const loadAll = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [workerRows, taskRows, signupRows] = await Promise.all([
        readSheet("工讀生名單"),
        readSheet("工作任務"),
        readSheet("報名紀錄"),
      ]);

      setWorkers(
        workerRows
          .map((row) => clean(row["姓名"]))
          .filter(Boolean)
      );

      setTasks(
        taskRows.filter(
          (row) => clean(row["日期"]) && clean(row["地點"])
        )
      );

      setSignups(
        signupRows.filter((row) => clean(row["姓名"]))
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "讀取資料失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    const timer = window.setInterval(loadAll, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const signupMap = useMemo(() => {
    const map = new Map<string, Row[]>();
    signups.forEach((signup) => {
      const key = taskKey(signup);
      const list = map.get(key) || [];
      list.push(signup);
      map.set(key, list);
    });
    return map;
  }, [signups]);

  const updateForm = (index: number, field: "name" | "until", value: string) => {
    setForm((current) => ({
      ...current,
      [index]: {
        name: current[index]?.name || "",
        until: current[index]?.until || "",
        [field]: value,
      },
    }));
  };

  const submit = async (index: number, task: Task) => {
    const name = clean(form[index]?.name);
    const until = clean(form[index]?.until);

    if (!name) {
      setMessage("請先選擇姓名");
      return;
    }

    if (!until) {
      setMessage("請填寫可出勤到幾點");
      return;
    }

    setSending(index);
    setMessage("");

    try {
      const response = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
        },
        body: JSON.stringify({
          action: "signup",
          date: clean(task["日期"]),
          place: clean(task["地點"]),
          name,
          until,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || "送出失敗");
      }

      setMessage("已完成登記");
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "送出失敗");
    } finally {
      setSending(null);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f6f7fb",
        color: "#111827",
        padding: "20px 14px 40px",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ padding: "8px 2px 18px" }}>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800 }}>工讀排班</h1>
          <div style={{ color: "#6b7280", marginTop: 6 }}>
            選擇工作任務，登記你可以出勤到幾點
          </div>
        </div>

        {message && (
          <div
            style={{
              marginBottom: 14,
              padding: "12px 14px",
              borderRadius: 14,
              border: "1px solid #d1d5db",
              background: "#ffffff",
            }}
          >
            {message}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
            color: "#6b7280",
            fontSize: 14,
          }}
        >
          <span>{loading ? "同步中…" : "已同步 Google Sheet"}</span>
          <button
            type="button"
            onClick={loadAll}
            style={{
              border: "1px solid #d1d5db",
              background: "#fff",
              borderRadius: 10,
              padding: "8px 12px",
              fontWeight: 700,
            }}
          >
            重新整理
          </button>
        </div>

        {!loading && tasks.length === 0 && (
          <div style={cardStyle}>
            <div style={{ textAlign: "center", color: "#6b7280" }}>
              目前沒有工作任務
            </div>
          </div>
        )}

        {tasks.map((task, index) => {
          const people = signupMap.get(taskKey(task)) || [];
          const needed = clean(task["人數"]);
          const current = form[index] || { name: "", until: "" };

          return (
            <section key={index} style={cardStyle}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>
                    {clean(task["地點"])}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      marginTop: 9,
                    }}
                  >
                    <span style={pillStyle}>{clean(task["日期"])}</span>
                    {clean(task["時間"]) && (
                      <span style={pillStyle}>開始 {clean(task["時間"])}</span>
                    )}
                    {needed && (
                      <span style={pillStyle}>需求 {needed} 人</span>
                    )}
                  </div>
                </div>
                <div style={{ color: "#6b7280", fontSize: 14, whiteSpace: "nowrap" }}>
                  已登記 {people.length}
                  {needed ? "/" + needed : ""}
                </div>
              </div>

              <hr style={hrStyle} />

              <label style={labelStyle}>姓名</label>
              <select
                value={current.name}
                onChange={(e) => updateForm(index, "name", e.target.value)}
                style={inputStyle}
              >
                <option value="">請選擇姓名</option>
                {workers.map((worker) => (
                  <option key={worker} value={worker}>
                    {worker}
                  </option>
                ))}
              </select>

              <label style={labelStyle}>可出勤到幾點</label>
              <input
                type="time"
                step="900"
                value={current.until}
                onChange={(e) => updateForm(index, "until", e.target.value)}
                style={inputStyle}
              />

              <button
                type="button"
                onClick={() => submit(index, task)}
                disabled={sending === index}
                style={{
                  width: "100%",
                  marginTop: 14,
                  border: 0,
                  borderRadius: 14,
                  padding: "14px 16px",
                  background: "#111827",
                  color: "#fff",
                  fontSize: 16,
                  fontWeight: 800,
                  opacity: sending === index ? 0.6 : 1,
                }}
              >
                {sending === index ? "送出中…" : "確認可以上班"}
              </button>

              <hr style={hrStyle} />

              <div style={{ fontWeight: 800, marginBottom: 8 }}>目前可出勤人員</div>

              {people.length === 0 ? (
                <div style={{ textAlign: "center", color: "#6b7280", padding: 10 }}>
                  目前尚無人登記
                </div>
              ) : (
                people.map((person, personIndex) => (
                  <div
                    key={personIndex}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      border: "1px solid #eceff3",
                      background: "#fafafa",
                      borderRadius: 12,
                      padding: "10px 12px",
                      marginTop: 7,
                    }}
                  >
                    <strong>{clean(person["姓名"])}</strong>
                    <span style={{ color: "#0f766e", fontWeight: 800 }}>
                      {clean(person["可出勤到幾點"])}
                    </span>
                  </div>
                ))
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 20,
  padding: 18,
  marginBottom: 14,
  boxShadow: "0 10px 30px rgba(17,24,39,.06)",
};

const pillStyle: React.CSSProperties = {
  background: "#f3f4f6",
  borderRadius: 999,
  padding: "7px 10px",
  fontSize: 13,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontWeight: 700,
  margin: "12px 0 7px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 50,
  border: "1px solid #d1d5db",
  borderRadius: 14,
  background: "#fff",
  padding: "0 14px",
  fontSize: 16,
};

const hrStyle: React.CSSProperties = {
  border: 0,
  borderTop: "1px solid #e5e7eb",
  margin: "16px 0",
};
