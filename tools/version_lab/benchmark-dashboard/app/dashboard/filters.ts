import type { TriageFilters } from "./types";

export function parsePercent(value: string | null, fallback: number) {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback;
}

export function parsePage(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed - 1 : 0;
}

export function normalizeTriageFilters(filters: TriageFilters): TriageFilters {
  const firstBound = Math.max(0, Math.min(100, filters.minimum));
  const secondBound = Math.max(0, Math.min(100, filters.maximum));
  return {
    ...filters,
    minimum: Math.min(firstBound, secondBound),
    maximum: Math.max(firstBound, secondBound),
    page: Number.isInteger(filters.page) ? Math.max(0, filters.page) : 0,
  };
}

export function triageQuery(filters: TriageFilters) {
  const query = new URLSearchParams();
  query.set("dimension", filters.dimension);
  if (filters.search.trim()) query.set("q", filters.search.trim());
  if (filters.minimum > 0) query.set("min", String(filters.minimum));
  if (filters.maximum < 100) query.set("max", String(filters.maximum));
  if (filters.sort !== "lowest") query.set("sort", filters.sort);
  if (filters.page > 0) query.set("page", String(filters.page + 1));
  return query;
}

export function hrefWithTriageFilters(path: string, filters: TriageFilters) {
  const query = triageQuery(filters);
  return query.size ? `${path}?${query.toString()}` : path;
}
