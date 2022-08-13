import { validateSchema } from "../schema";

describe("schema", () => {
  it("loads empty list", () => {
    validateSchema("[]");
  });
});
