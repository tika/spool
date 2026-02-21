import { HelixDB } from "helix-ts";

const HELIX_URL = process.env.HELIX_URL || "http://localhost:6969";

export const helix = new HelixDB(HELIX_URL);
