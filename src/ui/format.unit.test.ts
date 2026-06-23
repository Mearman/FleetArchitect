import { describe, expect, it } from "vitest";
import { formatJoules, formatSi, formatWatts } from "@/ui/format";

describe("formatSi", () => {
  it("renders zero without a prefix", () => {
    expect(formatSi(0, "J")).toBe("0 J");
    expect(formatSi(0, "W")).toBe("0 W");
  });

  it("renders sub-kilo magnitudes in the base unit", () => {
    expect(formatSi(500, "J")).toBe("500 J");
    expect(formatSi(42, "W")).toBe("42 W");
    expect(formatSi(8.5, "J")).toBe("8.5 J");
  });

  it("picks the tightest prefix for kilo-scale", () => {
    expect(formatSi(1000, "J")).toBe("1 kJ");
    expect(formatSi(1500, "W")).toBe("1.5 kW");
    expect(formatSi(42_000, "J")).toBe("42 kJ");
  });

  it("picks the tightest prefix for mega-scale", () => {
    expect(formatSi(1_000_000, "W")).toBe("1 MW");
    expect(formatSi(2.5e7, "J")).toBe("25 MJ");
    expect(formatSi(3.2e8, "W")).toBe("320 MW");
  });

  it("picks the tightest prefix for giga-scale", () => {
    expect(formatSi(1_500_000_000, "J")).toBe("1.5 GJ");
    expect(formatSi(3.42e9, "W")).toBe("3.42 GW");
    expect(formatSi(6e9, "J")).toBe("6 GJ");
  });

  it("steps up to tera when the coefficient would otherwise exceed 1000", () => {
    expect(formatSi(1e12, "W")).toBe("1 TW");
    expect(formatSi(2.3e12, "J")).toBe("2.3 TJ");
  });

  it("caps at the tera prefix rather than running out of steps", () => {
    expect(formatSi(5e15, "J")).toBe("5000 TJ");
  });

  it("preserves the sign of negative values", () => {
    expect(formatSi(-3_000_000, "W")).toBe("-3 MW");
    expect(formatSi(-1.5e9, "J")).toBe("-1.5 GJ");
  });
});

describe("formatJoules", () => {
  it("formats representative structure and shield magnitudes", () => {
    // GJ-scale structure
    expect(formatJoules(3_400_000_000)).toBe("3.4 GJ");
    // MJ-scale shield capacity
    expect(formatJoules(200_000_000)).toBe("200 MJ");
    expect(formatJoules(600_000_000)).toBe("600 MJ");
  });
});

describe("formatWatts", () => {
  it("formats representative reactor and shield-recharge magnitudes", () => {
    // GW-scale reactor output
    expect(formatWatts(1_500_000_000)).toBe("1.5 GW");
    expect(formatWatts(5_000_000_000)).toBe("5 GW");
    // MW-scale shield recharge
    expect(formatWatts(20_000_000)).toBe("20 MW");
    expect(formatWatts(60_000_000)).toBe("60 MW");
  });
});
