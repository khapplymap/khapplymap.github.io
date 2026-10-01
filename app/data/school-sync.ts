import schoolData from "./schools.json";

export type School = {
  id: number;
  code?: string;
  district: string;
  name: string;
  schoolCategory?: string;
  deviceCategory?: string;
  deviceQuantity?: number | string;
  existingImplementationProgress?: string;
  newDeviceCategory?: string;
  newDeviceQuantity?: number | string;
  chargingCartSpec?: string;
  chargingCartQuantity?: number | string;
  newImplementationProgress?: string;
  newDevices?: EquipmentItem[];
  chargingCarts?: EquipmentItem[];
};

export type EquipmentItem = {
  type: string;
  quantity: number;
};

type GoogleCell = { v?: unknown } | null;
export type GoogleTable = {
  cols?: Array<{ label?: string }>;
  rows?: Array<{ c?: GoogleCell[] }>;
};

export type GoogleSheetPayload = {
  status?: string;
  table?: GoogleTable;
};

export type SheetKind = "existing" | "new";

export const baselineSchools = schoolData as School[];

const PROGRESS_FIELDS = new Set<keyof School>([
  "existingImplementationProgress",
  "newImplementationProgress",
]);

function normalized(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, "");
}

function schoolNameKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/（[^）]*）|\([^)]*\)/g, "")
    .replace(/[\s·・‧,，.。()（）\-－_]/g, "")
    .replace(/臺/g, "台")
    .replace(/(?:學校)?財團法人/g, "")
    .replace(/高雄市(?:私立|立)?/g, "")
    .replace(/(?:市立|私立|公立)/g, "")
    .replace(/女子高級中學/g, "女中")
    .replace(/男子高級中學/g, "男中")
    .replace(/高級家事商業職業學校/g, "家商")
    .replace(/高級工業職業學校/g, "高工")
    .replace(/高級商業職業學校/g, "高商")
    .replace(/高級工商職業學校/g, "工商")
    .replace(/高級藝術職業學校/g, "藝校")
    .replace(/高級職業學校/g, "高職")
    .replace(/高級中學|高中/g, "中學")
    .replace(/國民中小學/g, "國中小")
    .replace(/國民中學/g, "國中")
    .replace(/國民小學/g, "國小")
    .replace(/特殊教育學校|特殊學校/g, "特教學校");
}

function schoolCoreKey(value: unknown) {
  return schoolNameKey(value)
    .replace(/^(?:天主教|佛光山)/, "")
    .replace(/(?:實驗中學|實驗學校|特教學校|國中小|中學|國中|國小|工商|家商|高工|高商|高職|藝校)$/, "")
    .replace(/^立志志/, "立志")
    .replace(/^(.{2,})\1/, "$1");
}

function matchingSchool(schools: School[], remote: School) {
  if (remote.code) {
    const sameCode = schools.find((school) => school.code === remote.code);
    if (sameCode) return sameCode;
  }

  // A school that has already been bound to a distribution code must never
  // accept a different row through fuzzy name matching (for example
  // KH057 中山國中 and KH250 中山高中). Unbound baseline rows may still use
  // their name once so the initial import can attach the authoritative code.
  const candidates = remote.code
    ? schools.filter((school) => !school.code)
    : schools;

  const exact = candidates.find((school) => normalized(school.name) === normalized(remote.name));
  if (exact) return exact;

  const nameKey = schoolNameKey(remote.name);
  const sameName = candidates.filter((school) => schoolNameKey(school.name) === nameKey);
  if (sameName.length === 1) return sameName[0];
  const sameDistrictName = sameName.find((school) => school.district === remote.district);
  if (sameDistrictName) return sameDistrictName;

  const coreKey = schoolCoreKey(remote.name);
  const sameCore = candidates.filter((school) => schoolCoreKey(school.name) === coreKey);
  if (sameCore.length === 1) return sameCore[0];
  return sameCore.find((school) => school.district === remote.district);
}

function normalizedHeader(value: unknown) {
  return normalized(value).replace(/[_\-（）()：:]/g, "").toLowerCase();
}

function definedSchoolFields(school: School) {
  return Object.fromEntries(
    Object.entries(school).filter(([key, value]) =>
      !["id", "name", "district"].includes(key)
      && value !== undefined
      && (value !== "" || PROGRESS_FIELDS.has(key as keyof School)),
    ),
  ) as Partial<School>;
}

export function readRemoteSchools(table: GoogleTable, kind: SheetKind): School[] {
  const headers = (table.cols ?? []).map((column) => normalizedHeader(column.label));
  const findColumn = (...aliases: string[]) => {
    const candidates = aliases.map(normalizedHeader);
    return headers.findIndex((header) => candidates.includes(header));
  };
  const indexes = {
    code: findColumn("編號", "學校編號", "代碼"),
    name: findColumn("學校名稱", "學校", "校名"),
    district: findColumn("行政區", "所屬行政區", "區域"),
    schoolCategory: findColumn("學校類別", "學校類型"),
    deviceCategory: kind === "existing" ? findColumn("既有載具類型", "既有載具類別", "載具類型", "載具類別", "類型") : -1,
    deviceQuantity: kind === "existing" ? findColumn("既有載具數量", "既有載具數", "載具數量", "數量") : -1,
    existingImplementationProgress: kind === "existing" ? findColumn("既有載具施作進度", "既有載具進度", "施作進度") : -1,
    newDeviceCategory: kind === "new" ? findColumn("新載具類型", "新載具類別", "載具類型", "載具類別", "類型") : -1,
    newDeviceQuantity: kind === "new" ? findColumn("新載具數量", "新載具數", "載具數量", "數量") : -1,
    newImplementationProgress: kind === "new" ? findColumn("新載具施作進度", "新載具進度", "施作進度") : -1,
    chargingCartSpec: findColumn("充電車類型", "充電車規格", "既有充電車類型"),
    chargingCartQuantity: findColumn("充電車數量", "充電車數"),
    ipad: kind === "new" ? findColumn("iPad OS", "iPadOS", "iPad") : -1,
    windows: kind === "new" ? findColumn("Windows", "Windows OS") : -1,
    chromeOs: kind === "new" ? findColumn("Chrome OS", "ChromeOS", "Chromebook") : -1,
    cart20U: kind === "new" ? findColumn("20U") : -1,
    cart30To32U: kind === "new" ? findColumn("30-32U", "30～32U") : -1,
    cart34To36U: kind === "new" ? findColumn("34-36U", "34～36U") : -1,
    cart42U: kind === "new" ? findColumn("42U") : -1,
  };

  if (indexes.name < 0) return [];

  const valueAt = (cells: GoogleCell[], index: number) => {
    if (index < 0) return undefined;
    const value = cells[index]?.v;
    return value === null || value === undefined || String(value).trim() === "" ? undefined : value;
  };

  const progressValueAt = (cells: GoogleCell[], index: number) => {
    if (index < 0) return undefined;
    const value = cells[index]?.v;
    return value === null || value === undefined ? "" : String(value).trim();
  };

  const positiveNumberAt = (cells: GoogleCell[], index: number) => {
    const value = valueAt(cells, index);
    if (value === undefined) return 0;
    const number = Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
  };

  return (table.rows ?? []).flatMap((row, index) => {
    const cells = row.c ?? [];
    const name = String(valueAt(cells, indexes.name) ?? "").trim();
    if (!name) return [];
    const newDevices: EquipmentItem[] = kind === "new"
      ? [
          { type: "iPad", quantity: positiveNumberAt(cells, indexes.ipad) },
          { type: "Windows", quantity: positiveNumberAt(cells, indexes.windows) },
          { type: "Chromebook", quantity: positiveNumberAt(cells, indexes.chromeOs) },
        ].filter((item) => item.quantity > 0)
      : [];
    const carts36U = positiveNumberAt(cells, indexes.cart30To32U) + positiveNumberAt(cells, indexes.cart34To36U);
    const chargingCarts: EquipmentItem[] = kind === "new"
      ? [
          { type: "24U", quantity: positiveNumberAt(cells, indexes.cart20U) },
          { type: "36U", quantity: carts36U },
          { type: "42U", quantity: positiveNumberAt(cells, indexes.cart42U) },
        ].filter((item) => item.quantity > 0)
      : [];
    return [{
      id: index + 1,
      code: String(valueAt(cells, indexes.code) ?? "").trim() || undefined,
      name,
      district: String(valueAt(cells, indexes.district) ?? "").trim(),
      schoolCategory: valueAt(cells, indexes.schoolCategory) as string | undefined,
      deviceCategory: valueAt(cells, indexes.deviceCategory) as string | undefined,
      deviceQuantity: valueAt(cells, indexes.deviceQuantity) as number | string | undefined,
      existingImplementationProgress: progressValueAt(cells, indexes.existingImplementationProgress),
      newDeviceCategory: valueAt(cells, indexes.newDeviceCategory) as string | undefined,
      newDeviceQuantity: valueAt(cells, indexes.newDeviceQuantity) as number | string | undefined,
      chargingCartSpec: valueAt(cells, indexes.chargingCartSpec) as string | undefined,
      chargingCartQuantity: valueAt(cells, indexes.chargingCartQuantity) as number | string | undefined,
      newImplementationProgress: progressValueAt(cells, indexes.newImplementationProgress),
      ...(kind === "new" ? { newDevices, chargingCarts } : {}),
    }];
  });
}

export function mergeSchools(remoteSchools: School[]) {
  const merged = baselineSchools.map((school) => ({ ...school }));
  let matchedRows = 0;

  for (const remote of remoteSchools) {
    const existing = matchingSchool(merged, remote);
    if (existing) {
      const definedFields = definedSchoolFields(remote);
      Object.assign(existing, definedFields, { id: existing.id, district: remote.district || existing.district });
      matchedRows += 1;
      continue;
    }

    if (remote.district) {
      const added = { ...remote, id: merged.length + 1 };
      merged.push(added);
    }
  }

  return { schools: merged, matchedRows };
}

export function updateSchoolsFromGooglePayload(
  currentSchools: School[],
  kind: SheetKind,
  payload: GoogleSheetPayload,
) {
  if (payload.status !== "ok" || !payload.table) throw new Error(`Google Sheets ${kind} query failed`);

  const next = currentSchools.map((school) => ({ ...school }));
  const remoteSchools = readRemoteSchools(payload.table, kind);

  for (const remote of remoteSchools) {
    const existing = matchingSchool(next, remote);
    if (!existing) continue;
    Object.assign(existing, definedSchoolFields(remote), {
      id: existing.id,
      district: remote.district || existing.district,
    });
  }

  return next;
}

export function schoolsFromGooglePayloads(sheets: Array<{ kind: SheetKind; payload: GoogleSheetPayload }>) {
  const combinedByName = new Map<string, School>();
  let sheetRows = 0;

  for (const { kind, payload } of sheets) {
    if (payload.status !== "ok" || !payload.table) throw new Error(`Google Sheets ${kind} query failed`);
    const remoteSchools = readRemoteSchools(payload.table, kind);
    sheetRows += remoteSchools.length;
    for (const school of remoteSchools) {
      const key = normalized(school.name);
      const current = combinedByName.get(key);
      const definedFields = definedSchoolFields(school);
      combinedByName.set(key, { ...(current ?? school), ...definedFields } as School);
    }
  }

  const remoteSchools = [...combinedByName.values()];
  return {
    ...mergeSchools(remoteSchools),
    sheetRows,
    status: sheetRows > 0 ? "synced" as const : "empty" as const,
  };
}
