"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import geoData from "./data/kaohsiung-districts.json";
import {
  baselineSchools,
  schoolsFromGooglePayloads,
  type GoogleSheetPayload,
  type School,
  type SheetKind,
} from "./data/school-sync";

type Coordinate = [number, number];
type Ring = Coordinate[];
type PolygonCoordinates = Ring[];
type MultiPolygonCoordinates = PolygonCoordinates[];

type DistrictFeature = {
  type: "Feature";
  properties: {
    TOWNCODE: string;
    TOWNNAME: string;
    TOWNENG: string;
  };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: PolygonCoordinates | MultiPolygonCoordinates;
  };
};

type ProgressKind = "existing" | "new";
type ProgressView = "completed" | "incomplete";
type SchoolLevelKey = "elementary" | "junior" | "senior" | "special";
type CountdownClock = {
  dateLabel: string;
  timeLabel: string;
  daysRemaining: number;
};

const features = geoData.features as DistrictFeature[];
const initialSchools = baselineSchools;
const ALL_DISTRICTS = "全區";
const SHEET_ID = "1QX5J-Ouq4zNDunI7slufWQRFG082ht0W9Zt3YJIXErk";
const SHEET_TABS: Array<{ name: string; kind: SheetKind }> = [
  { name: "既有載具", kind: "existing" },
  { name: "新載具", kind: "new" },
];

const districtOrder = [
  "鹽埕區", "鼓山區", "左營區", "楠梓區", "三民區", "新興區", "前金區", "苓雅區", "前鎮區", "旗津區", "小港區",
  "鳳山區", "林園區", "大寮區", "大樹區", "大社區", "仁武區", "鳥松區", "岡山區", "橋頭區", "燕巢區",
  "田寮區", "阿蓮區", "路竹區", "湖內區", "茄萣區", "永安區", "彌陀區", "梓官區", "旗山區", "美濃區",
  "六龜區", "甲仙區", "杉林區", "內門區", "茂林區", "桃源區", "那瑪夏區",
];

const schoolLevels: Array<{ key: SchoolLevelKey; label: string }> = [
  { key: "elementary", label: "國小" },
  { key: "junior", label: "國中" },
  { key: "senior", label: "高中" },
  { key: "special", label: "特教及實驗學校" },
];

const MAP_WIDTH = 650;
const MAP_HEIGHT = 820;
const MAP_PADDING = 28;
const DEADLINE_DATE = { year: 2026, month: 11, day: 13 };
const DAY_IN_MS = 86_400_000;
const taipeiDatePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const taipeiDateLabelFormatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});
const taipeiTimeLabelFormatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function countdownClockFor(now: Date): CountdownClock {
  const parts = Object.fromEntries(
    taipeiDatePartsFormatter
      .formatToParts(now)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
  const today = Date.UTC(parts.year, parts.month - 1, parts.day);
  const deadline = Date.UTC(DEADLINE_DATE.year, DEADLINE_DATE.month - 1, DEADLINE_DATE.day);
  return {
    dateLabel: taipeiDateLabelFormatter.format(now),
    timeLabel: taipeiTimeLabelFormatter.format(now),
    daysRemaining: Math.max(0, Math.ceil((deadline - today) / DAY_IN_MS)),
  };
}

// The southern port peninsula is presented as part of Qijin in this simplified
// city overview. It overlays the narrow westward spur in the source Xiaogang
// polygon so the two coastal districts read correctly at dashboard scale.
const qijinSouthernPortExtension: PolygonCoordinates = [[
  [120.31244, 22.51487],
  [120.28864, 22.54384],
  [120.28628, 22.54356],
  [120.28861, 22.54407],
  [120.28913, 22.54463],
  [120.28884, 22.54398],
  [120.29341, 22.53843],
  [120.29696, 22.54095],
  [120.30375, 22.53269],
  [120.30761, 22.53543],
  [120.31681, 22.52423],
  [120.32183, 22.52779],
  [120.30749, 22.54525],
  [120.3034, 22.54552],
  [120.31557, 22.55184],
  [120.32034, 22.55526],
  [120.31244, 22.51487],
]];

// The official boundary data also includes Kaohsiung-administered offshore
// islands far outside the city. Keep those shapes in the data, but fit the
// interactive viewport to metropolitan Kaohsiung so the map fills the canvas.
function isKaohsiungViewportPoint([lon, lat]: Coordinate) {
  return lon >= 120 && lon <= 121.2 && lat >= 22.3 && lat <= 23.7;
}

function coordinatesFor(feature: DistrictFeature): PolygonCoordinates[] {
  return feature.geometry.type === "Polygon"
    ? [feature.geometry.coordinates as PolygonCoordinates]
    : (feature.geometry.coordinates as MultiPolygonCoordinates);
}

function visibleCoordinatesFor(feature: DistrictFeature): PolygonCoordinates[] {
  const visiblePolygons = coordinatesFor(feature).filter((polygon) =>
    polygon.some((ring) => ring.some(isKaohsiungViewportPoint)),
  );
  return feature.properties.TOWNNAME === "旗津區"
    ? [...visiblePolygons, qijinSouthernPortExtension]
    : visiblePolygons;
}

function schoolType(name: string) {
  if (name.includes("國民中小學")) return "國中小";
  if (name.includes("國民小學")) return "國小";
  if (name.includes("國民中學")) return "國中";
  if (name.includes("特殊")) return "特教";
  if (name.includes("高級") || name.includes("工商職業") || name.includes("商業職業")) return "高中職";
  return "其他";
}

function schoolTypeFor(school: School) {
  return school.schoolCategory || schoolType(school.name);
}

function matchesSchoolLevel(school: School, level: SchoolLevelKey) {
  const type = schoolTypeFor(school);
  if (level === "elementary") return type === "國小";
  if (level === "junior") return type === "國中" || type === "國中小";
  if (level === "senior") return type === "高中職";
  return type === "特教" || type === "其他";
}

function normalizeSchoolSearchText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s·・‧,，.。()（）\-－_]/g, "")
    .replace(/高雄市(?:私立|立)?/g, "")
    .replace(/(?:學校)?財團法人/g, "")
    .replace(/(?:市立|私立|公立)/g, "")
    .replace(/女子高級中學/g, "女中")
    .replace(/男子高級中學/g, "男中")
    .replace(/高級家事商業職業學校/g, "家商")
    .replace(/高級工業職業學校/g, "高工")
    .replace(/高級商業職業學校/g, "高商")
    .replace(/高級工商職業學校/g, "工商")
    .replace(/高級藝術職業學校/g, "藝職")
    .replace(/高級職業學校/g, "高職")
    .replace(/高級中學/g, "高中")
    .replace(/國民中小學/g, "國中小")
    .replace(/國民中學/g, "國中")
    .replace(/國民小學/g, "國小")
    .replace(/特殊教育學校|特殊學校/g, "特教");
}

function isOrderedSchoolMatch(candidate: string, query: string) {
  let queryIndex = 0;
  for (const character of candidate) {
    if (character === query[queryIndex]) queryIndex += 1;
    if (queryIndex === query.length) return true;
  }
  return false;
}

function matchesSchoolQuery(school: School, query: string) {
  const normalizedQuery = normalizeSchoolSearchText(query);
  if (!normalizedQuery) return true;
  const candidates = [
    normalizeSchoolSearchText(school.name),
    normalizeSchoolSearchText(school.name.split(school.district).join("")),
  ];
  return candidates.some((candidate) => candidate.includes(normalizedQuery) || isOrderedSchoolMatch(candidate, normalizedQuery));
}

function progressFor(school: School, kind: ProgressKind) {
  return kind === "existing" ? school.existingImplementationProgress : school.newImplementationProgress;
}

function progressLabel(value?: string) {
  const label = String(value ?? "").trim();
  if (isProgressComplete(label)) return "已完成";
  return !label || /^(?:無資料|尚未填寫|待補資料|N\/?A|-)$/i.test(label) ? "未完成" : label;
}

function isProgressComplete(value?: string) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, "").toUpperCase();
  if (!normalized || /(未完成|未施作|尚未|部分完成|進行中)/.test(normalized)) return false;
  if (/^(?:V|OK)$/.test(normalized)) return true;
  return /(完成|已施作|100[%％])/.test(normalized);
}

function completionRateValue(completed: number, total: number) {
  return total ? (completed / total) * 100 : 0;
}

function completionRate(completed: number, total: number) {
  const rate = completionRateValue(completed, total);
  return `${Number.isInteger(rate) ? rate.toFixed(0) : rate.toFixed(1)}%`;
}

function fillForCount(count: number) {
  if (count >= 22) return "#1f6f78";
  if (count >= 15) return "#3c8f95";
  if (count >= 9) return "#67aaad";
  if (count >= 6) return "#99c5c6";
  return "#c8dfdf";
}

function SchoolIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10.25 12 5l9 5.25v1.5H3v-1.5Zm2 3h2v5H5v-5Zm4 0h2v5H9v-5Zm4 0h2v5h-2v-5Zm4 0h2v5h-2v-5ZM3 20h18v2H3v-2ZM11 2h2v2h-2V2Z" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 10.1A3.1 3.1 0 1 1 12 5.9a3.1 3.1 0 0 1 0 6.2Z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m20.5 19-4.2-4.2a7.2 7.2 0 1 0-1.5 1.5l4.2 4.2 1.5-1.5ZM5.1 10.7a5.6 5.6 0 1 1 11.2 0 5.6 5.6 0 0 1-11.2 0Z" />
    </svg>
  );
}

function loadGoogleSheet(sheetName: string) {
  return new Promise<GoogleSheetPayload>((resolve, reject) => {
    const callbackName = `__kaohsiungSchoolSync_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const callbackTarget = window as unknown as Record<string, unknown>;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => finish(() => reject(new Error("Google Sheets sync timed out"))), 12_000);

    function finish(action: () => void) {
      window.clearTimeout(timeout);
      script.remove();
      delete callbackTarget[callbackName];
      action();
    }

    callbackTarget[callbackName] = (payload: GoogleSheetPayload) => finish(() => resolve(payload));
    script.onerror = () => finish(() => reject(new Error("Google Sheets sync failed")));
    const url = new URL(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`);
    url.searchParams.set("tqx", `out:json;responseHandler:${callbackName}`);
    url.searchParams.set("headers", "1");
    url.searchParams.set("sheet", sheetName);
    url.searchParams.set("_", String(Date.now()));
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

export default function SchoolMapDashboard() {
  const [schools, setSchools] = useState<School[]>(initialSchools);
  const [syncState, setSyncState] = useState<"loading" | "synced" | "empty" | "unavailable">("loading");
  const [selectedDistrict, setSelectedDistrict] = useState("鳳山區");
  const [hoveredDistrict, setHoveredDistrict] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [panelRevision, setPanelRevision] = useState(0);
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  const [progressModal, setProgressModal] = useState<ProgressKind | null>(null);
  const [progressLevel, setProgressLevel] = useState<SchoolLevelKey | null>(null);
  const [progressView, setProgressView] = useState<ProgressView>("completed");
  const [countdownClock, setCountdownClock] = useState<CountdownClock | null>(null);

  useEffect(() => {
    const updateClock = () => setCountdownClock(countdownClockFor(new Date()));
    updateClock();
    const interval = window.setInterval(updateClock, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    let refreshInFlight = false;
    const controller = new AbortController();

    async function refreshSchools() {
      if (refreshInFlight || document.visibilityState === "hidden") return;
      refreshInFlight = true;

      try {
        const direct = schoolsFromGooglePayloads(await Promise.all(SHEET_TABS.map(async ({ name, kind }) => ({
          kind,
          payload: await loadGoogleSheet(name),
        }))));
        if (!active || direct.schools.length === 0) return;
        setSchools(direct.schools);
        setSyncState(direct.status);
        setSelectedSchool((current) => current
          ? direct.schools.find((school) => school.name === current.name) ?? current
          : null);
      } catch {
        try {
          const response = await fetch("/api/schools", { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error("School sync failed");
          const payload = await response.json() as {
            schools?: School[];
            status?: "synced" | "empty" | "unavailable";
          };
          if (!active || !Array.isArray(payload.schools) || payload.schools.length === 0) return;
          setSchools(payload.schools);
          setSyncState(payload.status ?? "unavailable");
        } catch (fallbackError) {
          if (active && !(fallbackError instanceof DOMException && fallbackError.name === "AbortError")) setSyncState("unavailable");
        }
      } finally {
        refreshInFlight = false;
      }
    }

    void refreshSchools();
    const interval = window.setInterval(refreshSchools, 10_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshSchools();
    };
    const handleFocus = () => void refreshSchools();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);

    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const schoolsByDistrict = useMemo(() => {
    const grouped = new Map<string, School[]>();
    for (const district of districtOrder) grouped.set(district, []);
    for (const school of schools) grouped.get(school.district)?.push(school);
    return grouped;
  }, [schools]);

  const counts = useMemo(
    () => new Map(districtOrder.map((district) => [district, schoolsByDistrict.get(district)?.length ?? 0])),
    [schoolsByDistrict],
  );

  const bounds = useMemo(() => {
    const points: Coordinate[] = [];
    for (const feature of features) {
      for (const polygon of visibleCoordinatesFor(feature)) {
        for (const ring of polygon) points.push(...ring.filter(isKaohsiungViewportPoint));
      }
    }
    return {
      minX: Math.min(...points.map(([x]) => x)),
      maxX: Math.max(...points.map(([x]) => x)),
      minY: Math.min(...points.map(([, y]) => y)),
      maxY: Math.max(...points.map(([, y]) => y)),
    };
  }, []);

  const projection = useMemo(() => {
    const usableWidth = MAP_WIDTH - MAP_PADDING * 2;
    const usableHeight = MAP_HEIGHT - MAP_PADDING * 2;
    const scale = Math.min(usableWidth / (bounds.maxX - bounds.minX), usableHeight / (bounds.maxY - bounds.minY));
    const renderedWidth = (bounds.maxX - bounds.minX) * scale;
    const renderedHeight = (bounds.maxY - bounds.minY) * scale;
    const offsetX = (MAP_WIDTH - renderedWidth) / 2;
    const offsetY = (MAP_HEIGHT - renderedHeight) / 2;
    return ([lon, lat]: Coordinate): Coordinate => [
      offsetX + (lon - bounds.minX) * scale,
      offsetY + (bounds.maxY - lat) * scale,
    ];
  }, [bounds]);

  const pathForFeature = (feature: DistrictFeature) =>
    visibleCoordinatesFor(feature)
      .map((polygon) =>
        polygon
          .map((ring) =>
            ring
              .map((point, index) => {
                const [x, y] = projection(point);
                return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
              })
              .join(" ") + " Z",
          )
          .join(" "),
      )
      .join(" ");

  const districtSchools = schoolsByDistrict.get(selectedDistrict) ?? [];
  const visibleDistrictSchools = selectedDistrict === ALL_DISTRICTS ? schools : districtSchools;
  const filteredSchools = visibleDistrictSchools.filter((school) => matchesSchoolQuery(school, query));
  const normalizedGlobalQuery = normalizeSchoolSearchText(globalQuery);
  const globalSearchResults = normalizedGlobalQuery
    ? schools.filter((school) => matchesSchoolQuery(school, normalizedGlobalQuery)).slice(0, 8)
    : [];
  const activeLabel = hoveredDistrict ?? selectedDistrict;
  const selectedCount = selectedDistrict === ALL_DISTRICTS ? schools.length : (counts.get(selectedDistrict) ?? 0);
  const activeCount = activeLabel === ALL_DISTRICTS ? schools.length : (counts.get(activeLabel) ?? 0);
  const selectedExistingCompleted = visibleDistrictSchools.filter((school) => isProgressComplete(school.existingImplementationProgress)).length;
  const selectedNewCompleted = visibleDistrictSchools.filter((school) => isProgressComplete(school.newImplementationProgress)).length;
  const existingProgress = useMemo(() => ({
    completed: schools.filter((school) => isProgressComplete(school.existingImplementationProgress)),
    incomplete: schools.filter((school) => !isProgressComplete(school.existingImplementationProgress)),
  }), [schools]);
  const newProgress = useMemo(() => ({
    completed: schools.filter((school) => isProgressComplete(school.newImplementationProgress)),
    incomplete: schools.filter((school) => !isProgressComplete(school.newImplementationProgress)),
  }), [schools]);
  const schoolLevelProgress = useMemo(() => {
    return schoolLevels.map(({ key, label }) => {
      const levelSchools = schools.filter((school) => matchesSchoolLevel(school, key));
      return {
        key,
        label,
        total: levelSchools.length,
        existingCompleted: levelSchools.filter((school) => isProgressComplete(school.existingImplementationProgress)).length,
        newCompleted: levelSchools.filter((school) => isProgressComplete(school.newImplementationProgress)).length,
      };
    });
  }, [schools]);
  const progressScopeSchools = progressLevel
    ? schools.filter((school) => matchesSchoolLevel(school, progressLevel))
    : schools;
  const activeProgress = {
    completed: progressScopeSchools.filter((school) => isProgressComplete(progressFor(school, progressModal ?? "existing"))),
    incomplete: progressScopeSchools.filter((school) => !isProgressComplete(progressFor(school, progressModal ?? "existing"))),
  };
  const activeProgressSchools = progressView === "completed" ? activeProgress.completed : activeProgress.incomplete;
  const activeProgressLevelLabel = schoolLevels.find((level) => level.key === progressLevel)?.label;
  const activeProgressLabel = `${activeProgressLevelLabel ? `${activeProgressLevelLabel} ` : ""}${progressModal === "existing" ? "既有載具施作進度" : "新載具施作進度"}`;

  function openProgress(kind: ProgressKind, level: SchoolLevelKey | null = null) {
    setSelectedSchool(null);
    setProgressModal(kind);
    setProgressLevel(level);
    setProgressView("completed");
  }

  function closeProgress() {
    setProgressModal(null);
    setProgressLevel(null);
  }

  function revealSchoolPanel() {
    setPanelRevision((revision) => revision + 1);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const panel = document.querySelector<HTMLElement>(".school-panel");
        if (!panel) return;
        if (window.matchMedia("(max-width: 1000px)").matches) {
          panel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        panel.focus({ preventScroll: true });
      });
    });
  }

  function selectDistrict(district: string, revealPanel = false) {
    setSelectedDistrict(district);
    setQuery("");
    setGlobalQuery("");
    setGlobalSearchOpen(false);
    setSelectedSchool(null);
    if (revealPanel) revealSchoolPanel();
  }

  function selectSchool(school: School) {
    setSelectedDistrict(school.district);
    setQuery(school.name);
    setGlobalQuery(school.name);
    setGlobalSearchOpen(false);
    revealSchoolPanel();
  }

  return (
    <main className="site-shell">
      <header className="topbar">
        <div className="brand-mark"><SchoolIcon /></div>
        <div className="brand-copy">
          <strong>高雄市載具施工進度追蹤圖</strong>
          <span>115 年中小學數位學習採購案</span>
        </div>
        <div className="topbar-pill" aria-live="polite">
          <span className={`status-dot status-${syncState}`} />
          {syncState === "loading" ? "同步資料中" : syncState === "synced" ? `已同步 · ${schools.length} 所` : syncState === "unavailable" ? `暫存資料 · ${schools.length} 所` : `資料共 ${schools.length} 所`}
        </div>
        <div className="deadline-widget" aria-live="polite" aria-label="目前日期時間與十一月十三日倒數">
          <time className="deadline-current">
            <span>{countdownClock?.dateLabel ?? "讀取時間中"}</span>
            {countdownClock && <span>{countdownClock.timeLabel}</span>}
          </time>
          <span className="deadline-countdown">
            距離 11/13 尚有 <strong>{countdownClock?.daysRemaining ?? "—"}</strong> 天
          </span>
        </div>
      </header>

      <section className="hero">
        <div className="hero-progress-center" aria-label="全市施工進度">
          <button type="button" className="summary-card progress-summary-card progress-existing" onClick={() => openProgress("existing")}>
            <span className="progress-card-label">既有載具進度</span>
            <span
              className="progress-ring"
              style={{ "--progress-angle": `${completionRateValue(existingProgress.completed.length, schools.length) * 3.6}deg` } as CSSProperties}
            >
              <span className="progress-ring-content">
                <strong>{completionRate(existingProgress.completed.length, schools.length)}</strong>
                <small>完成率</small>
              </span>
            </span>
            <span className="progress-card-count">已完成 {existingProgress.completed.length}／{schools.length} 所</span>
          </button>
          <button type="button" className="summary-card progress-summary-card progress-new" onClick={() => openProgress("new")}>
            <span className="progress-card-label">新載具進度</span>
            <span
              className="progress-ring"
              style={{ "--progress-angle": `${completionRateValue(newProgress.completed.length, schools.length) * 3.6}deg` } as CSSProperties}
            >
              <span className="progress-ring-content">
                <strong>{completionRate(newProgress.completed.length, schools.length)}</strong>
                <small>完成率</small>
              </span>
            </span>
            <span className="progress-card-count">已完成 {newProgress.completed.length}／{schools.length} 所</span>
          </button>
        </div>
        <div className="hero-right-stack">
          <section className="school-level-progress-panel" aria-labelledby="school-level-progress-title">
            <div className="school-level-progress-heading">
              <strong id="school-level-progress-title">各學制完成率</strong>
              <span>即時同步</span>
            </div>
            <div className="school-level-progress-grid">
              <span className="school-level-corner">載具</span>
              {schoolLevelProgress.map((level) => (
                <strong className="school-level-name" key={level.key}>{level.label}</strong>
              ))}

              <strong className="school-level-row-label existing">既有載具</strong>
              {schoolLevelProgress.map((level) => (
                <button
                  type="button"
                  className="school-level-progress-item existing"
                  key={`existing-${level.key}`}
                  aria-label={`查看${level.label}既有載具已完成學校`}
                  onClick={() => openProgress("existing", level.key)}
                >
                  <span
                    className="school-level-progress-ring"
                    style={{ "--school-level-progress-angle": `${completionRateValue(level.existingCompleted, level.total) * 3.6}deg` } as CSSProperties}
                  >
                    <strong>{completionRate(level.existingCompleted, level.total)}</strong>
                  </span>
                  <small>{level.existingCompleted}／{level.total} 所</small>
                </button>
              ))}

              <strong className="school-level-row-label new">新載具</strong>
              {schoolLevelProgress.map((level) => (
                <button
                  type="button"
                  className="school-level-progress-item new"
                  key={`new-${level.key}`}
                  aria-label={`查看${level.label}新載具已完成學校`}
                  onClick={() => openProgress("new", level.key)}
                >
                  <span
                    className="school-level-progress-ring"
                    style={{ "--school-level-progress-angle": `${completionRateValue(level.newCompleted, level.total) * 3.6}deg` } as CSSProperties}
                  >
                    <strong>{completionRate(level.newCompleted, level.total)}</strong>
                  </span>
                  <small>{level.newCompleted}／{level.total} 所</small>
                </button>
              ))}
            </div>
          </section>
          <div className="hero-summary-side" aria-label="資料摘要">
            <div className="summary-card"><strong>{schools.length}</strong><span>學校總數</span></div>
            <div className="summary-card selected"><strong>{selectedCount}</strong><span>{selectedDistrict}</span></div>
          </div>
        </div>
      </section>

      <section className="workspace" aria-label="高雄市學校互動地圖">
        <div className="map-card">
          <div className="card-heading">
            <div>
              <span className="section-label"><LocationIcon />互動地圖</span>
              <h2>高雄市行政區</h2>
            </div>
            <div className="district-controls">
              <button
                type="button"
                className={selectedDistrict === ALL_DISTRICTS ? "show-all-button active" : "show-all-button"}
                onClick={() => selectDistrict(ALL_DISTRICTS, true)}
              >
                <SchoolIcon />
                顯示全區
              </button>
              <label className="district-select-label">
                <span>選擇行政區</span>
                <select value={selectedDistrict} onChange={(event) => selectDistrict(event.target.value, true)}>
                  <option value={ALL_DISTRICTS}>全區（{schools.length} 所）</option>
                  {districtOrder.map((district) => <option key={district}>{district}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="global-school-search">
            <label className="global-search-field">
              <SearchIcon />
              <span className="sr-only">搜尋全部學校</span>
              <input
                value={globalQuery}
                onChange={(event) => {
                  setGlobalQuery(event.target.value);
                  setGlobalSearchOpen(true);
                }}
                onFocus={() => setGlobalSearchOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setGlobalSearchOpen(false);
                }}
                placeholder={`輸入校名或簡稱，如鳳山國中（共 ${schools.length} 所）`}
                autoComplete="off"
              />
              {globalQuery && (
                <button
                  type="button"
                  className="clear-search"
                  aria-label="清除全市學校搜尋"
                  onClick={() => {
                    setGlobalQuery("");
                    setGlobalSearchOpen(false);
                  }}
                >
                  ×
                </button>
              )}
            </label>

            {globalSearchOpen && normalizedGlobalQuery && (
              <div className="global-search-results" role="listbox" aria-label="全市學校搜尋結果">
                {globalSearchResults.length > 0 ? (
                  <>
                    <div className="global-results-meta">
                      <span>搜尋結果</span>
                      <span>最多顯示 8 所</span>
                    </div>
                    {globalSearchResults.map((school) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected="false"
                        key={school.id}
                        className="global-result-item"
                        onClick={() => selectSchool(school)}
                      >
                        <span className="result-school-icon"><SchoolIcon /></span>
                        <span className="result-school-copy">
                          <strong>{school.name}</strong>
                          <span>{school.district}</span>
                        </span>
                        <span className={`type-badge type-${schoolTypeFor(school)}`}>{schoolTypeFor(school)}</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <div className="global-no-results">
                    <SearchIcon />
                    <span>找不到符合「{globalQuery.trim()}」的學校</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="map-stage">
            <div className="map-status" aria-live="polite">
              <span>{activeLabel}</span>
              <strong>{activeCount} 所</strong>
            </div>
            <svg className="district-map" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="可點選的高雄市行政區地圖">
              <g>
                {features.map((feature) => {
                  const district = feature.properties.TOWNNAME;
                  const selected = selectedDistrict !== ALL_DISTRICTS && district === selectedDistrict;
                  return (
                    <path
                      key={feature.properties.TOWNCODE}
                      d={pathForFeature(feature)}
                      className={selected ? "district-shape selected" : "district-shape"}
                      fill={selected ? "#f2a65a" : fillForCount(counts.get(district) ?? 0)}
                      fillRule="evenodd"
                      role="button"
                      tabIndex={0}
                      aria-label={`${district}，${counts.get(district) ?? 0} 所學校`}
                      onMouseEnter={() => setHoveredDistrict(district)}
                      onMouseLeave={() => setHoveredDistrict(null)}
                      onFocus={() => setHoveredDistrict(district)}
                      onBlur={() => setHoveredDistrict(null)}
                      onClick={() => selectDistrict(district, true)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectDistrict(district, true);
                        }
                      }}
                    />
                  );
                })}
              </g>
            </svg>
            <div className="legend" aria-label="學校數量圖例">
              <span>學校較少</span>
              <i className="legend-scale" />
              <span>學校較多</span>
            </div>
          </div>
        </div>

        <aside key={panelRevision} className="school-panel" aria-labelledby="school-panel-title" tabIndex={-1}>
          <div className="panel-header">
            <div className="district-icon">{selectedDistrict === ALL_DISTRICTS ? <SchoolIcon /> : <LocationIcon />}</div>
            <div>
              <p>目前顯示</p>
              <h2 id="school-panel-title">{selectedDistrict}</h2>
            </div>
            <span className="school-count">{visibleDistrictSchools.length} 所</span>
          </div>

          <div className="district-progress-summary" aria-label={`${selectedDistrict}載具施工完成率`} aria-live="polite">
            <div className="district-progress-card district-progress-existing">
              <span
                className="district-progress-ring"
                style={{ "--district-progress-angle": `${completionRateValue(selectedExistingCompleted, visibleDistrictSchools.length) * 3.6}deg` } as CSSProperties}
              >
                <strong>{completionRate(selectedExistingCompleted, visibleDistrictSchools.length)}</strong>
              </span>
              <span className="district-progress-copy">
                <strong>既有載具完成率</strong>
                <small>{selectedExistingCompleted}／{visibleDistrictSchools.length} 所完成</small>
              </span>
            </div>
            <div className="district-progress-card district-progress-new">
              <span
                className="district-progress-ring"
                style={{ "--district-progress-angle": `${completionRateValue(selectedNewCompleted, visibleDistrictSchools.length) * 3.6}deg` } as CSSProperties}
              >
                <strong>{completionRate(selectedNewCompleted, visibleDistrictSchools.length)}</strong>
              </span>
              <span className="district-progress-copy">
                <strong>新載具完成率</strong>
                <small>{selectedNewCompleted}／{visibleDistrictSchools.length} 所完成</small>
              </span>
            </div>
          </div>

          <label className="search-field">
            <SearchIcon />
            <span className="sr-only">搜尋目前行政區學校</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜尋${selectedDistrict}學校或簡稱`} />
          </label>

          <div className="list-meta">
            <span>學校名稱</span>
            <span>{query ? `${filteredSchools.length} 筆結果` : selectedDistrict === ALL_DISTRICTS ? "跨 38 個行政區" : "依原始清單排序"}</span>
          </div>

          <ol className="school-list">
            {filteredSchools.map((school, index) => (
              <li key={school.id}>
                <button
                  type="button"
                  className="school-list-button"
                  aria-label={`查看${school.name}資料`}
                  onClick={() => setSelectedSchool(school)}
                >
                  <span className="school-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="school-name">
                    <strong>{school.name}</strong>
                    {selectedDistrict === ALL_DISTRICTS && <span>{school.district}</span>}
                  </span>
                  <span className={`type-badge type-${schoolTypeFor(school)}`}>{schoolTypeFor(school)}</span>
                  <span className="school-row-arrow" aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ol>

          {filteredSchools.length === 0 && (
            <div className="empty-state">
              <SearchIcon />
              <strong>找不到符合的學校</strong>
              <span>請嘗試其他關鍵字</span>
            </div>
          )}
        </aside>
      </section>

      {progressModal && (
        <div
          className="school-modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeProgress();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeProgress();
          }}
        >
          <section className="school-detail-modal progress-list-modal" role="dialog" aria-modal="true" aria-labelledby="progress-modal-title">
            <button type="button" className="modal-close" aria-label="關閉施作進度清單" autoFocus onClick={closeProgress}>×</button>
            <div className="modal-school-icon"><SchoolIcon /></div>
            <p>{progressLevel ? "各學制施作統計" : "全市施作統計"}</p>
            <h2 id="progress-modal-title">{activeProgressLabel}</h2>

            <div className="progress-tabs" aria-label="選擇施作進度">
              <button
                type="button"
                className={progressView === "completed" ? "active" : ""}
                onClick={() => setProgressView("completed")}
              >
                <strong>{activeProgress.completed.length}</strong>
                <span>已完成</span>
              </button>
              <button
                type="button"
                className={progressView === "incomplete" ? "active" : ""}
                onClick={() => setProgressView("incomplete")}
              >
                <strong>{activeProgress.incomplete.length}</strong>
                <span>未完成</span>
              </button>
            </div>

            <div className="progress-list-meta">
              <span>{progressView === "completed" ? "已完成學校" : "未完成學校"}</span>
              <span>{activeProgressSchools.length} 所</span>
            </div>

            {activeProgressSchools.length > 0 ? (
              <ul className="progress-school-list">
                {activeProgressSchools.map((school) => (
                  <li key={school.id}>
                    <button
                      type="button"
                      className="progress-school-button"
                      onClick={() => {
                        closeProgress();
                        setSelectedSchool(school);
                      }}
                    >
                      <span className="progress-school-copy">
                        <strong>{school.name}</strong>
                        <small>{school.district}</small>
                      </span>
                      <span className={isProgressComplete(progressFor(school, progressModal)) ? "progress-status complete" : "progress-status"}>
                        {progressLabel(progressFor(school, progressModal))}
                      </span>
                      <span className="school-row-arrow" aria-hidden="true">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="progress-empty-state">
                <SchoolIcon />
                <strong>目前沒有{progressView === "completed" ? "已完成" : "未完成"}學校</strong>
              </div>
            )}
          </section>
        </div>
      )}

      {selectedSchool && (
        <div
          className="school-modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedSchool(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setSelectedSchool(null);
          }}
        >
          <section className="school-detail-modal" role="dialog" aria-modal="true" aria-labelledby="school-detail-title">
            <button type="button" className="modal-close" aria-label="關閉學校資料" autoFocus onClick={() => setSelectedSchool(null)}>×</button>
            <div className="modal-school-icon"><SchoolIcon /></div>
            <p>學校資料</p>
            <h2 id="school-detail-title">{selectedSchool.name}</h2>
            <dl className="school-detail-grid">
              <div><dt>所屬行政區</dt><dd>{selectedSchool.district}</dd></div>
              <div><dt>學校類別</dt><dd><span className={`type-badge type-${schoolTypeFor(selectedSchool)}`}>{schoolTypeFor(selectedSchool)}</span></dd></div>
              <div>
                <dt>既有載具</dt>
                <dd className="equipment-summary">
                  <span className="equipment-item">
                    <small>類型</small>
                    {selectedSchool.deviceCategory ?? <span className="detail-pending">待補資料</span>}
                  </span>
                  <span className="equipment-item">
                    <small>數量</small>
                    {selectedSchool.deviceQuantity ?? <span className="detail-pending">待補資料</span>}
                  </span>
                </dd>
              </div>
              <div>
                <dt>既有載具施作進度</dt>
                <dd>
                  <span className={isProgressComplete(selectedSchool.existingImplementationProgress) ? "progress-value" : "progress-value incomplete"}>
                    {progressLabel(selectedSchool.existingImplementationProgress)}
                  </span>
                </dd>
              </div>
              <div>
                <dt>新載具</dt>
                <dd className="equipment-summary">
                  <span className="equipment-item">
                    <small>類型</small>
                    {selectedSchool.newDeviceCategory ?? <span className="detail-pending">待補資料</span>}
                  </span>
                  <span className="equipment-item">
                    <small>數量</small>
                    {selectedSchool.newDeviceQuantity ?? <span className="detail-pending">待補資料</span>}
                  </span>
                </dd>
              </div>
              <div>
                <dt>充電車</dt>
                <dd className="equipment-summary">
                  <span className="equipment-item">
                    <small>類型</small>
                    {selectedSchool.chargingCartSpec ?? <span className="detail-pending">待補資料</span>}
                  </span>
                  <span className="equipment-item">
                    <small>數量</small>
                    {selectedSchool.chargingCartQuantity ?? <span className="detail-pending">待補資料</span>}
                  </span>
                </dd>
              </div>
              <div>
                <dt>新載具施作進度</dt>
                <dd>
                  <span className={isProgressComplete(selectedSchool.newImplementationProgress) ? "progress-value" : "progress-value incomplete"}>
                    {progressLabel(selectedSchool.newImplementationProgress)}
                  </span>
                </dd>
              </div>
            </dl>
            <button
              type="button"
              className="modal-district-button"
              onClick={() => {
                const district = selectedSchool.district;
                setSelectedSchool(null);
                selectDistrict(district, true);
              }}
            >
              查看{selectedSchool.district}全部學校
            </button>
          </section>
        </div>
      )}

    </main>
  );
}
