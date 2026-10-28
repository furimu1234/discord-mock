import { test, expect, describe, inject } from "vitest";
import { installE2ERunner } from "dismock/e2e";
installE2ERunner({ test, expect, describe, inject });
