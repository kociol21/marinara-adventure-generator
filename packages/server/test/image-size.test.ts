import { describe, expect, it } from "vitest";
import { squareImageSize } from "../src/connections/adapters.ts";

describe("square image sizes", () => {
  it("pick the listed value closest to a 1024px square", async () => {
    const pick = (resolutions: string[], aspectRatios: string[] = []) => squareImageSize({ resolutions, aspectRatios });
    expect(pick(["768x768", "1024x1024", "2048x2048"])).toEqual({ size: "1024x1024" });
    expect(pick(["1536x1024", "1024x1536", "1536x1536"])).toEqual({ size: "1536x1536" });
    expect(pick(["2048*2048", "2560*1440"])).toEqual({ size: "2048*2048" });
    expect(pick(["1024x768", "1536x1024"])).toEqual({ size: "1024x768" });
    expect(pick(["2k", "1.5k", "4k"], ["1:1"])).toEqual({ size: "1.5k", aspect_ratio: "1:1" });
    expect(pick(["landscape_4_3", "square_hd", "square"])).toEqual({ size: "square_hd" });
    expect(pick(["16:9", "1:1"])).toEqual({ size: "1:1" });
    expect(pick([])).toEqual({ size: "1024x1024" });
    expect(squareImageSize(undefined)).toEqual({ size: "1024x1024" });
  });
});
