/**
 * スキーマ定義の変換ヘルパーおよびフォーム状態 ⇔ レコード変換 (JS-02).
 */

/**
 * 1つの条件次元における match_* / exclude_* 配列から 3状態マップを作成する.
 * @param {string[]} matchArr
 * @param {string[]} excludeArr
 * @returns {Record<string, "match" | "exclude">}
 */
export function arraysToTriStateMap(matchArr, excludeArr) {
  /** @type {Record<string, "match" | "exclude">} */
  const map = {};
  if (Array.isArray(matchArr)) {
    for (const v of matchArr) {
      if (v) map[String(v)] = "match";
    }
  }
  if (Array.isArray(excludeArr)) {
    for (const v of excludeArr) {
      if (v) map[String(v)] = "exclude";
    }
  }
  return map;
}

/**
 * 3状態マップから { match: string[], exclude: string[] } に分解する.
 * @param {Record<string, string>} triMap
 * @param {string[]} [optionOrder]
 * @returns {{ match: string[], exclude: string[] }}
 */
export function triStateMapToArrays(triMap, optionOrder = []) {
  const match = [];
  const exclude = [];
  if (!triMap || typeof triMap !== "object") {
    return { match, exclude };
  }
  const keys =
    optionOrder && optionOrder.length > 0
      ? [...new Set([...optionOrder, ...Object.keys(triMap)])]
      : Object.keys(triMap);

  for (const k of keys) {
    const st = triMap[k];
    if (st === "match") {
      match.push(k);
    } else if (st === "exclude") {
      exclude.push(k);
    }
  }
  return { match, exclude };
}

/**
 * レコード辞書をフォーム状態オブジェクトに変換する (JS-02).
 * @param {"event" | "group" | "member"} kind
 * @param {Record<string, any>} record
 * @param {Record<string, any>} schema
 * @returns {Record<string, any>}
 */
export function recordToFormState(kind, record, schema) {
  const rec = record || {};
  const fieldDefs =
    kind === "event"
      ? schema.events
      : kind === "group"
        ? schema.groups
        : schema.members;

  /** @type {Record<string, any>} */
  const values = {};
  for (const f of fieldDefs || []) {
    const raw = rec[f.name];
    if (f.kind === "multi") {
      values[f.name] = Array.isArray(raw) ? [...raw] : [];
    } else if (f.kind === "int") {
      values[f.name] =
        raw === null || raw === undefined || raw === "" ? "" : String(raw);
    } else {
      values[f.name] =
        raw === null || raw === undefined ? "" : String(raw);
    }
  }

  /** @type {Record<string, Record<string, "match" | "exclude">>} */
  const conditions = {};
  if (kind === "event" || kind === "group") {
    for (const dim of schema.condition_dimensions || []) {
      if (dim.kind === "multi") {
        conditions[dim.key] = arraysToTriStateMap(
          rec[dim.match_field],
          rec[dim.exclude_field]
        );
      }
    }
  }

  return {
    kind,
    values,
    conditions,
  };
}

/**
 * フォーム状態オブジェクトをサーバー送信・保存用のレコード辞書に戻す (JS-02).
 * @param {"event" | "group" | "member"} kind
 * @param {Record<string, any>} formState
 * @param {Record<string, any>} schema
 * @returns {Record<string, any>}
 */
export function formStateToRecord(kind, formState, schema) {
  const values = (formState && formState.values) || {};
  const conditions = (formState && formState.conditions) || {};
  const fieldDefs =
    kind === "event"
      ? schema.events
      : kind === "group"
        ? schema.groups
        : schema.members;

  const dataType =
    kind === "member" ? values.data_type || "人物" : null;

  /** @type {Record<string, any>} */
  const out = {};

  for (const f of fieldDefs || []) {
    if (
      kind === "member" &&
      dataType === "人物" &&
      ["pet_type", "pet_health_condition", "pet_vulnerabilities", "pet_skills"].includes(
        f.name
      )
    ) {
      continue;
    }

    const raw = values[f.name];
    if (f.kind === "multi") {
      out[f.name] = Array.isArray(raw) ? [...raw] : [];
    } else if (f.kind === "int") {
      if (raw === null || raw === undefined || String(raw).trim() === "") {
        out[f.name] = null;
      } else {
        const parsed = Number(String(raw).trim());
        out[f.name] = Number.isNaN(parsed) ? raw : Math.trunc(parsed);
      }
    } else {
      const strVal =
        raw === null || raw === undefined ? "" : String(raw).trim();
      if (kind === "member" && f.name === "statement") {
        out[f.name] = strVal;
      } else if (kind === "member" && f.name === "relationship" && dataType === "ペット") {
        out[f.name] = strVal || "ペット";
      } else {
        out[f.name] = strVal === "" ? null : strVal;
      }
    }
  }

  if (kind === "event" || kind === "group") {
    for (const dim of schema.condition_dimensions || []) {
      if (dim.kind === "multi" && conditions[dim.key]) {
        const { match, exclude } = triStateMapToArrays(
          conditions[dim.key],
          dim.options || []
        );
        out[dim.match_field] = match;
        out[dim.exclude_field] = exclude;
      }
    }
  }

  return out;
}
