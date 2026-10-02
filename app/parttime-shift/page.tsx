"use client";

import { useEffect, useMemo, useState } from "react";

const API =
  "https://script.google.com/macros/s/AKfycbzUSzoGVLRCaqBjE4B8Hbmy-viUuYW7pQSB5mlRaxj-pkE96y8W6K3uls2djftrCKrSBg/exec";

type Row = Record<string, string>;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function taskKey(row: Row) {
  return clean(row["日期"]) + "||" + clean(row["地點"]);
}

export default function ParttimeShiftPage() {
  const [workers, setWorkers] = useState<string[]>([]);
  const [tasks, setTasks] = useState<Row[]>([]);
  const [signups, setSignups] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"ok" | "error">("ok");
  const [sending, setSending] = useState<number | null>(null);

  const [form, setForm] = useState<
    Record<number, { name: string; hour: string; minute: string }>
  >({});

  const loadAll = async () => {
    setLoading(true);

    try {
      const response = await fetch(API + "?action=load&_=" + Date.now(), {
        cache: "no-store",
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "讀取排班資料失敗");
      }

      setWorkers(
        Array.isArray(data.workers)
          ? data.workers.map((v: unknown) => clean(v)).filter(Boolean)
          : []
      );

      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      setSignups(Array.isArray(data.signups) ? data.signups : []);
    } catch (error) {
      setMessageType("error");
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

  const updateForm = (
    index: number,
    field: "name" | "hour" | "minute",
    value: string
  ) => {
    setForm((current) => ({
      ...current,
      [index]: {
        name: current[index]?.name || "",
        hour: current[index]?.hour || "",
        minute: current[index]?.minute || "",
        [field]: value,
      },
    }));
  };

  const showMessage = (text: string, type: "ok" | "error") => {
    setMessageType(type);
    setMessage(text);

    window.setTimeout(() => {
      setMessage("");
    }, 3000);
  };

  const submit = async (index: number, task: Row) => {
    const current = form[index] || {
      name: "",
      hour: "",
      minute: "",
    };

    const name = clean(current.name);
    const hour = clean(current.hour);
    const minute = clean(current.minute);

    if (!name) {
      showMessage("請先選擇姓名", "error");
      return;
    }

    if (!hour || !minute) {
      showMessage("請選擇可出勤到幾點", "error");
      return;
    }

    const until = hour + ":" + minute;

    setSending(index);

    try {
      const response = await fetch(API, {
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

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "送出失敗");
      }

      showMessage(
        data.updated ? "已更新你的可出勤時間" : "已完成登記",
        "ok"
      );

      await loadAll();
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "送出失敗",
        "error"
      );
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
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800 }}>
            工讀排班
          </h1>

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
              border:
                messageType === "error"
                  ? "1px solid #fecaca"
                  : "1px solid #a7f3d0",
              background:
                messageType === "error" ? "#fef2f2" : "#ecfdf5",
              color:
                messageType === "error" ? "#991b1b" : "#065f46",
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
          <span>{loading ? "同步中…" : "已同步"}</span>

          <button
            type="button"
            onClick={loadAll}
            style={{
              border: "1px solid #d1d5db",
              background: "#fff",
              borderRadius: 10,
              padding: "8px 12px",
              fontWeight: 700,
              cursor: "pointer",
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

          const current = form[index] || {
            name: "",
            hour: "",
            minute: "",
          };

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
                    <span style={pillStyle}>
                      {clean(task["日期"])}
                    </span>

                    {clean(task["時間"]) && (
                      <span style={pillStyle}>
                        開始 {clean(task["時間"])}
                      </span>
                    )}

                    {needed && (
                      <span style={pillStyle}>
                        需求 {needed} 人
                      </span>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    color: "#6b7280",
                    fontSize: 14,
                    whiteSpace: "nowrap",
                  }}
                >
                  已登記 {people.length}
                  {needed ? "/" + needed : ""}
                </div>
              </div>

              <hr style={hrStyle} />

              <label style={labelStyle}>姓名</label>

              <select
                value={current.name}
                onChange={(e) =>
                  updateForm(index, "name", e.target.value)
                }
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

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto 1fr",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <select
                  value={current.hour}
                  onChange={(e) =>
                    updateForm(index, "hour", e.target.value)
                  }
                  style={inputStyle}
                >
                  <option value="">小時</option>

                  {Array.from({ length: 24 }, (_, hour) => {
                    const value = String(hour).padStart(2, "0");

                    return (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    );
                  })}
                </select>

                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: "#6b7280",
                  }}
                >
                  :
                </div>

                <select
                  value={current.minute}
                  onChange={(e) =>
                    updateForm(index, "minute", e.target.value)
                  }
                  style={inputStyle}
                >
                  <option value="">分鐘</option>
                  <option value="00">00</option>
                  <option value="15">15</option>
                  <option value="30">30</option>
                  <option value="45">45</option>
                </select>
              </div>

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
                  cursor: "pointer",
                  opacity: sending === index ? 0.6 : 1,
                }}
              >
                {sending === index
                  ? "送出中…"
                  : "確認可以上班"}
              </button>

              <hr style={hrStyle} />

              <div
                style={{
                  fontWeight: 800,
                  marginBottom: 8,
                }}
              >
                目前可出勤人員
              </div>

              {people.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    color: "#6b7280",
                    padding: 10,
                  }}
                >
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

                    <span
                      style={{
                        color: "#0f766e",
                        fontWeight: 800,
                      }}
                    >
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
  color: "#111827",
  padding: "0 14px",
  fontSize: 16,
};

const hrStyle: React.CSSProperties = {
  border: 0,
  borderTop: "1px solid #e5e7eb",
  margin: "16px 0",
};
