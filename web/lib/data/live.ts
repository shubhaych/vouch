// Every live read goes through a hook in hooks.ts and returns this shape, so a
// page can render all three states without knowing where the data comes from.
export type LiveStatus = "disconnected" | "loading" | "ready";
export interface Live<T> { status: LiveStatus; rows: T[] }

export const disconnected = <T,>(): Live<T> => ({ status: "disconnected", rows: [] });
