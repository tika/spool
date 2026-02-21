import { HelixDB } from "helix-ts";

const HELIX_URL = process.env.HELIX_URL || "http://localhost:3000/api/query";

export const helix = new HelixDB(HELIX_URL);
