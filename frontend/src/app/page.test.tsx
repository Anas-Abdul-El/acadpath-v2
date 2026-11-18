import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import Home from "@/app/page";

afterEach(cleanup);

describe("Home page", () => {
  test("renders without crashing", () => {
    expect(() => render(<Home />)).not.toThrow();
  });

  test("renders no content yet", () => {
    const { container } = render(<Home />);
    expect(container.innerHTML).toBe("");
  });
});
