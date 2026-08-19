import schoolData from "./schools.json";

export type School = {
  id: number;
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

function normalized(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, "");
}

function normalizedHeader(value: unknown) {
  return normalized(value).replace(/[_\-（）()：:]/g, "").toLowerCase();
}

export function readRemoteSchools(table: GoogleTable, kind: SheetKind): School[] {
  const headers = (table.cols ?? []).map((column) => normalizedHeader(column.label));
  const findColumn = (...aliases: string[]) => {
    const candidates = aliases.map(normalizedHeader);
    return headers.findIndex((header) => candidates.includes(header));
  };
  const indexes = {
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
  };

  if (indexes.name < 0) return [];

  const valueAt = (cells: GoogleCell[], index: number) => {
    if (index < 0) return undefined;
    const value = cells[index]?.v;
    return value === null || value === undefined || String(value).trim() === "" ? undefined : value;
  };

  return (table.rows ?? []).flatMap((row, index) => {
    const cells = row.c ?? [];
    const name = String(valueAt(cells, indexes.name) ?? "").trim();
    if (!name) return [];
    return [{
      id: index + 1,
      name,
      district: String(valueAt(cells, indexes.district) ?? "").trim(),
      schoolCategory: valueAt(cells, indexes.schoolCategory) as string | undefined,
      deviceCategory: valueAt(cells, indexes.deviceCategory) as string | undefined,
      deviceQuantity: valueAt(cells, indexes.deviceQuantity) as number | string | undefined,
      existingImplementationProgress: valueAt(cells, indexes.existingImplementationProgress) as string | undefined,
      newDeviceCategory: valueAt(cells, indexes.newDeviceCategory) as string | undefined,
      newDeviceQuantity: valueAt(cells, indexes.newDeviceQuantity) as number | string | undefined,
      chargingCartSpec: valueAt(cells, indexes.chargingCartSpec) as string | undefined,
      chargingCartQuantity: valueAt(cells, indexes.chargingCartQuantity) as number | string | undefined,
      newImplementationProgress: valueAt(cells, indexes.newImplementationProgress) as string | undefined,
    }];
  });
}

export function mergeSchools(remoteSchools: School[]) {
  const merged = baselineSchools.map((school) => ({ ...school }));
  const byName = new Map(merged.map((school) => [normalized(school.name), school]));
  let matchedRows = 0;

  for (const remote of remoteSchools) {
    const existing = byName.get(normalized(remote.name));
    if (existing) {
      const definedFields = Object.fromEntries(
        Object.entries(remote).filter(([, value]) => value !== undefined && value !== ""),
      ) as Partial<School>;
      Object.assign(existing, definedFields, { id: existing.id, district: remote.district || existing.district });
      matchedRows += 1;
      continue;
    }

    if (remote.district) {
      const added = { ...remote, id: merged.length + 1 };
      merged.push(added);
      byName.set(normalized(added.name), added);
    }
  }

  return { schools: merged, matchedRows };
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
      const definedFields = Object.fromEntries(
        Object.entries(school).filter(([, value]) => value !== undefined && value !== ""),
      ) as Partial<School>;
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
