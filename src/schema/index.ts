/**
 * Canonical schema for Fleet Architect. Every entity that is persisted, shared,
 * or simulated is defined here. Types are inferred from these schemas; runtime
 * validation uses `.parse()` / `.safeParse()`.
 */
export * from "./primitives";
export * from "./module";
export * from "./armor";
export * from "./ship";
export * from "./ai";
export * from "./fleet";
export * from "./battle";
