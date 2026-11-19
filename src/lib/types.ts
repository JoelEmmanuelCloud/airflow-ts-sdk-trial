export type Route = {
  id: string;
  name: string;
};

export type Trip = {
  tripId: string;
  routeId: string;
  serviceDate: string;
  scheduledAt: string;
  actualAt: string;
};

export type TripBatch = {
  asOf: string;
  serviceDate: string;
  newestTripAt: string | null;
  routes: Route[];
  trips: Trip[];
};

export type RouteDelay = {
  routeId: string;
  routeName: string;
  tripCount: number;
  averageDelayMinutes: number;
};

export type RouteStatus = "ok" | "degraded" | "bad";

export type RouteScore = RouteDelay & {
  status: RouteStatus;
};

export type ReportKind = "all_good" | "incident";

export type ReportDraft = {
  kind: ReportKind;
  serviceDate: string;
  markdown: string;
  scores: RouteScore[];
};

export type ReportFile = {
  kind: ReportKind;
  serviceDate: string;
  markdownPath: string;
  jsonPath: string;
  markdown: string;
  routesNeedingAttention: number;
};
