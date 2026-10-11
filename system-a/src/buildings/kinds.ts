/**
 * How a style is planned inside: a house, a block of flats, offices, a shed
 * or a civic hall. New styles register their kind; unknown styles are offices.
 */
export type PlanKind = "house" | "apartments" | "office" | "industrial" | "civic";

const kinds = new Map<string, PlanKind>([
  ["suburban-house", "house"],
  ["apartment", "apartments"],
  ["brick-midrise", "apartments"],
  ["industrial", "industrial"],
  ["civic", "civic"],
]);

export function planKind(style: string): PlanKind {
  return kinds.get(style) ?? "office";
}

export function registerPlanKind(style: string, kind: PlanKind): void {
  kinds.set(style, kind);
}
