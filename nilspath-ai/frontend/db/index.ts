import { getDatabase } from "@netlify/database";
import { drizzle } from "drizzle-orm/netlify-db";
import * as schema from "./schema.ts";
export const db = drizzle({ client: getDatabase(), schema });
