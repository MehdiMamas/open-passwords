import { ApplePasswords } from "../apple/protocol.js";
import { createMockClient } from "./mock-client.js";
import { MOCK_KIND } from "./mock-kind.js";

export function createClient() {
  if (MOCK_KIND) return createMockClient(MOCK_KIND);
  return new ApplePasswords();
}
